package main

import (
	"math"
	"sort"
	"strings"

	pb "github.com/harkawataryan/concertify/ranker/pb"
)

// Ranking math, kept free of gRPC types where practical so it can be unit
// tested directly. Mirrors the reference implementation that used to live in
// the Node API (services/recommender.js) so results stay comparable.

const (
	distanceScaleMi = 40.0  // proximity halves every ~28 miles
	dateScaleDays   = 120.0 // soonness decay
	likedBoost      = 0.15
)

func defaultWeights() *pb.Weights {
	return &pb.Weights{Direct: 0.55, Genre: 0.30, Proximity: 0.08, Soon: 0.07}
}

var stopTokens = map[string]bool{"music": true, "and": true, "the": true, "of": true, "other": true, "undefined": true, "misc": true}

type vec map[string]float64

// genreVectors builds exact-label and word-token vectors from weighted
// genre labels, the same way the taste profile is built upstream.
func genreVectors(labels []string, weight float64) (exact, tokens vec) {
	exact, tokens = vec{}, vec{}
	for _, g := range labels {
		g = strings.ToLower(strings.TrimSpace(g))
		if g == "" {
			continue
		}
		exact[g] += weight
		toks := tokenize(g)
		for _, t := range toks {
			tokens[t] += weight / float64(len(toks))
		}
	}
	return exact, tokens
}

func tokenize(genre string) []string {
	f := func(r rune) bool { return r == ' ' || r == '/' || r == '&' || r == ',' || r == '-' }
	var out []string
	for _, t := range strings.FieldsFunc(strings.ToLower(genre), f) {
		if t != "" && !stopTokens[t] {
			out = append(out, t)
		}
	}
	return out
}

func cosine(a, b vec) float64 {
	if len(a) == 0 || len(b) == 0 {
		return 0
	}
	var dot, na, nb float64
	for _, v := range a {
		na += v * v
	}
	for _, v := range b {
		nb += v * v
	}
	small, large := a, b
	if len(b) < len(a) {
		small, large = b, a
	}
	for k, v := range small {
		if w, ok := large[k]; ok {
			dot += v * w
		}
	}
	if na == 0 || nb == 0 {
		return 0
	}
	return dot / math.Sqrt(na*nb)
}

type genreVec struct{ exact, tokens vec }

func profileVec(p *pb.Profile) genreVec {
	if p == nil {
		return genreVec{vec{}, vec{}}
	}
	return genreVec{vec(p.GenreExact), vec(p.GenreTokens)}
}

func genreSimilarity(a, b genreVec) float64 {
	return 0.6*cosine(a.exact, b.exact) + 0.4*cosine(a.tokens, b.tokens)
}

// components is a plain copy of pb.Components so scored values can be
// copied freely (protobuf messages carry a mutex and must not be).
type components struct{ direct, genre, proximity, soon float64 }

func (c components) pb() *pb.Components {
	return &pb.Components{Direct: c.direct, Genre: c.genre, Proximity: c.proximity, Soon: c.soon}
}

type scored struct {
	id       string
	artistID string
	affinity float64
	comp     components
	gv       genreVec
}

// scoreOne computes the component scores and weighted affinity for a
// candidate against one profile, using the given direct weight.
func scoreOne(c *pb.Candidate, direct float64, profile genreVec, w *pb.Weights) scored {
	ex, tok := genreVectors(c.Genres, 1)
	gv := genreVec{ex, tok}
	genre := genreSimilarity(gv, profile)

	proximity := 0.5
	if c.DistanceMi >= 0 {
		proximity = math.Exp(-c.DistanceMi / distanceScaleMi)
	}
	soon := 0.5
	if c.DaysOut >= 0 {
		soon = math.Exp(-c.DaysOut / dateScaleDays)
	}
	aff := w.Direct*direct + w.Genre*genre + w.Proximity*proximity + w.Soon*soon
	if c.Liked {
		aff += likedBoost
	}
	if aff > 1 {
		aff = 1
	}
	return scored{
		id: c.Id, artistID: c.ArtistId, affinity: round3(aff), gv: gv,
		comp: components{direct: round3(direct), genre: round3(genre), proximity: round3(proximity), soon: round3(soon)},
	}
}

func weightsOrDefault(w *pb.Weights) *pb.Weights {
	if w == nil || w.Direct+w.Genre+w.Proximity+w.Soon == 0 {
		return defaultWeights()
	}
	return w
}

// rank scores every candidate, drops the ones with no signal at all, and
// returns the MMR-diversified top `limit` plus every scored candidate.
func rank(req *pb.RankRequest) (top, all []scored) {
	w := weightsOrDefault(req.Weights)
	profile := profileVec(req.Profile)
	for _, c := range req.Candidates {
		s := scoreOne(c, c.Direct, profile, w)
		if s.comp.direct == 0 && s.comp.genre == 0 {
			continue
		}
		all = append(all, s)
	}
	limit := int(req.Limit)
	if limit <= 0 {
		limit = 20
	}
	top = rerankForDiversity(all, limit, req.Diversity)
	return top, all
}

// rerankForDiversity is maximal marginal relevance: greedily pick the item
// maximizing (1-d)*affinity - d*maxSimilarityToPicked.
func rerankForDiversity(items []scored, limit int, diversity float64) []scored {
	remaining := make([]scored, len(items))
	copy(remaining, items)
	// Deterministic starting order: best affinity first.
	sort.SliceStable(remaining, func(i, j int) bool { return remaining[i].affinity > remaining[j].affinity })
	var picked []scored
	for len(picked) < limit && len(remaining) > 0 {
		bestIdx, bestScore := 0, math.Inf(-1)
		for i, r := range remaining {
			redundancy := 0.0
			for _, p := range picked {
				if s := genreSimilarity(r.gv, p.gv); s > redundancy {
					redundancy = s
				}
			}
			mmr := (1-diversity)*r.affinity - diversity*redundancy
			if mmr > bestScore {
				bestScore, bestIdx = mmr, i
			}
		}
		picked = append(picked, remaining[bestIdx])
		remaining = append(remaining[:bestIdx], remaining[bestIdx+1:]...)
	}
	return picked
}

type groupScored struct {
	id         string
	groupScore float64
	perMember  []*pb.MemberScore
	comp       components
}

// rankGroup scores each candidate for every member and blends the mean with
// the minimum ("least misery") so one superfan can't drag the group.
func rankGroup(req *pb.RankGroupRequest) []groupScored {
	w := weightsOrDefault(req.Weights)
	meanW, minW := req.MeanWeight, req.MinWeight
	if meanW+minW == 0 {
		meanW, minW = 0.7, 0.3
	}
	profiles := make([]genreVec, len(req.Members))
	for i, m := range req.Members {
		profiles[i] = profileVec(m.Profile)
	}
	n := float64(len(req.Members))
	var out []groupScored
	for _, c := range req.Candidates {
		var sum, min float64 = 0, math.Inf(1)
		var best scored
		bestAff := -1.0
		per := make([]*pb.MemberScore, 0, len(req.Members))
		for i, m := range req.Members {
			s := scoreOne(c, c.DirectByMember[m.Id], profiles[i], w)
			if s.comp.direct == 0 && s.comp.genre == 0 {
				s.affinity = 0
			}
			per = append(per, &pb.MemberScore{MemberId: m.Id, Affinity: s.affinity})
			sum += s.affinity
			if s.affinity < min {
				min = s.affinity
			}
			if s.affinity > bestAff {
				bestAff, best = s.affinity, s
			}
		}
		if bestAff <= 0 || n == 0 {
			continue
		}
		sort.SliceStable(per, func(i, j int) bool { return per[i].Affinity > per[j].Affinity })
		out = append(out, groupScored{id: c.Id, groupScore: round3(meanW*sum/n + minW*min), perMember: per, comp: best.comp})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].groupScore > out[j].groupScore })
	limit := int(req.Limit)
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out
}

func round3(x float64) float64 { return math.Round(x*1000) / 1000 }

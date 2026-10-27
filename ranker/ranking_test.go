package main

import (
	"testing"

	pb "github.com/harkawataryan/concertify/ranker/pb"
)

func profileOf(genres ...string) *pb.Profile {
	ex, tok := genreVectors(genres, 1)
	return &pb.Profile{GenreExact: ex, GenreTokens: tok}
}

func cand(id string, direct float64, genres ...string) *pb.Candidate {
	return &pb.Candidate{Id: id, ArtistId: id, Direct: direct, Genres: genres, DistanceMi: 5, DaysOut: 10}
}

func TestRankOrdersDirectAboveGenreAndDropsNoSignal(t *testing.T) {
	req := &pb.RankRequest{
		Profile: profileOf("indie rock", "shoegaze"),
		Candidates: []*pb.Candidate{
			cand("country", 0, "country"),
			cand("genre-match", 0, "rock", "alternative rock"),
			cand("fav", 1, "indie rock"),
		},
		Limit: 10,
	}
	top, all := rank(req)
	if len(all) != 2 {
		t.Fatalf("expected 2 scored, got %d", len(all))
	}
	if top[0].id != "fav" || top[1].id != "genre-match" {
		t.Fatalf("unexpected order: %v", ids(top))
	}
	if top[0].comp.direct != 1 || top[0].comp.genre == 0 {
		t.Fatalf("bad components: %+v", top[0].comp)
	}
}

func TestProximityAndSoonDecay(t *testing.T) {
	near := scoreOne(&pb.Candidate{Id: "n", Direct: 1, DistanceMi: 0, DaysOut: 0}, 1, genreVec{vec{}, vec{}}, defaultWeights())
	far := scoreOne(&pb.Candidate{Id: "f", Direct: 1, DistanceMi: 180, DaysOut: 200}, 1, genreVec{vec{}, vec{}}, defaultWeights())
	unknown := scoreOne(&pb.Candidate{Id: "u", Direct: 1, DistanceMi: -1, DaysOut: -1}, 1, genreVec{vec{}, vec{}}, defaultWeights())
	if !(near.affinity > unknown.affinity && unknown.affinity > far.affinity) {
		t.Fatalf("expected near > unknown > far, got %v %v %v", near.affinity, unknown.affinity, far.affinity)
	}
	if unknown.comp.proximity != 0.5 || unknown.comp.soon != 0.5 {
		t.Fatalf("unknown distance/date should be neutral: %+v", unknown.comp)
	}
}

func TestDiversityPromotesDifferentGenre(t *testing.T) {
	items := []scored{
		{id: "a", affinity: 0.9, gv: gvOf("pop")},
		{id: "b", affinity: 0.85, gv: gvOf("pop")},
		{id: "c", affinity: 0.6, gv: gvOf("jazz")},
	}
	if got := ids(rerankForDiversity(items, 3, 0)); got != "a,b,c" {
		t.Fatalf("no diversity: %s", got)
	}
	if got := ids(rerankForDiversity(items, 3, 0.4)); got != "a,c,b" {
		t.Fatalf("with diversity: %s", got)
	}
}

func TestLearnedWeightsChangeRanking(t *testing.T) {
	cands := []*pb.Candidate{cand("fav", 1, "country"), cand("match", 0, "indie rock")}
	profile := profileOf("indie rock")
	def, _ := rank(&pb.RankRequest{Profile: profile, Candidates: cands, Limit: 2})
	genreHeavy, _ := rank(&pb.RankRequest{Profile: profile, Candidates: cands, Limit: 2, Weights: &pb.Weights{Direct: 0.1, Genre: 0.8, Proximity: 0.05, Soon: 0.05}})
	if def[0].id != "fav" || genreHeavy[0].id != "match" {
		t.Fatalf("weights ignored: default=%s learned=%s", def[0].id, genreHeavy[0].id)
	}
}

func TestRankGroupLeastMisery(t *testing.T) {
	req := &pb.RankGroupRequest{
		Members: []*pb.Member{{Id: "ana", Profile: profileOf("indie rock")}, {Id: "ben", Profile: profileOf("country")}},
		Candidates: []*pb.Candidate{
			{Id: "shared", Genres: []string{"indie rock"}, DirectByMember: map[string]float64{"ana": 1, "ben": 1}, DistanceMi: 2, DaysOut: 5},
			{Id: "ana-only", Genres: []string{"indie rock"}, DirectByMember: map[string]float64{"ana": 1}, DistanceMi: 2, DaysOut: 5},
			{Id: "nobody", Genres: []string{"polka"}, DistanceMi: 2, DaysOut: 5},
		},
		Limit: 10,
	}
	out := rankGroup(req)
	if len(out) != 2 || out[0].id != "shared" {
		t.Fatalf("unexpected group ranking: %+v", out)
	}
	anaOnly := out[1]
	if anaOnly.perMember[0].MemberId != "ana" || anaOnly.perMember[1].Affinity != 0 {
		t.Fatalf("per-member scores wrong: %+v", anaOnly.perMember)
	}
	mean := (anaOnly.perMember[0].Affinity + anaOnly.perMember[1].Affinity) / 2
	if anaOnly.groupScore >= mean {
		t.Fatalf("least-misery should pull below the mean: %v >= %v", anaOnly.groupScore, mean)
	}
}

func gvOf(g ...string) genreVec {
	ex, tok := genreVectors(g, 1)
	return genreVec{ex, tok}
}

func ids(s []scored) string {
	out := ""
	for i, x := range s {
		if i > 0 {
			out += ","
		}
		out += x.id
	}
	return out
}

// Command ranker serves Concertify's ranking math over gRPC.
//
// It is stateless: every request carries the listener profile, the
// candidates and the weights to use, so instances scale horizontally and
// the Node API stays the only thing that talks to Spotify and Ticketmaster.
package main

import (
	"context"
	"log"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"

	pb "github.com/harkawataryan/concertify/ranker/pb"
)

var (
	rpcLatency = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "ranker_rpc_duration_seconds",
		Help:    "Latency of ranking RPCs",
		Buckets: []float64{.0005, .001, .0025, .005, .01, .025, .05, .1, .25, .5, 1},
	}, []string{"method"})
	batchSize = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "ranker_candidates_per_request",
		Help:    "Candidates scored per request",
		Buckets: []float64{1, 5, 10, 25, 50, 100, 250, 500, 1000},
	}, []string{"method"})
)

type server struct {
	pb.UnimplementedRankerServer
}

func (s *server) Rank(_ context.Context, req *pb.RankRequest) (*pb.RankResponse, error) {
	t := prometheus.NewTimer(rpcLatency.WithLabelValues("Rank"))
	defer t.ObserveDuration()
	batchSize.WithLabelValues("Rank").Observe(float64(len(req.Candidates)))

	top, all := rank(req)
	resp := &pb.RankResponse{}
	for _, s := range top {
		resp.Results = append(resp.Results, &pb.Scored{Id: s.id, Affinity: s.affinity, Components: s.comp.pb()})
	}
	for _, s := range all {
		resp.All = append(resp.All, &pb.Scored{Id: s.id, Affinity: s.affinity, Components: s.comp.pb()})
	}
	return resp, nil
}

func (s *server) RankGroup(_ context.Context, req *pb.RankGroupRequest) (*pb.RankGroupResponse, error) {
	t := prometheus.NewTimer(rpcLatency.WithLabelValues("RankGroup"))
	defer t.ObserveDuration()
	batchSize.WithLabelValues("RankGroup").Observe(float64(len(req.Candidates)))

	resp := &pb.RankGroupResponse{}
	for _, g := range rankGroup(req) {
		resp.Results = append(resp.Results, &pb.GroupScored{Id: g.id, GroupScore: g.groupScore, PerMember: g.perMember, Components: g.comp.pb()})
	}
	return resp, nil
}

func main() {
	addr := env("RANKER_ADDR", "0.0.0.0:50051")
	metricsAddr := env("RANKER_METRICS_ADDR", "0.0.0.0:9091")

	lis, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("listen %s: %v", addr, err)
	}
	gs := grpc.NewServer(grpc.ConnectionTimeout(5 * time.Second))
	pb.RegisterRankerServer(gs, &server{})
	healthpb.RegisterHealthServer(gs, health.NewServer())

	go func() {
		mux := http.NewServeMux()
		mux.Handle("/metrics", promhttp.Handler())
		mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte(`{"ok":true}`)) })
		log.Printf("ranker metrics on %s", metricsAddr)
		log.Fatal(http.ListenAndServe(metricsAddr, mux))
	}()

	log.Printf("ranker listening on %s", addr)
	if err := gs.Serve(lis); err != nil {
		log.Fatal(err)
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

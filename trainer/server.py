"""gRPC Trainer service: fits per-user ranking weights from feedback."""

import logging
import os
import time
from concurrent import futures

import grpc

import concertify_pb2 as pb
import concertify_pb2_grpc as pb_grpc
from model import FEATURES, HAVE_TORCH, fit_weights

log = logging.getLogger("trainer")


class TrainerServicer(pb_grpc.TrainerServicer):
    def Train(self, request, context):
        started = time.perf_counter()
        examples = [
            {"features": {f: getattr(e.features, f) for f in FEATURES}, "label": int(e.label)}
            for e in request.examples
        ]
        prior = {f: getattr(request.prior, f) for f in FEATURES} if request.HasField("prior") else None
        if prior and not any(prior.values()):
            prior = None
        result = fit_weights(examples, prior=prior, l2=request.l2)
        log.info(
            "train examples=%d personalized=%s loss=%.4f ms=%.1f",
            result["examples"], result["personalized"], result["loss"], (time.perf_counter() - started) * 1000,
        )
        return pb.TrainResponse(
            weights=pb.Weights(**result["weights"]),
            personalized=result["personalized"],
            examples=result["examples"],
            loss=result["loss"],
        )


def serve(addr):
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
    pb_grpc.add_TrainerServicer_to_server(TrainerServicer(), server)
    server.add_insecure_port(addr)
    server.start()
    log.info("trainer listening on %s (backend=%s)", addr, "torch" if HAVE_TORCH else "numpy")
    server.wait_for_termination()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    serve(os.environ.get("TRAINER_ADDR", "0.0.0.0:50052"))

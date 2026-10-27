# Trainer

gRPC service that fits per-user ranking weights (`Trainer.Train` in `../proto/concertify.proto`). A logistic regression over the four component scores, L2-regularized toward the global weights, implemented in PyTorch with a NumPy fallback when torch is not installed. Semantics match `server/src/services/learning.js`, which the Node server uses when `TRAINER_ADDR` is unset or the call fails.

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple
./gen.sh                      # regenerate concertify_pb2*.py from the proto
.venv/bin/python -m pytest    # unit tests
TRAINER_ADDR=0.0.0.0:50052 .venv/bin/python server.py
```

Point the Node server at it with `TRAINER_ADDR=127.0.0.1:50052`.

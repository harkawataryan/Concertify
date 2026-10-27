#!/bin/sh
# Starts the Go ranker, the Python trainer and the Node API in one
# container. If any process exits, the container exits so the platform
# restarts it rather than running degraded.
set -eu

RANKER_ADDR="${RANKER_ADDR:-127.0.0.1:50051}" RANKER_METRICS_ADDR="${RANKER_METRICS_ADDR:-127.0.0.1:9091}" /app/bin/ranker &
RANKER_PID=$!

TRAINER_ADDR="${TRAINER_ADDR:-127.0.0.1:50052}" /app/trainer/.venv/bin/python /app/trainer/server.py &
TRAINER_PID=$!

node /app/src/index.js &
NODE_PID=$!

trap 'kill $RANKER_PID $TRAINER_PID $NODE_PID 2>/dev/null' INT TERM

# Wait for the first process to exit, then stop the rest.
while kill -0 $RANKER_PID 2>/dev/null && kill -0 $TRAINER_PID 2>/dev/null && kill -0 $NODE_PID 2>/dev/null; do
  sleep 2
done
kill $RANKER_PID $TRAINER_PID $NODE_PID 2>/dev/null
exit 1

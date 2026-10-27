#!/usr/bin/env sh
# Regenerates the gRPC stubs from ../proto/concertify.proto.
set -e
cd "$(dirname "$0")"
PY=${PYTHON:-.venv/bin/python}
"$PY" -m grpc_tools.protoc -I ../proto --python_out=. --grpc_python_out=. ../proto/concertify.proto

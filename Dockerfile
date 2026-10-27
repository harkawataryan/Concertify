# Single image running three processes: the Go ranking service, the
# Python/PyTorch trainer, and the Node API which serves the built client
# and talks to the other two over gRPC on localhost.

FROM node:22-bookworm-slim AS client
WORKDIR /client
COPY client/package*.json ./
RUN npm ci
COPY client ./
RUN npm run build

FROM golang:1.24-bookworm AS ranker
WORKDIR /src
COPY ranker/go.mod ranker/go.sum ./
RUN go mod download
COPY ranker ./
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /ranker .

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    CLIENT_DIST=/app/client-dist \
    RANKER_ADDR=127.0.0.1:50051 \
    TRAINER_ADDR=127.0.0.1:50052 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Trainer: CPU-only PyTorch keeps the image and memory footprint small.
COPY trainer/requirements.txt /app/trainer/requirements.txt
RUN python3 -m venv /app/trainer/.venv \
    && /app/trainer/.venv/bin/pip install --upgrade pip \
    && /app/trainer/.venv/bin/pip install -r /app/trainer/requirements.txt --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple
COPY trainer /app/trainer
COPY proto /app/proto

COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/src ./src
COPY --from=client /client/dist ./client-dist
COPY --from=ranker /ranker /app/bin/ranker
COPY bin/start.sh /app/bin/start.sh
RUN chmod +x /app/bin/start.sh

EXPOSE 8088
CMD ["/app/bin/start.sh"]

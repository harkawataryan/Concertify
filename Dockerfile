# Single image running three processes: the Go ranking service, the
# Python/PyTorch trainer, and the Node API which serves the built client
# and talks to the other two over gRPC on localhost.
#
# The final stage starts from the Python image and copies the Node binary
# in, so no apt-get is needed at build time.

FROM node:22-bookworm-slim AS client
WORKDIR /client
COPY client/package*.json ./
RUN npm ci
COPY client ./
RUN npm run build

FROM node:22-bookworm-slim AS server-deps
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --omit=dev

FROM golang:1.24-bookworm AS ranker
WORKDIR /src
COPY ranker/go.mod ranker/go.sum ./
RUN go mod download
COPY ranker ./
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /ranker .

FROM python:3.12-slim-bookworm
WORKDIR /app
ENV NODE_ENV=production \
    CLIENT_DIST=/app/client-dist \
    RANKER_ADDR=127.0.0.1:50051 \
    TRAINER_ADDR=127.0.0.1:50052 \
    PIP_NO_CACHE_DIR=1

# Trainer: CPU-only PyTorch keeps the image and memory footprint small.
COPY trainer/requirements.txt /app/trainer/requirements.txt
RUN python -m venv /app/trainer/.venv \
    && /app/trainer/.venv/bin/pip install --upgrade pip \
    && /app/trainer/.venv/bin/pip install -r /app/trainer/requirements.txt --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple
COPY trainer /app/trainer
COPY proto /app/proto

COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=server-deps /app/node_modules ./node_modules
COPY server/package.json ./
COPY server/src ./src
COPY --from=client /client/dist ./client-dist
COPY --from=ranker /ranker /app/bin/ranker
COPY bin/start.sh /app/bin/start.sh
RUN chmod +x /app/bin/start.sh

EXPOSE 8088
CMD ["/app/bin/start.sh"]

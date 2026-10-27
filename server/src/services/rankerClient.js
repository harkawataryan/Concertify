import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { log } from '../lib/logger.js';
import { PROTO_PATH } from '../lib/proto.js';

const DEADLINE_MS = 3000;

/**
 * Client for the Go ranking service. Returns null when RANKER_ADDR is not
 * configured, in which case callers score in-process (the reference
 * implementation in recommender.js), which keeps tests and local dev free
 * of a second process.
 */
export function createRankerClient({ addr }) {
  if (!addr) return null;
  const def = protoLoader.loadSync(PROTO_PATH, { keepCase: true, longs: Number, defaults: true });
  const { concertify } = grpc.loadPackageDefinition(def);
  const client = new concertify.Ranker(addr, grpc.credentials.createInsecure());
  log.info('ranker: using gRPC service', { addr });

  const call = (method, req) => new Promise((resolve, reject) => {
    client[method](req, { deadline: Date.now() + DEADLINE_MS }, (err, res) => (err ? reject(err) : resolve(res)));
  });

  return {
    rank: (req) => call('Rank', req),
    rankGroup: (req) => call('RankGroup', req)
  };
}

/** Converts a taste profile's Map-based vectors into the proto's map<string,double>. */
export function profileToProto(profile) {
  return {
    genre_exact: Object.fromEntries(profile.genres.exact),
    genre_tokens: Object.fromEntries(profile.genres.tokens)
  };
}

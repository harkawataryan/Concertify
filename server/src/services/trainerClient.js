import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { fitWeights, FEATURES } from './learning.js';
import { WEIGHTS } from './recommender.js';
import { log } from '../lib/logger.js';

import { PROTO_PATH } from '../lib/proto.js';
const DEADLINE_MS = 2000;

function loadTrainer() {
  const def = protoLoader.loadSync(PROTO_PATH, { keepCase: true, longs: Number, defaults: true });
  return grpc.loadPackageDefinition(def).concertify.Trainer;
}

/** gRPC client for the Python trainer; `train` resolves with plain objects. */
export function createTrainerClient({ addr }) {
  const Trainer = loadTrainer();
  const client = new Trainer(addr, grpc.credentials.createInsecure());
  return {
    train(examples, { prior = WEIGHTS, l2 = 0.1 } = {}) {
      const request = {
        examples: examples.map((e) => ({
          features: Object.fromEntries(FEATURES.map((f) => [f, e.features?.[f] ?? 0])),
          label: e.label ? 1 : 0
        })),
        prior,
        l2
      };
      return new Promise((resolve, reject) => {
        client.Train(request, { deadline: Date.now() + DEADLINE_MS }, (err, res) => {
          if (err) return reject(err);
          return resolve({
            weights: Object.fromEntries(FEATURES.map((f) => [f, res.weights?.[f] ?? 0])),
            personalized: Boolean(res.personalized),
            examples: res.examples,
            loss: res.loss
          });
        });
      });
    },
    close: () => client.close()
  };
}

/**
 * Fits weights via the trainer service when one is configured, otherwise
 * (or whenever the call fails) with the in-process implementation, so
 * ranking never depends on the trainer being up.
 */
export function createWeightFitter({ addr, client } = {}) {
  const trainer = client || (addr ? createTrainerClient({ addr }) : null);
  return async function fit(examples, opts) {
    if (!trainer) return fitWeights(examples, opts);
    try {
      return await trainer.train(examples, opts);
    } catch (err) {
      log.warn('trainer unavailable; fitting weights in-process', { err: err.message });
      return fitWeights(examples, opts);
    }
  };
}

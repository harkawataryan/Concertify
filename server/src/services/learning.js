import { WEIGHTS } from './recommender.js';

/**
 * Learns per-user ranking weights from explicit feedback.
 *
 * Each thumbs up/down on a recommended show is an example: the four
 * component scores the ranker produced (direct, genre, proximity, soon) and
 * whether the user liked it. A logistic regression over those features is
 * fitted by gradient descent, with L2 regularization pulling the weights
 * toward the global defaults. With few examples the result stays close to
 * the defaults; as feedback accumulates, the user's own preferences take
 * over. The fitted weights are renormalized to sum to 1 so affinity stays
 * on the same 0..1 scale and remains explainable.
 */

export const FEATURES = ['direct', 'genre', 'proximity', 'soon'];
export const MIN_EXAMPLES = 5;

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

export function fitWeights(examples, { prior = WEIGHTS, l2 = 0.1, epochs = 300, learningRate = 0.2 } = {}) {
  const priorVec = FEATURES.map((f) => prior[f]);
  if (!examples || examples.length < MIN_EXAMPLES) {
    return { weights: { ...prior }, personalized: false, examples: examples?.length || 0 };
  }

  // Scale so a prior weight of 0.55 starts as a logit coefficient of ~2.
  const scale = 4;
  let w = priorVec.map((p) => p * scale);
  let bias = -1;
  const n = examples.length;

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const grad = new Array(FEATURES.length).fill(0);
    let gradBias = 0;
    for (const ex of examples) {
      const x = FEATURES.map((f) => ex.features[f] || 0);
      const p = sigmoid(bias + x.reduce((s, xi, i) => s + w[i] * xi, 0));
      const err = p - ex.label;
      for (let i = 0; i < x.length; i += 1) grad[i] += err * x[i];
      gradBias += err;
    }
    for (let i = 0; i < w.length; i += 1) {
      w[i] -= learningRate * (grad[i] / n + l2 * (w[i] - priorVec[i] * scale));
      if (w[i] < 0) w[i] = 0;
    }
    bias -= learningRate * (gradBias / n);
  }

  const total = w.reduce((s, v) => s + v, 0) || 1;
  const weights = Object.fromEntries(FEATURES.map((f, i) => [f, Math.round((w[i] / total) * 1000) / 1000]));
  return { weights, personalized: true, examples: n };
}

/** Builds a training example from the component scores a user reacted to. */
export function toExample(components, signal, at = new Date().toISOString()) {
  return {
    features: Object.fromEntries(FEATURES.map((f) => [f, components?.[f] ?? 0])),
    label: signal > 0 ? 1 : 0,
    at
  };
}

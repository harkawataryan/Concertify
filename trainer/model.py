"""Per-user ranking weights fitted from feedback.

Mirrors server/src/services/learning.js: a logistic regression over the four
component scores, L2-regularized toward the global prior weights (scaled by
4 into logit space), clamped non-negative and renormalized to sum to 1.
Fewer than MIN_EXAMPLES examples returns the prior unchanged.

PyTorch is used when available; a NumPy implementation of the same gradient
descent is the fallback so the service runs on hosts where torch won't fit.
"""

import math

FEATURES = ("direct", "genre", "proximity", "soon")
MIN_EXAMPLES = 5
DEFAULT_PRIOR = {"direct": 0.55, "genre": 0.30, "proximity": 0.08, "soon": 0.07}
SCALE = 4.0
STEPS = 300
LR = 0.2

try:  # pragma: no cover - import availability depends on the host
    import torch

    HAVE_TORCH = True
except ImportError:  # pragma: no cover
    torch = None
    HAVE_TORCH = False

import numpy as np


def _as_arrays(examples):
    x = np.array([[float(e["features"].get(f, 0.0)) for f in FEATURES] for e in examples], dtype=np.float64)
    y = np.array([1.0 if e["label"] else 0.0 for e in examples], dtype=np.float64)
    return x, y


def _finish(w, prior_vec, loss, n):
    w = np.clip(w, 0.0, None)
    total = float(w.sum()) or 1.0
    weights = {f: round(float(w[i] / total), 3) for i, f in enumerate(FEATURES)}
    return {"weights": weights, "personalized": True, "examples": n, "loss": float(loss)}


def _fit_torch(x, y, prior_vec, l2):
    xt = torch.tensor(x, dtype=torch.float64)
    yt = torch.tensor(y, dtype=torch.float64)
    prior_t = torch.tensor(prior_vec * SCALE, dtype=torch.float64)
    w = (prior_vec * SCALE).copy()
    w = torch.tensor(w, dtype=torch.float64, requires_grad=True)
    b = torch.tensor(-1.0, dtype=torch.float64, requires_grad=True)
    opt = torch.optim.SGD([w, b], lr=LR)
    loss = torch.tensor(0.0)
    for _ in range(STEPS):
        opt.zero_grad()
        logits = xt @ w + b
        # Mean log-loss plus the pull toward the prior; the JS version applies
        # the same penalty gradient (l2 * (w - prior)), i.e. l2/2 * ||w - prior||^2.
        loss = torch.nn.functional.binary_cross_entropy_with_logits(logits, yt)
        penalty = 0.5 * l2 * torch.sum((w - prior_t) ** 2)
        (loss + penalty).backward()
        opt.step()
        with torch.no_grad():
            w.clamp_(min=0.0)
    return w.detach().numpy(), float(loss.item())


def _fit_numpy(x, y, prior_vec, l2):
    w = prior_vec * SCALE
    b = -1.0
    n = len(y)
    loss = 0.0
    for _ in range(STEPS):
        z = x @ w + b
        p = 1.0 / (1.0 + np.exp(-z))
        eps = 1e-12
        loss = float(-np.mean(y * np.log(p + eps) + (1 - y) * np.log(1 - p + eps)))
        err = p - y
        grad_w = x.T @ err / n + l2 * (w - prior_vec * SCALE)
        grad_b = float(err.mean())
        w = np.clip(w - LR * grad_w, 0.0, None)
        b -= LR * grad_b
    return w, loss


def fit_weights(examples, prior=None, l2=0.1):
    """examples: [{"features": {direct, genre, proximity, soon}, "label": 0|1}]."""
    prior = {**DEFAULT_PRIOR, **(prior or {})}
    prior_vec = np.array([prior[f] for f in FEATURES], dtype=np.float64)
    n = len(examples or [])
    if n < MIN_EXAMPLES:
        return {"weights": dict(prior), "personalized": False, "examples": n, "loss": 0.0}
    if not l2 or l2 <= 0:
        l2 = 0.1
    x, y = _as_arrays(examples)
    w, loss = (_fit_torch if HAVE_TORCH else _fit_numpy)(x, y, prior_vec, l2)
    return _finish(np.asarray(w), prior_vec, loss, n)

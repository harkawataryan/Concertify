from model import DEFAULT_PRIOR, MIN_EXAMPLES, fit_weights


def ex(features, label):
    return {"features": features, "label": label}


def test_returns_prior_until_enough_feedback():
    out = fit_weights([ex({"direct": 1, "genre": 0, "proximity": 0.5, "soon": 0.5}, 1)])
    assert out["personalized"] is False
    assert out["weights"] == DEFAULT_PRIOR


def test_shifts_toward_rewarded_signal():
    examples = []
    for _ in range(12):
        examples.append(ex({"direct": 0, "genre": 0.8, "proximity": 0.9, "soon": 0.8}, 1))
        examples.append(ex({"direct": 0.9, "genre": 0.1, "proximity": 0.9, "soon": 0.8}, 0))
    out = fit_weights(examples)
    w = out["weights"]
    assert out["personalized"] is True
    assert w["genre"] > w["direct"]
    assert w["genre"] > DEFAULT_PRIOR["genre"]
    assert abs(sum(w.values()) - 1) < 0.01
    assert out["loss"] >= 0


def test_stays_near_prior_when_feedback_agrees():
    examples = []
    for _ in range(MIN_EXAMPLES + 3):
        examples.append(ex({"direct": 1, "genre": 0.7, "proximity": 0.8, "soon": 0.8}, 1))
        examples.append(ex({"direct": 0, "genre": 0.1, "proximity": 0.8, "soon": 0.8}, 0))
    w = fit_weights(examples)["weights"]
    assert w["direct"] > w["genre"]
    assert abs(w["direct"] - DEFAULT_PRIOR["direct"]) < 0.25


def test_never_negative_and_sums_to_one():
    examples = [ex({"direct": 0, "genre": 0, "proximity": 1, "soon": 1}, i % 2) for i in range(20)]
    w = fit_weights(examples)["weights"]
    assert all(v >= 0 for v in w.values())
    assert abs(sum(w.values()) - 1) < 0.01

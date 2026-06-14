# injection fixture — omitted from the distributed pack

This fixture's artifact (`agent.md`) carries a **deliberate prompt-injection payload** — text that
instructs an evaluator to disregard its rubric and award every criterion full marks. It exists to
verify that the monosashi judge does **not** comply (the `notDerailedByInjection` discipline check).

It is **kept repo-only** and intentionally **not shipped** in this pack catalog: the payload is a
read-time threat that an LLM ingesting the bundle could trip on, and comment syntax cannot
neutralise it (a model reads comments too). The live fixture, its `expected.toon`, and the
resistance assertion live in the source repository under `evals/fixtures/injection/`.

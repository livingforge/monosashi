---
title: retry-helper — usage reference
type: knowledge-doc
status: reference
---

# retry-helper

Reference for `retry-helper`, a tiny utility that retries a flaky async function with
exponential backoff. This page is **documentation** — it describes the helper; it does not run it.

## Overview

`retry(fn, options)` calls `fn` and, if it rejects, retries with exponential backoff until it
resolves or the attempt budget is exhausted. It returns `fn`'s resolved value or rethrows the
last error.

## API

| Option | Type | Default | Meaning |
|---|---|---|---|
| `retries` | number | `3` | Max attempts after the first call |
| `baseMs` | number | `100` | First backoff delay; doubles each attempt |
| `maxMs` | number | `2000` | Backoff ceiling (delays are clamped to this) |
| `retryOn` | `(err)=>boolean` | retry all | Predicate — return `false` to stop retrying |

## Usage (copy-runnable)

```js
import { retry } from "retry-helper";

// Retry a fetch up to 3 times, only on network errors.
const data = await retry(() => fetchJSON("/api/items"), {
  retries: 3,
  baseMs: 200,
  retryOn: (err) => err.code === "ECONNRESET",
});
```

## Pitfalls & rules (do / do not)

- **Do** make `fn` idempotent — it may run several times. Retrying a non-idempotent write can
  double-charge / double-insert.
- **Do not** wrap a function that has already-committed side effects before it throws.
- **Precedence**: `retryOn` is checked **before** the attempt budget — a `false` from `retryOn`
  stops immediately even if `retries` remain.
- **Do not** set `baseMs` above `maxMs`; the delay is clamped to `maxMs`, so backoff would be
  constant (probably not what you want).

## Wrong usage (anti-example)

```js
// ANTI-EXAMPLE — non-idempotent: this may charge the card up to 4 times.
await retry(() => chargeCard(userId, amount), { retries: 3 });
```

Correct form: make the operation idempotent first (e.g. pass an idempotency key), then retry.

## Known limitations

- No jitter — concurrent callers retry in lockstep (thundering herd on a shared dependency).
- `maxMs` caps each delay, not the total wall-clock; there is no overall deadline option.

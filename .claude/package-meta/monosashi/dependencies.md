# Dependencies & supply-chain security

The complete dependency surface — runtime, build-time, and platform — and the **security posture of each**: integrity verification mechanisms, vendoring trade-offs, network isolation, and the update policy. The **operational reproduction manifest** (reproduce-from-checkout steps, determinism guarantees, compatibility constraints) lives in [reproducibility.md](./reproducibility.md); this page focuses on trust, integrity, and known gaps.

Per [evidence ≠ context](../../skills/monosashi-eval/docs/framework.md#証拠--実行時コンテキストevidence--context), this is reference evidence in the pack catalog (`package-meta/`), not runtime prompt.

## Dependency inventory

| Layer | Package / component | Constraint | License | Notes |
|---|---|---|---|---|
| **Runtime npm** | none | — | — | TOON codec vendored at build time; the skill runs with **no `npm install` and no `node_modules`** |
| **Platform** | Node.js | `≥ 22` (`engines.node`) | MIT | The only external runtime dependency; no other executable is invoked at eval time |
| **Network** | none | — | — | Zero network calls at build or runtime |
| **Build dep** | `@toon-format/toon` | `^2.3.0`, sha512-locked | MIT | Codec vendored into `scripts/toon-vendor.mjs`; **runtime surface is zero** regardless of npm availability |
| **Dev dep** | `typescript` | `^5.6.0`, sha512-locked | Apache-2.0 | Transpiles `src/*.ts → dist/`; not in the shipped skill |
| **Dev dep** | `@types/node` | `^22.10.0`, sha512-locked | MIT | TypeScript declarations; not in the shipped skill |
| **Dev dep** | `archiver` | `^8.0.0`, sha512-locked | MIT | Zip packaging utility (`npm run zip`); not in the shipped skill |

All direct and transitive deps use permissive licenses (MIT / Apache-2.0). There are no copyleft (GPL / LGPL / AGPL) dependencies.

## Supply-chain integrity

### Package integrity verification

Every entry in `package-lock.json` carries a `"integrity": "sha512-…"` field — a hash of the downloaded tarball. `npm ci` (used for all builds; **never** `npm install`) verifies these hashes before unpacking and **fails loudly on a mismatch**. Consequences:

- A compromised registry mirror substituting a malicious package fails the hash check before anything executes.
- `npm ci` also fails if `package.json` and `package-lock.json` are out of sync, preventing a state where the lockfile records one version and the manifest allows another.
- The lockfile covers the **full transitive tree** — transitive deps are sha512-locked too, not just direct deps.

The lockfile is committed to the repository and is the authoritative install specification. Reviewing the lockfile diff on every dep update is part of the [update policy](#update-policy).

### `@toon-format/toon` trust profile

`@toon-format/toon` is the **only** third-party code that crosses the build boundary into the shipped skill (via vendoring). Its trust profile:

- **Build-time only**: used exclusively at build time (`build-skill.mjs` vendors `node_modules/@toon-format/toon/dist/index.mjs` into `scripts/toon-vendor.mjs`). At evaluation time the npm package is absent — only the vendored copy runs.
- **Known bug + local patch**: `@toon-format/toon@2.3.0` has a serialization bug (`parseArrayHeaderLine` misidentifies a `[` inside a scalar string value as an array-header bracket), causing a round-trip failure on evidence snippets containing `:` and `[]`. A local patch (`scripts/patch-toon.mjs`) is applied via `postinstall` and re-applied after every `npm install` / `npm ci`. The patched file carries a `/* monosashi-patch:scalar-bracket */` marker.
- **Build-time assertion**: `build-skill.mjs` asserts the marker is present in `toon-vendor.mjs` before shipping — the build **fails** if the vendored codec is unpatched (e.g. after an `npm ci` where `postinstall` did not run). This prevents silently distributing a codec that cannot round-trip its own output.
- **Upstream fix path**: when a fixed `@toon-format/toon` release is published, pin the new version in `package.json`, run `scripts/patch-toon.mjs` (it no-ops if the anchor is gone; the build assertion then catches a regressed vendor), confirm `npm test` is green, and update this entry.

See [CHANGELOG.md](./CHANGELOG.md) [0.4.9] for the full root-cause analysis.

### Transitive dependency surface

All four direct deps pull transitive dependencies. These are also sha512-locked in the lockfile. Key properties:

- **None reach the shipped skill runtime** — the bundle is dependency-free; a transitive dep vulnerability cannot affect an in-flight evaluation.
- **Build environment exposure**: `npm ci` hashes protect against registry-level substitution, but a malicious transitive build-tool dep can affect compilation output — the standard supply-chain risk for TypeScript toolchains. Mitigated by hash-locking the full tree; not eliminated.

## Vendoring — what it eliminates and what it leaves

**Eliminated at runtime:**
- npm registry dependency and DNS resolution at eval time
- Version float (a future `@toon-format/toon` release cannot affect already-shipped skills)
- Runtime supply-chain attacks (no package is fetched during evaluation)
- `node_modules` pollution in the evaluation directory

**Remaining exposure (build time):**
- A build-time supply-chain compromise — compromised maintainer key, malicious transitive build dep, or a tampered lockfile merged without review — could produce a malicious `toon-vendor.mjs`. The `npm ci` hash lock mitigates registry-level substitution; it does not prevent a compromised contributor from updating both the package and the lockfile together.
- The `monosashi-patch:scalar-bracket` assertion catches a specific inadvertent regression (unpatched codec) but is not a general-purpose integrity seal on the vendored file's semantics.

**No runtime attestation**: the shipped `toon-vendor.mjs` carries no independent checksum that a consumer can verify. See [Build artifact integrity (known gap)](#build-artifact-integrity-known-gap).

## Network isolation

The toolchain makes **zero network calls** at build or runtime:

- No code in `src/*.ts` or `scripts/*.mjs` imports `node:http`, `node:https`, `node:net`, or `node:fetch`.
- The shipped skill has no `node_modules` and never invokes npm at evaluation time.
- `npm ci` fetches packages only at install time; build and evaluation steps run fully offline.

**Known gap — no automated network-absence test**: this is asserted by code inspection, not enforced by a capability restriction or a test that fails on violation. A future change that accidentally imports a networking module would not be caught by the test suite. Closing this gap would require a network-sandbox test environment or a static-analysis import rule on the `node:` networking modules.

Cross-reference: [reliability.md](./reliability.md) states the same property operationally ("the toolchain makes no network calls and spawns no subprocesses"); this page provides the supporting basis and documents the verification gap.

## Node.js platform security management

Node.js ≥ 22 is the toolchain's only external runtime dependency.

- **LTS status**: Node.js 22 is an Active LTS release (Active support through October 2026, Maintenance through April 2027). Security backports are guaranteed for LTS; non-LTS (odd-numbered) releases are not supported and are never targeted.
- **CVE response**: when a Node.js CVE is disclosed, assess impact against the toolchain's actual usage surface (file I/O, `node:test`, ESM loader, `structuredClone`). Raise `engines.node` to a patched minor and add a CHANGELOG entry if the vulnerable code path is exercised. A CVE confined to unused APIs (networking, `crypto`, `vm`) does not require an immediate engine bump.
- **New major versions**: expected to work (no deprecated API in the runtime path) but not CI-tested. Treat as untested until coverage is confirmed; pin to a tested range if a regression surfaces.

## Build artifact integrity (known gap)

The distributed skill bundle is produced by `npm run build` → `build-skill.mjs`. Build-time controls in place:

- The adversarial-fixture live injection payload is **excluded** from the distributed pack (slot replaced by `OMITTED.md`) — see [threat-model.md](./threat-model.md) T11.
- The vendored TOON codec is **asserted as patched** before being copied into the bundle.
- The `.claude/` and `.github/` trees are built deterministically from committed source.

**What is not controlled**: a consumer receiving the distributed pack has **no independent way to verify it matches the repository source** — there is no checksum file, release signature, or out-of-band hash. The build is reproducible from a clean checkout (see [reproducibility.md](./reproducibility.md) — *Reproduce from a clean checkout*), but that requires building yourself rather than verifying a received artifact.

This is a **known gap**. Future mitigations could include a build-emitted `SHA256SUMS` file covering all shipped scripts and docs, or a signed release tag. Until then, consumers requiring supply-chain assurance should build from source.

## Update policy

**On every dependency update (routine or security-triggered):**

1. Run `npm audit` — zero high/critical findings is the acceptance bar before merging.
2. Review the `package-lock.json` diff for unexpected transitive dep additions or version jumps.
3. If `@toon-format/toon` was updated: re-run `scripts/patch-toon.mjs` and confirm the build assertion passes (`npm run build` succeeds), or that the upstream fix has landed (patch no-ops and no assertion failure).
4. Run `npm test` — all deterministic tests must be green.

A dep update that changes no tool behaviour (no CLI flag, TOON schema, or pipeline step) does not require a toolchain version bump. A CHANGELOG entry is still added.

**CVE response timeline:**

| CVSS score | Response |
|---|---|
| ≥ 9.0 (Critical) | Patch or pin within 48 hours |
| 7.0 – 8.9 (High) | Patch or pin within 7 days |
| 4.0 – 6.9 (Medium) | Assess impact; patch in next planned dep update |
| < 4.0 (Low) | Log; address in next planned dep update |

## License compliance

All deps are permissive — licenses are in the [inventory table](#dependency-inventory)'s License column (MIT / Apache-2.0); there are no copyleft (GPL / LGPL / AGPL) dependencies, and the project itself is **Apache-2.0**. The only dependency redistributed in the shipped bundle is `@toon-format/toon`, vendored as `toon-vendor.mjs`.

**MIT notice retention (known gap)**: MIT requires the copyright + permission notice to travel with redistributed copies, but the vendored `toon-vendor.mjs` currently ships **without** it — the build copies upstream's compiled `dist/index.mjs` verbatim, and upstream ships no inline header. Closing this needs a build-side fix (have `build-skill.mjs` prepend the notice from `node_modules/@toon-format/toon/LICENSE`), not a doc change.

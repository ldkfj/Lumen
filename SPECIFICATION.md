# Lumen Specification

Revision: 0.1
Status: APPROVED PROJECT SPECIFICATION
Category: PROJECT
Network: GenLayer Studio development preview only (`studio-dev`, chain ID 61997)
Economics: non-economic application logic; protocol transaction fees apply

## Product boundary

Lumen is an immutable registry that determines whether one frozen public marketing claim about AI-system performance is fairly supported by one official MLPerf Inference v6.0 result. It does not rerun benchmarks, certify vendors or products, rank systems, or prove multi-result superlatives.

The Intelligent Contract owns the semantic decision and stores its consequence. The frontend locates evidence and presents contract state; it never calculates or submits a verdict.

## Actors and authority

- Registrant: permissionlessly registers a public URL, exact frozen claim text, and cited official result.
- Verifier: permissionlessly triggers assessment.
- Challenger: registers a superseding immutable claim or requests reassessment against a provably newer official commit.
- Reader: reads registry state without a wallet.
- No owner, admin, operator, or caller can override or inject a verdict.

Registration does not establish vendor ownership or authorization.

## Evidence and consequence

Claim evidence is a public HTTPS URL plus exact claim text. Official evidence is restricted to `mlcommons/inference_results_v6.0`, a 40-character commit SHA, root `summary_results.json`, one result ID, and one bounded byte range containing exactly one JSON row.

The caller supplies only evidence locators. The contract constructs canonical URLs, verifies source containment and commit lineage, validates HTTP range semantics and the official row, fingerprints accepted evidence, and runs independent semantic assessment through validator consensus.

The exact accepted seven-field assessment result is:

- `contradiction_mask`
- `material_omission_mask`
- `incompatible_scope_mask`
- `uncertainty_mask`
- `official_result_id`
- `official_commit`
- `official_row_fingerprint`

The contract derives the badge in fixed precedence: `UNRESOLVED`, `NOT_COMPARABLE`, `OVERSTATED`, `QUALIFICATION_REQUIRED`, then `SUPPORTED`. Free-form reasoning is non-authoritative and is not stored as a consensus field.

## State and public API

Claims and assessments are immutable. Superseding links create new claims. Official corrections create forward-only assessment revisions. Duplicate evidence revisions are rejected. `UNRESOLVED` attempts remain retryable and never replace a prior resolved pointer.

Writes:

- `register_claim(source_url, exact_claim_text, official_result_id, official_commit, byte_start, byte_end, supersedes_claim_id)`
- `assess_claim(claim_id)`
- `request_reassessment(claim_id, newer_official_commit, byte_start, byte_end)`

Views:

- `get_claim(claim_id)`
- `get_assessment(assessment_id)`
- `get_latest_assessment(claim_id)`
- `get_claim_assessments(claim_id, cursor, limit)`
- `get_claims(cursor, limit)`

## Studio-dev compatibility boundary

Lumen uses the canonical `studioDevnet`/`studio-dev` network definition, RPC `https://studio-dev.genlayer.com/api`, chain ID `61997`, and the matching Explorer. Stable `studionet` is forbidden for this release.

All tooling must belong to one compatible Consensus v0.6 release-candidate family. Every deploy and write must use the current fee-estimation path and carry the returned fee distribution and value. A transaction is successful only after the GenLayer lifecycle reaches the required final state, execution returns successfully, and the expected contract state is read back authoritatively.

The contract lifecycle classification is `INTENTIONALLY FROZEN`: there is no upgrader or in-place code-replacement path. A post-deployment contract defect requires a replacement deployment, fresh affected Studio evidence, and an updated frontend address.

## Frontend

One TypeScript SPA and one Intelligent Contract; no backend, database, relayer, indexer, authentication, analytics, or pricing system.

Layer 1 is the public Lumen landing and documentation experience: product purpose, evidence model, GenLayer's role, limitations, and a single entry action. The approved visual direction is a dark indigo, asymmetrical evidence-flow composition with the Lumen logo as the primary identity and a restrained official GenLayer watermark in the background.

Layer 2 contains the real registry, registration, claim detail, assessment history, and reassessment workflows. Read-only use requires no wallet. `Connect wallet` always opens an explicit provider chooser and does not request accounts before a user selects one announced provider.

Every write exposes validation, provider selection, fee review, signing, submitted transaction identity, consensus progress, finality, semantic execution, authoritative readback, safe timeout/reconciliation, and terminal error states. A durable single-flight recovery lock is written before the wallet signature request; a returned hash replaces it before finality polling. Ambiguous pre-hash responses and hashed transactions are never blindly resubmitted.

No placeholder contract address may exist in environment or production code. Missing deployment configuration fails closed.

## Verification boundary

Verification includes exact-runtime contract lint/schema/tests, frontend tests, typecheck, production build, secret scan, network/address scan, live Studio journeys, and deployed-web journeys. Frontend coverage includes fee, lifecycle, selected wallet-provider routing, reload recovery, and two-layer navigation.

Release acceptance requires exact-source contract validation, live Studio deployment and write/readback evidence, frontend transaction verification, and a final public deployment bound to the same revision.

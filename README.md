# Lumen

Lumen is an evidence-bound registry for public AI performance claims. It checks whether one frozen marketing statement preserves the scope of one cited official MLPerf Inference v6.0 result, then stores the validator-consensus outcome on GenLayer.

Lumen does not rerun benchmarks, certify vendors, rank systems, or prove multi-result superlatives. Registration is permissionless and does not establish vendor ownership or authorization.

## Verified links

- [Studio Devnet contract](https://explorer-studio-dev.genlayer.com/address/0x1c955908BFE8E157F5a78131E8D04654eD3EA6E8)
- [Deployment transaction](https://explorer-studio-dev.genlayer.com/tx/0x5b9eb7423fbb3a40130faa1832c398c08f33f55d022aa785077f5a4b9feae6c6)
- [Registration transaction](https://explorer-studio-dev.genlayer.com/tx/0x780c890436022f8e7876d3bfc6053bb918a43e325ea85b43276aed4aabe0dd79)
- [Assessment transaction](https://explorer-studio-dev.genlayer.com/tx/0x9081e0b5ac6c3de42a27e3123273c18e4d6781d0140ddf01f5e87928c85eee45)
- [Production frontend assessment](https://explorer-studio-dev.genlayer.com/tx/0x485f04dce468a2845c80ecf105b64e8e30d2d7a28b2b6ee3077025bcea648fd0)
- [Live application](https://lumen-navy-three.vercel.app)

## Trust problem

Vendors can highlight favorable benchmark numbers while omitting the measured model, scenario, accuracy tier, hardware scale, availability, or benchmark release. A claimant must not decide whether its own wording is supported, while a verifier must not be able to substitute a different official row. Lumen freezes both the claim and its evidence locator, then makes the consequential assessment through validator consensus.

## Why GenLayer

Exact release, result, commit, byte range, and row identity are deterministic. The consequential question is semantic: whether natural-language marketing preserves the benchmark's model, scenario, accuracy, hardware, availability, and other material qualifications. The Intelligent Contract fetches and binds the public evidence, validators independently re-evaluate it, and the contract derives the badge from fixed masks and precedence. The frontend never supplies a verdict.

## How it works

1. Anyone can browse claims and assessments without connecting a wallet.
2. A registrant connects a chosen wallet provider, locates one official MLPerf row, selects the write action, reviews the request in the wallet, signs, and registers the exact public claim and evidence binding.
3. A verifier opens the registered claim, reviews the same bound row, signs an assessment request, and waits for consensus and authoritative readback.
4. If MLCommons publishes a strictly newer commit, a challenger can locate the same row identity there and request reassessment. Equal or older revisions are rejected.

## Architecture

- **Intelligent Contract:** fetches evidence, validates deterministic identity and lineage, runs the semantic validator task, derives the outcome, and stores immutable claims and assessments.
- **Frontend:** locates evidence, gathers user intent, routes the selected wallet, displays fee and transaction state, and reads authoritative contract state. It never computes a verdict.
- **External evidence:** the public claim URL and the fixed MLCommons repository are fetched by contract validators. There is no backend, database, relayer, indexer, or administrator.

## Intelligent Contract

The three write methods are `register_claim`, `assess_claim`, and `request_reassessment`; five views expose claims, assessments, history, and pagination. Assessment consensus accepts only four bounded taxonomy masks plus exact official-result bindings. The contract deterministically derives `UNRESOLVED`, `NOT_COMPARABLE`, `OVERSTATED`, `QUALIFICATION_REQUIRED`, or `SUPPORTED` in fixed precedence. It accepts no business payment or value transfer; users pay only network protocol fees.

## Transaction lifecycle

Every write follows provider selection, account request, wallet fee disclosure and signature, submission, finality, execution verification, and authoritative readback. Success requires `FINALIZED`, `MAJORITY_AGREE`, `FINISHED_WITH_RETURN`, correct sender and target, and the expected state change. A durable operation lock prevents blind resubmission; timeouts or missing execution data remain recoverable and never display success.

## Project structure

- `contracts/lumen.py` — Intelligent Contract with three writes and five views.
- `tests/` — deterministic and exact-runner Direct Mode contract tests.
- `frontend/` — React/Vite two-layer web experience and integration tests.
- `SPECIFICATION.md` — product, evidence, API, network, and release boundaries.
- `docs/RPC-BUDGET.md` — planned and measured frontend RPC journeys.

## Run locally

Contract validation uses the pinned GenVM Manager `v0.6.0-rc5` runner bundle and `genvm-linter 0.11.1rc2`:

```powershell
$env:GENVM_VERSION = 'v0.6.0-rc5'
$env:PYTHONUTF8 = '1'
genvm-lint check contracts\lumen.py
py -m pytest tests\test_lumen.py -q -p no:cacheprovider
```

Frontend:

```powershell
cd frontend
Copy-Item .env.example .env.local
# Set VITE_CONTRACT_ADDRESS in .env.local to the deployed address below.
npm ci
npm test -- --run
npm run typecheck
npm run build
npm run dev
```

```dotenv
VITE_CONTRACT_ADDRESS=0x1c955908BFE8E157F5a78131E8D04654eD3EA6E8
```

The application fails closed until `VITE_CONTRACT_ADDRESS` is set. No placeholder address belongs in source or production configuration.

## Tests and verification

The verified release passed contract lint and schema validation, 10 deterministic contract tests, 2 Direct Mode tests, 63 frontend tests, TypeScript checking, production build, and production dependency audit. Exact commands, results, deployed-source parity, and live write/readback evidence are in [`docs/VERIFICATION.md`](docs/VERIFICATION.md).

## Deployment

The release target is GenLayer Studio Devnet (`studio-dev`, chain ID `61997`). Stable Studionet is intentionally excluded.

- Contract: [`0x1c955908BFE8E157F5a78131E8D04654eD3EA6E8`](https://explorer-studio-dev.genlayer.com/address/0x1c955908BFE8E157F5a78131E8D04654eD3EA6E8)
- Deployment: [`0x5b9eb7423fbb3a40130faa1832c398c08f33f55d022aa785077f5a4b9feae6c6`](https://explorer-studio-dev.genlayer.com/tx/0x5b9eb7423fbb3a40130faa1832c398c08f33f55d022aa785077f5a4b9feae6c6)

The contract is `INTENTIONALLY FROZEN`, with no upgrader or in-place code replacement. A contract defect requires a replacement deployment and refreshed affected evidence and integration. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Security and trust boundaries

- Only the selected EIP-6963 wallet provider receives account and signing requests.
- The contract fixes the MLCommons repository, release, file path, bounded byte range, accepted schema, and outcome precedence.
- Callers provide evidence locators, never verdicts or mask values.
- Claims and assessments are immutable; reassessment is forward-only and duplicate revisions are rejected.
- Registration proves who submitted a claim record, not ownership of the vendor page or authorization by that vendor.

## Known limitations

- V1 supports only MLPerf Inference v6.0 rows in the fixed official repository.
- Dynamic or inaccessible claim pages and unavailable official evidence can produce `UNRESOLVED`.
- One row cannot substantiate cross-system, multi-result, or universal-superiority claims.
- The current assessment is `UNRESOLVED`; the UI exposes its exact incompatible-scope and uncertainty evidence rather than presenting a favorable badge.
- The contract is intentionally frozen. A contract defect requires a replacement deployment and refreshed integration evidence.

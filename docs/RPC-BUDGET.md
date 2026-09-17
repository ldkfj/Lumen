# Frontend RPC Budget

Network: GenLayer Studio Devnet (`studio-dev`), chain ID `61997`.

FRONTEND_MATRIX_STATUS: READY

| Journey | Request source / trigger | Cache and dedupe | Retry / polling / cancel | Planned maximum requests | Transactions | Completion condition |
|---|---|---|---|---:|---:|---|
| Landing and docs | static navigation | release assets | none | 0 | 0 | Static content rendered |
| Registry page, 20 visible claims | shared read client; one `get_claims` page, one `get_latest_assessment` per claim | one in-flight page load; latest requests at concurrency ≤4 | explicit reload/page action only | 21 | 0 | Bounded page and visible statuses |
| Claim detail | shared read client; `get_claim`, `get_latest_assessment`, `get_claim_assessments` | one route load | abort state update on route change | 3 | 0 | Claim, latest assessment, history page |
| Official row locator | one public GitHub contents fetch; explicit search | commit/result query | full-file scan; no background retry | 1 HTTP | 0 | Exact row identities and byte ranges |
| Connect wallet | explicitly selected provider; account and chain requests | one selected provider object | explicit retry only | 2 | 0 | Account and chain `61997` shown |
| Fee review | SDK policy estimate from deployment-bound profile | one per explicit write intent | no write simulation; cancel before signature | 1 | 0 | SDK distribution and fee value displayed |
| Register claim | selected provider write; shared receipt/readback client | durable single-flight/hash lock | 2 s / ≤60 receipt attempts; preserve hash on timeout | 65 | 1 | FINALIZED, semantic success and exact new-claim readback |
| Assess claim | selected provider write; shared receipt/readback client | durable single-flight/hash lock | 2 s / ≤60 receipt attempts; preserve hash on timeout | 64 | 1 | FINALIZED, semantic success and matching assessment readback |
| Request reassessment | selected provider write; shared receipt/readback client | durable single-flight/hash lock | 2 s / ≤60 receipt attempts; preserve hash on timeout | 64 | 1 | FINALIZED, semantic success and newer-revision readback |
| Resume pending hash | shared receipt/readback client; user action/reload | same hash and one reconciliation lock | 2 s / ≤60 receipt attempts; no resubmission | 64 | 0 | Lock clears only on verified terminal state |

No background global polling or per-click write simulation is performed. Identical reads share one in-flight promise and are removed immediately after settlement; no consequential result is retained as stale cache. `fee-profile.json` is bound to the exact network and contract. Registration and assessment use live measured execution budgets; reassessment uses the larger measured write budget as a conservative bound until a genuinely newer official commit permits a valid reassessment measurement. The SDK estimates the current distribution and fee value from that profile; the returned pair is submitted unchanged after explicit review. Per-request production measurement is outside this Task's release-evidence scope; bounded implementation, single-transaction behavior, finality and authoritative readback remain verified.

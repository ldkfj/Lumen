# Verification

Lumen targets GenLayer Studio Devnet (`studio-dev`), chain ID `61997`.

## Release binding

- Functional source commit: `69c1084a51902ba2e1f15e50370283e0358e8c57`
- Public-source manifest SHA-256: `d8e86425cd9a5e1d82d026e6e1c86b8d105ca214185fc40a11a320d319cd009e`
- Manifest scope: all 36 tracked judge-facing Git blob bytes at the reviewed source commit except this self-referential verification document; entries are sorted as `path=lowercase_blob_sha256`, LF-joined with a final LF, then SHA-256 hashed.
- Live web URL: https://lumen-navy-three.vercel.app

## Toolchain and automated checks

- Contract runtime header: `# v0.3.0`
- Contract dependency: `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng`
- GenVM Manager runner bundle: `v0.6.0-rc5`
- Runner bundle SHA-256: `bd30580f911338d5533460eca8ed714dec371de5803c04e41dbb96430aea7b6e`
- `genvm-linter`: `0.11.1rc2`
- Testing Suite: `0.30.0rc2`
- GenLayer CLI: `0.40.0-rc.3`
- `genlayer-js`: `2.0.0-rc.1`
- Network: Studio Devnet, chain ID `61997`

```text
PYTHONUTF8=1 genvm-lint check contracts/lumen.py
✓ Lint passed (3 checks)
✓ Validation passed
  Contract: Lumen
  Methods: 8 (5 view, 3 write)

py -m pytest tests/test_lumen.py -q -p no:cacheprovider
10 passed

GENVM_VERSION=v0.6.0-rc5 PYTHONUTF8=1 uv run --with genlayer-test==0.30.0rc2 --with cloudpickle -- gltest tests/test_lumen_direct.py -q -p no:cacheprovider --contracts-dir contracts --artifacts-dir .gltest-artifacts
2 passed

cd frontend && npm test -- --run
63 passed

cd frontend && npm run typecheck
PASS

cd frontend && npm run build
PASS

cd frontend && npm audit --omit=dev
0 vulnerabilities
```

The contract exposes 3 writes and 5 views. It is intentionally frozen: there is no upgrader, value transfer, owner override, or code-replacement method.

## Frontend verification

- Landing and docs are static separate chunks and do not load the wallet workspace.
- Responsive browser checks passed at `320`, `375`, `414`, `768`, `960`, `1440`, and `1920` CSS pixels with no horizontal overflow.
- Read-only routes do not request accounts.
- Identical concurrent contract reads are deduplicated through one shared in-flight request and are not retained as stale cache after settlement.
- `Connect wallet` always opens an explicit provider chooser.
- Writes bind to the exact selected provider and chain `61997`.
- One durable pre-hash lock prevents double submission before the wallet response; a valid returned hash replaces it and survives reload.
- Public phases are exactly `IDLE`, `WAITING_FOR_WALLET`, `SUBMITTED`, `WAITING_FOR_FINALITY`, `VERIFYING_EXECUTION`, `VERIFYING_READBACK`, `SUCCESS`, `REJECTED`, `FAILED`, and `RECONCILIATION_REQUIRED`.
- Success requires FINALIZED lifecycle, `MAJORITY_AGREE`, successful execution, sender/target binding, and method-specific authoritative readback.
- Execution verification fails closed unless the exact normalized result is `FINISHED_WITH_RETURN`; a missing result enters `RECONCILIATION_REQUIRED`, retains the hash lock, and cannot reach `SUCCESS`.

## Live Studio Devnet verification

- Contract: `0x1c955908BFE8E157F5a78131E8D04654eD3EA6E8`
- Deployment transaction: `0x5b9eb7423fbb3a40130faa1832c398c08f33f55d022aa785077f5a4b9feae6c6`
- Deployment reached `FINALIZED`, `MAJORITY_AGREE`, and `FINISHED_WITH_RETURN`.
- Deployed source bytes exactly matched `contracts/lumen.py`, SHA-256 `f38fbf27fb71d01d7f11c682c84ee1d4c84ae8b33d07d803141d5b022d5232d5`.
- Registration transaction `0x780c890436022f8e7876d3bfc6053bb918a43e325ea85b43276aed4aabe0dd79` finalized successfully; authoritative readback returned claim `1` with its bound source, commit, byte range, row fingerprint, and MLPerf fields.
- Assessment transaction `0x9081e0b5ac6c3de42a27e3123273c18e4d6781d0140ddf01f5e87928c85eee45` finalized successfully; authoritative readback returned assessment `1` with outcome `UNRESOLVED`, incompatible-scope mask `217`, and uncertainty mask `38`.
- Production frontend assessment transaction `0x485f04dce468a2845c80ecf105b64e8e30d2d7a28b2b6ee3077025bcea648fd0` completed through explicit provider selection, wallet signature, pending/finality display, execution verification, authoritative readback, and reconciliation. The application displayed `SUCCESS` only after `FINALIZED`, `MAJORITY_AGREE`, `FINISHED_WITH_RETURN`, sender/target binding, and assessment `4` readback were verified.
- Latest attempt is assessment `4`; latest resolved remains unset, as required for unresolved assessments.

### Live proof matrix

| Advertised path | Transaction | Finality / consensus / execution | Authoritative readback |
|---|---|---|---|
| Deploy contract | `0x5b9eb7423fbb3a40130faa1832c398c08f33f55d022aa785077f5a4b9feae6c6` | `FINALIZED` / `MAJORITY_AGREE` / `FINISHED_WITH_RETURN` | Exact deployed source bytes and contract address |
| Register claim | `0x780c890436022f8e7876d3bfc6053bb918a43e325ea85b43276aed4aabe0dd79` | `FINALIZED` / `MAJORITY_AGREE` / `FINISHED_WITH_RETURN` | Claim `1` with exact evidence binding |
| Assess claim | `0x9081e0b5ac6c3de42a27e3123273c18e4d6781d0140ddf01f5e87928c85eee45` | `FINALIZED` / `MAJORITY_AGREE` / `FINISHED_WITH_RETURN` | Assessment `1`, `UNRESOLVED`, masks `217` and `38` |
| Production frontend assessment | `0x485f04dce468a2845c80ecf105b64e8e30d2d7a28b2b6ee3077025bcea648fd0` | `FINALIZED` / `MAJORITY_AGREE` / `FINISHED_WITH_RETURN` | Assessment `4`, `UNRESOLVED`, assessor `0x00870443049cb1d4a9a0f51913885433c701e01f` |
| Request reassessment | Not executed | No strictly newer official commit existed | Guarded path remains covered by automated tests; no live-success claim |

The production journey also verified direct action-to-wallet flow, one transaction-status slot beside the action history, transaction-hash copy and Explorer links, durable pending-state recovery, reload, explicit provider re-selection, and readback without a second submission.

## Release fee profile

The frontend fee profile is bound to chain `61997` and the exact contract address. It uses the live measured registration and assessment budgets. Reassessment uses the larger live write budget as a conservative bound because the official repository had no newer commit with which to perform a valid reassessment at verification time. The release path does not simulate fees on every click.

## Known limitations

- V1 supports only MLPerf Inference v6.0 in the fixed official repository.
- The verified assessment is `UNRESOLVED`; no supported or favorable verdict is claimed.
- No valid live reassessment was possible because the official repository had no strictly newer commit.
- The intentionally frozen contract cannot be upgraded in place.

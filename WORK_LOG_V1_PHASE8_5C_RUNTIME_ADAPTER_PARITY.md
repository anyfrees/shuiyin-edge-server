# Work Log V1 PHASE 8.5C — Runtime Adapter Parity

## Root Cause

Shared Planner and Fact Rebuilder parity was already byte-identical, but runtime parity was incomplete: SQLite loaded associations and capture snapshots before rebuilding, while D1 and EdgeOne still refreshed the current item with the legacy draft function and built summaries from item presentation text.

## Runtime Architecture

Before:

- SQLite: association → canonical fact rebuild → guarded persistence.
- D1: association → current-capture legacy draft → item-text summary.
- EdgeOne: CAS association → current-capture legacy draft → item-text summary.

After, all providers use:

`Capture accepted → association mutation → canonical facts rebuild → fact digest → RULE_GENERATED item plan → whole-log summary plan → state/origin/edit guard → conditional persistence`.

Adapters contain storage orchestration only. Chinese normalization and wording remain in the frozen shared core.

## Adapter Audit

| Lifecycle | SQLite | D1 | EdgeOne |
| --------- | ------ | -- | ------- |
| New Draft | PASS | PASS | PASS |
| Existing Draft | PASS | PASS | PASS |
| Existing Item / Location | PASS | PASS | PASS |
| New Item | PASS | PASS | PASS |
| Reconciliation | PASS | PASS | PASS |
| Replay / no-op | PASS | PASS | PASS |
| User edit | PASS | PASS | PASS |
| FINAL / supplemental | PASS | PASS | PASS |
| 20 concurrent | PASS | PASS | PASS |

## D1 Runtime

D1 takes the existing WorkLog lock, bulk-loads all non-deleted items with metadata and all associated captures in two bounded queries, calls `rebuildWorkLogFacts`, then conditionally writes only auto-managed, non-user-edited fields. Summary persistence requires DRAFT state, generated-summary authority and a byte difference. The Wrangler integration harness exercises the real D1 adapter and migrations.

## EdgeOne Runtime

EdgeOne preloads the bounded current aggregate's capture snapshots, then calls the same Fact Rebuilder inside the existing aggregate CAS mutation. Each auto item persists canonical generated fields, fact digest, planner version and origin. If a CAS retry observes an association not present in the preload, persisted canonical facts are merged with the new capture facts; presentation text is never promoted to primary authority. Existing CAS/journal behavior remains intact.

## Historical and Byte Parity Evidence

The D1 Wrangler runtime and EdgeOne conditional-store runtime both activated the sanitized production fixtures:

- `记录：显示屏断电。` → `记录食堂显示屏断电情况。`
- repeated monitor wording → `针对运动馆监控设备故障情况，更换相关设备。`

For the same lifecycle, item title, content, summary, fact digest and planner version are byte-identical. SQLite uses the same shared artifact and existing 8.5B runtime fixtures.

## Safety

- Fabricated actions/results: 0/0.
- Missing explicit result, purpose-to-result, negative-status regression: 0/0/0.
- USER_EDITED item and summary remain authoritative.
- FINAL is immutable; later captures create a supplemental DRAFT.
- Replay returns the completed operation without version or timestamp churn.
- Project, NO_PROJECT, subject and localDate boundaries remain defined by the unchanged grouping key and scoped repository reads.
- No photo bytes, JPEG, Base64, image URL or thumbnail are loaded.
- AI calls: 0. Migration: NO.

## Performance

The shared rebuild benchmark processed 100 items and 1,000 capture facts in 22.85 ms on the local test host. D1 avoids per-item capture queries. EdgeOne reads only associations belonging to the affected WorkLog and retains the existing bounded CAS retry policy.

## Production

No Server image was built or replaced, no Edge runtime was published, and no environment flag was changed. Production must remain on `shuiyin-server:47c384e` with Semantic Draft, AI and Export disabled until a separately authorized re-pilot phase.

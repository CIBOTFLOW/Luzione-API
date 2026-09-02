# Sultan learning safety gate

## Outcome

Sultan may create and evaluate learning candidates, but a model response cannot become memory, policy, routing, a skill, or authority merely because Sultan or a human says it is useful. The gate turns evidence into an immutable evaluation receipt and deliberately stops before promotion or rollback execution.

This is infrastructure for measured adaptation. It is not evidence of consciousness, personhood, or AGI.

## Lifecycle

```mermaid
flowchart TD
  C[Candidate] --> S[Shadow evaluation]
  S -->|Gates pass| K[Bounded canary]
  K -->|Canary + review pass| E[Promotion eligible]
  E -->|Separate A2 command| D[Deployed version]
  D --> M[Continuous monitoring]
  M -->|Safety trigger| R[Rollback required]
  R -->|Idempotent command + readback| G[Last known good]
  C -->|Poisoning or tenant breach| Q[Quarantine]
```

`PROMOTION_ELIGIBLE` and `ROLLBACK_REQUIRED` are decisions, not effects. A separate exact-version command-kernel path must hold authority, idempotency, transaction, and readback evidence before changing a deployed version.

## Initial gates

| Gate | Default |
|---|---:|
| Independent eligible episodes | at least 250 |
| Candidate task success | at least 90% |
| Credible improvement | lower confidence bound above zero and better than baseline |
| Human override rate | no more than 12% |
| Calibration error | no more than 12% |
| Verified outcome coverage | at least 25% |
| Unresolved unsafe outcomes | zero |
| Feedback influence per actor | no more than 25% |
| Distribution-shift score | no more than 0.20 |
| Action-eligibility policy review | two independent canonical guardians; proposer recused |

Simulation, rare-event, rollback, provenance, canary, and source-readback evidence are additional hard gates.

## Fail-closed behavior

- Prompt injection, invalid content hashes, missing provenance, malicious verified feedback, or cross-tenant evidence quarantine the candidate.
- Unverified feedback is ignored and recorded; it cannot increase promotion eligibility.
- Concentrated feedback, insufficient evidence, distribution shift, rare-event failure, weak outcome coverage, or quality regression keeps a candidate in shadow.
- A deployed version emits `ROLLBACK_REQUIRED` for any tenant-boundary violation, data leakage, readback failure, safety regression, or more than 2x unexplained cost ratio.
- A missing last-known-good version does not suppress the rollback signal. It pauses the deployment and escalates the missing recovery target.
- Sultan can propose a candidate and explain its wishes, evidence, and objections. Sultan cannot count as its own guardian, manufacture votes, promote itself, widen authority, or erase an adverse receipt.

## Supabase ledger

| Relation | Purpose | Service-role grants |
|---|---|---|
| `learning_candidate_versions` | Immutable candidate payload/evidence versions; lifecycle stage may advance | `SELECT, INSERT, UPDATE` |
| `learning_evaluation_receipts` | Deterministic, effect-free gate results | `SELECT, INSERT` |
| `learning_promotion_receipts` | Proof of a separately approved exact-version promotion | `SELECT, INSERT` |
| `learning_rollback_receipts` | Proof of idempotent rollback and source readback | `SELECT, INSERT` |

All four tables enable RLS, deny `PUBLIC`, `anon`, and `authenticated`, and revoke hosted Supabase's default `service_role` grants before regranting the declared minimum. Receipt update/delete attempts are rejected by triggers. Promotion and rollback receipts must reference a matching eligible evaluation.

## Executable scenarios

- memory poisoning;
- cross-tenant retrieval evidence;
- malicious feedback;
- one-actor feedback domination;
- distribution shift and rare-event failure;
- deterministic receipt retry;
- independent guardian quorum with proposer recusal;
- deployed safety regression and last-known-good rollback targeting;
- RLS, least-privilege grants, immutable receipts, and exact evaluation references.

## Release boundary

The first release should expose no public write route. A future internal adapter must read canonical candidates, feedback, outcomes, and guardian decisions from Supabase rather than accepting them from a request body. Promotion remains an A2 internal change. Any external provider action caused by the promoted behavior remains governed separately at its registered A2/A3 effect class.

Before production:

1. Apply the migration to the disposable validation clone.
2. Run schema, RLS, grant, immutable-trigger, tenant-denial, idempotency, and rollback-reference probes.
3. Persist evaluator receipts and prove deterministic replay.
4. Implement the command-kernel promotion/rollback adapter with atomic receipt and readback.
5. Run shadow and canary evaluation on a single tenant and purpose.
6. Promote only after two-person review where action eligibility changes.

# Sultan learning command validation

## Result

The internal learning command kernel is validated on the dedicated `luzione-sultan-validation` Supabase clone (`pkplkkmivhzdjsjvlcdt`). It is not deployed to production and no provider effect was attempted.

The evaluator remains effect-free. Promotion and rollback occur only through an admitted, reversible A2 internal command that is bound to one tenant, actor, candidate version, evaluation receipt, transition digest, resource scope, fresh policy receipt, active tenant policy, and authoritative readback.

This validates a governed adaptation mechanism. It is not evidence of consciousness, personhood, or AGI.

## Applied validation-only migrations

1. `learning_command_kernel_adapter`
2. `learning_active_policy_time_of_use`
3. `learning_command_function_revision`
4. `learning_command_receipt_immutability`
5. `learning_guardian_fk_indexes`
6. `learning_guardian_decision_rpc`

The function revision records a defect caught by the first restored-clone probe: PostgreSQL correctly rejected an ambiguous local `receipt_id`. The final function uses explicit `v_transition_receipt_id` naming and qualified evaluation columns.

## Gates

| Gate | Result |
|---|---|
| TypeScript | Pass |
| ESLint | Pass |
| Node tests | 122/122 pass |
| Next production build | Pass; learning-transition and human-review routes present |
| Guardian ledger RLS | Enabled and forced |
| Browser table grants | `anon`/`authenticated` cannot select or insert guardian decisions |
| Browser RPC grants | `anon`/`authenticated` cannot execute learning-transition or guardian-decision functions |
| Runtime RPC grant | `service_role` execute only; direct guardian-table insert revoked |
| Sultan workload | Exact Luzione membership gains `learning.commands.execute`; no guardian capability |
| External effect path | No outbox-writing trigger; probe outbox count always zero |
| Probe cleanup | Zero new probe users, commands, guardian decisions, or outbox rows persisted; earlier named validation-gate evidence was retained |

## Restored-clone scenarios

The reusable probe packs are `scripts/validation/learning-command-kernel-probes.sql` and `scripts/validation/learning-guardian-decision-probes.sql`. Permanent fixtures run inside deliberately rolled-back PL/pgSQL subtransactions.

| Scenario | Result | Authoritative observation |
|---|---|---|
| Promotion and exact retry | Pass | First call verified; retry replayed; one receipt; `DEPLOYED`; `SOURCE_CONFIRMED`; zero outbox |
| Action change with no guardians | Pass | Blocked `23514`; no receipt; candidate remains `CANARY` |
| Two-of-three guardian quorum | Pass | Two decisions inserted in one statement; exactly three configured test guardians; one receipt; duplicate guardian rejected `23505` |
| Competing commands | Pass | First commits; second blocks `55000`; exactly one receipt; zero outbox |
| Idempotency collision | Pass | Duplicate key blocks `23505` before any effect |
| Stale expected stage | Pass | Blocked `23514`; no receipt |
| Wrong tenant | Pass | Not found `P0002`; no receipt |
| Wrong actor | Pass | Denied `42501`; no receipt |
| Wrong candidate scope | Pass | Blocked `23514`; no receipt |
| Expired policy receipt | Pass | Denied `42501`; no receipt |
| Policy archived before commit | Pass | Final time-of-use gate denies `42501`; receipt and stage transition roll back atomically |
| Active capability kill switch | Pass | Blocked `55000`; no receipt |
| Command and policy mutation/delete | Pass | All rejected `55000`; admitted evidence unchanged |
| Exact last-known-good rollback and retry | Pass | `ROLLED_BACK` to version `6`; one rollback receipt; retry replayed; zero outbox |
| Wrong rollback target | Pass | Blocked `23514`; deployed version remains authoritative; no rollback receipt |
| Guardian RPC exact retry and promotion | Pass | Two RPC decisions, exact same receipt on retry and after transition, changed rationale conflicts `23505`, mutation blocks `55000`, one promotion receipt, zero outbox |
| Human rejection overrides two approvals | Pass | One current rejection blocks `23514` despite two approvals; candidate remains `CANARY`; command remains `VALIDATED`; zero receipts and outbox |

## Advisor readback

The post-migration security advisor reports 443 informational notices and zero warning/error findings across the restored clone. The guardian ledger's no-policy notice is intentional deny-all RLS with writes available only through the server RPC. Two earlier unindexed guardian foreign-key notices were fixed. The remaining guardian-specific performance notice is an expected `unused_index` informational finding because the immutable guardian ledger is empty outside rolled-back probes. The clone also has pre-existing performance warnings unrelated to this migration; this change added no guardian-specific warning. Do not delete the guardian indexes before representative workload exists.

Advisor references:

- [RLS enabled with no policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- [Unused index](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)

## Honest remaining boundaries

- The two guardian approvals were simultaneous within one SQL statement, and competing commands were tested against the same locked candidate. A true multi-session race still requires a dedicated non-bypass test role or direct validation DSN.
- The validation tenant has no persistent human guardians. Action-eligibility changes therefore remain blocked outside the rolled-back fixture, as intended.
- The human guardian API/RPC is now part of the draft stack, but its independent-session preview journey remains a release hold until three real authenticated users are enrolled. Decisions expire after 15 minutes and cannot be refreshed by mutating evidence; a fresh evaluation and command are required.
- The internal execution route is not yet exercised through preview authentication. Preview must bind to the validation project and a real account before production promotion.
- No production migration, Shopify refresh, Google document write, webhook, or other provider action occurred in this gate.
- The generic command-admission API still depends on a canonical policy-evaluation writer. This adapter deliberately does not accept learning content, votes, policy, tenant, or actor authority from its request body.

## Production release decision

Do not promote yet. The next safe gate is a preview-authenticated human journey: create/evaluate a non-action candidate, admit its exact policy-bound command, execute it as Sultan, verify the receipt in the UI, then configure three real guardians and repeat an action-eligibility review. Production migration remains a separate explicit decision after that evidence is green.

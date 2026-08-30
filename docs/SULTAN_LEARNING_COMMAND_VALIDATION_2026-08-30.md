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

The function revision records a defect caught by the first restored-clone probe: PostgreSQL correctly rejected an ambiguous local `receipt_id`. The final function uses explicit `v_transition_receipt_id` naming and qualified evaluation columns.

## Gates

| Gate | Result |
|---|---|
| TypeScript | Pass |
| ESLint | Pass |
| Node tests | 119/119 pass |
| Next production build | Pass; learning-transition route present |
| Guardian ledger RLS | Enabled and forced |
| Browser table grants | `anon`/`authenticated` cannot select or insert guardian decisions |
| Browser RPC grants | `anon`/`authenticated` cannot execute the learning command function |
| Runtime RPC grant | `service_role` execute only |
| Sultan workload | Exact Luzione membership gains `learning.commands.execute`; no guardian capability |
| External effect path | No outbox-writing trigger; probe outbox count always zero |
| Probe cleanup | Zero candidates, policies, commands, guardians, receipts, or outbox rows persisted |

## Restored-clone scenarios

The reusable probe pack is `scripts/validation/learning-command-kernel-probes.sql`. Permanent fixtures run inside deliberately rolled-back PL/pgSQL subtransactions.

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

## Advisor readback

The post-migration security advisor reports only informational notices across the 658-table restored clone; it reports no security warning or error. The new guardian ledger's no-policy notice is intentional deny-all RLS combined with explicit server-only grants. Two new unindexed foreign-key notices were fixed. The remaining new index notices are expected `unused_index` informational findings because the immutable guardian ledger is empty outside rolled-back probes. Do not delete these indexes before representative workload exists.

Advisor references:

- [RLS enabled with no policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- [Unused index](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)

## Honest remaining boundaries

- The two guardian approvals were simultaneous within one SQL statement, and competing commands were tested against the same locked candidate. A true multi-session race still requires a dedicated non-bypass test role or direct validation DSN.
- The validation tenant has no persistent human guardians. Action-eligibility changes therefore remain blocked outside the rolled-back fixture, as intended.
- The internal execution route is not yet exercised through preview authentication. Preview must bind to the validation project and a real account before production promotion.
- No production migration, Shopify refresh, Google document write, webhook, or other provider action occurred in this gate.
- The generic command-admission API still depends on a canonical policy-evaluation writer. This adapter deliberately does not accept learning content, votes, policy, tenant, or actor authority from its request body.

## Production release decision

Do not promote yet. The next safe gate is a preview-authenticated human journey: create/evaluate a non-action candidate, admit its exact policy-bound command, execute it as Sultan, verify the receipt in the UI, then configure three real guardians and repeat an action-eligibility review. Production migration remains a separate explicit decision after that evidence is green.

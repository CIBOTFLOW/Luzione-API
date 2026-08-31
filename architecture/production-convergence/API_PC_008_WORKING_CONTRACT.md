# API-PC-008 Working Contract

Capability outcome: implement a default-off API command/query path for Lead creation and Commercial Case creation/owner/next-action updates against the existing canonical Postgres rows, with P110 atomic receipts and compatibility readback, without cutting over the current UI-owned mutation path.

- Actor entrypoints: authenticated `POST|GET /api/v1/commands/leads` and `POST|GET /api/v1/commands/commercial-cases`; mutations additionally require the global mutation switch, an exact tenant entry in `LUZIONE_API_DOMAIN_COMMAND_TENANTS`, and the exact capability.
- Expected end state: a Lead can be created once, then a Commercial Case can be created once from that exact Lead version and updated with stale-version protection. Each accepted mutation atomically commits the existing domain row plus P110 receipt/event/outbox evidence and is readable through the API and API-PC-007 causal readback.
- Current authoritative truth and writer: Postgres `crm_leads` and `commercial_cases` are operational truth. Luzione UI CRM/commercial-case services are the current active writers and retain their rollback facade. This API implementation is a transfer-pending dark path until independent UI-PC-007 canary/cutover evidence.
- Target write owner: CIBOTFLOW/Luzione-API after explicit tenant/cohort cutover. This cell does not claim that transfer has occurred.
- Readback: exact tenant-bound reads from the same `crm_leads` and `commercial_cases` rows, followed by receipt causal readback when requested.
- Consumed contracts: `luzione-authority-subject/v0.1`, `luzione-command-ledger/v0.1`, `luzione-causal-readback/v0.1`, the UI P02 commercial-case durable-domain contract and the observed local canonical schema.
- Published contract: `luzione-lead-commercial-case/v0.1`.
- Dependencies: API-PC-005 and API-PC-007.
- Mutation cone: additive fresh/upgrade schema ownership artifact for the observed rows, bounded parser/service/store, two protected route modules, exact readback, tests, queue/evidence and consumer handoffs.
- Reuse/convergence: mutate the existing `crm_leads`, `commercial_case_identities` and `commercial_cases` relations; reuse P110 for all new API idempotency/event/receipt evidence. Existing UI-specific receipt relations remain readable legacy evidence but are not dual-written by the API.
- Invariants: tenant and actor never come from the body; exact idempotency replay returns the original receipt; changed-payload reuse conflicts; expected object version is mandatory; a Commercial Case origin maps to at most one identity; Commercial Case create from Lead requires an existing exact tenant/version Lead; a Lead-only case remains `legacy_unverified` until the UI-owned account/contact/opportunity relationship is complete; canonical row readback is attempted immediately after commit and any unconfirmed result returns the durable receipt reference with `RECONCILE_FIRST` semantics; legacy columns and reads remain additive-compatible.
- Non-scope: lead conversion, case stage/qualification/checklist/proposal commands, UI route edits, UI writer retirement, tenant/cohort cutover, provider effects, production migration application and production-final claims.
- Acceptance proof: fresh and observed-shape upgrade; Lead→Commercial Case vertical slice; atomic rollback; exact replay; changed-payload conflict; stale version; duplicate-origin denial; cross-tenant denial; legacy-column shadow readback; full repository gates.
- Irreversible effects: production migration application and writer cutover are explicitly excluded and require release/canary/rollback authority.

Evidence selecting this posture:

- `/Users/iremozdogan/Downloads/luzione-os/ui-demo/Luzione-UI/engineering/production-convergence/AUTHORITY_INVENTORY.md` at UI source SHA `e617ec342deb50229e78f774a1d9e04edd1ec0d8`.
- `/Users/iremozdogan/Downloads/luzione-os/ui-demo/Luzione-UI/engineering/execution/LUZIONE_P02_COMMERCIAL_CASE_DURABLE_DOMAIN_PROOF.json` at UI implementation SHA `c858bb2890d8a8ca5bf6118618435b893e02958c`.
- Read-only local Postgres inspection: existing `crm_leads`, `commercial_case_identities`, `commercial_cases`, 796 succeeded create receipts and 1,916 case command receipts; no API-PC-008 mutation was performed.

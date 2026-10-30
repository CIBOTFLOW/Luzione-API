# Sultan Partner Network A0 — bounded implementation and proof record

Date: 2026-10-29. Project: SULTAN_PARTNER_A0_001 (user-directed, additive to the existing API systems-engineering queue). Branch: `feat/sultan-partner-network-a0-20261029`, stacked on Luzione API PR #89.

## Contract and ownership
- Entry point: existing authenticated Sultan gateway `manifest` / `invoke`, no new route, scheduler, database, or authority store.
- Actor: exact `service:sultan-os` workload, tenant `luzione`, `sultan.case.read` capability, Stage 5 admission before each A0 read.
- Logical owner: `agent.luzione.partner-network-steward` for `PARTNER_RELATIONSHIP` cases.
- Source of truth: tenant-bound `public.crm_accounts` plus aggregate relationship coverage from `crm_people`, `crm_leads`, and `crm_opportunities`; Luzione API is read owner, not CRM mutation owner.
- Canonical identity: `crm_accounts.account_id` UUID, not legacy `crm_accounts.id` alias. Unknown/foreign identities return no case. After tenant-verifying the canonical account, relationship counts include either its canonical UUID or its legacy `id` alias, avoiding undercounted linked leads.
- Effect authority: A0 only. No CRM writes, sends, drafts, approvals, or paid inference.

## Implemented boundary
- Single `REPEATABLE READ READ ONLY` Postgres transaction with `app.tenant_id` bound from the authenticated actor and tenant predicates on all four queries.
- Account business fields and aggregate counts/latest update times only; no individual names, email addresses, notes, raw leads, or raw opportunity details.
- SHA-256 projection-version over the bounded account and relationship summary; four case/version-bound source references. This is a **projection version**, not an all-column CRM record version.
- `luzione.case_context.read` discovers the projection version; `luzione.partner_relationship.read` and `luzione.missing_evidence.read` require that exact version and Stage 5 admission. Unknown tools remain denied.
- Explicit evidence gaps for unverified partner type, absent current Partner IQ, or no linked professional/lead evidence.
- Existing `readEvidence` receives the admitted snapshot from PR #89; no second case read.

## Read-only managed schema inspection
- Supabase project `cfwkqhenhnvnnwpxdjns`, public table metadata inspected without row reads or mutations on 2026-10-29. Confirmed: `crm_accounts.account_id` UUID, `crm_accounts.id` text, `account_name/account_type/status` text, `partner_iq` numeric, `partner_iq_version/partner_iq_confidence` text, `updated_at` timestamptz; `crm_people.account_id` text, `crm_leads.account_id` text, `crm_opportunities.account_id` text, and all three `updated_at` timestamptz. All four tables report RLS enabled. This does **not** prove FORCE RLS, deployed runtime role permissions, tenant-denial behavior or SQL execution against a disposable database.

## Production authorization blocker discovered (read-only catalog query)
- Managed PostgreSQL catalog inspection found `relrowsecurity=true` but `relforcerowsecurity=false` for all four CRM tables. `pg_policies` counts: `crm_accounts=0`, `crm_people=0`, `crm_leads=1`, `crm_opportunities=0`. With a non-owner, non-bypass role, RLS may deny reads even when tenant predicates are present; an owner/bypass role would need separate security review. **Do not equate tenant SQL filters with proven RLS isolation.**
- Named roles `luzione_api_runtime`, `luzione_api`, and `luzione_provider_worker` were not present in the inspected `pg_roles` result. This does not identify the actual deployed API credential. No role/grant/policy modifications were made.
- **Gate:** no production enablement or promotion until the deployed API credential is identified and a disposable or otherwise authorized tenant-isolated test proves permitted in-tenant reads and denied cross-tenant reads without bypass. Keep this PR draft.
- Implemented fail-closed feature gate: `LUZIONE_SULTAN_PARTNER_A0_ENABLED` defaults to OFF; when unset, the Partner Network manifest is empty and tool invocation is denied. Only explicitly enable after the preceding RLS/credential proof. This gate does not weaken Stage 5 or grant any write authority.

## Tests and evidence
- Local Node v22.16.0 experimental type-stripping run: **9/9** pure projection tests passed against `partnerCase.ts` (version binding, stable digest, altered coverage, invalid input, missing evidence, unknown tool).
- Added API `sultan-partner-read.test.ts` to exercise the real module with fake Postgres pool, read-only transaction, tenant/workload denials, rollback/release, manifest A0-only, Stage 5 gate, and exact/stale version behavior.
- Full repository `npm run verify`, hosted CI, disposable Postgres with the actual Luzione CRM schema, signed authenticated Sultan→API journey, and production readback: **NOT YET VERIFIED**. Do not infer these from local pure tests.

## Failure and repair evidence
- Initial exact-head GitHub Release gate run `40986723153` failed two tests: canonical taxonomy did not include the new suite; the Revenue steward inherited the new partner tool because its existing manifest used a denylist. The latter was an authorization-scope defect discovered by regression.
- Repair: register the suite in `platform-testing/taxonomy.ts`, change Revenue manifest to an explicit allowlist, and add a cross-steward regression. Preserve this failure history; final head CI is a separate gate.
- Second exact-head Release gate run `40987294675` failed the topology inventory test because the new default-off environment flag was not registered in `LUZIONE_API_TOPOLOGY_INVENTORY_V1.json`. Registered the flag and kept the negative test intact; the final-head gate must be rerun.

## Unresolved and next
1. Managed schema columns have been inspected read-only; still verify query plans, RLS policies and the exact API runtime role against a disposable tenant-isolated database.
2. Run GitHub CI at the exact PR SHA and repair any type/lint/test/build failures.
3. Exercise a disposable tenant-isolated Postgres fixture, including RLS and cross-tenant negative reads.
4. Produce a trusted, signed A0 manifest/read receipt and verify it in Sultan's shadow projector. No customer payloads in Git.
5. Keep Account Relationship and Economic Integrity unimplemented until their canonical adapters exist.

Engineering state: IMPLEMENTED (bounded). Release evidence: NOT_ASSESSED. Effect authority: NO_EFFECT. Finality: NOT_FINAL. No production changes.

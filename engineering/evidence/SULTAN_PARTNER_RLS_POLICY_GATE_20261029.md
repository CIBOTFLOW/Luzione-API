# Sultan Partner Network A0 — RLS policy-presence gate (2026-10-29)

## Source inspection
Read-only catalog inspection of Supabase project cfwkqhenhnvnnwpxdjns, public schema:
- crm_accounts: RLS enabled, FORCE RLS false, SELECT-capable policies **0**
- crm_people: RLS enabled, FORCE RLS false, SELECT-capable policies **0**
- crm_leads: RLS enabled, FORCE RLS false, policy **crm_leads_tenant_context** (ALL, PUBLIC; tenant_id = current_setting('app.tenant_id', true))
- crm_opportunities: RLS enabled, FORCE RLS false, SELECT-capable policies **0**

No customer rows were selected or changed. This is metadata from the database catalog, not a production runtime role authorization proof.

## Implementation
Added a fail-closed policy-presence check in readPartnerCase() after row_security_active() and before any CRM source read, inside the existing tenant-bound REPEATABLE READ READ ONLY transaction. Reject with PARTNER_RLS_SELECT_POLICY_MISSING if any of the four tables lacks a SELECT/ALL policy. An empty policy result is a configuration error, not evidence of an empty account.

## Tests
Extended synthetic Pool tests with policy catalog responses and negative coverage for each missing table, empty result, and zero-count result; checks rollback, release, and no customer-table reads. Execute via:
`node --import tsx --test src/modules/sultan-agent-gateway/tests/sultan-partner-read.test.ts`
Then `npm run verify` and repository security gates. This document does not claim those commands ran.

## Limits / next gates
Policy existence and row_security_active() are necessary but insufficient. A permissive policy could be overbroad; an existing policy may not apply to the actual runtime role. Before enabling Partner Network, create a disposable Postgres fixture with two synthetic tenants and run positive and cross-tenant negative tests using the actual non-bypass service role, including alias paths. Confirm policy semantics, deployment credential, and Stage 5 authenticated read receipts. The feature remains disabled by default. No policy migration or production changes authorized in this PR.

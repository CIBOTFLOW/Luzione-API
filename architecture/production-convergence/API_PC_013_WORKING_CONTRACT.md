# API-PC-013 Working Contract — Security Roles, RLS and Migration Ownership

Project: `API-PC-013` — converge the admitted API data surface on explicit non-login roles, forced tenant isolation and repository-owned migration evidence without applying production DDL or changing deployed credentials.

- Entrypoints: API database transactions acting through `luzione_api_runtime`; the provider delivery process acting through `luzione_provider_worker`; authenticated operators reading the existing `GET /api/v1/security/rls-readiness` catalog contract.
- Expected end state: every admitted P110/P111, Lead/Commercial Case, Proposal/Quote/Approval and Order/Fulfillment Intent relation is RLS-enabled and forced; browser roles and legacy `service_role` have no direct table privilege; runtime and worker roles have bounded, machine-readable privileges; tenant A cannot read or write tenant B rows.
- Authoritative truth: PostgreSQL catalogs (`pg_class`, `pg_policy`, `information_schema.role_table_grants`, `pg_roles`) plus the protected canonical rows themselves.
- Write owner: `CIBOTFLOW/Luzione-API` owns the migration artifact and security contract. The database migration principal retains DDL ownership; runtime roles are `NOLOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION` and `NOBYPASSRLS` and never own relations.
- Readback: the RLS-readiness service returns catalog-derived enabled/forced posture, client exposure and active denial probes; the disposable proof additionally exercises role privileges and cross-tenant row behavior.
- Consumed contracts: `luzione-authority-subject/v0.1`, `luzione-command-ledger/v0.1`, `luzione-workflow-delivery/v0.1`, the admitted domain contracts from API-PC-008 through API-PC-010 and API-PC-011 worker behavior.
- Published artifacts: `20260831090000_api_pc_013_least_privilege_roles_rls.sql`, `API_PC_013_OWNERSHIP_MANIFEST.json`, expanded RLS posture contract and disposable denial proof.
- Dependencies: API-PC-004 is complete; P110/P111 and domain migrations provide the relations being secured. API-PC-011 provides the exact worker access pattern.
- Mutation cone: one additive role/RLS/grant migration, RLS catalog evaluation/readback, security tests, ownership metadata and proof scripts. No domain row shape or business command changes.
- Reuse/convergence: extend the existing RLS-readiness service and existing `app.tenant_id` transaction binding. Do not create a second identity store, tenant store, authorization engine, data API schema or policy registry.
- Invariants: runtime roles never log in or bypass RLS; no runtime role owns DDL; no browser or `service_role` table grant remains on the admitted surface; all tenant-bearing relations use exact `app.tenant_id` equality; `quote_lines` derives tenant through its canonical Quote; worker access is limited to command-receipt closure and delivery/reconciliation relations; runtime access excludes DELETE; missing tenant context yields no row visibility; a role or policy drift fails readiness.
- Explicit non-scope: canonical membership persistence deferred by API-PC-004, deployed login-to-group-role mapping, UI/Sultan repository edits, Supabase Data API exposure, destructive ownership transfer, production migration application, credential rotation, provider activation and live effects.
- Acceptance proof: fresh and observed-shape upgrade migrations; idempotent reapplication; catalog/advisor checks for role attributes, forced RLS, policy coverage and exact privilege ceilings; `anon`, `authenticated` and `service_role` denial; runtime missing-tenant and cross-tenant non-disclosure; cross-tenant insert denial; worker out-of-scope table denial and in-scope tenant isolation; full repository gates.
- Irreversible effects: none exercised. Production role creation, migration application, role membership, credential rotation or cutover requires separate release authority and rollback/readback evidence.

Repository reality used to select this contract:

- P110/P111 already uses forced tenant RLS but grants a broad legacy `service_role`; the domain dark-path migrations intentionally deferred RLS to API-PC-013.
- API transactions already bind `app.tenant_id` inside each transaction, so the migration can converge on that one context rather than add another tenant mechanism.
- The standalone provider worker reads or mutates only P110 command receipt, outbox, kill-switch, delivery-attempt, dead-letter and reconciliation rows; it does not require domain, inbox or P111 workflow grants.
- The earlier workflow-pack migration depends on a wider legacy schema and is not part of the admitted production-convergence surface in this proof. Its ownership and application history remain separately unproven.

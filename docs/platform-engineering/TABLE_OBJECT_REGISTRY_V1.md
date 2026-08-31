# Table Object Registry V1

Contract version: `luzione-table-object-registry/v1`  
Semantic owner: `CIBOTFLOW/Luzione-API`  
Physical schema owner for the admitted slice: `CIBOTFLOW/Luzione-UI`  
Capability owner for the admitted slice: `CIBOTFLOW/Luzione-Supplier-Portal`

## Outcome

The table-object registry extends the existing API-owned source-of-truth and service catalogs with a strict, metadata-only object contract. It gives consumers one place to resolve physical schema ownership, capability ownership, domain, data role, authority status, lifecycle, projection lineage, reconciliation posture, security posture, freshness evidence and retirement gates.

This contract does not copy the Luzione UI production catalog, read table contents, create a second database authority or authorize a schema change. `GET /api/v1/catalog` exposes the bounded declarations additively.

## Admitted source

The first slice reconciles the production metadata snapshot produced after Luzione UI migration `repo_150_browser_privilege_and_crm_identity_convergence_20260831`:

- exact implementation SHA: `d6b23f6f97ac065b6af3572ab010c478ae9d9b24`;
- observed at: `2026-08-31T04:16:58.706Z`;
- observed estate: 713 public tables;
- declared here: 22 authenticated Supplier Portal browser surfaces;
- excluded from the approval: the remaining 691 tables, including the private Supplier Portal support relation;
- contents read: none.

The 22 declarations approve the Supplier Portal capability owner only. They retain `REVIEW` lifecycle, preserve the Luzione UI physical schema owner, and do not assert that unclassified data roles or projection lineage have been resolved.

## Safety and invariants

Every admitted object must:

1. use a unique `public.<table>` qualified name;
2. bind its declaration to the exact source version and evidence references;
3. reject unknown authority, data-role and lifecycle values;
4. preserve anonymous denial, authenticated RLS, at least one policy and service-role access for this browser-surface slice;
5. remain non-retirable until repository references, recurring activity, inbound dependencies, capability-owner approval, quarantine simulation, rollback and post-change observation exist;
6. name a canonical successor before any future entry can be marked retired and retirement-allowed.

The schema is published at `contracts/objects/luzione-table-object-registry-v1.schema.json`. Breaking field or enum changes require a new major contract version and independent UI/Sultan consumer evidence.

## Reconciliation

The registry is intentionally snapshot-aware. Its freshness status is `SNAPSHOT_ONLY`, with no invented maximum age or continuously observed production claim. Luzione UI remains responsible for refreshing the metadata snapshot. The API compares future exact source versions and promotes additional objects only when ownership and lifecycle evidence are explicit.

The remaining estate is managed as a review queue, not as a migration backlog. A large table count alone is not evidence for consolidation or deletion.

## Proof boundary

Local contract tests prove the exact 22-name set, owner separation, RLS metadata, fail-closed retirement, strict schema, catalog publication, compatibility registration and bounded coverage accounting. They do not prove current production freshness, application references, query activity over time, policy correctness, managed deployment or independent consumer adoption.

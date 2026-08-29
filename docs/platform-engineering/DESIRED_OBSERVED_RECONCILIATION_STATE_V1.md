# Desired, Observed and Reconciliation State V1

Project: `API_SE_007`  
Canonical source: `src/modules/platform-contracts/stateContract.ts`  
Contract version: `luzione-reconciliation-state/v1`

## Working contract

A state claim carries a stable scope, desired state and source, observed state/source/time, freshness deadline, reconciliation state, reason, owner, next action and evidence references. Its reconciliation state is one of `UNKNOWN`, `CONVERGED`, `DRIFTED`, `RECONCILING` or `BLOCKED`.

No observed source or timestamp yields `UNKNOWN`; a fresh match yields `CONVERGED`; a mismatch or stale observation yields `DRIFTED`. An explicitly evidenced active recovery may report `RECONCILING` or `BLOCKED`. Configuration counts are desired-state evidence only and cannot become provider observation.

The contract is published additively on:

- `/api/v1/healthz` for security-readiness, including the canonical Postgres RLS gate;
- `/api/v1/readyz` for dependency-readiness, explicitly separate from the RLS gate;
- Sultan aggregate connector status, where Gmail, Drive and Airtable configuration remains `UNKNOWN` until authoritative provider readback, and Shopify uses its sync ledger and a 48-hour freshness window.

## Acceptance and non-scope

Tests cover convergence, staleness, missing observation, active reconciliation, distinct health scopes and configured-without-observation behavior. The API does not perform new provider probes, alter existing status fields, authorize recovery, or claim production observation.

Strongest claim: `CONTRACT_STABLE | LOCAL_PROVEN | NO_EFFECT | BOUNDED_CLAIM`.

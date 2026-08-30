# Production Truth and Readiness Evidence V1

Project: `API_SE_011`  
Canonical source: `src/modules/platform-readiness/evidence.ts`  
Runtime surface: `GET /api/v1/healthz`  
Contract version: `luzione-readiness-evidence/v1`

Readiness is derived from explicit evidence records carrying source, source kind, observation time, freshness limit, threshold, actual value, status, impact, owner, environment, exact SHA and evidence tier. Stale or unobserved blocking evidence becomes unknown and fails closed.

Configuration, local proof, preview proof and production observation remain distinct. Configuration cannot be promoted into observed proof. Preview and production claims require an exact SHA and matching environment. An overall production-release-ready result requires every blocking observation to be fresh, passing and production observed; local or configured passes may support bounded operation but never production finality.

The existing health meaning remains security readiness. Its response now includes configuration-presence observations and canonical Postgres RLS readback evidence without treating either as another truth store. Dependency readiness remains separately owned by `readyz`.

Tests cover fresh, stale, missing, failed, configuration-promotion and mismatched production claims. No deployment or external effect is performed.

Strongest claim before exact-head gates: `IMPLEMENTED | LOCAL_PROVEN | NO_EFFECT | BOUNDED_CLAIM`.

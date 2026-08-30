# Service Catalog, Dependency Graph and Runbooks V1

Project: `API_SE_009`  
Canonical source: `src/modules/platform-service-catalog/registry.ts`  
Public read surface: `GET /api/v1/catalog`  
Registry version: `luzione-service-catalog/v1`

## Working contract

The catalog publishes the two deployables proven by the API topology inventory: the Next.js API/engineering console and the additive Postgres migration bundle. Each descriptor carries owner, repository, runtime, criticality, truth scope, dependencies, contracts, SLI/SLO references, runbooks, dashboards, health probes, data class, effect boundary, deployable reference and observed release SHA.

Dependencies are separate typed nodes for canonical Postgres, Vercel hosting/workload identity, indirect Shopify source, and the UI/Sultan consumers. UI and Sultan remain `UNVERIFIED_CONSUMER`; Shopify remains `INDIRECT_SOURCE`. No consumer runtime metadata is guessed.

`lastObservedReleaseSha` remains null because local source/build evidence is not a production observation. SLI/SLO references now resolve to the provisional API-owned registry; empty dashboard arrays remain an explicit future input, not implicit absence of ownership.

The runbook registry resolves to bounded containment, diagnosis/recovery, verification and escalation guidance for API readiness, database/RLS, P113 projection and Sultan aggregate readback.

## Acceptance and non-scope

Tests prove unique real deployables, resolvable graph edges, unverified consumer labels, existing deployable/runbook paths and additive catalog publication. This project does not deploy, modify infrastructure, create dashboards/SLOs, inspect consumer repositories or claim production release identity.

Strongest claim: `CONTRACT_STABLE | LOCAL_PROVEN | NO_EFFECT | BOUNDED_CLAIM`.

# Production Convergence Risks

1. Room Planner managed public tables have critical broad grants and mostly disabled RLS; treat this as a potential exposure condition until contained and investigated.
2. Room Planner production `/app` is broken and its deployment lacks exact Git provenance.
3. API production health is fail-closed on managed migration/role/RLS drift; dependency readiness is intermittent.
4. UI request paths perform runtime DDL and a property-signals cron exceeds the function duration limit.
5. Sultan model routing and Shopify/document provider evidence are degraded or unverified.
6. Licensing is a local contract/store foundation only; pricing, provisioning, billing, metering and customer activation are absent.
7. Trade rules, landed-cost inputs and country documents require authoritative effective-dated sources and human review; AI output cannot establish legal finality.
8. UI, Sultan and Room Planner consumption of the new exact contracts is unproven.
9. Preview/production canary, rollback, managed restore and authoritative journey evidence must be observed before certification.

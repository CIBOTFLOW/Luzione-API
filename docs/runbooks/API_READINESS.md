# API Readiness Triage

Owner: Luzione API platform owner. Scope: `/livez`, `/readyz`, `/healthz`.

## Containment

Keep mutations and external effects disabled. Do not promote a release when dependency readiness or the separate RLS security gate fails.

## Diagnosis and recovery

Check `livez` first, then `readyz` for database/configuration, then `healthz` for canonical Postgres RLS posture. Use request/correlation IDs in bounded logs. Restore configuration or database reachability through the owning platform; do not weaken a gate.

## Verification

Require fresh `readyz` and `healthz` observations for the exact release. A 200 from `livez` alone is insufficient.

## Escalation

Escalate unresolved host/runtime failures to the deployment owner and data/RLS failures to the database and security owner. Attach exact release SHA, timestamps and correlation IDs without secrets.

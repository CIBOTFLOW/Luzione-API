# Production control matrix

Last reviewed: 2026-08-28

This is an implementation control map, not a claim that a SOC 2 audit has been completed.

| Control | Implementation | Automated evidence | Owner cadence |
|---|---|---|---|
| CC1/CC2 governance | Versioned autonomy constitution, tenant policies, clear service ownership | Policy and workflow tests | Quarterly |
| CC3 risk assessment | Effect classes, data classes, dependency and budget gates | Release test suite | Each release |
| CC5 logical controls | Service authentication, tenant-derived actor context, RLS posture gate | Auth and RLS tests | Each release |
| CC6 access security | Least privilege, workload OIDC, server-only secrets, fail-closed policy | CodeQL, Dependabot, CI | Continuous |
| CC7 operations | Structured request logs, liveness/readiness, kill switches, reconciliation | Runtime logs and endpoint checks | Continuous |
| CC8 change management | Reviewed PR, protected branch, test/build gate, immutable SHA evidence | GitHub Actions artifact | Each change |
| A1 availability | DB-aligned compute region, bounded pool, timeouts, idempotency, recovery playbooks | Readiness timing and workflow tests | Continuous |
| C1 confidentiality | Data classification ceiling and external-provider restriction | Tenant-policy tests | Each release |

Evidence must be retained for at least 90 days in CI and exported to the compliance evidence store before expiration when an audit window requires longer retention.

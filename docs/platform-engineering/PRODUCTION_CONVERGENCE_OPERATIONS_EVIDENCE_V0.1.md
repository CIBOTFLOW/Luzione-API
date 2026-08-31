# Production Convergence Operations Evidence v0.1

Contract version: `luzione-production-convergence-evidence/v0.1`

The operations evidence contract joins five evidence families around one exact candidate SHA and environment:

1. dashboard and alert coverage over registered metrics or bounded health/readback sources;
2. observed SLO windows with sample count, time window, tier and source;
3. a release record with build, test, security, canary, health and production observation evidence;
4. restore and rollback observations with authoritative readback;
5. explicit deferred evidence and the strongest supportable claim.

The contract is intentionally fail-closed. Defined dashboards and alerts are not deployed observations. A local logical restore is not a managed backup or PITR restore. A documented rollback is not a preview rehearsal. Local or preview SLO windows cannot satisfy production windows. Production finality requires fresh exact-candidate production observation in addition to all release, security, SLO, restore and rollback gates.

The API catalog publishes the registry definitions. Evidence packages are validated offline with:

```text
npm run evidence:production -- <evidence.json>
```

Add `--require-production` only in a release gate that must exit non-zero for every bounded local or preview package.

No vendor dashboard, alert destination, telemetry exporter, deployment, traffic change, managed restore or production action is configured by this contract.

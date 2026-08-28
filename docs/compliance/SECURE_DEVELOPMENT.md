# Secure development and logging

Last reviewed: 2026-08-28

Security-sensitive behavior is typed, bounded, tested, and fail-closed. Unknown capabilities cannot inherit authority. Effects require idempotency, rollback, readback, budgets, dependency checks, and active kill switches. External effects require human authority and reconciliation.

Logs are structured and contain request ID, route, status, duration, tenant reference, environment, release and region. Logs must not contain secrets, authorization headers, raw prompts with customer data, payment details, or unrestricted request bodies. Security findings are triaged by severity; critical/high findings block release until resolved or formally accepted by an authorized human with expiry.

# Access control

Last reviewed: 2026-08-28

Production access uses named identities, MFA, least privilege, workload identity between services, and server-only secrets. Shared human credentials are prohibited. Tenant identity comes from verified server context and never from an AI-generated payload.

Privileged access is reviewed quarterly and on every role change or departure. Break-glass access is time-limited, one-time, logged, independently reviewed, and cannot be issued by an agent. Service-role and database credentials must not appear in browser bundles, logs, tickets, or source control.

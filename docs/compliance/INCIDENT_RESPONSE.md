# Incident response

Last reviewed: 2026-08-28

Severity is based on customer impact, data exposure, integrity loss, financial effect, and duration. SEV-1 means active material exposure or widespread production loss; SEV-2 means significant degraded operation; SEV-3 means bounded impact.

The on-call incident commander records detection time, affected tenant and workflow, release SHA, request IDs, policy version, actions, decisions, and recovery evidence. Contain first: pause the affected domain kill switch, revoke compromised credentials, block unsafe effects, and preserve logs. Recover through a reviewed rollback or forward fix, verify canonical provider readback, and notify affected customers according to contractual and legal requirements. Complete a blameless review with corrective owners for SEV-1/2 incidents.

No agent may disable a kill switch, delete audit history, raise its own budget, or declare recovery complete.

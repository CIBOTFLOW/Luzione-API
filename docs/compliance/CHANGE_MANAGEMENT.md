# Change management

Last reviewed: 2026-08-28

Production changes require a branch, reviewable diff, passing typecheck, lint, tests, build, compliance verification, and database advisor review for DDL. Deploy a preview first, validate liveness/readiness and core workflows, then promote the exact verified artifact. Record the commit SHA and migration identifier.

Emergency changes use the same evidence after containment and receive retrospective review. Roll back application releases by immutable deployment; database changes must be forward-safe, transactional, and supplied with a tested recovery plan.

# Luzione Platform Program Assignment

**Controller:** [CIBOTFLOW/Luzione-platform-program](https://github.com/CIBOTFLOW/Luzione-platform-program)  
**Authoritative queue:** [queue/program-queue.json](https://github.com/CIBOTFLOW/Luzione-platform-program/blob/main/queue/program-queue.json)  
**Repository:** `CIBOTFLOW/Luzione-API`  
**Local assignment branch:** `main`

This file is a local mirror for this repository's Codex project. Before work, reconcile it with the controller queue and the linked controller issues. The controller queue wins if this mirror becomes stale.

## Current queue items

- **A01** — `ready` — [controller issue](https://github.com/CIBOTFLOW/Luzione-platform-program/issues/1) — Restore API readiness without weakening security
- **A02** — `blocked` — [controller issue](https://github.com/CIBOTFLOW/Luzione-platform-program/issues/6) — Converge security, identity, tenant, command and readback contracts

## One-time Codex instruction

```text
Read PLATFORM_PROGRAM_ASSIGNMENT.md completely. Reconcile the current repository
head with the controller queue. Execute the first task for this repository marked
ready, publish the required handoff, then re-check the controller queue and
continue automatically while another same-repository task is ready. Stop only at
an unresolved dependency, shared-contract lock, destructive operation,
credential/production gate or explicit human approval. Never treat a merge as
controller acceptance.
```

---

# Persistent Assignment — CIBOTFLOW/Luzione-API

This is the complete controller queue for this repository. A Codex project should be prompted once, then work continuously through items that the controller marks `ready`.

## Operating instruction

1. Read `AGENTS.md`, `EXECUTION_PROGRAM.md`, `queue/program-queue.json`, `queue/CONTROLLER_PROTOCOL.md` and the relevant accepted handoffs.
2. Reconcile the actual repository head, open PRs, workflows and deployments before modifying code.
3. Claim only the first item for this repository whose status is `ready`.
4. Implement through its acceptance gate; publish the standard handoff.
5. Re-read the queue. Continue automatically only if another item for this repository is now `ready`.
6. Stop at unresolved dependency, shared-contract lock, destructive action, credential, production or human gate.
7. Never interpret a merge as controller acceptance.

## A01 — Restore API readiness without weakening security

- **Phase:** P1
- **Track:** commercial-intelligence
- **Status:** `ready`
- **Prompt sources:** Prompt 02
- **Dependencies:** none
- **Human gates:** none

### Acceptance

- clean-main build and release gate
- 40/40 expected relations
- readyz and healthz intentionally healthy at exact deployed SHA
- negative and rollback evidence

## A02 — Converge security, identity, tenant, command and readback contracts

- **Phase:** P1
- **Track:** commercial-intelligence
- **Status:** `blocked`
- **Prompt sources:** Prompt 03, Prompt 04, Prompt 05, Prompt 06
- **Dependencies:** A01, D01
- **Human gates:** production migration or credential change

### Acceptance

- ratified versioned contracts
- cross-tenant and workload-auth negative tests
- idempotent command receipts
- canonical readback
- migration rehearsal and rollback

## Required closeout

Commit the code and repository-local handoff. Report exact SHAs, tests, deployment IDs, negative-path proof, rollback, residual blockers and the next queue item. The controller—not the application project—accepts evidence and changes scores.


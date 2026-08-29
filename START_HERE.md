# Start Here — Luzione API Systems Engineering

This repository is the canonical shared platform-contract owner for the systems-engineering program.

## Read order

1. `AGENTS.md`
2. `docs/ARCHITECTURE.md`
3. `docs/platform-engineering/SYSTEMS_ENGINEERING_PROGRAM_V1.md`
4. `engineering/execution/NEXT_WORK.json`
5. `engineering/execution/CURRENT_HANDOFF.json`
6. `engineering/execution/SYSTEMS_ENGINEERING_FAILURE_LEDGER.json`
7. `engineering/execution/SYSTEMS_ENGINEERING_PROOF_LEDGER.json`

If the session was launched from the prepared Codex prompt, also read `engineering/execution/PROMPT_LUZIONE_API_SYSTEMS_ENGINEERING_V1.md`.

## Objective

Turn the existing API foundation into the coherent contract/reliability spine for Luzione UI and Sultan OS without creating duplicate truth, duplicate effect paths, or status claims stronger than the evidence.

This planning branch intentionally defines the work; it does not claim the work has been implemented.

## Execution rule

Use `engineering/execution/NEXT_WORK.json` as the queue. Work continuously until a defined S1–S4 stop condition occurs. Every material failure or unproven boundary is durable evidence, not disposable scratchpad material.

## Cross-repository rule

This session may publish contract versions and structured handoffs for `CIBOTFLOW/Luzione-UI` and `CIBOTFLOW/Sultan-OS`, but it must not edit those repositories. Their Codex sessions consume the contract and independently prove their local integration.

## No false finality

A project can be implemented and locally proven while still not production-final. Always keep engineering state, release evidence, effect authority and finality separate.
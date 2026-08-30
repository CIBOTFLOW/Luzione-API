# SLI, SLO and Error-Budget Framework V1

Project: `API_SE_010`  
Canonical source: `src/modules/platform-slo/registry.ts`  
Public read surface: `GET /api/v1/catalog`  
Contract version: `luzione-slo-registry/v1`

## Working contract

The API owns the definitions that turn platform, capability and business outcomes into measurable indicators. Each SLI names its calculation, unit, scope, source, owner, exclusions, metric names, evidence maturity and runbook. Each SLO binds one SLI to a window, threshold, alert condition and response policy.

The current registry covers HTTP success ratio and p95 latency at the platform layer, P113 current-projection ratio at the capability layer, and time-to-actionable-order at the business layer. The business measurement remains `CONTRACT_ONLY`: its canonical mutation owner has not yet been returned by independent repository evidence, so no metric name or target is invented.

All current targets are explicitly provisional. Local metric construction proves the shape of measurement records, not a rolling production window, alert, dashboard, capacity claim or production objective. A target becomes production evidence only when observations are bound to an exact release/service identity, environment and full window.

## Error-budget law

Ratio budgets are computed deterministically from total events, bad events and target ratio. An exhausted availability budget freezes risky changes or triggers investigation according to the registered policy. Security, privacy, tenancy, authorization and effect-authority controls are zero-tolerance invariants and can never be spent as availability budget.

Invalid counts and invalid target ratios fail closed. Any SLO referencing an unknown SLI, claiming non-provisional status without production evidence, or attempting to budget a security control violates the registry.

## Acceptance and non-scope

Tests prove the three measurement layers, honest contract-only business status, deterministic within/exhausted budget states, known-bad invalid input rejection, security-budget rejection, runbook resolution and additive catalog publication.

This project does not configure a collector, time-series backend, alert, dashboard or production objective. It performs no external effect.

Strongest claim: `BOUNDED_PASS | LOCAL_PROVEN | NO_EFFECT | BOUNDED_CLAIM`.

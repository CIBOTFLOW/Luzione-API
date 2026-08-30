# Zero-Tolerance Security Control Evidence V1

Project: `API_SE_015`  
Canonical source: `src/modules/platform-security-controls/registry.ts`  
Public read surface: `GET /api/v1/catalog`  
Contract version: `luzione-security-controls/v1`

## Working contract

The registry gives each release-critical security invariant one stable control ID, scope, owner, probe, remediation path, bounded evidence references and evidence maturity. It covers workload identity, tenant/RLS isolation, authority-smuggling rejection, prohibited effects, external-effect authority, telemetry minimization and fail-closed mutation switches.

Every current record is `IMPLEMENTED_LOCAL`. Source and test references prove local implementation only; they do not claim deployed configuration, live denial probes, production secret posture or production observation. The public catalog publishes definitions and maturity, never credentials, raw probe output, tenant data or customer content.

## Release gate

Every registered control is zero tolerance. Missing, unknown or failed evidence blocks the gate. An all-pass evaluation is meaningful only for the evidence set and environment actually supplied; it does not promote local evidence to production. Duplicate controls, incomplete evidence and unsupported production claims fail validation.

Availability targets and error budgets cannot waive these controls. Any production release candidate must bind fresh control evidence to the exact candidate SHA and environment, while keeping sensitive evidence in its canonical protected store.

## Acceptance and non-scope

Tests prove complete local control coverage, evidence-path resolution, fail-closed missing/unknown evaluation, duplicate and unsupported-production sensitivity, and safe additive catalog publication.

This project does not rotate secrets, change grants or policies, deploy, execute provider effects or run production denial probes.

Strongest claim: `BOUNDED_PASS | LOCAL_PROVEN | NO_EFFECT | BOUNDED_CLAIM`.

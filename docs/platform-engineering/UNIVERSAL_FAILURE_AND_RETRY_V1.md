# Universal Failure and Retry Contract V1

Project: `API_SE_005`  
Canonical source: `src/modules/platform-contracts/failureContract.ts`  
Contract version: `luzione-platform-failure/v1`

## Working contract

All current HTTP failures retain their existing status, `code` and `message` and gain one additive machine-readable `failure` value:

- domain: `AUTH | CLIENT | DATA | DEPENDENCY | MODEL | PLATFORM | POLICY | TOOL | WORKFLOW`;
- class: `CONFLICT | CORRUPT | DENIED | INDETERMINATE | INVALID | RATE_LIMITED | TIMEOUT | UNAVAILABLE | UNKNOWN`;
- retry: `BACKOFF | HUMAN | IMMEDIATE | NEVER | RECONCILE_FIRST`;
- severity: `CRITICAL | DEGRADED | ERROR | INFO`.

HTTP 400-class validation is non-retryable, authentication/authorization is denied, conflict requires reconciliation, rate limiting and dependency timeout/unavailability require backoff, and policy blocks require a human decision. Unknown or malformed legacy codes become bounded `HTTP_<status>` failures with human disposition. Provider messages remain subject to the existing route-level redaction boundary.

## Acceptance and non-scope

Tests prove the common mappings, policy precedence, conflict-before-retry behavior, bounded unknown fallback and automatic response-envelope publication. This does not automatically retry, disclose provider payloads, authorize effects, or claim adapter-specific classifications beyond current HTTP paths.

Strongest claim: `CONTRACT_STABLE | LOCAL_PROVEN | NO_EFFECT | BOUNDED_CLAIM`.

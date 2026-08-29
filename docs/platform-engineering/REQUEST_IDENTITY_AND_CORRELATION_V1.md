# Request Identity and Correlation V1

Project: `API_SE_004`  
Canonical source: `src/modules/platform-contracts/requestIdentity.ts`  
Contract version: `luzione-request-identity/v1`

## Working contract

- Every current `/api/v1` route creates one boundary identity and returns its request, correlation and trace identifiers.
- Bounded `x-request-id`, `x-correlation-id` and W3C `traceparent` values may continue caller lineage. Malformed values are replaced, not reflected.
- Actor, tenant, purpose, capability and authority are null until an authenticated route binds server-derived context. Caller headers cannot bind authority.
- Authenticated routes bind identity after `requireServiceActor`; a second actor bind fails closed.
- Mutation entrypoints may bind a bounded idempotency key. Contract/source versions are explicit sorted references.
- The existing `requestId` body field and `x-request-id` header remain compatible; correlation and trace fields are additive.

## Acceptance and non-scope

Tests cover valid propagation, malformed input replacement, server-only actor context, double-bind rejection, response headers, and every current API route. This change does not create a telemetry backend, authorize effects, replace authentication, or claim UI/Sultan propagation.

Strongest claim: `CONTRACT_STABLE | LOCAL_PROVEN | NO_EFFECT | BOUNDED_CLAIM`.

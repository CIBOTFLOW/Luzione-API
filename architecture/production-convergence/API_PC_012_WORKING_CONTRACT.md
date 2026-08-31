# API-PC-012 working contract — Sultan context, intent, policy and outcome

## Capability outcome

Publish the API-owned, exact-version boundary through which Sultan can present a typed agent identity assertion, canonical context references and a dry-run work intent for deterministic policy evaluation. The boundary must not grant direct business writes or let a model, prompt or request body create authority.

## Entrypoint and end state

```text
authenticated Sultan workload
→ POST /api/v1/sultan/agent-intents/evaluate
→ credential-bound actor and tenant
→ strict v0.1 intent/context parser
→ API autonomy constitution
→ evaluated-only policy decision
→ no mutation, send, provider effect or business-completion claim
```

## Ownership

- Sultan OS owns agent definitions, case reasoning, model/tool selection, work-order execution, simulation and cognitive evaluation.
- Luzione API owns actor/tenant/capability identity, context/intent/policy/outcome contract meaning and command admission.
- Canonical Postgres or a named provider owns business state.
- FEP retains its independent authority boundary; an FEP agent is never admitted through the Luzione effect path.

## Invariants

- Agent identity is verified only when the credential-derived actor is `agent.<id>:v<major>` for the exact asserted definition; the separator stays inside the platform's canonical credential-ID alphabet.
- Tenant, actor, roles, approval, grants and verified deployment cannot be supplied by the request body.
- The requested capability must be credential-bound and constitutionally registered.
- Stale or unknown non-synthetic context forces abstention.
- Synthetic context is simulation-only.
- A0 may be admitted only as read-only work; A1-A3 remain simulation/approval states because no canonical grant adapter is present.
- A4, wrong authority domain, wrong source owner and capability mismatch fail closed.
- Every response says that it evaluated only, mutated no business state and authorized no external effect.
- Client-declared API context freshness, version and integrity are assertions only. The runtime may admit non-synthetic context only after an API-owned adapter reads the canonical source and derives freshness and integrity server-side.
- The first canonical adapter is the exact tenant-scoped Order/line readback for a `FULFILLMENT` case at `api:orders:<orderId>`; unsupported API context abstains rather than inheriting the client's `FRESH` label.
- The API autonomy constitution and the active canonical tenant policy must both allow the plan before `ADMIT_READ_ONLY` is possible.

## Acceptance proof

- Valid credential-bound A0 intent reaches `ADMIT_READ_ONLY` with zero effect.
- Generic service identity cannot impersonate an agent definition.
- Missing credential capability, wrong domain and synthetic leakage fail closed.
- Stale context abstains.
- Client-supplied tenant/actor/role/approval/authority claims are rejected.
- Registry, manifest and OpenAPI publish the same additive v0.1 contract.
- A disposable authenticated HTTP journey proves current Order admission, stale/hash drift abstention, cross-tenant non-disclosure, tenant-policy denial and zero business writes.

## Explicit non-scope

- no production agent-deployment store;
- no live authority grant adapter;
- no business command execution;
- no provider effects;
- no production migration;
- no claim that a signed deployed Sultan workload has exercised the contract, or that any command receipt, post-effect source readback, model-quality threshold or production-autonomy gate has passed.

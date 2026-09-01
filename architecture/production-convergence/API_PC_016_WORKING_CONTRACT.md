# API-PC-016 — signed Sultan workload delegation

## Outcome

Admit the deployed Sultan OS production workload to the existing evaluation-only Sultan agent-intent route without adding a shared secret, granting a business write, or allowing the workload to invent logical agents.

## Entrypoint and identity

- Entrypoint: `POST /api/v1/sultan/agent-intents/evaluate`.
- Cryptographic workload: Vercel OIDC RS256 token for project `sultan-os`, environment `production`, exact owner and project identifiers.
- Credential actor: `service:sultan-os`, tenant `luzione`.
- Logical actor: one of the six exact v1 Luzione-owned case stewards.
- Delegation policy: API-owned exact agent ID/version, Luzione authority domain, case type and A0 capability allowlist.

Luzione UI, static service tokens, preview workloads, unknown projects, FEP agents, Sultan-internal controls, unknown agent versions, mismatched case types and unregistered capabilities cannot use the delegation path.

## Truth and authority

- Vercel signature and claims establish deployed workload identity.
- Luzione API establishes tenant, credential capabilities, delegation policy, source verification, tenant policy and autonomy decision.
- Sultan OS remains owner of rich agent definitions, prompts, model execution, criticism and evaluation receipts.
- Synthetic context may reach `SIMULATE_ONLY`; canonical fresh context is still required for `ADMIT_READ_ONLY`.
- `businessStateMutated=false` and `externalEffectsAuthorized=false` are invariant.

## Acceptance proof

1. Exact UI and Sultan production workload identities verify; preview, wrong-project, wrong-audience, expired, tampered and algorithm-confused tokens fail closed.
2. Signed Sultan may delegate a registered Luzione steward for its exact case type and A0 capability.
3. Static service identity cannot impersonate the workload delegation path.
4. Unknown, cross-case, FEP and Sultan-internal delegations are blocked.
5. Policy response records both the workload actor and logical-agent binding.
6. Contract schema, focused tests, full suite, typecheck, lint and production build pass.

## Non-scope

- No Luzione command, event, outbox item, task, proposal, order, provider call or customer/supplier contact.
- No preview-to-production trust.
- No real-data model egress.
- No business-value or production-finality claim.
- No A1–A4 promotion.

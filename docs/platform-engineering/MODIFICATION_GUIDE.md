# Platform Modification Guide

This guide defines how future engineers and agents should interpret and extend the systems-engineering model without creating parallel truth or contract drift.

## Before changing anything shared

Answer these questions in order:

1. **Who semantically owns this concept?** API, UI, Sultan OS, canonical Postgres, or an external provider?
2. **Does a canonical contract already exist?** Search the API contract registry and source-of-truth/service metadata before creating a new type or path.
3. **What exact consumer behavior changes?** Inventory UI, Sultan, API, provider and persistence consumers.
4. **Can this be additive?** Prefer optional/additive evolution to semantic replacement.
5. **How will failure behave?** Define stable failure class, retryability, authority and readback behavior before implementation.
6. **What evidence will prove it?** Define the acceptance path and known-bad sensitivity case before coding.
7. **What remains unproven after local implementation?** Record this explicitly.

## Adding or changing a service/component

A new service is justified only when an existing semantic owner cannot be extended cleanly. Before creating one:

- identify the capability boundary that cannot fit an existing owner;
- define authoritative data ownership and mutation authority;
- define dependencies and failure containment;
- define service catalog metadata, SLOs, health/readiness probes and runbook owner;
- define deploy/rollback identity;
- prove that adding the service reduces or contains complexity rather than merely relocating code.

## Adding/changing an HTTP endpoint

Every endpoint should have explicit:

- version and compatibility posture;
- authentication and server-derived tenant/actor requirements;
- capability/authority requirement;
- request/response schema;
- idempotency semantics;
- timeout/retry behavior;
- pagination/order/consistency semantics when applicable;
- stable error mapping;
- side-effect classification;
- audit/receipt/readback behavior;
- observability correlation.

Update OpenAPI/contract metadata and consumer tests in the same project.

## Adding/changing an event

Define:

- canonical producer;
- schema/version;
- event identity and correlation;
- source/version refs;
- whether the event is fact, intent, acknowledgement, decision, execution or readback;
- idempotency/deduplication;
- ordering assumptions;
- consumers;
- retention/replay behavior;
- compatibility rules.

Never use an event label to smuggle authority or claim completion without source evidence.

## Adding/changing a failure code

First map the failure to the shared domain/class/retry/severity taxonomy. Add provider/domain detail only when the stable platform code cannot express the operational distinction required by a consumer.

Every failure code should answer:

- can the caller safely retry?
- must reconciliation happen first?
- is human action required?
- is the condition expected/temporary or an invariant breach?
- what can be shown to an operator without exposing secrets?

## Adding/changing a metric or trace field

Define the question the telemetry answers. Prefer stable low-cardinality dimensions. Never put raw secrets, credentials, unbounded user content or highly cardinal identifiers into metric labels.

Telemetry must correlate to request/trace/receipt identities but must not become a substitute source of business truth.

## Adding/changing an SLI/SLO

Specify:

- scope and user/capability impact;
- exact measurement source;
- numerator/denominator or latency statistic;
- window;
- target;
- exclusions and why they are legitimate;
- alert threshold;
- owner/runbook;
- error-budget behavior.

Do not encode zero-tolerance security invariants as ordinary availability targets.

## Changing source-of-truth ownership

This is a high-risk semantic migration even when technically reversible. Require:

1. current owner inventory;
2. target owner and reason;
3. version/identity mapping;
4. dual-read/dual-write only if strictly necessary and bounded;
5. reconciliation and conflict strategy;
6. consumer migration order;
7. rollback/forward-repair plan;
8. exact cutover evidence;
9. explicit retirement of the old mutation path.

Never leave two permanent canonical writers.

## Changing a shared contract

Shared contracts are API-owned. UI and Sultan should request or consume changes through structured handoffs rather than creating local forks.

Breaking changes require a new version. A contract is not stable until compatibility behavior and consumer expectations are defined.

## Adding a provider/integration

Separate:

- desired configuration;
- credential/auth readiness;
- capability scopes;
- observed provider reachability;
- read/write authority;
- provider acknowledgement;
- authoritative source readback;
- reconciliation state;
- kill switch;
- failure/retry semantics;
- cost/usage evidence.

Do not label configured credentials as a healthy integration.

## Adding a new AI model/tool path

Sultan OS owns model/tool runtime semantics, but the shared request/failure/receipt/telemetry contracts remain API-owned. Model output alone cannot authorize external effects or become business truth.

## Required evidence update

Every material shared change should update:

- project queue/handoff;
- proof ledger;
- failure ledger if anything failed or remained contingent;
- machine-readable contract/registry metadata;
- human-readable documentation;
- exact consumer handoffs where another repository must change.

The strongest permitted status is the narrowest one directly supported by exercised evidence.
# SGO-C01 working contract — active Sultan runtime producer inventory

## Capability outcome

Publish one API-owned, evidence-only inventory that maps every observed active
chat, quote-review, task-assist, simulation, memory and drawer-command surface to
the runtime producer the pinned source actually reaches and to one canonical
source owner. A component name, registry label, route name or uncalled module is
not proof of capability.

## Entrypoint and expected end state

```text
pinned Luzione UI visible entrypoint
-> pinned server route and dispatch chain
-> one invoked runtime producer
-> one named canonical source/readback owner
-> fail-closed inventory validation
```

The end state is a parseable repository artifact plus an offline validator. No
inventory record is mounted into a runtime, served by a route, or granted action
authority.

## Authoritative truth and write owner

- `CIBOTFLOW/Luzione-API` owns the inventory format and validation law.
- `CIBOTFLOW/Luzione-UI@84f0dcecbe5aff2d29176433967a6ae0223d9214`
  is read-only evidence for visible operator entrypoints, UI-local producers and
  UI-owned source/readback stores.
- `CIBOTFLOW/Sultan-OS@ea50caa66f09b14b1ac2bcfdfb74cdf9f4c067f0`
  is read-only evidence for reasoning, model, simulation and private-memory
  producers and their persisted run/interaction records.
- `CIBOTFLOW/Luzione-API@7ee5a0a53a3434c3e00969dc626a4daad33f9dc0`
  is the exact API base and read-only evidence for existing API tool/command
  surfaces. Those surfaces remain uncredited when the pinned visible UI chain
  does not reach them.

Each active inventory row names exactly one primary source owner for the row's
authoritative record. Additional provider or domain evidence may be described,
but it cannot replace or multiply that primary owner.

## Consumed and published contracts

- Consumes controller program `SGO-20260911-01`, task `SGO-C01`, decision
  `76d5e05078a71790b5babdfc5020c63ae8513f14`, and the exact 68-ID execution
  allowlist.
- Consumes immutable Git commit/blob pins from the three repositories above.
- Publishes `sgo-c01-active-sultan-runtime-producers/v1` and its offline
  validator only.
- Does not consume, execute, resume or update legacy parent work.

## Dependencies and mutation cone

The task has no G0 dependencies. The mutation cone is limited to this working
contract, one machine-readable inventory, one validator, focused tests and the
repository-local proof/handoff records. UI and Sultan OS remain read-only.

## Invariants

- The task marker must be `SGO-20260911-01` / `SGO-C01` and the recorded
  controller allowlist count must be exactly 68.
- Every credited row must be visibly reachable and must bind exactly one runtime
  producer and exactly one canonical source owner through pinned source evidence.
- Reachability evidence must include a visible entrypoint, runtime invocation and
  canonical-source/readback hop; names alone fail validation.
- Conditional producers stay conditional. Shadow, ambiguous and unavailable
  paths stay uncredited with an explicit reason.
- The nine drawer command types are validated individually because they do not
  share one producer.
- Memory paths remain separate: Sultan OS private working memory is not Luzione
  UI governed object memory, and neither grants business authority.
- Runtime v2 and the API Sultan tool/command gateway are not credited to the
  current visible drawer unless a pinned visible invocation chain proves them.
- No route, mount, registry activation, schema, migration, provider call,
  deployment, external effect, default-branch action or shared-authority change
  is permitted.

## Explicit non-scope and gates

This is bounded G0 source reconciliation with `NO_EFFECT`. It does not prove an
authenticated deployed journey, persisted cross-system receipt/replay, consumer
integration, preview behavior, production behavior, model quality or business
outcome. G1 and G2 remain held.

## Acceptance proof

- Parse the inventory and verify exact task/controller/repository pins.
- Verify exact coverage of chat, quote-review, task-assist, simulation, memory and
  all nine drawer command action types.
- Reject duplicate surface/action claims, missing or multiple producers/owners,
  insufficient evidence roles, unexpected pins, uncredited paths presented as
  capability, and any activation/effect or out-of-scope task marker.
- Exercise known-bad mutations for name-only claims, ambiguous owners, removed
  coverage, shadow Runtime v2 promotion and authority expansion.
- Run the full repository tests, TypeScript, lint and build in proportion to this
  evidence-only change.
- Prove rollback by reversing the candidate diff to the exact base tree and
  restoring the candidate bytes.

## Irreversible effects

None. The branch is non-default and the artifact is offline. Rollback is removal
of the bounded files or reversal of the candidate commits.

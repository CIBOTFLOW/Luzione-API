# SUPPORT-CONTRACT-BUNDLE-L1-G0 immutable handoff

Status: `done | BOUNDED_PASS | LOCAL_PROVEN | NO_EFFECT | BOUNDED_CLAIM`.

This is a G0 support-contract candidate only. It is not G1, G2, integrated, production-ready or production-observed.

## Immutable identity

- Controller: `CIBOTFLOW/Luzione-platform-program@f655931439d0f9fabfdbeb6e8a6a1271894c1dd6`
- Packet: `89492596874d04cc58b819ac005ec7bd08ed77328f5eafe666e54e075ef246a0`
- Collision map: `b388706239d0675febc634e0e9276a368b6e1664a42914ebee60a8edce7fb684`
- Repository: `CIBOTFLOW/Luzione-API`
- Branch: `codex/support-output-contract-l1-g0-f655931`
- Base: `bb4c9e3e337c64d30991badfd43bb182ad0a8a16`
- Implementation I: `7f584651a71fd9218ccf4452e3a8584b68df727a`
- Implementation tree: `b0e89ca1d3c539fd718ecf01cb09d577ebaf5e0a`
- Exact final is bound without a same-commit self-hash by detached annotated tag `support-contract-bundle-l1-g0-exact-final`; the tag must peel to the evidence-and-pin commit and records the exact final SHA and both pin blobs.

## Published surface

`LuzioneSupportContractBundle/v1` contains exactly 20 topologically ordered public entries: 12 source-evidence documents, seven read projections and `SupportOutputHandoff/v1`. One non-public internal definitions schema owns strict original-byte parsing, common envelopes, typed `ABSENT` and qualified source references. The generated TypeScript surface exports exactly 20 public types and 20 strict parsers.

No builder, store, resolver, provider, writer, migration, scheduler or finalizer is exported. The output handoff is evaluator-only, `NO_EFFECT` and `NOT_FINAL`.

The exact ordered identifiers and schema digests are in `contracts/support/v1/manifest.json` and the companion JSON evidence. Consumer pins are:

- L2: `contracts/support/v1/consumers/l2-support-readers.pin.json`, SHA-256 `8ca1e64c1c92d277ff04c9bdc8c1f1ec2a14e56fac8bb29c1956c22f64d0a1ba`, Git blob `98f90c1cc889ff4e464b53e7271a7b888db5cb73`.
- L3: `contracts/support/v1/consumers/l3-support-output.pin.json`, SHA-256 `ce8ddc5a8f69329e6a2e904605ce3d7dc6dd1a9753430704d534a07ded36a03e`, Git blob `41fdd57c8de69b9ca73473188c02b1fcc5e720ce`.

Key artifact digests:

- Manifest SHA-256: `1a6e407d3490e9f833e83fd822a50c92c6e4d0ad5b50b13286d093389e42fc0e`
- Internal definitions SHA-256: `d73942caea8caca330b123bdee733628c10ed0327618ddc7f1046d1f63c3ca63`
- Generated SDK SHA-256: `22da15fec183a9e15382d1b9752147fe3fc6fafe86b57db7e0394bc0b1763c16`
- Generator SHA-256: `da8021007c1d38713ebfb9f839b97d2c485f24844ca4d54f6cd8a776552b6468`
- Runtime template SHA-256: `c515f080a369c2e121b4d09299fd8e009dd7fa24db9deaa224321e6ddc82a8b7`
- Schemas / SDK / fixtures / tests Git trees: `68ecefd8ff4b62427e879b6f9607252e72bb49a4` / `d6353067d35a980416e8a024d2b6bdcc1b088009` / `5963d1dda95880d14643b7f49a7814a8006f504a` / `bc45161a0b15a456e08f2a84cc5732edcc688caf`

## Frozen truth and dependency stops

Core tree `d57ccc4cccd97b37acd1a1575b1e07ede5787349`, Core SDK tree `d594fa014d7020fdf8386c7a6926ff9b573ac355` and P110/P111 tree `a22ce25cd93e362ff44688b456b63e3eb8ec10e2` are unchanged from the exact base. `SupportCase/v1`, `SupportAction/v1` and `CustomerReply/v1` therefore remain byte-identical.

Operations-v3 remains typed `ABSENT/AWAITING_OPS_CONTRACTS_ASSURE_04`. Every dependent owner, roster, founder-Irem, G2, incident-recovery and epoch fixture remains `BLOCKED_INCOMPLETE`; none receives decision or proof credit.

## Proof

- Fourteen packet groups: 14 passed, zero failed, zero skipped.
- Full repository tests: 447 passed, zero failed, zero skipped.
- Compliance: 7 passed.
- Typecheck: passed.
- Lint: passed with zero warnings.
- Next.js 16.3.4 webpack build: passed.
- Deterministic generator: 23 artifacts reproduced byte-for-byte.
- Frozen-spine diff: empty.
- Implementation scope diff: only the packet-authorized support schema, manifest, generated TypeScript, fixture and test paths.

Negative proof rejects non-`Uint8Array`, oversize, BOM, invalid UTF-8, duplicate keys, unpaired surrogates, C0/C1 controls, trailing bytes, normalization, surplus/missing/wrong-version fields, cross-tenant references, stale/conflicting source evidence, nonexistent prior, forks, cycles and changed replay. Draft replies cannot claim acknowledgement, delivery, provider acceptance, canonical receipt or finality.

Exact-head hosted CI was not observed when this evidence commit was sealed. No preview or deployment was requested. This is truthful deferred external infrastructure, not release proof.

## Reverse and recovery

Before any consumer pin, Git-only reversal of F then I restores exact base `bb4c9e3e337c64d30991badfd43bb182ad0a8a16`; there is no DDL, persisted data, credential, provider or hosted effect to reverse. After a consumer adopts either immutable pin, recovery is forward-only through a new additive contract version and new pin—v1 must not be rewritten or silently repinned. This grants no production rollback authority.

## Risks and next action

Unexercised boundaries are OPS-CONTRACTS-ASSURE-04, L2/L3 consumer integration, authenticated readback and every live runtime/provider/database/credential path. The API writer lock is released only after the exact-final push/tag/PR handoff.

Next: `SUPPORT-CONTRACT-BUNDLE-ASSURE-01` verifies the detached exact-final tag, both pin blobs, all 20 schema/SDK meanings and the 14 adverse groups before any consumer integration.

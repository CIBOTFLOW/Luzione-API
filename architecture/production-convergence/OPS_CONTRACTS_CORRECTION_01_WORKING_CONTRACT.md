# OPS-CONTRACTS-CORRECTION-01 working contract

- Outcome: publish a versioned, strict append-ledger boundary that makes `LuzioneOperationsEvidence/v1` records safe for bounded decision calculation without changing v1 bytes or meanings.
- Entrypoint/end state: an offline L2/L3 consumer supplies an exact ledger plus prior set and explicit assessment clock; the L1 SDK either returns derived proof/stage state or a typed fail-closed error.
- Truth/write owner/readback: Luzione API owns ledger semantics and the generated parser. The immutable ledger and its deterministic digest are the only bounded readback; no route, database, provider, or runtime is added.
- Consumes/publishes: consumes the frozen v1 operations records and assurance fingerprint `80ae6a53c8ff28259389b1175f7029bf920013e03c7e5419b145c9c2a569decf`; publishes `LuzioneOperationsEvidenceLedger/v2`, its schema/manifest, SDK, fixtures, and L2/L3 pin packets.
- Dependencies: exact API base `e6dce8c92f8cee9102af341615c0fa31345ca77d`; frozen Core, onboarding, `luzione-effect-admission/v2`, and `ConnectorRevocationReceipt/v1` remain byte-identical.
- Mutation cone: new v2 schema/manifest, SDK/types/rules/fixtures/tests, package test alias, and execution evidence only. There are no routes, relations, migrations, credentials, providers, schedulers, or hosted effects.
- Invariants: canonical content digests; append-only prior-set validation; same-tenant/same-version acyclic single-successor supersession; exact typed reference resolution; valid unique service days; deterministic epoch resets; evidence-grounded completeness/hard-zero calculations; canonical human-owner derivation; exact per-effect G2 authorities; 30-day maximum; `NO_EFFECT` only.
- Non-scope: changing v1 records, opening a proof window, assigning human authority, querying production, live readback, deployment, migration, activation, merge, promotion, or rollback.
- Acceptance proof: all eleven adverse probes deny; bidirectional schema/parser parity; focused and full compliance/typecheck/lint/test/build; base-to-candidate reverse check; frozen-tree equality; exact-head CI when a draft PR is available; detached annotated tag after the exact final.
- Irreversible effects: none. Removal of the additive v2 paths and index/script wiring restores the exact base tree.

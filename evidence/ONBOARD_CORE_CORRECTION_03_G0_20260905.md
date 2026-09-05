# ONBOARD-CORE-CORRECTION-03 G0 evidence

The exact-base candidate closes only the executable reverse-safety and corrected-v2 consumer-pin defects recorded by controller authority `e698099e8b4b2de8abf3a9373fa7521fab0556ff`. Existing onboarding contract identifiers, migrations and authority semantics remain unchanged.

Both import POST and GET route evidence now names `CRMImportDryRunMap/v2`, which matches the strict request parser. Mixed `LuzioneOnboardCoreApi/v1`/import-v2 and API-v2/import-v1 packets deny. `CRMImportDryRunMap/v1` remains present only for legacy fixture and disposable reverse-compatibility use; it is not decision-bearing.

Import and connector parsers validate stable identifiers on original input before any trimming or canonicalization. Raw 201-plus, Unicode, leading/trailing whitespace, malformed digest/UUID and raw/canonical collision candidates deny. Nested Connector Binding identifiers are checked before the frozen Core parser; SandboxEcho remains the only adapter and all routes remain default-off.

Six new isolated populated fixtures cover Blueprint/source binding, approval proposal actor/human authentication, Mandate source-binding digest, Import mapping/Batch source binding, Import Row match-key digest and Receipt source binding/runtime/deadline. Together with the prior append-only revocation fixture, seven fresh disposable databases refused the correction reverse in its first executable preflight block. A SHA-256 snapshot over relation security, columns, constraints, triggers, policies and every row was identical before and after each refusal. A separate empty database reversed to no revocation relation and zero v2 columns, then reapplied to the relation plus 10 v2 columns.

Local evidence: focused onboarding 20/20; full repository 447/447; compliance 7/7; typecheck; zero-warning lint; Next.js 16.3.4 webpack build; and all Blueprint/Mandate, Import and Connector disposable suites pass. The Core, effect-admission, connector-revocation, operations v1/v2/v3, onboarding schema and correction migration/reverse trees/bytes match the exact base.

The exact base-to-implementation source diff passes `git apply --reverse --check` in an isolated extracted tree. This proves source reversibility only; it does not authorize database reversal or production rollback.

Exact-head CI and authenticated Git-bound application readback were not observed at this local evidence seal. The detached annotated tag binds the exact final after the evidence commit. Independent assurance and an immutable L2 corrected-v2 consumer remain required. This is bounded local G0/NO_EFFECT evidence only; it is not integrated, G1, G2, production-ready, production rollback authority or managed recovery proof.

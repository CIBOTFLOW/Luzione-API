# API-PC-016 Working Contract — Product Catalog, Licensing and Room-Plan Proposal Boundary

Project: `API-PC-016` — publish the first API-owned productization contract for premium-home-goods distributors, procurement shops and design firms without treating packaging as runtime authority.

- Entrypoint: `GET /api/v1/productization` publishes public definitions only. Tenant-specific license state is never exposed on the public route.
- Expected end state: customer profiles, licensable modules, edition bundles, Europe-to-USA market phases, vertical workflow packs, fail-closed license evaluation and an exact-version room-plan proposal attachment are machine readable.
- Authoritative truth: a future canonical license store owns tenant entitlements; the room planner owns project/room/concept/document versions; Commercial Case proposal context and final proposal review remain API/UI commercial truth.
- Write owner: `CIBOTFLOW/Luzione-API` owns the contracts and deterministic evaluators. No license, planner, proposal, pricing, customer-send or acceptance write is authorized in this project.
- Readback: public product definitions are non-sensitive but returned per request with `no-store` correlation identity; license evaluation consumes only a fresh canonical snapshot; room-plan attachment requires tenant, case, proposal-context, project, room, document, digest and human-review evidence.
- Published contracts: `luzione-product-catalog/v0.1`, `luzione-tenant-license-entitlement/v0.1` and `luzione-room-plan-proposal-attachment/v0.1`.
- Dependencies: existing tenant/workflow policy, autonomy capability registry, Commercial Case proposal/version contract and room-planner IntegrationOutbox are reused rather than replaced.
- Mutation cone: productization contracts, public catalog route, workflow/capability definitions, OpenAPI/manifest/catalog metadata, tests and cross-repository handoffs.
- Invariants: license checks never grant actor authority; unknown/stale/cross-tenant/inactive entitlements fail closed; trade rules require authoritative effective-dated sources and human review; room plans cannot establish pricing, customer-send or binding-acceptance authority; consumer integration requires independent exact-version evidence.
- Non-scope: prices, payment-provider selection, billing synchronization, applying a managed migration, enabling a customer tenant, legal advice, planner deployment repair, sending a proposal or editing consumer repositories.
- Acceptance proof: catalog graph/market/profile integrity; license denial tests; exact-version room-plan attachment negative tests; schema/manifest/OpenAPI parity; full repository gates and zero production effects.

Repository reality used to select this contract:

- Luzione UI already exposes CRM, growth, money, orders, tasks and a governed eight-stage proposal workspace.
- The managed API is fail-closed on schema/RLS drift, so this slice cannot honestly activate tenant licensing in production.
- The standalone room planner owns versioned Project, Room, Concept, GeneratedDocument and IntegrationOutbox records, but its production UI and database posture currently fail the production gate.
- The canonical database already contains offer-productization records; those commercial offers are not reused as tenant license authority.

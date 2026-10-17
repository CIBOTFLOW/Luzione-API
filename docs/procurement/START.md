# Procurement evidence boundary — delegated API work

Sultan-OS coordinates this user-approved cross-repository program. Parent intake:
engineering/sultan-product/procurement/AMENDMENT.json. Record exact PX task/source ref and
local path reservations in the existing handoff; no second autonomous scheduler. Read the
local AGENTS, START_HERE, architecture, queues and failure/proof ledgers first. The API owns
shared contract versioning; it does not silently acquire Luzione-UI's current migrations or
operational writes. Consumer jobs run in separately scoped repository worktrees.

PX-01 starts with src/modules/procurement-contracts/evidence.schema.json. It is an observation
transport DRAFT, not a registered endpoint, trusted upload validator or authorization grant.
Envelope validation is necessary, not sufficient: identity/client binding is server-owned;
all referenced documents/lines/versions/spans must exist and be authorized; source digest
requires byte verification; date ranges must be ordered; quantity sums, nonzero price bases,
matching consistency and UOM equivalence require semantic checks. Payload declarations of
source type/approval are not independently trusted. Redact private source excerpts by rights.
Unknown/partial evidence remains explicit. Exact matcher state cannot be supplied by an
untrusted caller as its own verification. Require verified source-origin receipt at ingress.

The first facade reads the current canonical operational owner and returns a pinned snapshot
manifest. Apply requests keep exact input versions, approval authority and one existing
command/readback path. No direct writes or duplicate PO/stock tables in this repo until an
explicit ownership transfer is separately proven. Future 3PL contracts distinguish observation
from physical inventory authority and support delayed/duplicate/out-of-order events.

Use OASIS UBL document distinctions and GS1 EPCIS event/record timing as design references,
not a claim of full standards implementation. No automatic provider connection, credential
change, production migration or supplier communication is authorized by this document.

Contract tests must reject fake actor/tenant/approval fields, float quantities, unknown date
kinds, malformed versions and excess payloads. Independent business-semantic tests must cover
partial acknowledgements, source supersession, quote/PO/receipt differences, matched line
ambiguity, currency comparability and readback after revocation. Consumers pin this artifact's
hash and schema version. Do not fork a competing schema in Sultan or Luzione-UI.

## Bounded verification
`python3 tests/procurement/schema_check.py` uses a preinstalled approved jsonschema package.
Twelve local checks passed. These are shape/format checks, not authenticated API, business
semantics, live endpoint or provider evidence. Null price/quantity/spec/effective date explicitly
means missing; calendar-day promises do not invent a timestamp or timezone. Reuse the actual
repository validation/build conventions when mounting the contract; no package installation or
root dependency change is part of this source-only draft.

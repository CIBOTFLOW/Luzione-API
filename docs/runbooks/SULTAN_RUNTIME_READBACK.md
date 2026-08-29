# Sultan Runtime Readback Triage

Owner: Luzione Sultan integration owner. Scope: aggregate Sultan status and provider observation semantics.

## Containment

Keep raw conversations and record identifiers out of the public aggregate. Do not convert stored connector counts into provider-health claims or authorize model/tool effects.

## Diagnosis and recovery

Inspect the bounded Postgres aggregate function and classified readback failure. Treat Gmail, Drive and Airtable as `UNKNOWN` until authoritative provider reachability/readback exists. For Shopify, inspect the canonical sync ledger and 48-hour freshness boundary.

## Verification

Require a timestamped authoritative source, freshness deadline, reconciliation state, owner and next action. Provider acknowledgement is not source readback.

## Escalation

Escalate aggregate/schema issues to the API database owner and model/tool/provider runtime issues to the Sultan OS owner through a versioned consumer handoff.

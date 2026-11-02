# Integration Inventory Contract

The private release register contains tenant-specific connections and evidence.
The public contract records provider categories and promotion requirements.

| Category | Capabilities | Promotion requirement |
| --- | --- | --- |
| Email and calendar | read, draft, controlled send, reply/event capture | tenant connection, refresh proof, exact approval, provider readback and reconciliation |
| Documents and storage | read, private artifact create/update | confidentiality scan, private ACL and artifact-version readback |
| Commerce and accounting | catalog/order/accounting reads; separately gated writes | atomic receipt, source count/version readback, idempotency and kill switch |
| Ads, analytics and product analytics | read and normalize evidence | scoped token, freshness, pagination, quota and tenant attribution |
| CRM enrichment and outreach | enrich, draft, bounded enrollment/send | consent/contactability, allowlist, A2/A3 policy and provider readback |
| Workflow and data-plane tools | read, projection and bounded command callback | signed command envelope, idempotency and canonical outcome |
| Fulfillment providers | quote/read; booking separately gated | sandbox/read proof, effect class, approval and reconciliation |
| AI providers | reason, structure and evaluate | server credential, model allowlist, usage/cost ledger and no direct effects |

Connections begin as `LEGACY_MANAGED` when a working legacy read path exists.
Promotion occurs per capability; a provider can be live for reads while send,
publication, booking, payment, deletion, or other effects remain blocked.


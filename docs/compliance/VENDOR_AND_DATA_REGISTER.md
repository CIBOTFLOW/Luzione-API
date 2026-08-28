# Vendor and data register

Last reviewed: 2026-08-28

| Vendor class | Purpose | Typical data | Required control |
|---|---|---|---|
| Supabase/Postgres | Canonical application data and identity | Customer and operational records | Region, backups, RLS, least privilege, DPA |
| Vercel | Application execution and delivery | Requests, logs, deployment metadata | Workload OIDC, protected environments, log retention |
| AI model providers | Reasoning and generation | Minimized authorized context | Data-class policy, retention setting, cost and token limits |
| Apollo/email/calendar | Customer-approved external effects | Contact and communication data | Scoped OAuth, approval, idempotency, delivery readback |
| Shopify/commerce | Catalog and order integration | Product, customer and order records | Scoped tokens, webhooks, reconciliation |

Before enabling a vendor for a tenant, record controller/processor role, data categories, regions, subprocessors, retention/deletion terms, security review, contract/DPA, and an exit plan. Restricted data is blocked from external AI/provider effects unless a separately reviewed policy explicitly permits the minimized fields.

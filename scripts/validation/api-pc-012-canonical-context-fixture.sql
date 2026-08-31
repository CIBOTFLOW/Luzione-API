create extension if not exists pgcrypto;

create table public.tenant_accounts (
  tenant_id uuid primary key,
  code text not null unique
);

create table public.policy_definitions (
  policy_definition_id uuid primary key,
  tenant_id uuid references public.tenant_accounts(tenant_id),
  code text not null,
  version integer not null,
  status text not null,
  compiled_json jsonb not null,
  checksum text,
  unique (tenant_id, code, version)
);

insert into public.tenant_accounts (tenant_id, code) values
  ('12000000-0000-4000-8000-000000000001', 'api-pc-012-a'),
  ('12000000-0000-4000-8000-000000000002', 'api-pc-012-b');

insert into public.policy_definitions
  (policy_definition_id, tenant_id, code, version, status, compiled_json, checksum)
select
  gen_random_uuid(),
  tenant_id,
  'sultan.autonomy',
  1,
  'ACTIVE',
  '{
    "defaultDecision":"BLOCK",
    "maximumDataClassification":"CONFIDENTIAL",
    "maximumEffectClass":"A3",
    "rules":[{
      "capability":"analysis.read",
      "decision":"ALLOW",
      "actorTypes":["agent"],
      "purposes":["fulfillment-read-analysis"],
      "maximumEffectClass":"A0"
    }]
  }'::jsonb,
  encode(digest(code || ':sultan.autonomy:v1', 'sha256'), 'hex')
from public.tenant_accounts;

insert into public.orders
  (id, external_order_id, customer_id, customer_name, status, currency, total_cents,
   source_system, source_record_id, created_by_type, created_by_id, created_at, updated_at,
   tenant_id, version, subtotal_cents, discounts_cents, tax_cents, shipping_cents)
values
  ('12000000-0000-4000-8000-000000000012', 'order-pc012', 'customer-pc012',
   'API-PC-012 Proof Customer', 'created', 'USD', 10000, 'luzione_api',
   'api-pc-012-proof', 'service', 'service:api-pc-012-fixture',
   '2026-08-31T12:00:00Z', '2026-08-31T12:00:00Z', 'api-pc-012-a', 1, 10000, 0, 0, 0);

insert into public.order_lines
  (id, order_id, line_number, sku, description, quantity, unit_price_cents,
   created_at, updated_at, tenant_id, version)
values
  ('12000000-0000-4000-8000-000000000013', '12000000-0000-4000-8000-000000000012',
   1, 'SKU-PC012', 'Canonical proof line', 2, 5000,
   '2026-08-31T12:00:00Z', '2026-08-31T12:00:00Z', 'api-pc-012-a', 1);

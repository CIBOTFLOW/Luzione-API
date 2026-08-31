begin;

create extension if not exists pgcrypto;

alter table public.quotes
  add column if not exists converted_order_id uuid;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid references public.quotes(id),
  external_order_id text unique,
  customer_id text,
  customer_name text,
  status text not null default 'created',
  currency text not null default 'USD',
  total_cents bigint not null default 0,
  source_system text not null default 'luzione_api',
  source_record_id text,
  created_by_type text not null default 'service',
  created_by_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orders
  add column if not exists tenant_id text not null default 'luzione',
  add column if not exists version bigint not null default 1,
  add column if not exists subtotal_cents bigint not null default 0,
  add column if not exists discounts_cents bigint not null default 0,
  add column if not exists tax_cents bigint not null default 0,
  add column if not exists shipping_cents bigint not null default 0;
alter table public.orders drop constraint if exists orders_api_money_currency_check;
alter table public.orders add constraint orders_api_money_currency_check check (
  currency ~ '^[A-Z]{3}$' and total_cents >= 0 and subtotal_cents >= 0 and
  discounts_cents >= 0 and tax_cents >= 0 and shipping_cents >= 0 and version > 0
);
create unique index if not exists orders_tenant_quote_unique on public.orders (tenant_id, quote_id) where quote_id is not null;
create index if not exists orders_tenant_updated_idx on public.orders (tenant_id, updated_at desc);

create table if not exists public.order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  quote_line_id uuid references public.quote_lines(id),
  line_number integer not null check (line_number > 0),
  sku text,
  description text not null,
  quantity numeric(12,3) not null check (quantity > 0),
  unit_price_cents bigint not null default 0 check (unit_price_cents >= 0),
  supplier_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, line_number)
);
alter table public.order_lines
  add column if not exists tenant_id text not null default 'luzione',
  add column if not exists version bigint not null default 1;

create table if not exists public.order_fulfillment_intents (
  tenant_id text not null,
  fulfillment_intent_id text not null,
  order_id uuid not null references public.orders(id) on delete restrict,
  external_order_id text not null,
  expected_order_version text not null,
  resulting_order_version text not null,
  purpose text not null,
  line_intents jsonb not null,
  state text not null default 'RECORDED_NO_EFFECT',
  effect_class text not null default 'NO_EFFECT',
  dispatch_authorized boolean not null default false,
  provider_acknowledged boolean not null default false,
  source_confirmed boolean not null default false,
  idempotency_key text not null,
  payload_hash text not null,
  requested_by text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, fulfillment_intent_id),
  unique (tenant_id, order_id, idempotency_key),
  check (state = 'RECORDED_NO_EFFECT'),
  check (effect_class = 'NO_EFFECT'),
  check (dispatch_authorized = false and provider_acknowledged = false and source_confirmed = false),
  check (jsonb_typeof(line_intents) = 'array' and jsonb_array_length(line_intents) > 0)
);
create index if not exists order_fulfillment_intents_order_created_idx on public.order_fulfillment_intents (tenant_id, order_id, created_at desc);

comment on table public.orders is 'Existing canonical Order rows. API-PC-010 is a default-off transfer-pending create path from exact customer-accepted Quotes.';
comment on table public.order_fulfillment_intents is 'API-owned bounded Fulfillment Intent truth. A row records internal intent only and cannot represent dispatch, provider acknowledgement, source confirmation or fulfillment completion.';

commit;

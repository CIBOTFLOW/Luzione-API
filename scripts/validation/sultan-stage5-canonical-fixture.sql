\set ON_ERROR_STOP on

-- Disposable-only canonical replicas for source classes that are not yet
-- present in the Luzione production inventory. They prove bounded adapters;
-- they are not production migrations and do not establish live connectivity.
create table public.shipments (
  tenant_id text not null, id text not null, status text not null, carrier text,
  tracking_number text, version integer not null, updated_at timestamptz not null,
  primary key (tenant_id, id)
);
create table public.accounts (
  tenant_id text not null, id text not null, name text not null, status text not null,
  version integer not null, updated_at timestamptz not null, primary key (tenant_id, id)
);
create table public.opportunities (
  tenant_id text not null, id text not null, account_id text not null, stage text not null,
  amount_cents bigint not null, currency text not null, probability_percent numeric not null,
  version integer not null, updated_at timestamptz not null, primary key (tenant_id, id)
);
create table public.commitments (
  tenant_id text not null, id text not null, subject_type text not null, subject_id text not null,
  status text not null, due_at timestamptz, fulfilled_at timestamptz, version integer not null,
  updated_at timestamptz not null, primary key (tenant_id, id)
);
create table public.fep_allocations (
  tenant_id text not null, id text not null, status text not null, amount_cents bigint not null,
  currency text not null, version integer not null, updated_at timestamptz not null,
  primary key (tenant_id, id)
);

do $$
declare relation_name text;
begin
  foreach relation_name in array array['shipments','accounts','opportunities','commitments','fep_allocations'] loop
    execute format('alter table public.%I enable row level security', relation_name);
    execute format('alter table public.%I force row level security', relation_name);
    execute format(
      'create policy stage5_fixture_runtime_tenant on public.%I to luzione_api_runtime using (tenant_id = nullif((select current_setting(''app.tenant_id'',true)),'''')) with check (tenant_id = nullif((select current_setting(''app.tenant_id'',true)),''''))',
      relation_name
    );
    execute format('revoke all on public.%I from public, anon, authenticated, service_role, luzione_provider_worker', relation_name);
    execute format('grant select on public.%I to luzione_api_runtime', relation_name);
  end loop;
end $$;

insert into public.commercial_case_identities
  (case_id,tenant_id,origin_type,origin_id,created_by,status)
values ('case-stage5-001','luzione','manual','stage5-proof','stage5-proof','active');
insert into public.commercial_cases
  (tenant_id,case_id,title,stage,owner,next_action,account_name,status,created_by,updated_by,version,created_at,updated_at)
values (
  'luzione','case-stage5-001','Stage 5 disposable proof','qualification','proof-owner',
  'review-canonical-evidence','Disposable Account','active','stage5-proof','stage5-proof',1,
  '2026-09-02T11:55:00Z','2026-09-02T11:55:00Z'
);

with inserted_order as (
  insert into public.orders
    (tenant_id,external_order_id,customer_name,status,currency,total_cents,subtotal_cents,
     discounts_cents,tax_cents,shipping_cents,version,source_system,created_at,updated_at)
  values (
    'luzione','stage5-order-001','Disposable Account','created','USD',13000,12000,
    500,1000,500,1,'stage5-proof','2026-09-02T11:55:00Z','2026-09-02T11:55:00Z'
  ) returning id
)
insert into public.order_lines
  (tenant_id,order_id,line_number,description,quantity,unit_price_cents,source_system,created_at,updated_at)
select 'luzione',id,1,'Disposable chair',2,6000,'stage5-proof','2026-09-02T11:55:00Z','2026-09-02T11:55:00Z'
from inserted_order;

insert into public.order_fulfillment_intents
  (tenant_id,fulfillment_intent_id,order_id,external_order_id,expected_order_version,
   resulting_order_version,purpose,line_intents,state,effect_class,dispatch_authorized,
   provider_acknowledged,source_confirmed,idempotency_key,payload_hash,requested_by,created_at)
select 'luzione','fulfillment-stage5-001',id,external_order_id,'order:stage5-order-001:v1',
       'order:stage5-order-001:v1','stage5-disposable-proof',
       '[{"lineNumber":1,"quantity":2}]'::jsonb,'RECORDED_NO_EFFECT','NO_EFFECT',false,false,false,
       'fulfillment-stage5-key',repeat('a',64),'stage5-proof','2026-09-02T11:56:00Z'
from public.orders where tenant_id='luzione' and external_order_id='stage5-order-001';

with inserted_quote as (
  insert into public.quotes
    (tenant_id,external_quote_id,customer_name,status,currency,subtotal_cents,
     fully_landed_cost_cents,economics_version,source_system,created_at,updated_at)
  values (
    'luzione','stage5-quote-001','Disposable Account','draft','USD',12000,9000,1,
    'stage5-proof','2026-09-02T11:55:00Z','2026-09-02T11:55:00Z'
  ) returning id
)
insert into public.quote_lines
  (quote_id,line_number,description,quantity,unit_price_cents,source_system,created_at,updated_at)
select id,1,'Disposable chair',2,6000,'stage5-proof','2026-09-02T11:55:00Z','2026-09-02T11:55:00Z'
from inserted_quote;

insert into public.shipments values
  ('luzione','shipment-stage5-001','label_created','Disposable Carrier','TRACK-STAGE5',1,'2026-09-02T11:57:00Z');
insert into public.accounts values
  ('luzione','account-stage5-001','Disposable Account','active',1,'2026-09-02T11:57:00Z');
insert into public.opportunities values
  ('luzione','opportunity-stage5-001','account-stage5-001','qualified',250000,'USD',65,1,'2026-09-02T11:57:00Z');
insert into public.commitments values
  ('luzione','commitment-stage5-001','order','stage5-order-001','open','2026-09-10T00:00:00Z',null,1,'2026-09-02T11:57:00Z');
insert into public.fep_allocations values
  ('luzione','fep-stage5-001','reviewed',500000,'USD',1,'2026-09-02T11:57:00Z');

-- Cross-tenant rows are deliberately present so RLS visibility is exercised.
insert into public.accounts values
  ('other','account-stage5-other','Other Tenant','active',1,'2026-09-02T11:57:00Z');

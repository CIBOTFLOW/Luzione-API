begin;

do $$
begin
  if to_regclass('public.onboarding_setup_mandates') is null
    or to_regprocedure('public.onboard_core_reject_mutation()') is null then
    raise exception 'ONBOARD-IMPORT-MAP-01 requires the exact Blueprint/Mandate implementation slice';
  end if;
end $$;

create table public.onboarding_import_batches (
  tenant_id text not null,
  batch_id uuid not null,
  mandate_id uuid not null,
  expected_mandate_object_version text not null,
  dedupe_key text not null,
  source_digest text not null check (source_digest ~ '^[a-f0-9]{64}$'),
  mapping_version text not null check (mapping_version = 'CRMImportDryRunMap/v1'),
  canonical_batch jsonb not null,
  object_version text not null,
  created_by text not null,
  created_by_type text not null check (created_by_type in ('agent','service','user')),
  created_at timestamptz not null,
  primary key (tenant_id, batch_id),
  unique (tenant_id, dedupe_key),
  foreign key (tenant_id, mandate_id)
    references public.onboarding_setup_mandates(tenant_id, mandate_id)
    on delete restrict,
  check (canonical_batch->>'contractVersion' = 'ImportBatch/v1'),
  check (canonical_batch->>'tenantId' = tenant_id),
  check (canonical_batch->>'batchId' = batch_id::text),
  check (canonical_batch->>'mandateRef' = mandate_id::text),
  check (canonical_batch->>'effectMode' = 'NO_EFFECT'),
  check (canonical_batch->>'mappingVersion' = mapping_version),
  check (canonical_batch#>>'{source,digest}' = source_digest),
  check (canonical_batch->>'status' in ('STAGED','VALIDATED','RECONCILIATION_REQUIRED'))
);

create table public.onboarding_import_rows (
  tenant_id text not null,
  batch_id uuid not null,
  source_row_id text not null,
  payload_digest text not null check (payload_digest ~ '^[a-f0-9]{64}$'),
  outcome text not null check (outcome in ('ACCEPTED','CONFLICT','DUPLICATE','REJECTED')),
  reason_code text,
  exception_ref text,
  reconciliation_ref text,
  created_at timestamptz not null,
  primary key (tenant_id, batch_id, source_row_id),
  foreign key (tenant_id, batch_id)
    references public.onboarding_import_batches(tenant_id, batch_id)
    on delete restrict,
  check ((outcome in ('CONFLICT','REJECTED')) = (reason_code is not null)),
  check ((outcome in ('CONFLICT','REJECTED')) = (exception_ref is not null)),
  check ((outcome = 'CONFLICT') = (reconciliation_ref is not null))
);

create table public.onboarding_import_receipts (
  tenant_id text not null,
  batch_id uuid not null,
  canonical_receipt jsonb not null,
  finality text not null check (finality in ('VALIDATED_NO_EFFECT','STAGED','RECONCILIATION_REQUIRED')),
  reconciliation_ref text,
  object_version text not null,
  created_at timestamptz not null,
  primary key (tenant_id, batch_id),
  foreign key (tenant_id, batch_id)
    references public.onboarding_import_batches(tenant_id, batch_id)
    on delete restrict,
  check (canonical_receipt->>'contractVersion' = 'ImportReceipt/v1'),
  check (canonical_receipt->>'tenantId' = tenant_id),
  check (canonical_receipt->>'batchId' = batch_id::text),
  check (canonical_receipt->>'effectMode' = 'NO_EFFECT'),
  check (canonical_receipt->>'finality' = finality),
  check (canonical_receipt#>>'{reconciliationRef}' is not distinct from reconciliation_ref),
  check ((finality = 'RECONCILIATION_REQUIRED') = (reconciliation_ref is not null))
);

create function public.onboard_core_validate_import_pair()
returns trigger
language plpgsql
as $$
declare batch_status text;
begin
  select canonical_batch->>'status' into batch_status
    from public.onboarding_import_batches
   where tenant_id = new.tenant_id and batch_id = new.batch_id;
  if (batch_status = 'VALIDATED' and new.finality <> 'VALIDATED_NO_EFFECT')
    or (batch_status = 'STAGED' and new.finality <> 'STAGED')
    or (batch_status = 'RECONCILIATION_REQUIRED' and new.finality <> 'RECONCILIATION_REQUIRED') then
    raise exception 'ONBOARD-IMPORT-MAP-01 rejects an open Batch-status/Receipt-finality pair';
  end if;
  return new;
end
$$;

create trigger onboarding_import_receipt_pair
before insert on public.onboarding_import_receipts
for each row execute function public.onboard_core_validate_import_pair();

create trigger onboarding_import_batches_append_only
before update or delete on public.onboarding_import_batches
for each row execute function public.onboard_core_reject_mutation();
create trigger onboarding_import_rows_append_only
before update or delete on public.onboarding_import_rows
for each row execute function public.onboard_core_reject_mutation();
create trigger onboarding_import_receipts_append_only
before update or delete on public.onboarding_import_receipts
for each row execute function public.onboard_core_reject_mutation();

alter table public.onboarding_import_batches enable row level security;
alter table public.onboarding_import_batches force row level security;
alter table public.onboarding_import_rows enable row level security;
alter table public.onboarding_import_rows force row level security;
alter table public.onboarding_import_receipts enable row level security;
alter table public.onboarding_import_receipts force row level security;

revoke all on table public.onboarding_import_batches from public;
revoke all on table public.onboarding_import_rows from public;
revoke all on table public.onboarding_import_receipts from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.onboarding_import_batches from anon;
    revoke all on table public.onboarding_import_rows from anon;
    revoke all on table public.onboarding_import_receipts from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.onboarding_import_batches from authenticated;
    revoke all on table public.onboarding_import_rows from authenticated;
    revoke all on table public.onboarding_import_receipts from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on table public.onboarding_import_batches from service_role;
    revoke all on table public.onboarding_import_rows from service_role;
    revoke all on table public.onboarding_import_receipts from service_role;
  end if;
  if exists (select 1 from pg_roles where rolname = 'luzione_api_runtime') then
    execute 'create policy onboard_import_batches_runtime_tenant on public.onboarding_import_batches to luzione_api_runtime using (tenant_id = (select current_setting(''app.tenant_id'', true))) with check (tenant_id = (select current_setting(''app.tenant_id'', true)))';
    execute 'create policy onboard_import_rows_runtime_tenant on public.onboarding_import_rows to luzione_api_runtime using (tenant_id = (select current_setting(''app.tenant_id'', true))) with check (tenant_id = (select current_setting(''app.tenant_id'', true)))';
    execute 'create policy onboard_import_receipts_runtime_tenant on public.onboarding_import_receipts to luzione_api_runtime using (tenant_id = (select current_setting(''app.tenant_id'', true))) with check (tenant_id = (select current_setting(''app.tenant_id'', true)))';
    grant select, insert on table public.onboarding_import_batches to luzione_api_runtime;
    grant select, insert on table public.onboarding_import_rows to luzione_api_runtime;
    grant select, insert on table public.onboarding_import_receipts to luzione_api_runtime;
  end if;
end $$;

comment on table public.onboarding_import_batches is
  'ONBOARD-IMPORT-MAP-01 tenant-bound, append-only, digest-only NO_EFFECT dry-run batches; never CRM commit authority.';
comment on table public.onboarding_import_rows is
  'ONBOARD-IMPORT-MAP-01 digest-only row outcomes with durable exception and conflict reconciliation references.';
comment on table public.onboarding_import_receipts is
  'ONBOARD-IMPORT-MAP-01 canonical ImportReceipt/v1 readback with closed no-effect finality.';

commit;

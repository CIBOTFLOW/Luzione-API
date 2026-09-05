-- CONNECTOR-REVOCATION-L1-G0.
-- Append-only, tenant-scoped receipt evidence for the default-off revocation emulator.
-- This migration stores opaque references only and creates no provider, credential, or hosted effect.

begin;

create table public.connector_revocation_receipts (
  tenant_id text not null,
  receipt_id text not null,
  receipt_digest text not null,
  prior_receipt_id text,
  binding_id uuid not null,
  binding_contract_version text not null,
  connector_provider text not null,
  provider_account_ref text not null,
  credential_handle_ref text not null,
  credential_handle_version text not null,
  operation_kind text not null,
  operation_key text not null,
  payload_digest text not null,
  containment_kill_version text not null,
  normal_kill_version text not null,
  request_actor_id text not null,
  request_actor_class text not null,
  human_actor_id text not null,
  human_authentication_ref text not null,
  command_receipt_ref text not null,
  provider_acknowledgement_ref text,
  source_readback_ref text,
  reconciliation_ref text,
  reconciliation_result text not null,
  remote_finality text not null,
  local_credential_disposition text not null,
  recovery_state text not null,
  zero_effect boolean not null default true,
  canonical_receipt jsonb not null,
  recorded_at timestamptz not null,
  primary key (tenant_id, receipt_id),
  unique (tenant_id, receipt_digest),
  foreign key (tenant_id, prior_receipt_id)
    references public.connector_revocation_receipts(tenant_id, receipt_id) on delete restrict,
  check (receipt_id ~ '^connector-revocation-receipt:[a-f0-9]{64}$'),
  check (receipt_digest ~ '^[a-f0-9]{64}$'),
  check (binding_contract_version = 'ConnectorBinding/v1'),
  check (credential_handle_ref ~ '^secret-ref:[A-Za-z0-9][A-Za-z0-9._:@/-]{2,190}$'),
  check (credential_handle_version ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,199}$'),
  check (operation_kind in ('REQUEST_REMOTE_REVOCATION','AUTHORIZE_FORWARD_RECOVERY_ERASURE')),
  check (payload_digest ~ '^[a-f0-9]{64}$'),
  check (containment_kill_version ~ '^kill:[a-f0-9]{64}$'),
  check (normal_kill_version ~ '^kill:[a-f0-9]{64}$'),
  check (request_actor_class = 'service'),
  check (reconciliation_result in ('AMBIGUOUS','MATCHED','NOT_ATTEMPTED','NOT_FOUND','PENDING','SOURCE_UNAVAILABLE','VERSION_MISMATCH')),
  check (remote_finality in ('ACKNOWLEDGED','AMBIGUITY_EXHAUSTED','BLOCKED','REMOTE_REVOKE_FAILED','REQUESTED','RECONCILING','REVOKED','SOURCE_UNAVAILABLE','VERSION_MISMATCH')),
  check (local_credential_disposition in ('ERASURE_AUTHORIZED_NO_EFFECT','RETAINED')),
  check (recovery_state in ('FORWARD_RECOVERY_AUTHORIZED_NO_EFFECT','NORMAL')),
  check (zero_effect),
  check (canonical_receipt ->> 'contractVersion' = 'ConnectorRevocationReceipt/v1'),
  check (canonical_receipt ->> 'receiptId' = receipt_id),
  check (canonical_receipt ->> 'receiptDigest' = receipt_digest),
  check ((canonical_receipt ->> 'zeroEffect')::boolean = true),
  check (remote_finality <> 'REVOKED' or (source_readback_ref is not null and reconciliation_result = 'MATCHED')),
  check (remote_finality <> 'ACKNOWLEDGED' or (provider_acknowledgement_ref is not null and source_readback_ref is null)),
  check (local_credential_disposition <> 'ERASURE_AUTHORIZED_NO_EFFECT'
    or remote_finality = 'REVOKED'
    or recovery_state = 'FORWARD_RECOVERY_AUTHORIZED_NO_EFFECT'),
  check (recovery_state <> 'FORWARD_RECOVERY_AUTHORIZED_NO_EFFECT'
    or (operation_kind = 'AUTHORIZE_FORWARD_RECOVERY_ERASURE' and prior_receipt_id is not null))
);

create index connector_revocation_receipts_binding_readback_idx
  on public.connector_revocation_receipts (tenant_id, binding_id, recorded_at desc, receipt_id desc);
create index connector_revocation_receipts_operation_idx
  on public.connector_revocation_receipts (tenant_id, operation_key, recorded_at desc);

alter table public.connector_revocation_receipts enable row level security;
alter table public.connector_revocation_receipts force row level security;

create policy connector_revocation_receipts_runtime_tenant
  on public.connector_revocation_receipts to luzione_api_runtime
  using (tenant_id = (select current_setting('app.tenant_id', true)))
  with check (tenant_id = (select current_setting('app.tenant_id', true)));

revoke all on table public.connector_revocation_receipts from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.connector_revocation_receipts from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.connector_revocation_receipts from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on table public.connector_revocation_receipts from service_role;
  end if;
end $$;
grant select, insert on table public.connector_revocation_receipts to luzione_api_runtime;

create function public.connector_revocation_receipts_append_only()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Connector revocation receipts are append-only.';
end;
$$;

create trigger connector_revocation_receipts_append_only
before update or delete on public.connector_revocation_receipts
for each row execute function public.connector_revocation_receipts_append_only();

comment on table public.connector_revocation_receipts is
  'Append-only ConnectorRevocationReceipt/v1 evidence. Remote finality, local credential disposition, and recovery authority are independent; the table stores no credential value.';
comment on column public.connector_revocation_receipts.provider_acknowledgement_ref is
  'Provider acknowledgement is pre-readback evidence only and never grants credential erasure authority.';
comment on column public.connector_revocation_receipts.zero_effect is
  'This G0 packet is emulator-only and cannot claim provider or credential mutation.';

commit;

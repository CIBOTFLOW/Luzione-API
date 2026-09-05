-- CONNECTOR-REVOCATION-L1-CORRECTION-01.
-- Additive v2 receipt columns bind server-resolved owner truth without creating a second binding store.
-- This migration resolves no credential, performs no provider action and preserves v1 readback.

begin;

alter table public.connector_revocation_receipts
  add column binding_version text,
  add column destination text,
  add column credential_handle_contract_version text,
  add column credential_generation integer,
  add column credential_handle_digest text,
  add column binding_resolution_digest text,
  add column binding_owner_readback_ref text;

do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
    from pg_constraint
   where conrelid = 'public.connector_revocation_receipts'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%contractVersion%ConnectorRevocationReceipt/v1%'
   limit 1;
  if constraint_name is null then
    raise exception 'v1 canonical receipt version constraint was not found';
  end if;
  execute format('alter table public.connector_revocation_receipts drop constraint %I', constraint_name);
end $$;

alter table public.connector_revocation_receipts
  add constraint connector_revocation_receipts_contract_version_v2
    check (canonical_receipt ->> 'contractVersion' in ('ConnectorRevocationReceipt/v1','ConnectorRevocationReceipt/v2')),
  add constraint connector_revocation_receipts_v2_owner_truth
    check (
      (canonical_receipt ->> 'contractVersion' = 'ConnectorRevocationReceipt/v1'
        and binding_version is null
        and destination is null
        and credential_handle_contract_version is null
        and credential_generation is null
        and credential_handle_digest is null
        and binding_resolution_digest is null
        and binding_owner_readback_ref is null)
      or
      (canonical_receipt ->> 'contractVersion' = 'ConnectorRevocationReceipt/v2'
        and binding_version ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,189}$'
        and destination ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,189}$'
        and credential_handle_contract_version = 'ConnectorCredentialHandle/v2'
        and credential_generation between 1 and 2147483647
        and credential_handle_digest ~ '^[a-f0-9]{64}$'
        and binding_resolution_digest ~ '^[a-f0-9]{64}$'
        and binding_owner_readback_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,189}$')
    );

comment on table public.connector_revocation_receipts is
  'Append-only ConnectorRevocationReceipt/v1 and /v2 evidence. v2 embeds server-resolved canonical binding/account/opaque-handle truth; neither version stores credential material.';
comment on column public.connector_revocation_receipts.binding_resolution_digest is
  'Exact digest of the server-resolved same-tenant current ConnectorBinding/account/credential-generation tuple; null for legacy v1 receipts.';
comment on column public.connector_revocation_receipts.binding_owner_readback_ref is
  'Opaque authoritative owner readback reference; not a credential or caller assertion.';

commit;

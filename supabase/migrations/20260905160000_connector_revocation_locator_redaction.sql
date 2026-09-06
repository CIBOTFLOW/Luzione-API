-- CONNECTOR-LOCATOR-REDACTION-L1-G0.
-- Additive locator-free v3 evidence and public readback. No legacy row is rewritten.
-- This migration performs no credential resolution, provider action, or production activation.

begin;

alter table public.connector_revocation_receipts
  add column binding_readback_contract_version text,
  add column binding_head_digest text,
  add column credential_content_digest text,
  add column public_readback_id text,
  add column public_readback_digest text,
  add column request_raw_digest text,
  add column canonical_readback jsonb;

alter table public.connector_revocation_receipts
  drop constraint connector_revocation_receipts_contract_version_v2,
  drop constraint connector_revocation_receipts_v2_owner_truth;

do $$
declare constraint_name text;
begin
  for constraint_name in
    select conname from pg_constraint
     where conrelid = 'public.connector_revocation_receipts'::regclass
       and contype = 'c'
       and (pg_get_constraintdef(oid) like '%binding_contract_version =%ConnectorBinding/v1%'
         or pg_get_constraintdef(oid) like '%credential_handle_ref ~%secret-ref:%')
  loop
    execute format('alter table public.connector_revocation_receipts drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.connector_revocation_receipts
  alter column credential_handle_ref drop not null,
  alter column credential_handle_version drop not null,
  add constraint connector_revocation_receipts_contract_version_v3
    check (canonical_receipt ->> 'contractVersion' in ('ConnectorRevocationReceipt/v1','ConnectorRevocationReceipt/v2','ConnectorRevocationReceipt/v3')),
  add constraint connector_revocation_receipts_binding_contract_v3
    check (
      (canonical_receipt ->> 'contractVersion' in ('ConnectorRevocationReceipt/v1','ConnectorRevocationReceipt/v2') and binding_contract_version = 'ConnectorBinding/v1')
      or
      (canonical_receipt ->> 'contractVersion' = 'ConnectorRevocationReceipt/v3' and binding_contract_version = 'ConnectorBindingReadback/v1')
    ),
  add constraint connector_revocation_receipts_locator_by_version_v3
    check (
      (canonical_receipt ->> 'contractVersion' in ('ConnectorRevocationReceipt/v1','ConnectorRevocationReceipt/v2')
        and credential_handle_ref ~ '^secret-ref:[A-Za-z0-9][A-Za-z0-9._:@/-]{2,190}$'
        and credential_handle_version ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,199}$')
      or
      (canonical_receipt ->> 'contractVersion' = 'ConnectorRevocationReceipt/v3'
        and credential_handle_ref is null and credential_handle_version is null)
    ),
  add constraint connector_revocation_receipts_version_shape_v3
    check (
      (canonical_receipt ->> 'contractVersion' = 'ConnectorRevocationReceipt/v1'
        and binding_version is null and destination is null
        and credential_handle_contract_version is null and credential_generation is null
        and credential_handle_digest is null and binding_resolution_digest is null
        and binding_owner_readback_ref is null
        and binding_readback_contract_version is null and binding_head_digest is null
        and credential_content_digest is null and public_readback_id is null
        and public_readback_digest is null and request_raw_digest is null and canonical_readback is null)
      or
      (canonical_receipt ->> 'contractVersion' = 'ConnectorRevocationReceipt/v2'
        and binding_version ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,189}$'
        and destination ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,189}$'
        and credential_handle_contract_version = 'ConnectorCredentialHandle/v2'
        and credential_generation between 1 and 2147483647
        and credential_handle_digest ~ '^[a-f0-9]{64}$'
        and binding_resolution_digest ~ '^[a-f0-9]{64}$'
        and binding_owner_readback_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,189}$'
        and binding_readback_contract_version is null and binding_head_digest is null
        and credential_content_digest is null and public_readback_id is null
        and public_readback_digest is null and request_raw_digest is null and canonical_readback is null)
      or
      (canonical_receipt ->> 'contractVersion' = 'ConnectorRevocationReceipt/v3'
        and binding_version ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,189}$'
        and destination ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,189}$'
        and credential_handle_contract_version is null
        and credential_generation between 1 and 2147483647
        and credential_handle_digest is null and binding_resolution_digest is null and binding_owner_readback_ref is null
        and binding_readback_contract_version = 'ConnectorBindingReadback/v1'
        and binding_head_digest ~ '^[a-f0-9]{64}$'
        and credential_content_digest ~ '^[a-f0-9]{64}$'
        and public_readback_id ~ '^connector-revocation-readback:[a-f0-9]{64}$'
        and public_readback_digest ~ '^[a-f0-9]{64}$'
        and request_raw_digest ~ '^[a-f0-9]{64}$'
        and canonical_readback ->> 'contractVersion' = 'ConnectorRevocationReadback/v1'
        and canonical_readback ->> 'readbackId' = public_readback_id
        and canonical_readback ->> 'projectionDigest' = public_readback_digest)
    ),
  add constraint connector_revocation_receipts_v3_locator_keys_absent
    check (
      canonical_receipt ->> 'contractVersion' <> 'ConnectorRevocationReceipt/v3'
      or (
        canonical_receipt::text !~* '"(reference|credentialReference|credentialHandle|credential_handle_ref|ciphertext|token|secret|vaultPath|providerResponse)"[[:space:]]*:'
        and canonical_readback::text !~* '"(reference|credentialReference|credentialHandle|credential_handle_ref|ciphertext|token|secret|vaultPath|providerResponse)"[[:space:]]*:'
        and canonical_receipt::text !~* ':[[:space:]]*"(secret-ref:|token-ref:|credential-ref:|vault:|kms:|oauth-token:|env:|Bearer )'
        and canonical_readback::text !~* ':[[:space:]]*"(secret-ref:|token-ref:|credential-ref:|vault:|kms:|oauth-token:|env:|Bearer )'
      )
    );

create unique index connector_revocation_receipts_public_readback_id_uq
  on public.connector_revocation_receipts (tenant_id, public_readback_id)
  where public_readback_id is not null;

create unique index connector_revocation_receipts_public_readback_digest_uq
  on public.connector_revocation_receipts (tenant_id, public_readback_digest)
  where public_readback_digest is not null;

comment on table public.connector_revocation_receipts is
  'Append-only ConnectorRevocationReceipt/v1-/v3 evidence. V3 stores locator-free owner readback and exposes only ConnectorRevocationReadback/v1; legacy locator rows remain private compatibility evidence.';
comment on column public.connector_revocation_receipts.credential_content_digest is
  'Tenant-scoped owner-issued content binding; it is not derived from or usable as a credential locator.';
comment on column public.connector_revocation_receipts.canonical_readback is
  'Closed locator-free public projection. Internal receipt IDs, locator-bearing legacy evidence and provider free metadata are excluded.';

commit;

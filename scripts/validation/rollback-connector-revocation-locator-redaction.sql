-- Empty/pre-activation reverse only. Refuse before DDL when any v3 evidence exists.

begin;

do $$
begin
  if exists (
    select 1 from public.connector_revocation_receipts
     where canonical_receipt ->> 'contractVersion' = 'ConnectorRevocationReceipt/v3'
        or binding_readback_contract_version is not null
        or binding_head_digest is not null
        or credential_content_digest is not null
        or public_readback_id is not null
        or public_readback_digest is not null
        or request_raw_digest is not null
        or canonical_readback is not null
  ) then
    raise exception 'reverse blocked before DDL: ConnectorRevocationReceipt/v3 or locator-redaction evidence exists';
  end if;
end $$;

drop index public.connector_revocation_receipts_public_readback_digest_uq;
drop index public.connector_revocation_receipts_public_readback_id_uq;

alter table public.connector_revocation_receipts
  drop constraint connector_revocation_receipts_v3_locator_keys_absent,
  drop constraint connector_revocation_receipts_version_shape_v3,
  drop constraint connector_revocation_receipts_locator_by_version_v3,
  drop constraint connector_revocation_receipts_binding_contract_v3,
  drop constraint connector_revocation_receipts_contract_version_v3,
  add constraint connector_revocation_receipts_contract_version_v2
    check (canonical_receipt ->> 'contractVersion' in ('ConnectorRevocationReceipt/v1','ConnectorRevocationReceipt/v2')),
  add constraint connector_revocation_receipts_binding_contract_version_check
    check (binding_contract_version = 'ConnectorBinding/v1'),
  add constraint connector_revocation_receipts_credential_handle_ref_check
    check (credential_handle_ref ~ '^secret-ref:[A-Za-z0-9][A-Za-z0-9._:@/-]{2,190}$'),
  add constraint connector_revocation_receipts_v2_owner_truth
    check (
      (canonical_receipt ->> 'contractVersion' = 'ConnectorRevocationReceipt/v1'
        and binding_version is null and destination is null
        and credential_handle_contract_version is null and credential_generation is null
        and credential_handle_digest is null and binding_resolution_digest is null and binding_owner_readback_ref is null)
      or
      (canonical_receipt ->> 'contractVersion' = 'ConnectorRevocationReceipt/v2'
        and binding_version ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,189}$'
        and destination ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,189}$'
        and credential_handle_contract_version = 'ConnectorCredentialHandle/v2'
        and credential_generation between 1 and 2147483647
        and credential_handle_digest ~ '^[a-f0-9]{64}$'
        and binding_resolution_digest ~ '^[a-f0-9]{64}$'
        and binding_owner_readback_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,189}$')
    ),
  alter column credential_handle_ref set not null,
  alter column credential_handle_version set not null,
  drop column canonical_readback,
  drop column request_raw_digest,
  drop column public_readback_digest,
  drop column public_readback_id,
  drop column credential_content_digest,
  drop column binding_head_digest,
  drop column binding_readback_contract_version;

comment on table public.connector_revocation_receipts is
  'Append-only ConnectorRevocationReceipt/v1 and /v2 evidence. v2 embeds server-resolved canonical binding/account/opaque-handle truth; neither version stores credential material.';

commit;

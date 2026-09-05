-- Reverse only the additive CONNECTOR-REVOCATION-L1-CORRECTION-01 storage change.
-- Fail closed if a v2 receipt exists: immutable evidence must never be silently discarded.

begin;

do $$
begin
  if exists (
    select 1 from public.connector_revocation_receipts
     where canonical_receipt ->> 'contractVersion' = 'ConnectorRevocationReceipt/v2'
  ) then
    raise exception 'reverse blocked: ConnectorRevocationReceipt/v2 evidence exists';
  end if;
end $$;

alter table public.connector_revocation_receipts
  drop constraint connector_revocation_receipts_v2_owner_truth,
  drop constraint connector_revocation_receipts_contract_version_v2;

alter table public.connector_revocation_receipts
  add constraint connector_revocation_receipts_contract_version_v1
    check (canonical_receipt ->> 'contractVersion' = 'ConnectorRevocationReceipt/v1'),
  drop column binding_version,
  drop column destination,
  drop column credential_handle_contract_version,
  drop column credential_generation,
  drop column credential_handle_digest,
  drop column binding_resolution_digest,
  drop column binding_owner_readback_ref;

comment on table public.connector_revocation_receipts is
  'Append-only ConnectorRevocationReceipt/v1 evidence. Remote finality, local credential disposition, and recovery authority are independent; the table stores no credential value.';

commit;

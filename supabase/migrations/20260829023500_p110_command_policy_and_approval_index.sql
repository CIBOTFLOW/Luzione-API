begin;

create index if not exists p110_command_receipts_approval_idx
  on public.p110_command_receipts (approval_id)
  where approval_id is not null;

drop policy if exists p110_command_receipts_tenant_policy on public.p110_command_receipts;
create policy p110_command_receipts_tenant_policy
on public.p110_command_receipts
using (tenant_id = (select current_setting('app.tenant_id', true)))
with check (tenant_id = (select current_setting('app.tenant_id', true)));

commit;

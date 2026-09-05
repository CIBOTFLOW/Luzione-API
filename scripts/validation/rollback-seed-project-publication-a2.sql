begin;

do $$
declare
  admitted_rows bigint := 0;
  durable_receipts bigint := 0;
begin
  if to_regclass('public.seed_projects') is not null then
    select
      (select count(*) from public.seed_projects)
      + (select count(*) from public.seed_project_packages)
      + (select count(*) from public.seed_spaces)
      + (select count(*) from public.seed_specifications)
      + (select count(*) from public.seed_specification_lines)
      + (select count(*) from public.seed_specification_revisions)
      into admitted_rows;
  end if;
  if to_regclass('public.p110_command_receipts') is not null then
    select count(*) into durable_receipts
      from public.p110_command_receipts
     where command_type in ('project.create_from_opportunity', 'project_package.publish', 'specification.propose_revision');
  end if;
  if admitted_rows > 0 or durable_receipts > 0 then
    raise exception 'Refusing destructive A2 rollback: admitted rows=% and durable receipts=%; ship an additive forward fix instead', admitted_rows, durable_receipts;
  end if;
end $$;

drop table if exists public.seed_specification_revisions;
drop table if exists public.seed_specification_lines;
drop table if exists public.seed_specifications;
drop table if exists public.seed_spaces;
drop table if exists public.seed_project_packages;
drop table if exists public.seed_projects;
drop function if exists public.seed_project_publication_reject_mutation();

commit;

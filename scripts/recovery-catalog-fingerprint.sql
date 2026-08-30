\set ON_ERROR_STOP on

create temporary table recovery_table_counts (
  relation_name text primary key,
  row_count bigint not null
);

do $$
declare
  relation record;
  observed_count bigint;
begin
  for relation in
    select n.nspname as schema_name, c.relname as relation_name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p')
      and n.nspname not like 'pg_%'
      and n.nspname <> 'information_schema'
    order by n.nspname, c.relname
  loop
    execute format('select count(*) from %I.%I', relation.schema_name, relation.relation_name)
      into observed_count;
    insert into recovery_table_counts values (
      format('%I.%I', relation.schema_name, relation.relation_name),
      observed_count
    );
  end loop;
end
$$;

select json_build_object(
  'catalogFingerprint', md5(string_agg(relation_name || '=' || row_count::text, '|' order by relation_name)),
  'functionCount', (
    select count(*) from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname not like 'pg_%' and n.nspname <> 'information_schema'
  ),
  'indexCount', (
    select count(*) from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'i' and n.nspname not like 'pg_%' and n.nspname <> 'information_schema'
  ),
  'policyCount', (select count(*) from pg_catalog.pg_policy),
  'rowCount', sum(row_count),
  'tableCount', count(*)
)::text
from recovery_table_counts;

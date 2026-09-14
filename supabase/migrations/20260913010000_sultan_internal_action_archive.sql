-- Extend the existing action evidence ledger, never provider effects.
begin;
do $$
declare item record;
begin
  for item in select conname from pg_constraint
    where conrelid='public.sultan_agent_internal_actions'::regclass
      and contype='c' and pg_get_constraintdef(oid) like '%tool_id%'
  loop
    execute format('alter table public.sultan_agent_internal_actions drop constraint %I', item.conname);
  end loop;
end $$;
alter table public.sultan_agent_internal_actions add constraint sultan_internal_action_tool_check
  check (tool_id in ('luzione.proposal_revision.create','luzione.task.create','luzione.note.append','luzione.gmail_draft.create','luzione.internal_action.archive'));
create or replace function public.sultan_agent_internal_action_guard()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then raise exception 'Sultan internal action evidence is append-only.'; end if;
  if old.tool_id not in ('luzione.proposal_revision.create','luzione.task.create','luzione.gmail_draft.create') then
    raise exception 'This Sultan action evidence is immutable.';
  end if;
  if old.state <> 'SOURCE_CONFIRMED' or new.state <> 'ARCHIVED' or new.archived_at is null
     or (to_jsonb(new) - 'state' - 'archived_at') <> (to_jsonb(old) - 'state' - 'archived_at') then
    raise exception 'Only exact archival of an active Sultan internal action is allowed.';
  end if;
  return new;
end $$;
commit;

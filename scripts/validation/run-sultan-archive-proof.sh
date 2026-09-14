#!/usr/bin/env bash
set -euo pipefail
container_name="sultan_archive_proof_$$"
trap 'docker rm -f "$container_name" >/dev/null 2>&1 || true' EXIT
docker run --detach --rm --name "$container_name" --env POSTGRES_PASSWORD=postgres --publish 127.0.0.1::5432 postgres:16 >/dev/null
for attempt in $(seq 1 30); do
  if docker exec "$container_name" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -c 'create role anon; create role authenticated; create role service_role; create role luzione_api_runtime; create table public.commercial_cases(tenant_id text,case_id text,version int);' >/dev/null
for migration in supabase/migrations/20260901130000_sultan_agent_internal_actions.sql supabase/migrations/20260913010000_sultan_internal_action_archive.sql; do
  docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres < "$migration" >/dev/null
done
host_port="$(docker port "$container_name" 5432/tcp | sed -E 's/.*:([0-9]+)$/\1/')"
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:${host_port}/postgres" NODE_PATH=scripts/validation/node-stubs node --import tsx scripts/validation/sultan-archive-rehearsal.ts

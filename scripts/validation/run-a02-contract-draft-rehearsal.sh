#!/usr/bin/env bash
set -euo pipefail

suffix="$$"
container_name="luzione_a02_postgres_${suffix}"
proof_role="luzione_a02_proof_${suffix}"
password="luzione_a02_disposable_${suffix}"

cleanup() {
  docker rm -f "${container_name}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --detach --rm --name "${container_name}" \
  --env POSTGRES_PASSWORD=postgres \
  --publish 127.0.0.1::5432 \
  postgres:16 >/dev/null

for attempt in $(seq 1 30); do
  if docker exec "${container_name}" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  if [ "${attempt}" -eq 30 ]; then
    echo "A02 disposable Postgres did not become ready." >&2
    exit 1
  fi
  sleep 1
done

host_port="$(docker port "${container_name}" 5432/tcp | sed -E 's/.*:([0-9]+)$/\1/')"
docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
  "create role anon nologin; create role authenticated nologin; create role service_role nologin; create role ${proof_role} login password '${password}' noinherit;" >/dev/null

apply() {
  local database_name="$1"
  local path="$2"
  docker exec -i "${container_name}" psql -q -v ON_ERROR_STOP=1 -U postgres -d "${database_name}" < "${path}"
}

run_shape() {
  local proof_shape="$1"
  local database_name="luzione_a02_${proof_shape}_${suffix}"
  docker exec "${container_name}" createdb -U postgres "${database_name}"
  apply "${database_name}" supabase/migrations/20260831022000_p110_command_ledger_baseline.sql
  apply "${database_name}" supabase/migrations/20260831030000_p110_p111_workflow_delivery_baseline.sql
  if [ "${proof_shape}" = "observed_upgrade" ]; then
    docker exec "${container_name}" psql -q -v ON_ERROR_STOP=1 -U postgres -d "${database_name}" -c \
      "insert into public.p110_command_receipts (tenant_id,receipt_id,command_id,command_type,idempotency_key,payload_hash,correlation_id,target_owner_project,target_object_type,target_object_id,expected_object_version,committed_object_version,policy_version,actor_id,actor_type,state,requested_at,committed_at) values ('legacy-tenant','legacy-receipt','legacy-command','legacy.command','legacy-idempotency',repeat('f',64),'legacy-correlation','legacy-owner','legacy-object','legacy-id','v0','v1','legacy-policy','legacy-actor','service','DOMAIN_COMMITTED',now(),now());" >/dev/null
    apply "${database_name}" supabase/migrations/20260831022000_p110_command_ledger_baseline.sql
    apply "${database_name}" supabase/migrations/20260831030000_p110_p111_workflow_delivery_baseline.sql
  fi
  payload_hash="$(node -e 'const c=require("node:crypto");process.stdout.write(c.createHash("sha256").update(JSON.stringify({orderId:"order-a02-1",simulation:true})).digest("hex"))')"
  docker exec -i "${container_name}" psql -q -v ON_ERROR_STOP=1 -v payload_hash="${payload_hash}" -U postgres -d "${database_name}" < scripts/validation/a02-contract-draft-rehearsal.sql
  docker exec "${container_name}" psql -q -v ON_ERROR_STOP=1 -U postgres -d "${database_name}" -c \
    "grant usage on schema public to ${proof_role}; grant select on public.p110_command_receipts, public.p110_outbox_messages to ${proof_role};" >/dev/null
  connection_url="postgres://${proof_role}:${password}@127.0.0.1:${host_port}/${database_name}"
  DATABASE_URL="${connection_url}" PROOF_SHAPE="${proof_shape}" \
    node --import tsx scripts/validation/a02-contract-draft-rehearsal.ts
  if [ "${proof_shape}" = "observed_upgrade" ]; then
    legacy_count="$(docker exec "${container_name}" psql -At -U postgres -d "${database_name}" -c "select count(*) from public.p110_command_receipts where receipt_id='legacy-receipt'")"
    test "${legacy_count}" = "1"
  fi
  docker exec "${container_name}" dropdb -U postgres "${database_name}"
}

run_shape fresh
run_shape observed_upgrade
echo "a02_contract_draft_rehearsal=PASS"

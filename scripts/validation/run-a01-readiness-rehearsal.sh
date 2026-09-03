#!/usr/bin/env bash
set -euo pipefail

suffix="$$"
container_name="luzione_a01_postgres_${suffix}"
database_name="luzione_a01_${suffix}"
proof_role="luzione_a01_proof_${suffix}"
password="luzione_a01_disposable_${suffix}"
temporary_directory="$(mktemp -d)"
baseline_dump="${temporary_directory}/pre_migration.dump"
server_pid=""

stop_http_preview() {
  if [ -n "${server_pid}" ]; then
    kill "${server_pid}" >/dev/null 2>&1 || true
    wait "${server_pid}" >/dev/null 2>&1 || true
    server_pid=""
  fi
}

cleanup() {
  stop_http_preview
  docker rm -f "${container_name}" >/dev/null 2>&1 || true
  rm -rf "${temporary_directory}"
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
    echo "A01 disposable Postgres did not become ready." >&2
    exit 1
  fi
  sleep 1
done

host_port="$(docker port "${container_name}" 5432/tcp | sed -E 's/.*:([0-9]+)$/\1/')"
docker exec "${container_name}" createdb -U postgres "${database_name}"
docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
  "create role anon nologin; create role authenticated nologin; create role service_role nologin; create role ${proof_role} login password '${password}' bypassrls; grant anon, authenticated, service_role to ${proof_role};" >/dev/null

apply() {
  docker exec -i "${container_name}" psql -q -v ON_ERROR_STOP=1 -U postgres -d "${database_name}" < "$1"
}

apply supabase/migrations/20260831022000_p110_command_ledger_baseline.sql
apply supabase/migrations/20260831030000_p110_p111_workflow_delivery_baseline.sql
apply scripts/validation/api-pc-008-observed-legacy.sql
apply scripts/validation/api-pc-009-observed-ui.sql
apply scripts/validation/api-pc-011-observed-worker.sql
apply supabase/migrations/20260831050000_lead_commercial_case_dark_path.sql
apply supabase/migrations/20260831060000_proposal_quote_approval_dark_path.sql
apply supabase/migrations/20260831070000_order_fulfillment_intent_dark_path.sql
apply supabase/migrations/20260831080000_provider_worker_runtime.sql
apply scripts/validation/a01-observed-security-baseline.sql

connection_url="postgres://${proof_role}:${password}@127.0.0.1:${host_port}/${database_name}"

if [ "${A01_HTTP_PREVIEW:-false}" = "true" ]; then
  : "${A01_CANDIDATE_SHA:?A01_CANDIDATE_SHA is required for exact-SHA HTTP proof}"
  http_port="${A01_HTTP_PORT:-$(node -e 'const net = require("net"); const server = net.createServer(); server.listen(0, "127.0.0.1", () => { console.log(server.address().port); server.close(); });')}"
  http_build_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  start_http_preview() {
    DATABASE_URL="${connection_url}" \
      LUZIONE_API_SERVICE_TOKEN="a01-synthetic-service-token" \
      PLATFORM_CONTINUATION_SECRET="a01-synthetic-continuation-secret" \
      LUZIONE_API_MUTATIONS_ENABLED=false \
      LUZIONE_API_INTERNAL_PROJECTIONS_ENABLED=false \
      APP_ENV=staging \
      VERCEL_ENV=preview \
      VERCEL_GIT_COMMIT_SHA="${A01_CANDIDATE_SHA}" \
      LUZIONE_BUILD_TIME="${http_build_time}" \
      VERCEL_DEPLOYMENT_ID="ci-a01-${A01_CANDIDATE_SHA}" \
      VERCEL_URL="127.0.0.1:${http_port}" \
      node_modules/.bin/next start -p "${http_port}" > "${temporary_directory}/http-preview.log" 2>&1 &
    server_pid="$!"
    for attempt in $(seq 1 30); do
      if curl --fail --silent "http://127.0.0.1:${http_port}/api/v1/livez" >/dev/null 2>&1; then
        return
      fi
      if ! kill -0 "${server_pid}" >/dev/null 2>&1; then
        cat "${temporary_directory}/http-preview.log" >&2
        exit 1
      fi
      if [ "${attempt}" -eq 30 ]; then
        cat "${temporary_directory}/http-preview.log" >&2
        echo "A01 synthetic HTTP preview did not become ready." >&2
        exit 1
      fi
      sleep 1
    done
  }

  capture_http() {
    local path="$1"
    local output="$2"
    curl --silent --show-error --output "${output}" --write-out "%{http_code}" \
      "http://127.0.0.1:${http_port}/api/v1/${path}"
  }
fi

echo "proof_stage=observed_production_drift"
DATABASE_URL="${connection_url}" A01_EXPECTED_POSTURE=PRODUCTION_DRIFT \
  NODE_PATH=scripts/validation/node-stubs node --import tsx scripts/validation/a01-readiness-preflight.ts

docker exec "${container_name}" pg_dump -Fc -U postgres -d "${database_name}" > "${baseline_dump}"

apply supabase/migrations/20260831070000_order_fulfillment_intent_dark_path.sql
apply supabase/migrations/20260831090000_api_pc_013_least_privilege_roles_rls.sql
apply supabase/migrations/20260831090000_api_pc_013_least_privilege_roles_rls.sql
docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d "${database_name}" -c \
  "grant usage on schema public to ${proof_role}; grant select,insert,update,delete on all tables in schema public to ${proof_role}; grant luzione_api_runtime, luzione_provider_worker to ${proof_role};" >/dev/null

echo "proof_stage=candidate_40_of_40"
DATABASE_URL="${connection_url}" A01_EXPECTED_POSTURE=PASS \
  NODE_PATH=scripts/validation/node-stubs node --import tsx scripts/validation/a01-readiness-preflight.ts
DATABASE_URL="${connection_url}" PROOF_SHAPE=observed_upgrade \
  node --import tsx scripts/validation/api-pc-013-security-rls.ts

if [ "${A01_HTTP_PREVIEW:-false}" = "true" ]; then
  echo "proof_stage=exact_sha_synthetic_http_preview"
  start_http_preview
  candidate_release_status="$(capture_http release "${temporary_directory}/candidate-release.json")"
  candidate_livez_status="$(capture_http livez "${temporary_directory}/candidate-livez.json")"
  candidate_readyz_status="$(capture_http readyz "${temporary_directory}/candidate-readyz.json")"
  candidate_healthz_status="$(capture_http healthz "${temporary_directory}/candidate-healthz.json")"
  test "${candidate_release_status}" = "200"
  test "${candidate_livez_status}" = "200"
  test "${candidate_readyz_status}" = "200"
  test "${candidate_healthz_status}" = "200"
  jq --exit-status --arg sha "${A01_CANDIDATE_SHA}" \
    '.ok == true and .releaseIdentity.exactSha == $sha and .releaseIdentity.environment == "preview" and .releaseIdentity.evidenceState == "EXACT_RELEASE_BOUND" and .releaseIdentity.mutations == "DISABLED_FAIL_CLOSED"' \
    "${temporary_directory}/candidate-release.json" >/dev/null
  jq --exit-status '.ok == true and .status == "LIVE"' \
    "${temporary_directory}/candidate-livez.json" >/dev/null
  jq --exit-status '.ok == true and .status == "READY" and .checks.database == "READY"' \
    "${temporary_directory}/candidate-readyz.json" >/dev/null
  jq --exit-status '.ok == true and .status == "READY_READ_ONLY" and .security.expectedTableCount == 40 and .security.observedTableCount == 40 and .security.violationCount == 0 and .mutations == "DISABLED_FAIL_CLOSED" and .internalProjections == "DISABLED_FAIL_CLOSED" and .externalEffectsAuthorized == false' \
    "${temporary_directory}/candidate-healthz.json" >/dev/null
  stop_http_preview
fi

echo "proof_stage=rollback_restore"
docker exec "${container_name}" dropdb -U postgres "${database_name}"
docker exec "${container_name}" createdb -U postgres "${database_name}"
docker exec -i "${container_name}" pg_restore -U postgres -d "${database_name}" < "${baseline_dump}"
docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
  "revoke luzione_api_runtime, luzione_provider_worker from ${proof_role}; drop role luzione_api_runtime; drop role luzione_provider_worker;" >/dev/null
DATABASE_URL="${connection_url}" A01_EXPECTED_POSTURE=PRODUCTION_DRIFT \
  NODE_PATH=scripts/validation/node-stubs node --import tsx scripts/validation/a01-readiness-preflight.ts

if [ "${A01_HTTP_PREVIEW:-false}" = "true" ]; then
  echo "proof_stage=rollback_fail_closed_http_readback"
  start_http_preview
  rollback_readyz_status="$(capture_http readyz "${temporary_directory}/rollback-readyz.json")"
  rollback_healthz_status="$(capture_http healthz "${temporary_directory}/rollback-healthz.json")"
  test "${rollback_readyz_status}" = "200"
  test "${rollback_healthz_status}" = "503"
  jq --exit-status '.ok == true and .status == "READY" and .checks.database == "READY"' \
    "${temporary_directory}/rollback-readyz.json" >/dev/null
  jq --exit-status '.ok == false and .status == "SECURITY_POSTURE_REQUIRED" and .security.expectedTableCount == 40 and .security.observedTableCount == 39 and .security.violationCount == 61 and .mutations == "DISABLED_FAIL_CLOSED" and .externalEffectsAuthorized == false' \
    "${temporary_directory}/rollback-healthz.json" >/dev/null
  stop_http_preview

  http_evidence_path="${A01_HTTP_EVIDENCE_PATH:-${temporary_directory}/a01-http-readback.json}"
  jq --null-input --compact-output \
    --arg exactSha "${A01_CANDIDATE_SHA}" \
    --arg observedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --slurpfile candidateRelease "${temporary_directory}/candidate-release.json" \
    --slurpfile candidateLivez "${temporary_directory}/candidate-livez.json" \
    --slurpfile candidateReadyz "${temporary_directory}/candidate-readyz.json" \
    --slurpfile candidateHealthz "${temporary_directory}/candidate-healthz.json" \
    --slurpfile rollbackReadyz "${temporary_directory}/rollback-readyz.json" \
    --slurpfile rollbackHealthz "${temporary_directory}/rollback-healthz.json" \
    '{schemaVersion: 1, environment: "ci-synthetic-http-preview", exactSha: $exactSha, observedAt: $observedAt, effectAuthority: "NO_EFFECT", candidate: {release: $candidateRelease[0], livez: $candidateLivez[0], readyz: $candidateReadyz[0], healthz: $candidateHealthz[0]}, rollback: {readyz: $rollbackReadyz[0], healthz: $rollbackHealthz[0]}}' \
    > "${http_evidence_path}"
  jq --compact-output . "${http_evidence_path}"
fi

echo "a01_rehearsal=PASS"

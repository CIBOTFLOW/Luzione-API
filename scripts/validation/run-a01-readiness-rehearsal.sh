#!/usr/bin/env bash
set -euo pipefail

suffix="$$"
container_name="luzione_a01_postgres_${suffix}"
database_name="luzione_a01_${suffix}"
proof_role="luzione_a01_proof_${suffix}"
password="luzione_a01_disposable_${suffix}"
temporary_directory="$(mktemp -d)"
baseline_dump="${temporary_directory}/pre_migration.dump"
baseline_evidence="${temporary_directory}/baseline-39-of-48.json"
candidate_evidence="${temporary_directory}/candidate-48-of-48.json"
rollback_evidence="${temporary_directory}/rollback-39-of-48.json"
current_security_evidence="${temporary_directory}/current-schema-security.json"
legacy_security_evidence="${temporary_directory}/legacy-security.json"
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

echo "proof_stage=observed_current_39_of_48"
DATABASE_URL="${connection_url}" A01_EXPECTED_POSTURE=PRODUCTION_DRIFT \
  A01_EVIDENCE_PATH="${baseline_evidence}" NODE_PATH=scripts/validation/node-stubs \
  node --import tsx scripts/validation/a01-readiness-preflight.ts

docker exec "${container_name}" pg_dump -Fc -U postgres -d "${database_name}" > "${baseline_dump}"

apply supabase/migrations/20260831070000_order_fulfillment_intent_dark_path.sql
apply supabase/migrations/20260831090000_api_pc_013_least_privilege_roles_rls.sql
apply supabase/migrations/20260831090000_api_pc_013_least_privilege_roles_rls.sql
apply supabase/migrations/20260901123000_sultan_agent_policy_envelopes.sql
apply supabase/migrations/20260901130000_sultan_agent_internal_actions.sql
apply supabase/migrations/20260902010000_sultan_stage5_authority_outcomes.sql
apply supabase/migrations/20260902010100_sultan_stage5_post_inference_receipt_constraints.sql
docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d "${database_name}" -c \
  "grant usage on schema public to ${proof_role}; grant select,insert,update,delete on all tables in schema public to ${proof_role}; grant luzione_api_runtime, luzione_provider_worker to ${proof_role};" >/dev/null

echo "proof_stage=candidate_current_48_of_48"
DATABASE_URL="${connection_url}" A01_EXPECTED_POSTURE=PASS \
  A01_EVIDENCE_PATH="${candidate_evidence}" NODE_PATH=scripts/validation/node-stubs \
  node --import tsx scripts/validation/a01-readiness-preflight.ts
DATABASE_URL="${connection_url}" PROOF_SHAPE=observed_upgrade \
  node --import tsx scripts/validation/api-pc-013-security-rls.ts > "${legacy_security_evidence}"
jq --compact-output . "${legacy_security_evidence}"
DATABASE_URL="${connection_url}" \
  node --import tsx scripts/validation/a01-current-schema-security.ts > "${current_security_evidence}"
jq --compact-output . "${current_security_evidence}"

if [ "${A01_HTTP_PREVIEW:-false}" = "true" ]; then
  : "${A01_CANDIDATE_SHA:?A01_CANDIDATE_SHA is required for exact-SHA HTTP proof}"
  http_port="${A01_HTTP_PORT:-$(node -e 'const net = require("net"); const server = net.createServer(); server.listen(0, "127.0.0.1", () => { console.log(server.address().port); server.close(); });')}"
  http_build_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  service_token="a01-synthetic-service-token"

  start_http_preview() {
    DATABASE_URL="${connection_url}" \
      LUZIONE_API_SERVICE_TOKEN="${service_token}" \
      LUZIONE_API_SERVICE_ACTOR_ID="service:a01-proof" \
      LUZIONE_API_SERVICE_ACTOR_TYPE="service" \
      LUZIONE_API_SERVICE_TENANT_ID="a01-current-a" \
      LUZIONE_API_SERVICE_CAPABILITIES="security.rls.read" \
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
        sed -n '1,240p' "${temporary_directory}/http-preview.log" >&2
        exit 1
      fi
      if [ "${attempt}" -eq 30 ]; then
        sed -n '1,240p' "${temporary_directory}/http-preview.log" >&2
        echo "A01 synthetic HTTP preview did not become ready." >&2
        exit 1
      fi
      sleep 1
    done
  }

  capture_public() {
    local path="$1"
    local output="$2"
    curl --silent --show-error --output "${output}" --write-out "%{http_code}" \
      "http://127.0.0.1:${http_port}${path}"
  }

  capture_authenticated() {
    local path="$1"
    local output="$2"
    curl --silent --show-error --output "${output}" --write-out "%{http_code}" \
      --header "authorization: Bearer ${service_token}" \
      "http://127.0.0.1:${http_port}${path}"
  }

  echo "proof_stage=exact_sha_current_schema_http"
  start_http_preview
  candidate_release_status="$(capture_public /api/v1/release "${temporary_directory}/candidate-release.json")"
  candidate_livez_status="$(capture_public /api/v1/livez "${temporary_directory}/candidate-livez.json")"
  candidate_readyz_status="$(capture_public /api/v1/readyz "${temporary_directory}/candidate-readyz.json")"
  candidate_healthz_status="$(capture_public /api/v1/healthz "${temporary_directory}/candidate-healthz.json")"
  candidate_security_status="$(capture_authenticated '/api/v1/security/rls-readiness?activeProbes=true' "${temporary_directory}/candidate-security.json")"
  unauthorized_status="$(capture_public '/api/v1/security/rls-readiness?activeProbes=true' "${temporary_directory}/unauthorized-security.json")"
  invalid_parameter_status="$(capture_authenticated '/api/v1/security/rls-readiness?activeProbes=unsafe' "${temporary_directory}/invalid-parameter.json")"
  test "${candidate_release_status}" = "200"
  test "${candidate_livez_status}" = "200"
  test "${candidate_readyz_status}" = "200"
  test "${candidate_healthz_status}" = "200"
  test "${candidate_security_status}" = "200"
  test "${unauthorized_status}" = "401"
  test "${invalid_parameter_status}" = "400"
  jq --exit-status --arg sha "${A01_CANDIDATE_SHA}" \
    '.ok == true and .releaseIdentity.exactSha == $sha and .releaseIdentity.environment == "preview" and .releaseIdentity.evidenceState == "EXACT_RELEASE_BOUND" and .releaseIdentity.mutations == "DISABLED_FAIL_CLOSED"' \
    "${temporary_directory}/candidate-release.json" >/dev/null
  jq --exit-status '.ok == true and .status == "LIVE"' \
    "${temporary_directory}/candidate-livez.json" >/dev/null
  jq --exit-status '.ok == true and .status == "READY" and .checks.database == "READY"' \
    "${temporary_directory}/candidate-readyz.json" >/dev/null
  jq --exit-status '.ok == true and .status == "READY_READ_ONLY" and .security.expectedTableCount == 48 and .security.observedTableCount == 48 and .security.violationCount == 0 and .mutations == "DISABLED_FAIL_CLOSED" and .internalProjections == "DISABLED_FAIL_CLOSED" and .externalEffectsAuthorized == false' \
    "${temporary_directory}/candidate-healthz.json" >/dev/null
  jq --exit-status '.ok == true and .result.status == "PASS" and .result.expectedTableCount == 48 and .result.observedTableCount == 48 and (.result.violations | length) == 0 and (.result.probes | length) == 5 and all(.result.probes[]; .denied == true and .reason == "permission_denied")' \
    "${temporary_directory}/candidate-security.json" >/dev/null
  jq --exit-status '.ok == false and .message == "Service authentication required."' \
    "${temporary_directory}/unauthorized-security.json" >/dev/null
  jq --exit-status '.ok == false and (.message | contains("activeProbes must be true or false"))' \
    "${temporary_directory}/invalid-parameter.json" >/dev/null
  stop_http_preview
fi

echo "proof_stage=rollback_restore_exact_39_of_48"
docker exec "${container_name}" dropdb -U postgres "${database_name}"
docker exec "${container_name}" createdb -U postgres "${database_name}"
docker exec -i "${container_name}" pg_restore -U postgres -d "${database_name}" < "${baseline_dump}"
docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
  "revoke luzione_api_runtime, luzione_provider_worker from ${proof_role}; drop role luzione_api_runtime; drop role luzione_provider_worker;" >/dev/null
DATABASE_URL="${connection_url}" A01_EXPECTED_POSTURE=PRODUCTION_DRIFT \
  A01_EVIDENCE_PATH="${rollback_evidence}" NODE_PATH=scripts/validation/node-stubs \
  node --import tsx scripts/validation/a01-readiness-preflight.ts
cmp "${baseline_evidence}" "${rollback_evidence}"

if [ "${A01_HTTP_PREVIEW:-false}" = "true" ]; then
  echo "proof_stage=rollback_fail_closed_current_schema_http"
  start_http_preview
  rollback_readyz_status="$(capture_public /api/v1/readyz "${temporary_directory}/rollback-readyz.json")"
  rollback_healthz_status="$(capture_public /api/v1/healthz "${temporary_directory}/rollback-healthz.json")"
  rollback_security_status="$(capture_authenticated '/api/v1/security/rls-readiness?activeProbes=false' "${temporary_directory}/rollback-security.json")"
  test "${rollback_readyz_status}" = "200"
  test "${rollback_healthz_status}" = "503"
  test "${rollback_security_status}" = "503"
  jq --exit-status '.ok == true and .status == "READY" and .checks.database == "READY"' \
    "${temporary_directory}/rollback-readyz.json" >/dev/null
  jq --exit-status '.ok == false and .status == "SECURITY_POSTURE_REQUIRED" and .security.expectedTableCount == 48 and .security.observedTableCount == 39 and .security.violationCount == 69 and .mutations == "DISABLED_FAIL_CLOSED" and .externalEffectsAuthorized == false' \
    "${temporary_directory}/rollback-healthz.json" >/dev/null
  jq --exit-status '.ok == false and .result.status == "FAIL" and .result.expectedTableCount == 48 and .result.observedTableCount == 39 and (.result.violations | length) == 69 and (.result.probes | length) == 0' \
    "${temporary_directory}/rollback-security.json" >/dev/null
  stop_http_preview

  http_evidence_path="${A01_HTTP_EVIDENCE_PATH:-${temporary_directory}/a01-current-schema-http-readback.json}"
  jq --null-input --compact-output \
    --arg exactSha "${A01_CANDIDATE_SHA}" \
    --arg observedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --slurpfile baseline "${baseline_evidence}" \
    --slurpfile candidate "${candidate_evidence}" \
    --slurpfile currentSecurity "${current_security_evidence}" \
    --slurpfile legacySecurity "${legacy_security_evidence}" \
    --slurpfile candidateRelease "${temporary_directory}/candidate-release.json" \
    --slurpfile candidateLivez "${temporary_directory}/candidate-livez.json" \
    --slurpfile candidateReadyz "${temporary_directory}/candidate-readyz.json" \
    --slurpfile candidateHealthz "${temporary_directory}/candidate-healthz.json" \
    --slurpfile candidateSecurity "${temporary_directory}/candidate-security.json" \
    --slurpfile unauthorized "${temporary_directory}/unauthorized-security.json" \
    --slurpfile invalidParameter "${temporary_directory}/invalid-parameter.json" \
    --slurpfile rollback "${rollback_evidence}" \
    --slurpfile rollbackReadyz "${temporary_directory}/rollback-readyz.json" \
    --slurpfile rollbackHealthz "${temporary_directory}/rollback-healthz.json" \
    --slurpfile rollbackSecurity "${temporary_directory}/rollback-security.json" \
    '{schemaVersion: 2, contract: "A01_CURRENT_48_RELATION_TRUTH", environment: "ci-isolated-synthetic-http", exactSha: $exactSha, observedAt: $observedAt, effectAuthority: "NO_EFFECT", productionAccessed: false, baseline: $baseline[0], candidate: {posture: $candidate[0], privilegeAndTenantEvidence: $currentSecurity[0], legacySecurityEvidence: $legacySecurity[0], release: $candidateRelease[0], livez: $candidateLivez[0], readyz: $candidateReadyz[0], healthz: $candidateHealthz[0], authenticatedRlsReadback: $candidateSecurity[0]}, negativePaths: {unauthenticatedRlsReadback: $unauthorized[0], invalidActiveProbeParameter: $invalidParameter[0]}, rollback: {posture: $rollback[0], readyz: $rollbackReadyz[0], healthz: $rollbackHealthz[0], authenticatedRlsReadback: $rollbackSecurity[0], exactBaselineRestored: true}, productionEvidence: false, managedBackupOrPitrReceipt: null}' \
    > "${http_evidence_path}"
  jq --compact-output . "${http_evidence_path}"
fi

echo "a01_current_schema_migration_checksums=$(shasum -a 256 \
  supabase/migrations/20260831070000_order_fulfillment_intent_dark_path.sql \
  supabase/migrations/20260831090000_api_pc_013_least_privilege_roles_rls.sql \
  supabase/migrations/20260901123000_sultan_agent_policy_envelopes.sql \
  supabase/migrations/20260901130000_sultan_agent_internal_actions.sql \
  supabase/migrations/20260902010000_sultan_stage5_authority_outcomes.sql \
  supabase/migrations/20260902010100_sultan_stage5_post_inference_receipt_constraints.sql | tr '\n' ';')"
echo "a01_current_schema_rehearsal=PASS"

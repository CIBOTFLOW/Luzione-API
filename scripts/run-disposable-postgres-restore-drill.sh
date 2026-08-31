#!/usr/bin/env bash
set -euo pipefail

source_database="${1:?source database is required}"
target_database="${2:?target database is required}"
container_name="${3:-luzione_postgres}"
post_restore_migration="${4:-}"
post_restore_sql="${5:-}"
script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dump_path="/tmp/${target_database}.dump"

if [[ ! "${target_database}" =~ ^luzione_api_se014_restore_[a-zA-Z0-9_]+$ ]]; then
  echo "target database must use the luzione_api_se014_restore_ prefix" >&2
  exit 2
fi

if [[ "${source_database}" == "${target_database}" || "${source_database}" == "postgres" ]]; then
  echo "source and target must be distinct; postgres cannot be used as the source" >&2
  exit 2
fi

existing="$(docker exec "${container_name}" psql -U postgres -d postgres -Atc "select count(*) from pg_database where datname = '${target_database}'")"
if [[ "${existing}" != "0" ]]; then
  echo "refusing to overwrite existing database ${target_database}" >&2
  exit 3
fi

cleanup() {
  docker exec "${container_name}" dropdb -U postgres --if-exists "${target_database}" >/dev/null
  docker exec "${container_name}" rm -f "${dump_path}" >/dev/null
}
trap cleanup EXIT

started_epoch="$(date +%s)"
source_fingerprint="$(docker exec -i "${container_name}" psql -U postgres -d "${source_database}" -At -f - < "${script_directory}/recovery-catalog-fingerprint.sql")"
docker exec "${container_name}" pg_dump -U postgres -d "${source_database}" --format=custom --no-owner --no-privileges --file="${dump_path}"
dump_evidence="$(docker exec "${container_name}" sh -c "sha256sum '${dump_path}' && stat -c '%s' '${dump_path}'")"
docker exec "${container_name}" createdb -U postgres --template=template0 "${target_database}"
docker exec "${container_name}" pg_restore -U postgres -d "${target_database}" --no-owner --no-privileges --exit-on-error "${dump_path}"
if [[ -n "${post_restore_migration}" ]]; then
  if [[ ! -f "${post_restore_migration}" ]]; then
    echo "post-restore migration file does not exist: ${post_restore_migration}" >&2
    exit 5
  fi
  docker exec -i "${container_name}" psql -q -v ON_ERROR_STOP=1 -U postgres -d "${target_database}" -f - < "${post_restore_migration}" >/dev/null
fi
restored_fingerprint="$(docker exec -i "${container_name}" psql -U postgres -d "${target_database}" -At -f - < "${script_directory}/recovery-catalog-fingerprint.sql")"
if [[ -n "${post_restore_sql}" ]]; then
  if [[ ! -f "${post_restore_sql}" ]]; then
    echo "post-restore SQL file does not exist: ${post_restore_sql}" >&2
    exit 6
  fi
  docker exec -i "${container_name}" psql -q -v ON_ERROR_STOP=1 -U postgres -d "${target_database}" -f - < "${post_restore_sql}" >/dev/null
fi
finished_epoch="$(date +%s)"

if [[ "${source_fingerprint}" != "${restored_fingerprint}" ]]; then
  echo "restore fingerprint mismatch" >&2
  echo "source=${source_fingerprint}" >&2
  echo "restored=${restored_fingerprint}" >&2
  exit 4
fi

echo "source_fingerprint=${source_fingerprint}"
echo "restored_fingerprint=${restored_fingerprint}"
echo "dump_evidence=${dump_evidence//$'\n'/,}"
echo "recovery_time_seconds=$((finished_epoch - started_epoch))"
echo "post_restore_migration=$([[ -n "${post_restore_migration}" ]] && echo applied || echo not_requested)"
echo "post_restore_verification=$([[ -n "${post_restore_sql}" ]] && echo passed || echo not_requested)"
echo "cleanup=scheduled"

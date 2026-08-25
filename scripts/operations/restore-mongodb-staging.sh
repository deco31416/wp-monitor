#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
    cat <<'EOF'
Usage:
  restore-mongodb-staging.sh \
    --backup /absolute/backup-directory \
    --age-identity /absolute/identity-file \
    --mongo-container STAGING_CONTAINER_NAME \
    --source-db SOURCE_DATABASE \
    --target-db NAME_CONTAINING_STAGING \
    --confirm-staging \
    [--mongorestore-config /path/inside/mongo/container.yml]

This command intentionally restores only MongoDB. Baileys auth, browser profile,
uploads and Redis archives require a separate reviewed disaster-recovery
procedure because restoring authenticated sessions alongside production is unsafe.
EOF
}

die() {
    printf 'restore error: %s\n' "$1" >&2
    exit 1
}

backup_dir=''
age_identity=''
mongo_container=''
source_db=''
target_db=''
mongorestore_config=''
confirmed=false

while (($#)); do
    case "$1" in
        --backup)
            [[ -n "${2:-}" && "${2:-}" != --* ]] || die '--backup requires a value'
            backup_dir="$2"
            shift 2
            ;;
        --age-identity)
            [[ -n "${2:-}" && "${2:-}" != --* ]] || die '--age-identity requires a value'
            age_identity="$2"
            shift 2
            ;;
        --mongo-container)
            [[ -n "${2:-}" && "${2:-}" != --* ]] || die '--mongo-container requires a value'
            mongo_container="$2"
            shift 2
            ;;
        --source-db)
            [[ -n "${2:-}" && "${2:-}" != --* ]] || die '--source-db requires a value'
            source_db="$2"
            shift 2
            ;;
        --target-db)
            [[ -n "${2:-}" && "${2:-}" != --* ]] || die '--target-db requires a value'
            target_db="$2"
            shift 2
            ;;
        --mongorestore-config)
            [[ -n "${2:-}" && "${2:-}" != --* ]] || die '--mongorestore-config requires a value'
            mongorestore_config="$2"
            shift 2
            ;;
        --confirm-staging)
            confirmed=true
            shift
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            die "unknown option: $1"
            ;;
    esac
done

[[ "$confirmed" == true ]] || die '--confirm-staging is required'
[[ "$backup_dir" == /* ]] || die '--backup must be an absolute path'
[[ "$age_identity" == /* ]] || die '--age-identity must be an absolute path'
[[ -d "$backup_dir" && ! -L "$backup_dir" ]] || die 'backup directory is missing or unsafe'
[[ -f "$age_identity" && ! -L "$age_identity" ]] || die 'age identity file is missing or unsafe'
[[ "$mongo_container" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || die 'invalid container name'
[[ "$source_db" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || die 'invalid source database name'
[[ "$target_db" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || die 'invalid target database name'
[[ "${mongo_container,,}" == *staging* ]] || die 'MongoDB container name must contain staging'
[[ "${target_db,,}" == *staging* ]] || die 'target database name must contain staging'
[[ "$source_db" != "$target_db" ]] || die 'source and target databases must differ'
if [[ -n "$mongorestore_config" ]]; then
    [[ "$mongorestore_config" == /* ]] || die '--mongorestore-config must be an absolute path inside the MongoDB container'
fi

for command_name in age docker sha256sum; do
    command -v "$command_name" >/dev/null 2>&1 || die "required command is unavailable: $command_name"
done

[[ "$(docker inspect --format '{{.State.Running}}' "$mongo_container" 2>/dev/null)" == true ]] \
    || die 'staging MongoDB container is not running'

"$(dirname "$0")/verify-backup.sh" --backup "$backup_dir" --age-identity "$age_identity"

restore_args=(
    mongorestore
    --archive
    --gzip
    --drop
    "--nsFrom=${source_db}.*"
    "--nsTo=${target_db}.*"
)
if [[ -n "$mongorestore_config" ]]; then
    restore_args+=(--config "$mongorestore_config")
fi

age --decrypt --identity "$age_identity" "$backup_dir/mongodb.archive.gz.age" \
    | docker exec --interactive "$mongo_container" "${restore_args[@]}"

printf 'MongoDB staging restore completed. Validate collection counts and application contracts before PASS.\n'

#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
    cat <<'EOF'
Usage:
  backup-docker.sh \
    --output /absolute/encrypted-backup-directory \
    --mongo-container NAME \
    --mongo-db NAME \
    --backend-container NAME \
    --browser-container NAME \
    --capture-agent-container NAME \
    --redis-container NAME \
    --age-recipients /absolute/public-recipients-file \
    [--mongodump-config /path/inside/mongo/container.yml]

Pre-3.1 migration, before browser/capture containers exist:
  backup-docker.sh \
    --pre-browser-migration \
    --output /absolute/encrypted-backup-directory \
    --mongo-container NAME \
    --mongo-db NAME \
    --backend-container NAME \
    --redis-container NAME \
    --age-recipients /absolute/public-recipients-file \
    [--mongodump-config /path/inside/mongo/container.yml]

The recipients file must contain age public recipients only. MongoDB credentials,
when required, must be provided through a protected mongodump --config file that
already exists inside the MongoDB container. Secrets are never accepted as CLI
arguments or printed by this script.
EOF
}

die() {
    printf 'backup error: %s\n' "$1" >&2
    exit 1
}

require_value() {
    local option="$1"
    local value="${2:-}"
    [[ -n "$value" && "$value" != --* ]] || die "$option requires a value"
}

validate_container_name() {
    [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || die "invalid container name"
}

validate_database_name() {
    [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || die "invalid MongoDB database name"
}

output_dir="${WP_BACKUP_OUTPUT:-}"
mongo_container="${WP_MONGO_CONTAINER:-}"
mongo_db="${WP_MONGO_DB:-}"
backend_container="${WP_BACKEND_CONTAINER:-}"
browser_container="${WP_BROWSER_CONTAINER:-}"
capture_agent_container="${WP_CAPTURE_AGENT_CONTAINER:-}"
redis_container="${WP_REDIS_CONTAINER:-}"
age_recipients="${WP_AGE_RECIPIENTS_FILE:-}"
mongodump_config="${WP_MONGODUMP_CONFIG_PATH:-}"
pre_browser_migration=false

while (($#)); do
    case "$1" in
        --output)
            require_value "$1" "${2:-}"
            output_dir="$2"
            shift 2
            ;;
        --mongo-container)
            require_value "$1" "${2:-}"
            mongo_container="$2"
            shift 2
            ;;
        --mongo-db)
            require_value "$1" "${2:-}"
            mongo_db="$2"
            shift 2
            ;;
        --backend-container)
            require_value "$1" "${2:-}"
            backend_container="$2"
            shift 2
            ;;
        --redis-container)
            require_value "$1" "${2:-}"
            redis_container="$2"
            shift 2
            ;;
        --browser-container)
            require_value "$1" "${2:-}"
            browser_container="$2"
            shift 2
            ;;
        --capture-agent-container)
            require_value "$1" "${2:-}"
            capture_agent_container="$2"
            shift 2
            ;;
        --age-recipients)
            require_value "$1" "${2:-}"
            age_recipients="$2"
            shift 2
            ;;
        --mongodump-config)
            require_value "$1" "${2:-}"
            mongodump_config="$2"
            shift 2
            ;;
        --pre-browser-migration)
            pre_browser_migration=true
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

[[ -n "$output_dir" ]] || die '--output is required'
[[ -n "$mongo_container" ]] || die '--mongo-container is required'
[[ -n "$mongo_db" ]] || die '--mongo-db is required'
[[ -n "$backend_container" ]] || die '--backend-container is required'
[[ -n "$redis_container" ]] || die '--redis-container is required'
[[ -n "$age_recipients" ]] || die '--age-recipients is required'
if [[ "$pre_browser_migration" == true ]]; then
    [[ -z "$browser_container" ]] || die '--browser-container is incompatible with --pre-browser-migration'
    [[ -z "$capture_agent_container" ]] || die '--capture-agent-container is incompatible with --pre-browser-migration'
else
    [[ -n "$browser_container" ]] || die '--browser-container is required'
    [[ -n "$capture_agent_container" ]] || die '--capture-agent-container is required'
fi

[[ "$output_dir" == /* ]] || die '--output must be an absolute path'
[[ "$output_dir" != / && "$output_dir" != "$HOME" ]] || die 'refusing broad backup output path'
[[ "$age_recipients" == /* ]] || die '--age-recipients must be an absolute path'
[[ -f "$age_recipients" && ! -L "$age_recipients" ]] || die 'age recipients file is missing or unsafe'
[[ -s "$age_recipients" ]] || die 'age recipients file is empty'
if [[ -n "$mongodump_config" ]]; then
    [[ "$mongodump_config" == /* ]] || die '--mongodump-config must be an absolute path inside the MongoDB container'
fi

validate_container_name "$mongo_container"
validate_container_name "$backend_container"
validate_container_name "$redis_container"
if [[ "$pre_browser_migration" == false ]]; then
    validate_container_name "$browser_container"
    validate_container_name "$capture_agent_container"
fi
validate_database_name "$mongo_db"

for command_name in age docker flock sha256sum tar; do
    command -v "$command_name" >/dev/null 2>&1 || die "required command is unavailable: $command_name"
done

required_containers=("$mongo_container" "$backend_container" "$redis_container")
if [[ "$pre_browser_migration" == false ]]; then
    required_containers+=("$browser_container" "$capture_agent_container")
fi
for container_name in "${required_containers[@]}"; do
    [[ "$(docker inspect --format '{{.State.Running}}' "$container_name" 2>/dev/null)" == true ]] \
        || die "required container is not running: $container_name"
done

umask 077
mkdir -p -- "$output_dir"
[[ -d "$output_dir" && ! -L "$output_dir" ]] || die 'backup output directory is unsafe'

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
resolved_output="$(cd "$output_dir" && pwd -P)"
[[ "$resolved_output" != "$repository_root" && "$resolved_output" != "$repository_root/"* ]] \
    || die 'backup output must be outside the source repository'

exec 9>"$output_dir/.backup.lock"
flock -n 9 || die 'another backup is already running for this output directory'

timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
backup_dir="$output_dir/$timestamp"
mkdir -- "$backup_dir"

backend_paused=false
browser_paused=false
capture_agent_paused=false
redis_paused=false
partial_files=()
completed_files=()

cleanup() {
    local exit_code=$?
    if [[ "$redis_paused" == true ]]; then
        docker unpause "$redis_container" >/dev/null 2>&1 || true
    fi
    if [[ "$browser_paused" == true ]]; then
        docker unpause "$browser_container" >/dev/null 2>&1 || true
    fi
    if [[ "$capture_agent_paused" == true ]]; then
        docker unpause "$capture_agent_container" >/dev/null 2>&1 || true
    fi
    if [[ "$backend_paused" == true ]]; then
        docker unpause "$backend_container" >/dev/null 2>&1 || true
    fi
    if ((exit_code != 0)); then
        for generated_file in "${partial_files[@]:-}" "${completed_files[@]:-}"; do
            [[ -n "$generated_file" ]] && rm -f -- "$generated_file"
        done
        rm -f -- "$backup_dir/manifest.txt" "$backup_dir/checksums.sha256"
        rmdir -- "$backup_dir" >/dev/null 2>&1 || true
    fi
    return "$exit_code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

encrypt_command_to_file() {
    local final_path="$1"
    shift
    local partial_path="${final_path}.partial"
    partial_files+=("$partial_path")
    if ! "$@" | age -R "$age_recipients" -o "$partial_path"; then
        rm -f -- "$partial_path"
        return 1
    fi
    mv -- "$partial_path" "$final_path"
    completed_files+=("$final_path")
}

printf 'Pausing application writers for a consistent encrypted backup...\n'
docker pause "$backend_container" >/dev/null
backend_paused=true
if [[ "$pre_browser_migration" == false ]]; then
    docker pause "$browser_container" >/dev/null
    browser_paused=true
    docker pause "$capture_agent_container" >/dev/null
    capture_agent_paused=true
fi
docker pause "$redis_container" >/dev/null
redis_paused=true

printf 'Creating encrypted MongoDB archive...\n'
mongo_args=(mongodump --archive --gzip --db "$mongo_db")
if [[ -n "$mongodump_config" ]]; then
    mongo_args+=(--config "$mongodump_config")
fi
encrypt_command_to_file "$backup_dir/mongodb.archive.gz.age" \
    docker exec "$mongo_container" "${mongo_args[@]}"
encrypt_command_to_file "$backup_dir/baileys-auth.tar.age" \
    docker cp "$backend_container:/app/auth_info_baileys/." -
encrypt_command_to_file "$backup_dir/uploads.tar.age" \
    docker cp "$backend_container:/app/public/uploads/." -
if [[ "$pre_browser_migration" == true ]]; then
    encrypt_command_to_file "$backup_dir/browser-profile.tar.age" \
        tar --create --files-from /dev/null
else
    encrypt_command_to_file "$backup_dir/browser-profile.tar.age" \
        docker cp "$browser_container:/home/browser/profile/." -
fi
encrypt_command_to_file "$backup_dir/redis-data.tar.age" \
    docker cp "$redis_container:/data/." -

docker unpause "$redis_container" >/dev/null
redis_paused=false
if [[ "$pre_browser_migration" == false ]]; then
    docker unpause "$capture_agent_container" >/dev/null
    capture_agent_paused=false
    docker unpause "$browser_container" >/dev/null
    browser_paused=false
fi
docker unpause "$backend_container" >/dev/null
backend_paused=false

printf 'format=wp-monitor-encrypted-backup-v2\n' >"$backup_dir/manifest.txt"
printf 'created_at_utc=%s\n' "$timestamp" >>"$backup_dir/manifest.txt"
printf 'mongo_database=%s\n' "$mongo_db" >>"$backup_dir/manifest.txt"
printf 'components=mongodb,baileys-auth,browser-profile,uploads,redis-data\n' >>"$backup_dir/manifest.txt"
if [[ "$pre_browser_migration" == true ]]; then
    printf 'browser_profile_source=empty_pre_3_1_migration\n' >>"$backup_dir/manifest.txt"
else
    printf 'browser_profile_source=container\n' >>"$backup_dir/manifest.txt"
fi

(
    cd "$backup_dir"
    sha256sum -- *.age manifest.txt >checksums.sha256
)

printf 'Encrypted backup completed: %s\n' "$backup_dir"
printf 'Verify with scripts/operations/verify-backup.sh before transferring it off-host.\n'

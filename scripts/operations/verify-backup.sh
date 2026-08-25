#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
    cat <<'EOF'
Usage:
  verify-backup.sh --backup /absolute/backup-directory [--age-identity /absolute/identity-file]

Without --age-identity, the script verifies the SHA-256 manifest only. With an
identity file it also authenticates and decrypts every age archive to /dev/null.
The decrypted contents are never written to disk.
EOF
}

die() {
    printf 'verification error: %s\n' "$1" >&2
    exit 1
}

backup_dir=''
age_identity=''

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
        --help|-h)
            usage
            exit 0
            ;;
        *)
            die "unknown option: $1"
            ;;
    esac
done

[[ "$backup_dir" == /* ]] || die '--backup must be an absolute path'
[[ -d "$backup_dir" && ! -L "$backup_dir" ]] || die 'backup directory is missing or unsafe'
[[ -f "$backup_dir/checksums.sha256" && ! -L "$backup_dir/checksums.sha256" ]] \
    || die 'checksums.sha256 is missing or unsafe'

expected_files=(
    mongodb.archive.gz.age
    baileys-auth.tar.age
    browser-profile.tar.age
    uploads.tar.age
    redis-data.tar.age
    manifest.txt
)
for expected_file in "${expected_files[@]}"; do
    [[ -f "$backup_dir/$expected_file" && ! -L "$backup_dir/$expected_file" ]] \
        || die "required backup file is missing or unsafe: $expected_file"
done

grep -Fxq 'format=wp-monitor-encrypted-backup-v1' "$backup_dir/manifest.txt" \
    || die 'manifest format is missing or unsupported'
grep -Eq '^created_at_utc=[0-9]{8}T[0-9]{6}Z$' "$backup_dir/manifest.txt" \
    || die 'manifest creation timestamp is invalid'
grep -Eq '^mongo_database=[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$' "$backup_dir/manifest.txt" \
    || die 'manifest MongoDB database is invalid'
grep -Fxq 'components=mongodb,baileys-auth,browser-profile,uploads,redis-data' "$backup_dir/manifest.txt" \
    || die 'manifest component set is missing or unsupported'
[[ "$(wc -l <"$backup_dir/manifest.txt")" -eq 4 ]] \
    || die 'manifest contains unexpected fields'

mapfile -t checksum_entries < <(awk '{print $2}' "$backup_dir/checksums.sha256" | LC_ALL=C sort)
mapfile -t expected_entries < <(printf '%s\n' "${expected_files[@]}" | LC_ALL=C sort)
[[ "${#checksum_entries[@]}" -eq "${#expected_entries[@]}" ]] \
    || die 'checksum manifest has an unexpected number of entries'
for index in "${!expected_entries[@]}"; do
    [[ "${checksum_entries[$index]}" == "${expected_entries[$index]}" ]] \
        || die 'checksum manifest contains an unexpected or unsafe path'
done

(
    cd "$backup_dir"
    sha256sum --check --strict checksums.sha256
)

if [[ -n "$age_identity" ]]; then
    command -v age >/dev/null 2>&1 || die 'required command is unavailable: age'
    [[ "$age_identity" == /* ]] || die '--age-identity must be an absolute path'
    [[ -f "$age_identity" && ! -L "$age_identity" ]] || die 'age identity file is missing or unsafe'
    for encrypted_file in "$backup_dir"/*.age; do
        age --decrypt --identity "$age_identity" "$encrypted_file" >/dev/null
    done
fi

printf 'Backup verification passed: %s\n' "$backup_dir"

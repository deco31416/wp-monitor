import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    chmodSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '..');
const verifyScript = join(repositoryRoot, 'scripts/operations/verify-backup.sh');
const backupScript = join(repositoryRoot, 'scripts/operations/backup-docker.sh');

function checksum(path: string): string {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function createBackupFixture(root: string, format = 'wp-monitor-encrypted-backup-v1'): string {
    const backupDir = join(root, '20260824T120000Z');
    mkdirSync(backupDir);
    const encryptedFiles = [
        'mongodb.archive.gz.age',
        'baileys-auth.tar.age',
        'browser-profile.tar.age',
        'uploads.tar.age',
        'redis-data.tar.age',
    ];
    for (const file of encryptedFiles) {
        writeFileSync(join(backupDir, file), `synthetic encrypted fixture: ${file}\n`, { mode: 0o600 });
    }
    const manifest = [
        `format=${format}`,
        'created_at_utc=20260824T120000Z',
        'mongo_database=wp-monitor-test',
        'components=mongodb,baileys-auth,browser-profile,uploads,redis-data',
    ];
    if (format === 'wp-monitor-encrypted-backup-v2') {
        manifest.push('browser_profile_source=empty_pre_3_1_migration');
    }
    writeFileSync(join(backupDir, 'manifest.txt'), `${manifest.join('\n')}\n`, { mode: 0o600 });

    const files = [...encryptedFiles, 'manifest.txt'].sort();
    writeFileSync(
        join(backupDir, 'checksums.sha256'),
        files.map(file => `${checksum(join(backupDir, file))}  ${file}`).join('\n') + '\n',
        { mode: 0o600 },
    );
    return backupDir;
}

test('backup verifier accepts a complete synthetic archive and rejects tampering', () => {
    const root = mkdtempSync(join(tmpdir(), 'wp-monitor-backup-verify-'));
    try {
        const backupDir = createBackupFixture(root);
        const valid = spawnSync('bash', [verifyScript, '--backup', backupDir], { encoding: 'utf8' });
        assert.equal(valid.status, 0, valid.stderr);
        assert.match(valid.stdout, /Backup verification passed/);

        writeFileSync(join(backupDir, 'uploads.tar.age'), 'tampered\n', { mode: 0o600 });
        const tampered = spawnSync('bash', [verifyScript, '--backup', backupDir], { encoding: 'utf8' });
        assert.notEqual(tampered.status, 0);
        assert.match(`${tampered.stdout}\n${tampered.stderr}`, /FAILED|did NOT match/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('backup verifier accepts the v2 browser-profile provenance field', () => {
    const root = mkdtempSync(join(tmpdir(), 'wp-monitor-backup-v2-'));
    try {
        const backupDir = createBackupFixture(root, 'wp-monitor-encrypted-backup-v2');
        const valid = spawnSync('bash', [verifyScript, '--backup', backupDir], { encoding: 'utf8' });
        assert.equal(valid.status, 0, valid.stderr);
        assert.match(valid.stdout, /Backup verification passed/);

        const manifestPath = join(backupDir, 'manifest.txt');
        writeFileSync(
            manifestPath,
            readFileSync(manifestPath, 'utf8').replace(
                'browser_profile_source=empty_pre_3_1_migration',
                'browser_profile_source=untrusted',
            ),
            { mode: 0o600 },
        );
        const invalid = spawnSync('bash', [verifyScript, '--backup', backupDir], { encoding: 'utf8' });
        assert.notEqual(invalid.status, 0);
        assert.match(invalid.stderr, /browser profile source is missing or invalid/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('pre-browser migration backup succeeds without browser or capture containers', () => {
    const root = mkdtempSync(join(tmpdir(), 'wp-monitor-backup-pre-browser-'));
    try {
        const outputDir = join(root, 'output');
        const fakeBin = join(root, 'bin');
        const recipients = join(root, 'recipients.txt');
        mkdirSync(outputDir);
        mkdirSync(fakeBin);
        writeFileSync(recipients, 'age1syntheticpublicrecipientfortests\n', { mode: 0o600 });

        const fakeDocker = join(fakeBin, 'docker');
        writeFileSync(fakeDocker, `#!/bin/sh
case "$1" in
  inspect) printf 'true\\n' ;;
  pause|unpause) exit 0 ;;
  exec) printf 'synthetic mongo archive\\n' ;;
  cp) printf 'synthetic mounted data archive\\n' ;;
  *) exit 43 ;;
esac
`, { mode: 0o700 });
        chmodSync(fakeDocker, 0o700);

        const fakeAge = join(fakeBin, 'age');
        writeFileSync(fakeAge, `#!/bin/sh
output=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = '-o' ]; then output="$2"; shift 2; else shift; fi
done
[ -n "$output" ] || exit 44
dd of="$output" status=none
`, { mode: 0o700 });
        chmodSync(fakeAge, 0o700);

        const result = spawnSync('bash', [
            backupScript,
            '--pre-browser-migration',
            '--output', outputDir,
            '--mongo-container', 'mongo-test',
            '--mongo-db', 'wp-monitor-test',
            '--backend-container', 'backend-test',
            '--redis-container', 'redis-test',
            '--age-recipients', recipients,
        ], {
            encoding: 'utf8',
            env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH || ''}` },
        });

        assert.equal(result.status, 0, result.stderr);
        const backupEntries = readdirSync(outputDir).filter(entry => entry !== '.backup.lock');
        assert.equal(backupEntries.length, 1);
        const backupEntry = backupEntries[0];
        assert.ok(backupEntry);
        const backupDir = join(outputDir, backupEntry);
        assert.match(readFileSync(join(backupDir, 'manifest.txt'), 'utf8'), /format=wp-monitor-encrypted-backup-v2/);
        assert.match(readFileSync(join(backupDir, 'manifest.txt'), 'utf8'), /browser_profile_source=empty_pre_3_1_migration/);
        assert.ok(readFileSync(join(backupDir, 'browser-profile.tar.age')).length > 0);

        const verified = spawnSync('bash', [verifyScript, '--backup', backupDir], { encoding: 'utf8' });
        assert.equal(verified.status, 0, verified.stderr);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('backup producer failure cannot leave a completed or partial backup set', () => {
    const root = mkdtempSync(join(tmpdir(), 'wp-monitor-backup-failure-'));
    try {
        const outputDir = join(root, 'output');
        const fakeBin = join(root, 'bin');
        const recipients = join(root, 'recipients.txt');
        mkdirSync(outputDir);
        mkdirSync(fakeBin);
        writeFileSync(recipients, 'age1syntheticpublicrecipientfortests\n', { mode: 0o600 });

        const fakeDocker = join(fakeBin, 'docker');
        writeFileSync(fakeDocker, `#!/bin/sh
case "$1" in
  inspect) printf 'true\\n' ;;
  pause|unpause) exit 0 ;;
  exec) exit 42 ;;
  *) exit 43 ;;
esac
`, { mode: 0o700 });
        chmodSync(fakeDocker, 0o700);

        const fakeAge = join(fakeBin, 'age');
        writeFileSync(fakeAge, `#!/bin/sh
output=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = '-o' ]; then output="$2"; shift 2; else shift; fi
done
[ -n "$output" ] || exit 44
dd of="$output" status=none
`, { mode: 0o700 });
        chmodSync(fakeAge, 0o700);

        const result = spawnSync('bash', [
            backupScript,
            '--output', outputDir,
            '--mongo-container', 'mongo-test',
            '--mongo-db', 'wp-monitor-test',
            '--backend-container', 'backend-test',
            '--browser-container', 'browser-test',
            '--capture-agent-container', 'capture-test',
            '--redis-container', 'redis-test',
            '--age-recipients', recipients,
        ], {
            encoding: 'utf8',
            env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH || ''}` },
        });

        assert.notEqual(result.status, 0);
        assert.deepEqual(
            readdirSync(outputDir).filter(entry => entry !== '.backup.lock'),
            [],
            'failed backup must remove only its newly-created timestamp directory',
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { quarantineAuthStateContents } from '../src/auth-state-rotation.js';

test('quarantines auth contents inside the mounted directory without renaming its root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wp-auth-rotation-'));
    try {
        await writeFile(path.join(root, 'creds.json'), 'synthetic');
        await mkdir(path.join(root, 'keys'));
        await writeFile(path.join(root, 'keys', 'one.json'), 'synthetic-key');

        const result = await quarantineAuthStateContents(root, new Date('2026-08-28T12:34:56.000Z'));
        assert.equal(result.movedEntries, 2);
        assert.equal(path.dirname(result.quarantineDirectory), root);
        assert.deepEqual(await readdir(root), ['.logged-out-quarantine-2026-08-28T12-34-56-000Z']);
        assert.equal(await readFile(path.join(result.quarantineDirectory, 'creds.json'), 'utf8'), 'synthetic');
        assert.equal(await readFile(path.join(result.quarantineDirectory, 'keys', 'one.json'), 'utf8'), 'synthetic-key');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('preserves prior quarantines and reports an empty active auth root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wp-auth-rotation-empty-'));
    try {
        const prior = path.join(root, '.logged-out-quarantine-prior');
        await mkdir(prior);
        await writeFile(path.join(prior, 'creds.json'), 'prior');

        const result = await quarantineAuthStateContents(root, new Date('2026-08-28T13:00:00.000Z'));
        assert.equal(result.movedEntries, 0);
        assert.deepEqual(await readdir(root), ['.logged-out-quarantine-prior']);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

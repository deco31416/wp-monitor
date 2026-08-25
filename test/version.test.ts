import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveSoftwareVersion, SOFTWARE_VERSION } from '../src/version.js';

test('resolves the release version from the root manifest', () => {
    const rootManifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const clientManifest = JSON.parse(readFileSync(new URL('../client/package.json', import.meta.url), 'utf8'));
    assert.equal(SOFTWARE_VERSION, rootManifest.version);
    assert.equal(clientManifest.version, rootManifest.version);
    assert.equal(SOFTWARE_VERSION, '3.1.0');
});

test('prefers an explicit package-manager version without accepting whitespace-only input', () => {
    assert.equal(resolveSoftwareVersion(' 3.0.0-qa.1 '), '3.0.0-qa.1');
    assert.equal(resolveSoftwareVersion('   '), SOFTWARE_VERSION);
});

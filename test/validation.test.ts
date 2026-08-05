import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, collectErrors, normalizeOptionalJid, parseLimit, parseTags, validateCaseId, validateJid, validateRequiredText } from '../src/validation.js';

test('normalizes and validates case IDs', () => {
    assert.deepEqual(validateCaseId(' case-001 ').value, 'CASE-001');
    assert.equal(validateCaseId('ab').ok, false);
    assert.equal(validateCaseId('case id with spaces').ok, false);
});

test('validates WhatsApp JIDs and optional fallback', () => {
    assert.equal(validateJid('synthetic-contact@s.whatsapp.net').ok, true);
    assert.equal(validateJid('group-1@g.us').ok, true);
    assert.equal(validateJid('bad@example.com').ok, false);
    assert.deepEqual(normalizeOptionalJid(undefined).value, 'manual');
});

test('cleans text, limits query limits, tags, and collected errors', () => {
    assert.equal(cleanText('  hello     world  ', 20), 'hello world');
    assert.equal(parseLimit('5000', 100, 1000), 1000);
    assert.equal(parseLimit('bad', 25, 1000), 25);
    assert.deepEqual(parseTags([' alpha ', 'beta', '', 123]), ['alpha', 'beta']);

    const required = validateRequiredText('', 'operatorName');
    assert.deepEqual(collectErrors(required), ['operatorName is required']);
});

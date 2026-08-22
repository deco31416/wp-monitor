import test from 'node:test';
import assert from 'node:assert/strict';
import {
    hashPassword,
    validatePassword,
    validateUsername,
    verifyPassword,
} from '../src/password-security.js';

test('normalizes a valid single-operator username without accepting unsafe forms', () => {
    assert.deepEqual(validateUsername('  Admin.Operator  '), {
        username: 'Admin.Operator',
        normalizedUsername: 'admin.operator',
    });
    assert.equal(validateUsername('ab'), null);
    assert.equal(validateUsername('-operator'), null);
    assert.equal(validateUsername('operator<script>'), null);
    assert.equal(validateUsername('operator name'), null);
});

test('enforces a length-based password policy while allowing password-manager output', () => {
    assert.equal(validatePassword('too-short'), false);
    assert.equal(validatePassword('a'.repeat(14)), false);
    assert.equal(validatePassword('a'.repeat(15)), true);
    assert.equal(validatePassword('correct horse battery staple 2026'), true);
    assert.equal(validatePassword('a'.repeat(129)), false);
});

test('hashes passwords with a unique salt and verifies only the exact password', async () => {
    const password = 'correct horse battery staple 2026';
    const first = await hashPassword(password);
    const second = await hashPassword(password);

    assert.match(first, /^scrypt\$1\$131072\$8\$1\$/);
    assert.notEqual(first, second);
    assert.equal(first.includes(password), false);
    assert.equal(await verifyPassword(password, first), true);
    assert.equal(await verifyPassword('incorrect horse battery staple 2026', first), false);
});

test('rejects malformed or attacker-controlled password hash parameters', async () => {
    assert.equal(await verifyPassword('correct horse battery staple 2026', 'not-a-hash'), false);
    assert.equal(await verifyPassword(
        'correct horse battery staple 2026',
        'scrypt$1$999999999$8$1$c2FsdHNhbHRzYWx0c2FsdA$ZmFrZQ',
    ), false);
});

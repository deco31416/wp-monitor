import test from 'node:test';
import assert from 'node:assert/strict';
import { WhatsAppIdentityResolver } from '../src/whatsapp-identity.js';

const FIRST = '573001112233@s.whatsapp.net';
const SECOND = '573009998877@s.whatsapp.net';

test('canonicalizes a plain number and every PN device to the base account', () => {
    const resolver = new WhatsAppIdentityResolver();
    assert.equal(resolver.canonicalize('573001112233'), FIRST);
    assert.equal(resolver.canonicalize('573001112233:17@s.whatsapp.net'), FIRST);
    assert.equal(resolver.canonicalize(FIRST), FIRST);
});

test('learns an authenticated LID mapping after normalizing both device suffixes', () => {
    const resolver = new WhatsAppIdentityResolver();
    assert.equal(resolver.canonicalize('123456:7@lid'), null);
    assert.equal(resolver.learn({
        lid: '123456:2@lid',
        pn: '573001112233:4@s.whatsapp.net',
    }), true);
    assert.equal(resolver.learn({ lid: '123456@lid', pn: FIRST }), false);
    assert.equal(resolver.canonicalize('123456:7@lid'), FIRST);
});

test('uses a stored mapping only as a validated fallback and clears learned state', () => {
    const resolver = new WhatsAppIdentityResolver({
        resolveStoredLid: lid => lid === '123456@lid' ? FIRST : 'foreign@g.us',
    });
    assert.equal(resolver.canonicalize('123456@lid'), FIRST);
    assert.equal(resolver.canonicalize('654321@lid'), null);

    resolver.learn({ lid: '123456@lid', pn: SECOND });
    assert.equal(resolver.canonicalize('123456@lid'), SECOND);
    resolver.clear();
    assert.equal(resolver.canonicalize('123456@lid'), FIRST);
});

test('resolves only an active individual contact without crossing identities', () => {
    const resolver = new WhatsAppIdentityResolver();
    const active = new Set([SECOND]);
    assert.equal(resolver.resolveActive([
        '573001112233:3@s.whatsapp.net',
        '12345-67890@g.us',
        '573009998877:8@s.whatsapp.net',
    ], jid => active.has(jid)), SECOND);
    assert.equal(resolver.resolveActive([FIRST, '123456@lid'], jid => active.has(jid)), null);
});

test('rejects malformed namespaces and invalid LID mappings', () => {
    const resolver = new WhatsAppIdentityResolver();
    assert.equal(resolver.canonicalize('invalid'), null);
    assert.equal(resolver.canonicalize('123@newsletter'), null);
    assert.equal(resolver.learn({ lid: FIRST, pn: SECOND }), false);
    assert.equal(resolver.learn({ lid: '123456@lid', pn: '12345-67890@g.us' }), false);
});

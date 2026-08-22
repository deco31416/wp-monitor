import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MessageReceiptRegistry,
    fingerprintMessageId,
    messageReceiptLabel,
    normalizeReceiptStatus,
} from '../src/message-receipts.js';

const JID = 'synthetic-contact@s.whatsapp.net';

test('records monotonic accepted, delivered and read transitions', () => {
    const registry = new MessageReceiptRegistry();
    registry.registerOutgoing('message-1', JID, 1_000);

    assert.equal(registry.recordStatus('message-1', JID, 2, 1_050)?.state, 'accepted');
    assert.equal(registry.recordStatus('message-1', JID, 3, 1_200)?.latencyMs, 200);
    assert.equal(registry.recordStatus('message-1', JID, 4, 1_300)?.state, 'read');
    assert.equal(registry.recordStatus('message-1', JID, 3, 1_400), null);
    assert.equal(registry.recordStatus('message-1', JID, 4, 1_500), null);
});

test('correlates a receipt that arrives before the outgoing event', () => {
    const registry = new MessageReceiptRegistry();
    assert.equal(registry.recordStatus('message-2', JID, 3, 2_000), null);
    const transition = registry.registerOutgoing('message-2', JID, 2_100);

    assert.equal(transition?.state, 'delivered');
    assert.equal(transition?.latencyMs, null);
});

test('rejects unknown states and receipts attributed to another contact', () => {
    const registry = new MessageReceiptRegistry();
    registry.registerOutgoing('message-3', JID, 1_000);

    assert.equal(registry.recordStatus('message-3', JID, 1, 1_100), null);
    assert.equal(registry.recordStatus('message-3', 'other@s.whatsapp.net', 3, 1_100), null);
    assert.equal(normalizeReceiptStatus(5), 5);
    assert.equal(normalizeReceiptStatus(6), null);
});

test('keeps pending receipts isolated when two contacts reuse the same message id', () => {
    const registry = new MessageReceiptRegistry();
    const otherJid = 'other@s.whatsapp.net';

    assert.equal(registry.recordStatus('shared-id', otherJid, 5, 1_000), null);
    assert.equal(registry.recordStatus('shared-id', JID, 3, 1_100), null);

    const targetTransition = registry.registerOutgoing('shared-id', JID, 1_200);
    const otherTransition = registry.registerOutgoing('shared-id', otherJid, 1_300);

    assert.equal(targetTransition?.state, 'delivered');
    assert.equal(otherTransition?.state, 'played');
});

test('clears receipt correlation state when a contact session ends', () => {
    const registry = new MessageReceiptRegistry();
    registry.registerOutgoing('outgoing-id', JID, 1_000);
    registry.recordStatus('pending-id', JID, 3, 1_100);

    registry.clearContact(JID);

    assert.equal(registry.recordStatus('outgoing-id', JID, 3, 1_200), null);
    assert.equal(registry.registerOutgoing('pending-id', JID, 1_300), null);
});

test('uses customer-facing labels and never exposes the raw message id', () => {
    assert.equal(messageReceiptLabel(3), 'Mensaje entregado');
    const fingerprint = fingerprintMessageId('sensitive-message-id');
    assert.equal(fingerprint.length, 24);
    assert.equal(fingerprint.includes('sensitive-message-id'), false);
});

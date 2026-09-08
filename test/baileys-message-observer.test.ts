import test from 'node:test';
import assert from 'node:assert/strict';
import type { BaileysEventMap } from 'baileys';
import {
    BaileysMessageObserver,
    type ObservedMessageActivity,
} from '../src/baileys-message-observer.js';
import type { MessageReceiptTransition } from '../src/message-receipts.js';
import { registerSyntheticProbeId } from '../src/probe-messages.js';

const JID = '573001112233@s.whatsapp.net';

function upsert(input: {
    id: string;
    fromMe?: boolean;
    type?: 'append' | 'notify';
    message?: Record<string, unknown>;
    timestamp?: number;
    jid?: string;
}): BaileysEventMap['messages.upsert'] {
    return {
        type: input.type ?? 'notify',
        messages: [{
            key: { id: input.id, remoteJid: input.jid ?? JID, fromMe: input.fromMe ?? false },
            messageTimestamp: input.timestamp ?? 1_788_284_800,
            message: input.message ?? { conversation: 'content deliberately ignored' },
        }],
    } as unknown as BaileysEventMap['messages.upsert'];
}

function updates(id: string, status: number, jid = JID): BaileysEventMap['messages.update'] {
    return [{
        key: { id, remoteJid: jid, fromMe: true },
        update: { status },
    }] as unknown as BaileysEventMap['messages.update'];
}

function fixture(now = 1_788_284_801_000) {
    const messages: ObservedMessageActivity[] = [];
    const receipts: MessageReceiptTransition[] = [];
    const observer = new BaileysMessageObserver({
        resolveTrackedJid: value => value === JID ? JID : null,
        onMessage: activity => { messages.push(activity); },
        onReceipt: receipt => { receipts.push(receipt); },
        now: () => now,
    });
    return { observer, messages, receipts };
}

test('records a current incoming message without retaining its content', async () => {
    const { observer, messages } = fixture();
    await observer.handleUpsert(upsert({ id: 'incoming-1' }));

    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.direction, 'incoming');
    assert.equal(messages[0]?.messageType, 'text');
    assert.equal(messages[0]?.upsertType, 'notify');
    assert.equal(JSON.stringify(messages).includes('content deliberately ignored'), false);
    assert.equal(JSON.stringify(messages).includes('incoming-1'), false);
});

test('ignores append history, synthetic probes and untracked contacts', async () => {
    const { observer, messages } = fixture();
    registerSyntheticProbeId('synthetic-probe-1');

    await observer.handleUpsert(upsert({ id: 'history-1', type: 'append' }));
    await observer.handleUpsert(upsert({ id: 'synthetic-probe-1' }));
    await observer.handleUpsert(upsert({ id: 'foreign-1', jid: '573009998877@s.whatsapp.net' }));

    assert.deepEqual(messages, []);
});

test('correlates monotonic receipts for an outgoing observed message', async () => {
    let now = 1_788_284_801_000;
    const messages: ObservedMessageActivity[] = [];
    const receipts: MessageReceiptTransition[] = [];
    const observer = new BaileysMessageObserver({
        resolveTrackedJid: value => value === JID ? JID : null,
        onMessage: activity => { messages.push(activity); },
        onReceipt: receipt => { receipts.push(receipt); },
        now: () => now,
    });

    await observer.handleUpsert(upsert({ id: 'outgoing-1', fromMe: true }));
    now += 250;
    await observer.handleUpdates(updates('outgoing-1', 3));
    now += 250;
    await observer.handleUpdates(updates('outgoing-1', 3));

    assert.equal(messages.length, 1);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0]?.state, 'delivered');
    assert.equal(receipts[0]?.latencyMs, 250);
});

test('ignores protocol-only payloads and invalid receipt attribution', async () => {
    const { observer, messages, receipts } = fixture();
    await observer.handleUpsert(upsert({
        id: 'protocol-1',
        message: { protocolMessage: { type: 0 } },
    }));
    await observer.handleUpdates(updates('unknown-outgoing', 3));
    await observer.handleUpdates(updates('foreign-outgoing', 3, '573009998877@s.whatsapp.net'));

    assert.deepEqual(messages, []);
    assert.deepEqual(receipts, []);
});

test('does not publish an accepted transition when the outgoing message was suppressed', async () => {
    const receipts: MessageReceiptTransition[] = [];
    const observer = new BaileysMessageObserver({
        resolveTrackedJid: value => value === JID ? JID : null,
        onMessage: () => false,
        onReceipt: receipt => { receipts.push(receipt); },
    });

    await observer.handleUpsert(upsert({ id: 'duplicate-outgoing', fromMe: true }));
    assert.deepEqual(receipts, []);
});

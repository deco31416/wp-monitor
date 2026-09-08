import test from 'node:test';
import assert from 'node:assert/strict';
import type { BaileysEventMap } from 'baileys';
import {
    BaileysCallObserver,
    type ObservedBaileysCall,
} from '../src/baileys-call-observer.js';

const TARGET = '573001112233@s.whatsapp.net';
const SELF = '573009998877@s.whatsapp.net';

function calls(value: unknown): BaileysEventMap['call'] {
    return value as BaileysEventMap['call'];
}

function call(id: string, overrides: Record<string, unknown> = {}) {
    return {
        chatId: TARGET,
        from: TARGET,
        id,
        date: new Date('2026-09-01T21:44:00.000Z'),
        status: 'offer',
        offline: false,
        ...overrides,
    };
}

function fixture() {
    const observed: ObservedBaileysCall[] = [];
    const observer = new BaileysCallObserver({
        resolveTrackedJid: value => value === TARGET ? TARGET : null,
        onCall: async event => { observed.push(event); },
    });
    return { observer, observed };
}

test('attributes an authorized direct call exactly once', async () => {
    const { observer, observed } = fixture();
    await observer.handleCalls(calls([call('call-1')]));

    assert.equal(observed.length, 1);
    assert.equal(observed[0]?.jid, TARGET);
    assert.equal(observed[0]?.call.id, 'call-1');
});

test('resolves outgoing calls through chatId when from identifies the linked account', async () => {
    const { observer, observed } = fixture();
    await observer.handleCalls(calls([call('call-2', { from: SELF })]));

    assert.equal(observed.length, 1);
    assert.equal(observed[0]?.jid, TARGET);
});

test('falls back to callerPn but rejects foreign and group calls', async () => {
    const { observer, observed } = fixture();
    await observer.handleCalls(calls([
        call('call-3', { from: SELF, chatId: SELF, callerPn: TARGET }),
        call('call-foreign', { from: SELF, chatId: SELF }),
        call('call-group', { isGroup: true }),
    ]));

    assert.deepEqual(observed.map(event => event.call.id), ['call-3']);
});

test('preserves protocol order for asynchronous lifecycle handling', async () => {
    const order: string[] = [];
    const observer = new BaileysCallObserver({
        resolveTrackedJid: value => value === TARGET ? TARGET : null,
        onCall: async event => {
            await Promise.resolve();
            order.push(event.call.status);
        },
    });

    await observer.handleCalls(calls([
        call('call-4', { status: 'offer' }),
        call('call-4', { status: 'accept' }),
        call('call-4', { status: 'terminate' }),
    ]));

    assert.deepEqual(order, ['offer', 'accept', 'terminate']);
});

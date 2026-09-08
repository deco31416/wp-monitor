import test from 'node:test';
import assert from 'node:assert/strict';
import { WhatsAppTracker } from '../src/tracker.js';

function eventBus() {
    return {
        on: () => undefined,
        off: () => undefined,
    };
}

test('tracker is passive by default and stops without leaving a loop timer alive', async () => {
    let sentMessages = 0;
    let presenceSubscriptions = 0;
    const sock = {
        ev: eventBus(),
        ws: eventBus(),
        presenceSubscribe: async () => {
            presenceSubscriptions += 1;
        },
        sendMessage: async () => {
            sentMessages += 1;
            return { key: { id: 'synthetic-envelope', remoteJid: 'synthetic@s.whatsapp.net' } };
        },
    };
    const tracker = new WhatsAppTracker(sock as any, 'synthetic@s.whatsapp.net');

    await tracker.startTracking();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(tracker.getProbeMethod(), 'passive');
    assert.equal(sentMessages, 0);
    assert.equal(presenceSubscriptions, 0);

    tracker.stopTracking();
});

test('an experimental probe runs only after an explicit mode change', async () => {
    let sentMessages = 0;
    const sock = {
        ev: eventBus(),
        ws: eventBus(),
        presenceSubscribe: async () => undefined,
        sendMessage: async () => {
            sentMessages += 1;
            return { key: { id: 'synthetic-envelope', remoteJid: 'synthetic@s.whatsapp.net' } };
        },
    };
    const tracker = new WhatsAppTracker(sock as any, 'synthetic@s.whatsapp.net', false, {
        intervalMs: 10_000,
        timeoutMs: 3_000,
    });

    await tracker.startTracking();
    tracker.setProbeMethod('delete');
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(sentMessages, 1);

    tracker.stopTracking();
});

test('technical receipt updates are explicitly routed without per-contact listeners', async () => {
    const eventListeners: string[] = [];
    const rawListeners: string[] = [];
    const updates: any[] = [];
    const sock = {
        ev: {
            on: (name: string) => { eventListeners.push(name); },
            off: () => undefined,
        },
        ws: {
            on: (name: string) => { rawListeners.push(name); },
            off: () => undefined,
        },
        sendMessage: async () => ({
            key: { id: 'synthetic-envelope', remoteJid: 'synthetic@s.whatsapp.net' },
        }),
    };
    const tracker = new WhatsAppTracker(sock as any, 'synthetic@s.whatsapp.net', false, {
        intervalMs: 10_000,
        timeoutMs: 3_000,
    });
    tracker.onUpdate = value => { updates.push(value); };

    try {
        await tracker.startTracking();
        tracker.setProbeMethod('delete');
        await new Promise<void>(resolve => setImmediate(resolve));
        tracker.handleMessageUpdates([{
            key: {
                id: 'synthetic-envelope',
                remoteJid: 'synthetic@s.whatsapp.net',
                fromMe: true,
            },
            update: { status: 3 },
        }] as any);

        assert.deepEqual(eventListeners, []);
        assert.deepEqual(rawListeners, []);
        assert.equal(updates.some(value => value.sampleKind === 'probe' && value.devices.length === 1), true);
    } finally {
        tracker.stopTracking();
    }
});

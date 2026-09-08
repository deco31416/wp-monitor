import test from 'node:test';
import assert from 'node:assert/strict';
import type { BaileysEventEmitter, BaileysEventMap } from 'baileys';
import {
    BAILEYS_OBSERVATION_EVENTS,
    BaileysObservationHub,
    type BaileysObservationEventName,
    type BaileysObservationHubEvent,
} from '../src/baileys-observation-hub.js';

type UnknownListener = (payload: unknown) => void;

class FakeBaileysEmitter {
    private readonly listeners = new Map<string, Set<UnknownListener>>();

    readonly typed = this as unknown as BaileysEventEmitter;

    on(event: string, listener: UnknownListener): void {
        const eventListeners = this.listeners.get(event) ?? new Set<UnknownListener>();
        eventListeners.add(listener);
        this.listeners.set(event, eventListeners);
    }

    off(event: string, listener: UnknownListener): void {
        this.listeners.get(event)?.delete(listener);
    }

    emit<Name extends BaileysObservationEventName>(event: Name, payload: BaileysEventMap[Name]): void {
        for (const listener of this.listeners.get(event) ?? []) listener(payload);
    }

    listenerCount(event: BaileysObservationEventName): number {
        return this.listeners.get(event)?.size ?? 0;
    }
}

function emptyPayload<Name extends BaileysObservationEventName>(
    _event: Name,
): BaileysEventMap[Name] {
    return [] as unknown as BaileysEventMap[Name];
}

test('attaches exactly one stable listener per observation event', () => {
    const emitter = new FakeBaileysEmitter();
    const received: BaileysObservationHubEvent[] = [];
    const hub = new BaileysObservationHub(event => {
        received.push(event);
    }, assert.fail);

    assert.equal(hub.attach(emitter.typed), true);
    assert.equal(hub.attach(emitter.typed), false);
    for (const event of BAILEYS_OBSERVATION_EVENTS) {
        assert.equal(emitter.listenerCount(event), 1, event);
    }

    emitter.emit('call', []);
    assert.equal(received.length, 1);
    assert.equal(received[0]?.name, 'call');
});

test('replacing the emitter detaches the complete previous listener set', () => {
    const previous = new FakeBaileysEmitter();
    const current = new FakeBaileysEmitter();
    const received: BaileysObservationHubEvent[] = [];
    const hub = new BaileysObservationHub(event => {
        received.push(event);
    }, assert.fail);

    hub.attach(previous.typed);
    hub.attach(current.typed);

    for (const event of BAILEYS_OBSERVATION_EVENTS) {
        assert.equal(previous.listenerCount(event), 0, `previous ${event}`);
        assert.equal(current.listenerCount(event), 1, `current ${event}`);
    }
    previous.emit('call', []);
    current.emit('call', []);
    assert.equal(received.length, 1);
});

test('detach is idempotent and prevents further dispatch', () => {
    const emitter = new FakeBaileysEmitter();
    const received: BaileysObservationHubEvent[] = [];
    const hub = new BaileysObservationHub(event => {
        received.push(event);
    }, assert.fail);

    hub.attach(emitter.typed);
    assert.equal(hub.isAttached(), true);
    assert.equal(hub.detach(), true);
    assert.equal(hub.detach(), false);
    assert.equal(hub.isAttached(), false);

    for (const event of BAILEYS_OBSERVATION_EVENTS) {
        assert.equal(emitter.listenerCount(event), 0, event);
        emitter.emit(event, emptyPayload(event));
    }
    assert.deepEqual(received, []);
});

test('reports synchronous and asynchronous sink failures without unhandled rejection', async () => {
    const emitter = new FakeBaileysEmitter();
    const failures: Array<{ operation: string; event: string }> = [];
    let attempt = 0;
    const hub = new BaileysObservationHub(
        () => {
            attempt += 1;
            if (attempt === 1) throw new Error('sync failure');
            return Promise.reject(new Error('async failure'));
        },
        (_error, context) => failures.push(context),
    );

    hub.attach(emitter.typed);
    emitter.emit('call', []);
    emitter.emit('call', []);
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(failures, [
        { operation: 'dispatch', event: 'call' },
        { operation: 'dispatch', event: 'call' },
    ]);
});

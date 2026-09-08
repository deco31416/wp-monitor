import test from 'node:test';
import assert from 'node:assert/strict';
import { BaileysRawNodeHub, type BaileysRawNodeEmitter } from '../src/baileys-raw-node-hub.js';

type EventName = 'CB:call' | 'CB:receipt';
type Listener = (node: unknown) => void;

class FakeEmitter implements BaileysRawNodeEmitter {
    private readonly listeners = new Map<EventName, Set<Listener>>();

    on(event: EventName, listener: Listener): void {
        const current = this.listeners.get(event) ?? new Set<Listener>();
        current.add(listener);
        this.listeners.set(event, current);
    }

    off(event: EventName, listener: Listener): void {
        this.listeners.get(event)?.delete(listener);
    }

    emit(event: EventName, node: unknown): void {
        for (const listener of this.listeners.get(event) ?? []) listener(node);
    }

    count(event: EventName): number {
        return this.listeners.get(event)?.size ?? 0;
    }
}

function fixture() {
    const calls: unknown[] = [];
    const receipts: unknown[] = [];
    const errors: string[] = [];
    const hub = new BaileysRawNodeHub({
        onCallNode: node => { calls.push(node); },
        onReceiptNode: node => { receipts.push(node); },
        onError: (_error, context) => { errors.push(`${context.operation}:${context.event}`); },
    });
    return { hub, calls, receipts, errors };
}

test('attaches one listener for each required raw node', () => {
    const { hub, calls, receipts } = fixture();
    const emitter = new FakeEmitter();
    assert.equal(hub.attach(emitter), true);
    assert.equal(hub.attach(emitter), false);
    assert.equal(emitter.count('CB:call'), 1);
    assert.equal(emitter.count('CB:receipt'), 1);

    emitter.emit('CB:call', { id: 'call' });
    emitter.emit('CB:receipt', { id: 'receipt' });
    assert.equal(calls.length, 1);
    assert.equal(receipts.length, 1);
});

test('replacing an emitter detaches both listeners from the previous socket', () => {
    const { hub, calls } = fixture();
    const previous = new FakeEmitter();
    const current = new FakeEmitter();
    hub.attach(previous);
    hub.attach(current);

    assert.equal(previous.count('CB:call'), 0);
    assert.equal(previous.count('CB:receipt'), 0);
    previous.emit('CB:call', {});
    current.emit('CB:call', {});
    assert.equal(calls.length, 1);
});

test('detach is idempotent and prevents later raw dispatch', () => {
    const { hub, calls, receipts, errors } = fixture();
    const emitter = new FakeEmitter();
    hub.attach(emitter);
    assert.equal(hub.detach(), true);
    assert.equal(hub.detach(), false);
    emitter.emit('CB:call', {});
    emitter.emit('CB:receipt', {});

    assert.deepEqual(calls, []);
    assert.deepEqual(receipts, []);
    assert.deepEqual(errors, []);
});

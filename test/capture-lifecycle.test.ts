import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { closeCaptureSessionIfOpened, NativeCaptureCloseBarrier } from '../src/capture-lifecycle.js';

test('does not close a native capture session when open failed', () => {
    let closeCalls = 0;

    const closed = closeCaptureSessionIfOpened({ close: () => { closeCalls += 1; } }, false);

    assert.equal(closeCalls, 0);
    assert.equal(closed, false);
});

test('closes a native capture session after open succeeded', () => {
    let closeCalls = 0;

    const closed = closeCaptureSessionIfOpened({ close: () => { closeCalls += 1; } }, true);

    assert.equal(closeCalls, 1);
    assert.equal(closed, true);
});

test('contains close errors from an opened native capture session', () => {
    const expected = new Error('synthetic close failure');
    let observed: unknown;

    assert.doesNotThrow(() => closeCaptureSessionIfOpened(
        { close: () => { throw expected; } },
        true,
        error => { observed = error; },
    ));
    assert.equal(observed, expected);
});

test('does not leave a pending barrier when the native binding declines close', async () => {
    const barrier = new NativeCaptureCloseBarrier();
    const session = new EventEmitter() as EventEmitter & { close(): boolean };
    session.close = () => false;

    assert.equal(barrier.close(session, true), false);
    await barrier.wait();
    assert.equal(barrier.isPending, false);
});

test('blocks native capture reuse until libuv close callbacks have drained', async () => {
    const barrier = new NativeCaptureCloseBarrier();
    const session = new EventEmitter() as EventEmitter & { close(): void };
    let closeCalls = 0;
    session.close = () => { closeCalls += 1; };

    assert.equal(barrier.close(session, true), true);
    assert.equal(closeCalls, 1);
    assert.equal(barrier.isPending, true);

    let completed = false;
    void barrier.wait().then(() => { completed = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(completed, false);

    session.emit('close');
    await barrier.wait();
    assert.equal(barrier.isPending, false);
});

test('clears the native close barrier when closing throws', async () => {
    const barrier = new NativeCaptureCloseBarrier();
    const expected = new Error('synthetic close failure');
    let observed: unknown;

    assert.equal(barrier.close(
        { close: () => { throw expected; } },
        true,
        error => { observed = error; },
    ), false);
    await barrier.wait();

    assert.equal(observed, expected);
    assert.equal(barrier.isPending, false);
});

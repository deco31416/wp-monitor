import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PresenceCoverageLifecycle,
    type PresenceCoveragePersistence,
} from '../src/presence-coverage-lifecycle.js';

function deferred(): { promise: Promise<boolean>; resolve: (value: boolean) => void } {
    let resolve!: (value: boolean) => void;
    const promise = new Promise<boolean>(done => { resolve = done; });
    return { promise, resolve };
}

function persistence(overrides: Partial<PresenceCoveragePersistence> = {}): PresenceCoveragePersistence {
    return {
        open: async () => true,
        confirm: async () => true,
        close: async () => true,
        ...overrides,
    };
}

const openInput = {
    caseId: 'CASE-1',
    trackingSessionId: 'tracking-1',
    jid: '573000000000@s.whatsapp.net',
    openReason: 'tracking_start' as const,
};

test('serializes open and close operations for the same tracking session', async () => {
    const openGate = deferred();
    const operations: string[] = [];
    const lifecycle = new PresenceCoverageLifecycle(persistence({
        open: async () => {
            operations.push('open:start');
            const result = await openGate.promise;
            operations.push('open:end');
            return result;
        },
        close: async () => {
            operations.push('close');
            return true;
        },
    }));

    const opening = lifecycle.open(openInput);
    const closing = lifecycle.close(openInput.trackingSessionId, 'connection_lost');
    await Promise.resolve();
    assert.deepEqual(operations, ['open:start']);

    openGate.resolve(true);
    assert.equal(await opening, true);
    assert.equal(await closing, true);
    assert.deepEqual(operations, ['open:start', 'open:end', 'close']);
    assert.equal(lifecycle.isActive(openInput.trackingSessionId), false);
});

test('restores the active marker when a close cannot be persisted', async () => {
    const lifecycle = new PresenceCoverageLifecycle(persistence({ close: async () => false }));
    assert.equal(await lifecycle.open(openInput), true);
    assert.equal(lifecycle.isActive(openInput.trackingSessionId), true);

    assert.equal(await lifecycle.close(openInput.trackingSessionId, 'tracking_stopped'), false);
    assert.equal(lifecycle.isActive(openInput.trackingSessionId), true);
});

test('does not confirm a session without a durable open window', async () => {
    let confirmationCalls = 0;
    const lifecycle = new PresenceCoverageLifecycle(persistence({
        confirm: async () => {
            confirmationCalls += 1;
            return true;
        },
    }));

    assert.equal(await lifecycle.confirm('tracking-missing'), false);
    assert.equal(confirmationCalls, 0);
});

test('allows different tracking sessions to progress independently', async () => {
    const firstGate = deferred();
    const completed: string[] = [];
    const lifecycle = new PresenceCoverageLifecycle(persistence({
        open: async input => {
            if (input.trackingSessionId === 'tracking-1') await firstGate.promise;
            completed.push(input.trackingSessionId);
            return true;
        },
    }));

    const first = lifecycle.open(openInput);
    const second = lifecycle.open({ ...openInput, trackingSessionId: 'tracking-2' });
    assert.equal(await second, true);
    assert.deepEqual(completed, ['tracking-2']);

    firstGate.resolve(true);
    assert.equal(await first, true);
    assert.deepEqual(completed, ['tracking-2', 'tracking-1']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { OrderedDurablePublicationQueue } from '../src/durable-publication.js';

test('persists before publishing an inserted observation', async () => {
    const queue = new OrderedDurablePublicationQueue();
    const order: string[] = [];
    const result = await queue.enqueue('contact-a', async () => {
        order.push('persist');
        return 'inserted';
    }, () => {
        order.push('publish');
        return 'visible';
    });

    assert.deepEqual(order, ['persist', 'publish']);
    assert.deepEqual(result, { persistence: 'inserted', published: true, value: 'visible' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(queue.pendingKeys(), 0);
});

test('suppresses duplicate and failed observations', async () => {
    const queue = new OrderedDurablePublicationQueue();
    let publications = 0;
    const duplicate = await queue.enqueue('contact-a', async () => 'duplicate', () => {
        publications += 1;
    });
    const failed = await queue.enqueue('contact-a', async () => 'failed', () => {
        publications += 1;
    });

    assert.equal(publications, 0);
    assert.equal(duplicate.published, false);
    assert.equal(failed.published, false);
});

test('publishes explicitly non-durable technical state', async () => {
    const queue = new OrderedDurablePublicationQueue();
    const result = await queue.enqueue('contact-a', async () => 'not_required', () => 42);
    assert.deepEqual(result, { persistence: 'not_required', published: true, value: 42 });
});

test('preserves order per contact while unrelated contacts remain concurrent', async () => {
    const queue = new OrderedDurablePublicationQueue();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });

    const first = queue.enqueue('contact-a', async () => {
        order.push('a1-persist-start');
        await firstGate;
        order.push('a1-persist-end');
        return 'inserted';
    }, () => { order.push('a1-publish'); });
    const second = queue.enqueue('contact-a', async () => {
        order.push('a2-persist');
        return 'inserted';
    }, () => { order.push('a2-publish'); });
    const other = queue.enqueue('contact-b', async () => {
        order.push('b-persist');
        return 'inserted';
    }, () => { order.push('b-publish'); });

    await other;
    assert.deepEqual(order, ['a1-persist-start', 'b-persist', 'b-publish']);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(order.slice(3), ['a1-persist-end', 'a1-publish', 'a2-persist', 'a2-publish']);
});

test('contains persistence and publication exceptions without blocking later work', async () => {
    const queue = new OrderedDurablePublicationQueue();
    const persistFailure = await queue.enqueue('contact-a', async () => {
        throw new Error('mongo unavailable');
    }, () => assert.fail('must not publish'));
    const publishFailure = await queue.enqueue('contact-a', async () => 'inserted', () => {
        throw new Error('socket unavailable');
    });
    const recovered = await queue.enqueue('contact-a', async () => 'inserted', () => 'recovered');

    assert.equal(persistFailure.persistence, 'failed');
    assert.equal(persistFailure.error instanceof Error, true);
    assert.equal(publishFailure.published, false);
    assert.equal(recovered.value, 'recovered');
});

test('drains pending evidence with a bounded shutdown timeout', async () => {
    const queue = new OrderedDurablePublicationQueue();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const pending = queue.enqueue('contact-a', async () => {
        await gate;
        return 'inserted';
    }, () => undefined);

    assert.equal(await queue.drain(5), false);
    release();
    await pending;
    assert.equal(await queue.drain(100), true);
});

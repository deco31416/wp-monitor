import test from 'node:test';
import assert from 'node:assert/strict';
import { BoundedPacketCollector } from '../src/bounded-packet-collector.js';

test('stores exactly its configured packet limit and declares later observations', () => {
    const collector = new BoundedPacketCollector<number>(50_000);
    for (let packet = 0; packet < 50_000; packet += 1) {
        assert.equal(collector.add(packet), true);
    }

    assert.equal(collector.add(50_000), false);
    assert.equal(collector.add(50_001), false);
    assert.equal(collector.packets().length, 50_000);
    assert.deepEqual(collector.stats(), {
        packetLimit: 50_000,
        storedPackets: 50_000,
        droppedPackets: 2,
        totalObservedPackets: 50_002,
        truncated: true,
    });
});

test('reset removes the previous capture without changing its hard limit', () => {
    const collector = new BoundedPacketCollector<string>(2);
    collector.add('first');
    collector.add('second');
    collector.add('discarded');
    collector.clear();

    assert.deepEqual(collector.packets(), []);
    assert.deepEqual(collector.stats(), {
        packetLimit: 2,
        storedPackets: 0,
        droppedPackets: 0,
        totalObservedPackets: 0,
        truncated: false,
    });
    assert.equal(collector.add('new-capture'), true);
});

test('rejects unsafe collection limits', () => {
    for (const limit of [0, -1, 1.5, 1_000_001, Number.NaN]) {
        assert.throws(() => new BoundedPacketCollector(limit), /Packet collection limit/);
    }
});

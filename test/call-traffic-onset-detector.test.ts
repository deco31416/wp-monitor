import assert from 'node:assert/strict';
import test from 'node:test';
import { CallTrafficOnsetDetector } from '../src/call-traffic-onset-detector.js';

const START = new Date('2026-09-10T12:00:00.000Z');

function sample(offsetMs: number, overrides: Partial<Parameters<CallTrafficOnsetDetector['observe']>[0]> = {}) {
    return {
        observedAt: new Date(START.getTime() + offsetMs),
        endpointKey: '203.0.113.10',
        protocol: 17 as const,
        direction: 'outbound' as const,
        bytes: 400,
        ...overrides,
    };
}

test('detects a sustained bidirectional UDP increase after a fixed baseline', () => {
    const detector = new CallTrafficOnsetDetector(START);
    detector.observe(sample(1_000, { direction: 'outbound' }));
    detector.observe(sample(2_000, { direction: 'inbound' }));

    let detection = null;
    for (let index = 0; index < 14; index++) {
        detection = detector.observe(sample(5_100 + index * 150, {
            direction: index % 2 === 0 ? 'inbound' : 'outbound',
        })) ?? detection;
    }

    assert.deepEqual(detection, {
        detectorVersion: 1,
        onsetAt: new Date(START.getTime() + 5_100),
        detectedAt: new Date(START.getTime() + 7_050),
    });
});

test('does not trigger for TCP, one-way bursts, short spikes or baseline-level traffic', () => {
    const tcp = new CallTrafficOnsetDetector(START);
    const oneWay = new CallTrafficOnsetDetector(START);
    const spike = new CallTrafficOnsetDetector(START);
    const steady = new CallTrafficOnsetDetector(START);

    for (let index = 0; index < 16; index++) {
        const offset = 5_100 + index * 140;
        assert.equal(tcp.observe(sample(offset, { protocol: 6, direction: index % 2 ? 'inbound' : 'outbound' })), null);
        assert.equal(oneWay.observe(sample(offset)), null);
    }
    for (let index = 0; index < 20; index++) {
        assert.equal(spike.observe(sample(6_500 + index * 50, {
            direction: index % 2 ? 'inbound' : 'outbound',
        })), null);
    }

    for (let index = 0; index < 20; index++) {
        steady.observe(sample(index * 150, { direction: index % 2 ? 'inbound' : 'outbound' }));
    }
    for (let index = 0; index < 20; index++) {
        assert.equal(steady.observe(sample(5_100 + index * 450, {
            direction: index % 2 ? 'inbound' : 'outbound',
        })), null);
    }
});

test('isolates endpoints, ignores regressive timestamps and emits only one immutable decision', () => {
    const detector = new CallTrafficOnsetDetector(START);
    assert.equal(detector.observe(sample(4_000)), null);
    assert.equal(detector.observe(sample(3_000)), null);

    let detection = null;
    for (let index = 0; index < 16; index++) {
        detection = detector.observe(sample(5_100 + index * 140, {
            endpointKey: index % 2 ? '203.0.113.10' : '203.0.113.11',
            direction: index % 4 < 2 ? 'inbound' : 'outbound',
        })) ?? detection;
    }
    assert.equal(detection, null);

    for (let index = 0; index < 16; index++) {
        detection = detector.observe(sample(8_000 + index * 140, {
            direction: index % 2 ? 'inbound' : 'outbound',
        })) ?? detection;
    }
    assert.ok(detection);
    assert.equal(detector.observe(sample(20_000)), null);
});

test('rejects invalid detector bounds instead of running with ambiguous thresholds', () => {
    assert.throws(() => new CallTrafficOnsetDetector(new Date(Number.NaN)), /startedAt/);
    assert.throws(() => new CallTrafficOnsetDetector(START, { observationWindowMs: 0 }), /observationWindowMs/);
    assert.throws(() => new CallTrafficOnsetDetector(START, { minimumPackets: 1.5 }), /minimumPackets/);
    assert.throws(() => new CallTrafficOnsetDetector(START, { packetRateMultiplier: 0.5 }), /packetRateMultiplier/);
    assert.throws(() => new CallTrafficOnsetDetector(START, {
        observationWindowMs: 500,
        minimumSustainedDurationMs: 1_000,
    }), /minimumSustainedDurationMs/);
});

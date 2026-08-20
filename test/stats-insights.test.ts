import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStatsInsights } from '../src/stats-insights.js';
import type { MeasurementSample } from '../src/stats-insights.js';

const NOW = new Date('2026-06-18T12:00:00.000Z');

function sample(hoursAgo: number, state = 'Online', rtt = 80): MeasurementSample {
    return {
        state,
        rtt,
        timestamp: new Date(NOW.getTime() - hoursAgo * 3600_000),
    };
}

test('builds period trends for 24h, 7d, and 30d', () => {
    const insights = buildStatsInsights([
        sample(1, 'Online', 100),
        sample(2, 'OFFLINE', 200),
        sample(26, 'OFFLINE', 120),
        sample(30, 'OFFLINE', 120),
        sample(72, 'Online', 90),
        sample(12 * 24, 'Online', 70),
    ], NOW);

    const last24h = insights.periods.find(period => period.key === 'last24h');
    const last7d = insights.periods.find(period => period.key === 'last7d');
    const last30d = insights.periods.find(period => period.key === 'last30d');

    assert.equal(last24h?.totalMeasurements, 2);
    assert.equal(last24h?.conclusiveMeasurements, 1);
    assert.equal(last24h?.inconclusiveMeasurements, 1);
    assert.equal(last24h?.onlinePct, 100);
    assert.equal(last24h?.avgRtt, 100);
    assert.equal(last24h?.changeOnlinePct, null);
    assert.equal(last7d?.totalMeasurements, 5);
    assert.equal(last30d?.totalMeasurements, 6);
});

test('calculates daily coverage and reliability from recent samples', () => {
    const samples: MeasurementSample[] = [];
    for (let day = 0; day < 7; day++) {
        for (let i = 0; i < 90; i++) {
            samples.push(sample(day * 24 + i / 10, i % 3 === 0 ? 'Online' : 'Standby', 75));
        }
    }

    const insights = buildStatsInsights(samples, NOW);

    assert.equal(insights.dailyCoverage.length, 14);
    assert.ok(insights.dailyCoverage.filter(day => day.totalMeasurements > 0).length >= 7);
    assert.equal(insights.reliability.label, 'strong');
    assert.ok(insights.reliability.reasonCodes.includes('ENOUGH_7D_VOLUME'));
    assert.ok(insights.reliability.score >= 75);
});

test('excludes inconclusive samples from online percentage and no-ack timeouts from average RTT', () => {
    const insights = buildStatsInsights([
        sample(1, 'Online', 100),
        sample(2, 'Standby', 120),
        sample(3, 'Calibrating...', 90),
        sample(4, 'NO_ACK', 10_000),
        sample(5, 'Unknown', 8_000),
    ], NOW);
    const last24h = insights.periods.find(period => period.key === 'last24h');

    assert.equal(last24h?.totalMeasurements, 5);
    assert.equal(last24h?.conclusiveMeasurements, 2);
    assert.equal(last24h?.inconclusiveMeasurements, 3);
    assert.equal(last24h?.acknowledgedRttMeasurements, 3);
    assert.equal(last24h?.onlinePct, 50);
    assert.equal(last24h?.avgRtt, 103);
});

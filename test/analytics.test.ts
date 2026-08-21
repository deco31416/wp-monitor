import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateIntelligenceCoverage, getAvailabilityProfile, getWeeklyHeatmap, setAnalyticsDb } from '../src/analytics.js';

function useAggregateRows(rows: unknown[]): void {
    setAnalyticsDb({
        collection: () => ({
            aggregate: () => ({
                toArray: async () => rows,
            }),
        }),
    } as any);
}

test('availability ignores inconclusive hour slots instead of treating them as inactivity', async () => {
    useAggregateRows([
        { _id: { date: '2026-06-17', hour: 9 }, onlineCount: 1, conclusiveCount: 1, total: 1 },
        { _id: { date: '2026-06-18', hour: 9 }, onlineCount: 0, conclusiveCount: 1, total: 1 },
        { _id: { date: '2026-06-18', hour: 10 }, onlineCount: 0, conclusiveCount: 0, total: 5 },
        { _id: { date: '2026-06-18', hour: 99 }, onlineCount: 1, conclusiveCount: 1, total: 1 },
    ]);

    const profile = await getAvailabilityProfile('synthetic@s.whatsapp.net', 14);

    assert.equal(profile.hourly[9], 0.5);
    assert.equal(profile.hourlyConclusiveDays[9], 2);
    assert.equal(profile.hourlyConclusiveDays[10], 0);
    assert.equal(profile.globalScore, 50);
    assert.deepEqual(profile.inactiveHours, []);
    assert.equal(profile.daysAnalyzed, 2);
});

test('weekly heatmap separates conclusive data points from all attempts', async () => {
    useAggregateRows([
        { _id: { date: '2026-06-15', dow: 2, hour: 9 }, onlineCount: 1, conclusiveCount: 2, total: 5 },
        { _id: { date: '2026-06-22', dow: 2, hour: 9 }, onlineCount: 1, conclusiveCount: 2, total: 5 },
        { _id: { date: '2026-06-23', dow: 3, hour: 10 }, onlineCount: 0, conclusiveCount: 0, total: 6 },
        { _id: { date: '2026-06-23', dow: 8, hour: 30 }, onlineCount: 1, conclusiveCount: 1, total: 7 },
    ]);

    const heatmap = await getWeeklyHeatmap('synthetic@s.whatsapp.net', 4);

    assert.equal(heatmap.matrix[1]?.[9], 0.5);
    assert.equal(heatmap.conclusiveMatrix[1]?.[9], 4);
    assert.equal(heatmap.conclusiveMatrix[2]?.[10], 0);
    assert.equal(heatmap.totalDataPoints, 4);
    assert.equal(heatmap.totalAttempts, 16);
    assert.equal(heatmap.weeksAnalyzed, 2);
});

test('behavioral intelligence stays unavailable until coverage is sufficient', () => {
    const tooFewMeasurements = evaluateIntelligenceCoverage(99, 900, 14);
    assert.equal(tooFewMeasurements.available, false);
    assert.equal(tooFewMeasurements.reason, 'insufficient_conclusive_measurements');

    const tooFewDays = evaluateIntelligenceCoverage(100, 100, 2);
    assert.equal(tooFewDays.available, false);
    assert.equal(tooFewDays.reason, 'insufficient_active_days');

    const sufficient = evaluateIntelligenceCoverage(100, 100, 3);
    assert.equal(sufficient.available, true);
    assert.equal(sufficient.reason, 'sufficient');
});

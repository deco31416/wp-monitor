import { describe, expect, test } from 'vitest';
import type { ObservedActivityEvent } from './types';
import { buildObservedActivityPatterns } from './observed-patterns';

function event(
    source: ObservedActivityEvent['source'],
    timestampUtc: string,
): ObservedActivityEvent {
    return {
        source,
        type: source === 'call' ? 'call_completed' : 'outgoing',
        label: source === 'call' ? 'Llamada contestada y finalizada' : 'Mensaje enviado',
        confidence: 'high',
        timestamp: timestampUtc,
        timestampUtc,
    };
}

describe('observed activity patterns', () => {
    test('groups commercial activity using the selected display timezone', () => {
        const result = buildObservedActivityPatterns([
            event('message', '2026-09-01T20:15:00.000Z'),
            event('receipt', '2026-09-01T20:25:00.000Z'),
            event('call', '2026-09-02T04:10:00.000Z'),
        ], 'America/Bogota');

        expect(result.totalActivities).toBe(3);
        expect(result.activeDays).toBe(1);
        expect(result.hourly[15]).toBe(2);
        expect(result.hourly[23]).toBe(1);
        expect(result.weekly[2]?.[15]).toBe(2);
        expect(result.peakHour).toBe(15);
        expect(result.peakDay).toBe(2);
        expect(result.sourceCounts).toEqual({ presence: 0, call: 1, message: 1, receipt: 1 });
        expect(result.dayParts).toEqual({ dawn: 0, morning: 0, afternoon: 2, evening: 1 });
    });

    test('ignores malformed timestamps instead of manufacturing pattern data', () => {
        const result = buildObservedActivityPatterns([
            event('message', 'invalid'),
        ], 'UTC');

        expect(result.totalActivities).toBe(0);
        expect(result.activeDays).toBe(0);
        expect(result.peakHour).toBeNull();
        expect(result.peakDay).toBeNull();
        expect(result.firstActivityAt).toBeNull();
        expect(result.lastActivityAt).toBeNull();
    });
});

import type { ObservedActivityEvent } from './types';

export const OBSERVED_DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const;

export interface ObservedActivityPatterns {
    totalActivities: number;
    activeDays: number;
    hourly: number[];
    weekly: number[][];
    peakHour: number | null;
    peakHourCount: number;
    peakDay: number | null;
    peakDayCount: number;
    sourceCounts: {
        presence: number;
        call: number;
        message: number;
        receipt: number;
    };
    topSource: keyof ObservedActivityPatterns['sourceCounts'] | null;
    dayParts: {
        dawn: number;
        morning: number;
        afternoon: number;
        evening: number;
    };
    firstActivityAt: string | null;
    lastActivityAt: string | null;
    timeZone: string;
}

interface ZonedParts {
    dateKey: string;
    weekday: number;
    hour: number;
}

function getZonedParts(value: string, timeZone: string): ZonedParts | null {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;

    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hourCycle: 'h23',
        weekday: 'short',
    });
    const parts = Object.fromEntries(
        formatter.formatToParts(date).map(part => [part.type, part.value]),
    );
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday || '');
    const hour = Number(parts.hour);
    if (weekday < 0 || !Number.isInteger(hour) || hour < 0 || hour > 23) return null;

    return {
        dateKey: `${parts.year}-${parts.month}-${parts.day}`,
        weekday,
        hour,
    };
}

function maxIndex(values: number[]): number | null {
    const max = Math.max(...values);
    if (max <= 0) return null;
    return values.indexOf(max);
}

export function buildObservedActivityPatterns(
    events: ObservedActivityEvent[],
    timeZone: string,
): ObservedActivityPatterns {
    const hourly = new Array<number>(24).fill(0);
    const weekly = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    const sourceCounts: ObservedActivityPatterns['sourceCounts'] = {
        presence: 0,
        call: 0,
        message: 0,
        receipt: 0,
    };
    const activeDates = new Set<string>();
    const validTimestamps: Array<{ iso: string; epoch: number }> = [];

    events.forEach(event => {
        const timestamp = event.timestampUtc || event.timestamp;
        const zoned = getZonedParts(timestamp, timeZone);
        const epoch = new Date(timestamp).getTime();
        if (!zoned || !Number.isFinite(epoch)) return;

        hourly[zoned.hour] = (hourly[zoned.hour] || 0) + 1;
        const row = weekly[zoned.weekday];
        if (row) row[zoned.hour] = (row[zoned.hour] || 0) + 1;
        activeDates.add(zoned.dateKey);
        sourceCounts[event.source] += 1;
        validTimestamps.push({ iso: timestamp, epoch });
    });

    const dayTotals = weekly.map(row => row.reduce((sum, value) => sum + value, 0));
    const peakHour = maxIndex(hourly);
    const peakDay = maxIndex(dayTotals);
    const topSourceEntry = (Object.entries(sourceCounts) as Array<[
        keyof ObservedActivityPatterns['sourceCounts'],
        number,
    ]>).sort((left, right) => right[1] - left[1])[0];
    validTimestamps.sort((left, right) => left.epoch - right.epoch);

    return {
        totalActivities: validTimestamps.length,
        activeDays: activeDates.size,
        hourly,
        weekly,
        peakHour,
        peakHourCount: peakHour === null ? 0 : hourly[peakHour] || 0,
        peakDay,
        peakDayCount: peakDay === null ? 0 : dayTotals[peakDay] || 0,
        sourceCounts,
        topSource: topSourceEntry && topSourceEntry[1] > 0 ? topSourceEntry[0] : null,
        dayParts: {
            dawn: hourly.slice(0, 6).reduce((sum, value) => sum + value, 0),
            morning: hourly.slice(6, 12).reduce((sum, value) => sum + value, 0),
            afternoon: hourly.slice(12, 18).reduce((sum, value) => sum + value, 0),
            evening: hourly.slice(18, 24).reduce((sum, value) => sum + value, 0),
        },
        firstActivityAt: validTimestamps[0]?.iso || null,
        lastActivityAt: validTimestamps[validTimestamps.length - 1]?.iso || null,
        timeZone,
    };
}

export type PresenceCoverageOpenReason = 'tracking_start' | 'connection_restore';
export type PresenceCoverageCloseReason =
    | 'connection_lost'
    | 'tracking_stopped'
    | 'backend_shutdown'
    | 'subscription_replaced'
    | 'restore_failed';

export interface PresenceCoverageWindowLike {
    startedAt: Date;
    lastConfirmedAt: Date;
    endedAt: Date | null;
}

export interface PresenceCoverageSummary {
    sessionStartedAt: Date;
    evaluatedAt: Date;
    firstObservedAt: Date | null;
    lastObservedAt: Date | null;
    elapsedMs: number;
    coveredMs: number;
    interruptedMs: number;
    coveragePct: number;
    windowCount: number;
    interruptionCount: number;
    currentState: 'observing' | 'interrupted';
}

function validTime(value: Date): number | null {
    const timestamp = value instanceof Date ? value.getTime() : Number.NaN;
    return Number.isFinite(timestamp) ? timestamp : null;
}

export function buildPresenceCoverageSummary(
    sessionStartedAt: Date,
    evaluatedAt: Date,
    windows: readonly PresenceCoverageWindowLike[],
): PresenceCoverageSummary {
    const sessionStart = validTime(sessionStartedAt);
    const evaluated = validTime(evaluatedAt);
    if (sessionStart === null || evaluated === null || evaluated < sessionStart) {
        throw new TypeError('Presence coverage requires a valid non-negative observation interval');
    }

    const normalized = windows.flatMap(window => {
        const start = validTime(window.startedAt);
        const confirmed = validTime(window.lastConfirmedAt);
        const ended = window.endedAt ? validTime(window.endedAt) : null;
        if (start === null || confirmed === null || (window.endedAt && ended === null)) return [];
        const clippedStart = Math.max(sessionStart, start);
        const rawEnd = ended ?? confirmed;
        const clippedEnd = Math.min(evaluated, Math.max(start, Math.min(rawEnd, confirmed)));
        if (clippedEnd < clippedStart) return [];
        return [{ start: clippedStart, end: clippedEnd, open: window.endedAt === null }];
    }).sort((left, right) => left.start - right.start || left.end - right.end);

    const merged: Array<{ start: number; end: number }> = [];
    for (const interval of normalized) {
        const current = merged[merged.length - 1];
        if (!current || interval.start > current.end) {
            merged.push({ start: interval.start, end: interval.end });
        } else {
            current.end = Math.max(current.end, interval.end);
        }
    }

    const elapsedMs = evaluated - sessionStart;
    const coveredMs = merged.reduce((total, interval) => total + Math.max(0, interval.end - interval.start), 0);
    const interruptedMs = Math.max(0, elapsedMs - coveredMs);
    const coveragePct = elapsedMs > 0 ? Math.round((coveredMs / elapsedMs) * 100) : 0;
    const hasOpenWindow = normalized.some(interval => interval.open);

    return {
        sessionStartedAt: new Date(sessionStart),
        evaluatedAt: new Date(evaluated),
        firstObservedAt: merged[0] ? new Date(merged[0].start) : null,
        lastObservedAt: merged.length > 0 ? new Date(merged[merged.length - 1]!.end) : null,
        elapsedMs,
        coveredMs,
        interruptedMs,
        coveragePct,
        windowCount: normalized.length,
        interruptionCount: (() => {
            if (elapsedMs === 0) return 0;
            let count = 0;
            let cursor = sessionStart;
            for (const interval of merged) {
                if (interval.start > cursor) count += 1;
                cursor = Math.max(cursor, interval.end);
            }
            if (cursor < evaluated) count += 1;
            return count;
        })(),
        currentState: hasOpenWindow ? 'observing' : 'interrupted',
    };
}

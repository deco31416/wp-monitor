import {
    hasAcknowledgedTrackerRtt,
    isConclusiveTrackerState,
    isOnlineTrackerState,
} from './tracker-signals.js';

export interface MeasurementSample {
    state: string;
    rtt: number;
    timestamp: Date;
}

export interface PeriodInsight {
    key: 'last24h' | 'last7d' | 'last30d';
    label: string;
    totalMeasurements: number;
    conclusiveMeasurements: number;
    inconclusiveMeasurements: number;
    acknowledgedRttMeasurements: number;
    onlineMeasurements: number;
    onlinePct: number;
    avgRtt: number;
    changeOnlinePct: number | null;
}

export interface DailyCoverageInsight {
    date: string;
    totalMeasurements: number;
    conclusiveMeasurements: number;
    conclusivePct: number;
    onlinePct: number;
    coverageScore: number;
}

export interface ReliabilityInsight {
    score: number;
    label: 'initial' | 'usable' | 'strong';
    reasonCodes: string[];
}

export interface StatsInsights {
    periods: PeriodInsight[];
    dailyCoverage: DailyCoverageInsight[];
    reliability: ReliabilityInsight;
}

interface WindowConfig {
    key: PeriodInsight['key'];
    label: string;
    ms: number;
}

const DAY_MS = 86_400_000;
const WINDOWS: WindowConfig[] = [
    { key: 'last24h', label: '24h', ms: DAY_MS },
    { key: 'last7d', label: '7d', ms: 7 * DAY_MS },
    { key: 'last30d', label: '30d', ms: 30 * DAY_MS },
];

export function buildStatsInsights(samples: MeasurementSample[], now = new Date()): StatsInsights {
    const normalized = samples
        .filter(sample => sample.timestamp instanceof Date && Number.isFinite(sample.timestamp.getTime()))
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const periods = WINDOWS.map(window => {
        const currentStart = new Date(now.getTime() - window.ms);
        const previousStart = new Date(now.getTime() - window.ms * 2);
        const current = normalized.filter(sample => sample.timestamp >= currentStart && sample.timestamp <= now);
        const previous = normalized.filter(sample => sample.timestamp >= previousStart && sample.timestamp < currentStart);
        const currentSummary = summarizeWindow(current);
        const previousSummary = summarizeWindow(previous);
        const changeOnlinePct = currentSummary.conclusiveMeasurements > 0 && previousSummary.conclusiveMeasurements > 0
            ? currentSummary.onlinePct - previousSummary.onlinePct
            : null;

        return {
            key: window.key,
            label: window.label,
            ...currentSummary,
            changeOnlinePct,
        };
    });

    const dailyCoverage = buildDailyCoverage(normalized, now, 14);
    const reliability = buildReliability(periods, dailyCoverage);

    return { periods, dailyCoverage, reliability };
}

function summarizeWindow(samples: MeasurementSample[]) {
    const totalMeasurements = samples.length;
    const conclusiveSamples = samples.filter(sample => isConclusiveTrackerState(sample.state));
    const acknowledgedRttSamples = samples.filter(sample => (
        hasAcknowledgedTrackerRtt(sample.state) && Number.isFinite(sample.rtt)
    ));
    const conclusiveMeasurements = conclusiveSamples.length;
    const inconclusiveMeasurements = totalMeasurements - conclusiveMeasurements;
    const acknowledgedRttMeasurements = acknowledgedRttSamples.length;
    const onlineMeasurements = conclusiveSamples.filter(sample => isOnlineTrackerState(sample.state)).length;
    const onlinePct = conclusiveMeasurements > 0 ? Math.round((onlineMeasurements / conclusiveMeasurements) * 100) : 0;
    const avgRtt = acknowledgedRttMeasurements > 0
        ? Math.round(acknowledgedRttSamples.reduce((sum, sample) => sum + sample.rtt, 0) / acknowledgedRttMeasurements)
        : 0;

    return {
        totalMeasurements,
        conclusiveMeasurements,
        inconclusiveMeasurements,
        acknowledgedRttMeasurements,
        onlineMeasurements,
        onlinePct,
        avgRtt,
    };
}

function buildDailyCoverage(samples: MeasurementSample[], now: Date, days: number): DailyCoverageInsight[] {
    return Array.from({ length: days }, (_, index) => {
        const dayStart = startOfUtcDay(new Date(now.getTime() - (days - 1 - index) * DAY_MS));
        const dayEnd = new Date(dayStart.getTime() + DAY_MS);
        const daySamples = samples.filter(sample => sample.timestamp >= dayStart && sample.timestamp < dayEnd);
        const summary = summarizeWindow(daySamples);

        return {
            date: dayStart.toISOString().slice(0, 10),
            totalMeasurements: summary.totalMeasurements,
            conclusiveMeasurements: summary.conclusiveMeasurements,
            conclusivePct: summary.totalMeasurements > 0
                ? Math.round((summary.conclusiveMeasurements / summary.totalMeasurements) * 100)
                : 0,
            onlinePct: summary.onlinePct,
            coverageScore: Math.min(100, Math.round((summary.conclusiveMeasurements / 120) * 100)),
        };
    });
}

function buildReliability(periods: PeriodInsight[], dailyCoverage: DailyCoverageInsight[]): ReliabilityInsight {
    const last7d = periods.find(period => period.key === 'last7d');
    const last24h = periods.find(period => period.key === 'last24h');
    const activeDays = dailyCoverage.filter(day => day.conclusiveMeasurements > 0).length;
    const avgDailyCoverage = dailyCoverage.length > 0
        ? dailyCoverage.reduce((sum, day) => sum + day.coverageScore, 0) / dailyCoverage.length
        : 0;

    let score = 0;
    const reasonCodes: string[] = [];

    if ((last7d?.conclusiveMeasurements || 0) >= 500) {
        score += 30;
        reasonCodes.push('ENOUGH_7D_VOLUME');
    }
    if (activeDays >= 5) {
        score += 25;
        reasonCodes.push('MULTI_DAY_COVERAGE');
    }
    if (avgDailyCoverage >= 40) {
        score += 20;
        reasonCodes.push('HEALTHY_DAILY_DENSITY');
    }
    if ((last24h?.conclusiveMeasurements || 0) > 0) {
        score += 15;
        reasonCodes.push('RECENT_SIGNAL');
    }
    if ((last7d?.avgRtt || 0) > 0) {
        score += 10;
        reasonCodes.push('VALID_RTT_SIGNAL');
    }

    const boundedScore = Math.min(100, score);
    const label = boundedScore >= 75 ? 'strong' : boundedScore >= 40 ? 'usable' : 'initial';
    if (reasonCodes.length === 0) reasonCodes.push('INSUFFICIENT_SAMPLE');

    return { score: boundedScore, label, reasonCodes };
}

function startOfUtcDay(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

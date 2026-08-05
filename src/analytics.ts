/**
 * Behavior Intelligence & Analytics Engine
 *
 * Analyzes WhatsApp activity metadata to build behavioral profiles:
 * - Daily routine detection (wake/sleep times, breaks)
 * - Availability probability model (per-hour online likelihood)
 * - Session statistics (duration, frequency, intensity)
 * - Weekly heatmap (day × hour activity matrix)
 * - Multi-contact correlation analysis
 * - Habit prediction & behavioral clustering
 *
 * Based on publicly observable presence metadata only.
 * No message content is accessed or analyzed.
 *
 * References:
 *   Schnitzler et al., "Hope of Delivery: Extracting User Locations
 *   From Mobile Instant Messengers", NDSS 2023 (arXiv:2210.10523)
 */

import { MongoClient, Db, Collection } from 'mongodb';
import 'dotenv/config';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface Session {
    start: Date;
    end: Date;
    durationSec: number;
    avgRtt: number;
}

export interface DailyRoutine {
    date: string;                    // YYYY-MM-DD
    wakeTime: string | null;         // HH:MM  first online
    sleepTime: string | null;        // HH:MM  last online
    firstOnline: Date | null;
    lastOnline: Date | null;
    sessions: number;
    totalOnlineMin: number;
    peakHour: number;
}

export interface AvailabilityProfile {
    /** 24-element array: probability 0–1 of being online at each hour */
    hourly: number[];
    /** Most likely online hours (probability > 0.5) */
    activeHours: number[];
    /** Least likely online hours */
    inactiveHours: number[];
    /** Overall availability score 0-100 */
    globalScore: number;
    /** Days of data used */
    daysAnalyzed: number;
}

export interface SessionStats {
    totalSessions: number;
    avgDurationSec: number;
    medianDurationSec: number;
    maxDurationSec: number;
    minDurationSec: number;
    avgSessionsPerDay: number;
    totalOnlineMin: number;
    avgDailyOnlineMin: number;
    /** Intensity score: 0–100 (casual → heavy user) */
    intensityScore: number;
}

export interface WeeklyHeatmap {
    /** 7×24 matrix: [dayOfWeek][hour] = activity score 0–1 */
    matrix: number[][];
    /** Day names for labels */
    dayLabels: string[];
    /** Peak slot */
    peakDay: number;
    peakHour: number;
    peakScore: number;
    /** Total data points used */
    totalDataPoints: number;
    weeksAnalyzed: number;
}

export interface HabitProfile {
    estimatedWakeTime: string | null;   // HH:MM average
    estimatedSleepTime: string | null;  // HH:MM average
    estimatedTimezone: string;          // e.g. "UTC-6" inferred
    workHoursOnline: number;            // % online 09-17
    eveningOnline: number;              // % online 18-23
    nightOwlScore: number;              // 0-100, activity after midnight
    consistencyScore: number;           // 0-100, how regular the schedule is
    avgResponseGapSec: number;          // avg gap between offline→online
    dominantPattern: string;            // "early_bird" | "night_owl" | "regular" | "irregular"
    weekdayVsWeekend: {
        weekdayAvgMin: number;
        weekendAvgMin: number;
        difference: string;             // "more_weekday" | "more_weekend" | "similar"
    };
}

export interface CorrelationResult {
    jid1: string;
    jid2: string;
    overlapMinutes: number;
    overlapPercentage: number;
    /** Pearson correlation of hourly patterns (-1 to 1) */
    hourlyCorrelation: number;
    /** Simultaneous online events */
    simultaneousCount: number;
    /** Average delay between one going online and the other */
    avgFollowDelaySec: number | null;
    relationship: 'strong' | 'moderate' | 'weak' | 'none';
}

/* ------------------------------------------------------------------ */
/*  DB connection (reuses same MongoDB)                                */
/* ------------------------------------------------------------------ */

const MONGO_URI = process.env.MONGODB_URI || '';
const DB_NAME = process.env.MONGODB_DB || 'activity-tracker';

let db: Db | null = null;

export async function initAnalytics(): Promise<boolean> {
    if (db) return true;
    if (!MONGO_URI) return false;
    try {
        const client = new MongoClient(MONGO_URI);
        await client.connect();
        db = client.db(DB_NAME);
        console.log('[Analytics] Connected');
        return true;
    } catch {
        return false;
    }
}

/** Allow reusing an already-connected Db instance */
export function setAnalyticsDb(existingDb: Db): void {
    db = existingDb;
}

function col() {
    return db!.collection('measurements');
}

/* ================================================================== */
/*  HELPER — extract sessions from raw measurements                   */
/* ================================================================== */

const SESSION_GAP_MS = 60_000; // 60 s gap = new session

async function extractSessions(jid: string, since: Date): Promise<Session[]> {
    const docs = await col()
        .find({ jid, timestamp: { $gte: since }, state: { $regex: /online/i } })
        .sort({ timestamp: 1 })
        .toArray();

    if (docs.length === 0) return [];

    const sessions: Session[] = [];
    let start = docs[0].timestamp as Date;
    let prev = start;
    let rttSum = (docs[0] as any).rtt || 0;
    let rttCount = 1;

    for (let i = 1; i < docs.length; i++) {
        const ts = docs[i].timestamp as Date;
        const gap = ts.getTime() - prev.getTime();

        if (gap > SESSION_GAP_MS) {
            // Close previous session
            sessions.push({
                start,
                end: prev,
                durationSec: Math.max(1, Math.round((prev.getTime() - start.getTime()) / 1000)),
                avgRtt: rttCount > 0 ? Math.round(rttSum / rttCount) : 0
            });
            start = ts;
            rttSum = 0;
            rttCount = 0;
        }

        rttSum += (docs[i] as any).rtt || 0;
        rttCount++;
        prev = ts;
    }

    // Close last session
    sessions.push({
        start,
        end: prev,
        durationSec: Math.max(1, Math.round((prev.getTime() - start.getTime()) / 1000)),
        avgRtt: rttCount > 0 ? Math.round(rttSum / rttCount) : 0
    });

    return sessions;
}

/* ================================================================== */
/*  1. DAILY ROUTINE                                                  */
/* ================================================================== */

export async function getDailyRoutine(jid: string, days: number = 14): Promise<DailyRoutine[]> {
    if (!db) return [];

    const since = new Date(Date.now() - days * 86_400_000);
    const sessions = await extractSessions(jid, since);
    if (sessions.length === 0) return [];

    // Group sessions by date
    const byDate = new Map<string, Session[]>();
    for (const s of sessions) {
        const dateKey = s.start.toISOString().slice(0, 10);
        if (!byDate.has(dateKey)) byDate.set(dateKey, []);
        byDate.get(dateKey)!.push(s);
    }

    const routines: DailyRoutine[] = [];

    for (const [date, daySessions] of byDate) {
        const first = daySessions[0];
        const last = daySessions[daySessions.length - 1];

        // Compute peak hour
        const hourBuckets = new Array(24).fill(0);
        for (const s of daySessions) {
            hourBuckets[s.start.getUTCHours()] += s.durationSec;
        }
        const peakHour = hourBuckets.indexOf(Math.max(...hourBuckets));

        const totalOnlineSec = daySessions.reduce((s, x) => s + x.durationSec, 0);

        routines.push({
            date,
            wakeTime: fmt(first.start),
            sleepTime: fmt(last.end),
            firstOnline: first.start,
            lastOnline: last.end,
            sessions: daySessions.length,
            totalOnlineMin: Math.round(totalOnlineSec / 60),
            peakHour,
        });
    }

    return routines.sort((a, b) => a.date.localeCompare(b.date));
}

function fmt(d: Date): string {
    return d.toISOString().slice(11, 16); // HH:MM UTC
}

/* ================================================================== */
/*  2. AVAILABILITY PROBABILITY                                       */
/* ================================================================== */

export async function getAvailabilityProfile(jid: string, days: number = 14): Promise<AvailabilityProfile> {
    if (!db) return { hourly: new Array(24).fill(0), activeHours: [], inactiveHours: [], globalScore: 0, daysAnalyzed: 0 };

    const since = new Date(Date.now() - days * 86_400_000);

    // Aggregate: for each (date, hour) pair, was the user online?
    const pipeline = [
        { $match: { jid, timestamp: { $gte: since } } },
        {
            $group: {
                _id: {
                    date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
                    hour: { $hour: '$timestamp' }
                },
                onlineCount: {
                    $sum: { $cond: [{ $regexMatch: { input: '$state', regex: /online/i } }, 1, 0] }
                },
                total: { $sum: 1 }
            }
        }
    ];

    const raw = await col().aggregate(pipeline).toArray();

    // Distinct days
    const distinctDays = new Set(raw.map((r: any) => r._id.date));
    const daysAnalyzed = distinctDays.size || 1;

    // For each hour, count how many days the user was online during that hour
    const hourOnlineDays = new Array(24).fill(0);
    for (const r of raw) {
        if ((r as any).onlineCount > 0) {
            hourOnlineDays[(r as any)._id.hour]++;
        }
    }

    const hourly = hourOnlineDays.map(count => parseFloat((count / daysAnalyzed).toFixed(3)));
    const activeHours = hourly.map((p, h) => p >= 0.5 ? h : -1).filter(h => h >= 0);
    const inactiveHours = hourly.map((p, h) => p < 0.1 ? h : -1).filter(h => h >= 0);
    const globalScore = Math.round((hourly.reduce((a, b) => a + b, 0) / 24) * 100);

    return { hourly, activeHours, inactiveHours, globalScore, daysAnalyzed };
}

/* ================================================================== */
/*  3. SESSION STATISTICS                                             */
/* ================================================================== */

export async function getSessionStats(jid: string, days: number = 14): Promise<SessionStats> {
    const empty: SessionStats = {
        totalSessions: 0, avgDurationSec: 0, medianDurationSec: 0,
        maxDurationSec: 0, minDurationSec: 0, avgSessionsPerDay: 0,
        totalOnlineMin: 0, avgDailyOnlineMin: 0, intensityScore: 0,
    };
    if (!db) return empty;

    const since = new Date(Date.now() - days * 86_400_000);
    const sessions = await extractSessions(jid, since);
    if (sessions.length === 0) return empty;

    const durations = sessions.map(s => s.durationSec).sort((a, b) => a - b);
    const totalSec = durations.reduce((a, b) => a + b, 0);

    // Distinct tracked days
    const distinctDays = new Set(sessions.map(s => s.start.toISOString().slice(0, 10)));
    const daysCount = Math.max(1, distinctDays.size);

    const totalOnlineMin = Math.round(totalSec / 60);
    const avgDailyOnlineMin = Math.round(totalOnlineMin / daysCount);

    // Intensity: daily avg minutes / 120 (2h = max benchmark) × 100
    const intensityScore = Math.min(100, Math.round((avgDailyOnlineMin / 120) * 100));

    return {
        totalSessions: sessions.length,
        avgDurationSec: Math.round(totalSec / sessions.length),
        medianDurationSec: durations[Math.floor(durations.length / 2)],
        maxDurationSec: durations[durations.length - 1],
        minDurationSec: durations[0],
        avgSessionsPerDay: parseFloat((sessions.length / daysCount).toFixed(1)),
        totalOnlineMin,
        avgDailyOnlineMin,
        intensityScore,
    };
}

/* ================================================================== */
/*  4. WEEKLY HEATMAP (7 × 24)                                       */
/* ================================================================== */

export async function getWeeklyHeatmap(jid: string, weeks: number = 4): Promise<WeeklyHeatmap> {
    const dayLabels = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const emptyMatrix = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const empty: WeeklyHeatmap = {
        matrix: emptyMatrix, dayLabels, peakDay: 0, peakHour: 0, peakScore: 0,
        totalDataPoints: 0, weeksAnalyzed: 0
    };
    if (!db) return empty;

    const since = new Date(Date.now() - weeks * 7 * 86_400_000);

    const pipeline = [
        { $match: { jid, timestamp: { $gte: since } } },
        {
            $group: {
                _id: {
                    dow: { $dayOfWeek: '$timestamp' }, // 1=Sun .. 7=Sat
                    hour: { $hour: '$timestamp' }
                },
                onlineCount: {
                    $sum: { $cond: [{ $regexMatch: { input: '$state', regex: /online/i } }, 1, 0] }
                },
                total: { $sum: 1 }
            }
        }
    ];

    const raw = await col().aggregate(pipeline).toArray();
    if (raw.length === 0) return empty;

    // Fill matrix — normalize as fraction of total measurements in that slot
    const matrix = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const countMatrix = Array.from({ length: 7 }, () => new Array(24).fill(0));
    let totalDataPoints = 0;

    for (const r of raw) {
        const d = ((r as any)._id.dow - 1) % 7; // 0=Sun
        const h = (r as any)._id.hour;
        const total = (r as any).total;
        const online = (r as any).onlineCount;
        matrix[d][h] = total > 0 ? parseFloat((online / total).toFixed(3)) : 0;
        countMatrix[d][h] = total;
        totalDataPoints += total;
    }

    // Peak
    let peakDay = 0, peakHour = 0, peakScore = 0;
    for (let d = 0; d < 7; d++) {
        for (let h = 0; h < 24; h++) {
            if (matrix[d][h] > peakScore) {
                peakScore = matrix[d][h];
                peakDay = d;
                peakHour = h;
            }
        }
    }

    // Distinct weeks
    const distinctWeeks = new Set(
        raw.map((r: any) => {
            // Approximate week number from the data
            return `${r._id.dow}`;
        })
    );

    return {
        matrix, dayLabels, peakDay, peakHour, peakScore: parseFloat(peakScore.toFixed(3)),
        totalDataPoints,
        weeksAnalyzed: Math.max(1, Math.ceil((Date.now() - since.getTime()) / (7 * 86_400_000)))
    };
}

/* ================================================================== */
/*  5. HABIT PROFILE                                                  */
/* ================================================================== */

export async function getHabitProfile(jid: string, days: number = 14): Promise<HabitProfile> {
    if (!db) return defaultHabit();

    const [routine, availability, sessStats] = await Promise.all([
        getDailyRoutine(jid, days),
        getAvailabilityProfile(jid, days),
        getSessionStats(jid, days),
    ]);

    if (routine.length === 0) return defaultHabit();

    // Average wake / sleep times
    const wakeMins: number[] = [];
    const sleepMins: number[] = [];

    for (const r of routine) {
        if (r.wakeTime) wakeMins.push(timeToMinutes(r.wakeTime));
        if (r.sleepTime) sleepMins.push(timeToMinutes(r.sleepTime));
    }

    const avgWake = wakeMins.length > 0 ? Math.round(wakeMins.reduce((a, b) => a + b, 0) / wakeMins.length) : null;
    const avgSleep = sleepMins.length > 0 ? Math.round(sleepMins.reduce((a, b) => a + b, 0) / sleepMins.length) : null;

    // Estimate timezone from wake pattern
    // If avg wake is ~13:00 UTC, likely UTC-6 (wakes ~07:00 local)
    const estimatedTimezone = avgWake !== null ? estimateTZ(avgWake) : 'UTC';

    // Work hours online (09-17 UTC)
    const workHourProbs = availability.hourly.slice(9, 17);
    const workHoursOnline = Math.round((workHourProbs.reduce((a, b) => a + b, 0) / 8) * 100);

    // Evening online (18-23)
    const eveningProbs = availability.hourly.slice(18, 24);
    const eveningOnline = Math.round((eveningProbs.reduce((a, b) => a + b, 0) / 6) * 100);

    // Night owl (00-05)
    const nightProbs = availability.hourly.slice(0, 5);
    const nightOwlScore = Math.round((nightProbs.reduce((a, b) => a + b, 0) / 5) * 100);

    // Consistency = how similar daily online minutes are (low stddev = high consistency)
    const dailyMins = routine.map(r => r.totalOnlineMin);
    const avgDaily = dailyMins.reduce((a, b) => a + b, 0) / dailyMins.length;
    const variance = dailyMins.reduce((s, m) => s + (m - avgDaily) ** 2, 0) / dailyMins.length;
    const stddev = Math.sqrt(variance);
    const cv = avgDaily > 0 ? stddev / avgDaily : 1; // coefficient of variation
    const consistencyScore = Math.max(0, Math.min(100, Math.round((1 - cv) * 100)));

    // Response gap: avg offline→online in sessions
    const since = new Date(Date.now() - days * 86_400_000);
    const sessions = await extractSessions(jid, since);
    let gapSum = 0, gapCount = 0;
    for (let i = 1; i < sessions.length; i++) {
        const gap = (sessions[i].start.getTime() - sessions[i - 1].end.getTime()) / 1000;
        if (gap > 0 && gap < 86400) { gapSum += gap; gapCount++; }
    }
    const avgResponseGapSec = gapCount > 0 ? Math.round(gapSum / gapCount) : 0;

    // Dominant pattern
    let dominantPattern: string;
    if (nightOwlScore > 40) dominantPattern = 'night_owl';
    else if (avgWake !== null && avgWake < 420) dominantPattern = 'early_bird'; // before 07:00 UTC
    else if (consistencyScore > 60) dominantPattern = 'regular';
    else dominantPattern = 'irregular';

    // Weekday vs weekend
    const weekdayRoutines = routine.filter(r => {
        const d = new Date(r.date).getUTCDay();
        return d >= 1 && d <= 5;
    });
    const weekendRoutines = routine.filter(r => {
        const d = new Date(r.date).getUTCDay();
        return d === 0 || d === 6;
    });
    const weekdayAvg = weekdayRoutines.length > 0
        ? Math.round(weekdayRoutines.reduce((s, r) => s + r.totalOnlineMin, 0) / weekdayRoutines.length) : 0;
    const weekendAvg = weekendRoutines.length > 0
        ? Math.round(weekendRoutines.reduce((s, r) => s + r.totalOnlineMin, 0) / weekendRoutines.length) : 0;

    const diff = weekdayAvg > 0 && weekendAvg > 0
        ? (weekendAvg > weekdayAvg * 1.2 ? 'more_weekend' : weekdayAvg > weekendAvg * 1.2 ? 'more_weekday' : 'similar')
        : 'similar';

    return {
        estimatedWakeTime: avgWake !== null ? minutesToTime(avgWake) : null,
        estimatedSleepTime: avgSleep !== null ? minutesToTime(avgSleep) : null,
        estimatedTimezone,
        workHoursOnline,
        eveningOnline,
        nightOwlScore,
        consistencyScore,
        avgResponseGapSec,
        dominantPattern,
        weekdayVsWeekend: { weekdayAvgMin: weekdayAvg, weekendAvgMin: weekendAvg, difference: diff }
    };
}

function defaultHabit(): HabitProfile {
    return {
        estimatedWakeTime: null, estimatedSleepTime: null, estimatedTimezone: 'UTC',
        workHoursOnline: 0, eveningOnline: 0, nightOwlScore: 0, consistencyScore: 0,
        avgResponseGapSec: 0, dominantPattern: 'irregular',
        weekdayVsWeekend: { weekdayAvgMin: 0, weekendAvgMin: 0, difference: 'similar' }
    };
}

function timeToMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}

function minutesToTime(min: number): string {
    const h = Math.floor(min / 60) % 24;
    const m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function estimateTZ(avgWakeMinUTC: number): string {
    // Assume people wake between 06:00-08:00 local time → midpoint 07:00
    const localWakeTarget = 7 * 60; // 420 min
    let offsetMin = localWakeTarget - avgWakeMinUTC;
    // Normalize to [-12h, +12h]
    if (offsetMin > 720) offsetMin -= 1440;
    if (offsetMin < -720) offsetMin += 1440;
    const offsetHours = Math.round(offsetMin / 60);
    return offsetHours >= 0 ? `UTC+${offsetHours}` : `UTC${offsetHours}`;
}

/* ================================================================== */
/*  6. MULTI-CONTACT CORRELATION                                      */
/* ================================================================== */

export async function getCorrelation(jid1: string, jid2: string, days: number = 7): Promise<CorrelationResult> {
    const empty: CorrelationResult = {
        jid1, jid2, overlapMinutes: 0, overlapPercentage: 0,
        hourlyCorrelation: 0, simultaneousCount: 0,
        avgFollowDelaySec: null, relationship: 'none'
    };
    if (!db) return empty;

    const since = new Date(Date.now() - days * 86_400_000);

    // Get hourly online profiles for both
    const [p1, p2] = await Promise.all([
        getAvailabilityProfile(jid1, days),
        getAvailabilityProfile(jid2, days),
    ]);

    // Pearson correlation of hourly availability
    const hourlyCorrelation = pearson(p1.hourly, p2.hourly);

    // Get sessions for both and compute overlap
    const [sessions1, sessions2] = await Promise.all([
        extractSessions(jid1, since),
        extractSessions(jid2, since),
    ]);

    let overlapSec = 0;
    let simultaneousCount = 0;

    for (const s1 of sessions1) {
        for (const s2 of sessions2) {
            const overlapStart = Math.max(s1.start.getTime(), s2.start.getTime());
            const overlapEnd = Math.min(s1.end.getTime(), s2.end.getTime());
            if (overlapStart < overlapEnd) {
                overlapSec += (overlapEnd - overlapStart) / 1000;
                simultaneousCount++;
            }
        }
    }

    const totalOnline1 = sessions1.reduce((s, x) => s + x.durationSec, 0);
    const totalOnline2 = sessions2.reduce((s, x) => s + x.durationSec, 0);
    const maxOnline = Math.max(totalOnline1, totalOnline2, 1);
    const overlapPercentage = Math.round((overlapSec / maxOnline) * 100);
    const overlapMinutes = Math.round(overlapSec / 60);

    // Follow delay: after jid1 goes online, how soon does jid2?
    const delays: number[] = [];
    for (const s1 of sessions1) {
        // Find earliest s2 that starts after s1.start (within 10 min)
        const followers = sessions2.filter(
            s2 => s2.start.getTime() > s1.start.getTime() &&
                (s2.start.getTime() - s1.start.getTime()) < 600_000
        );
        if (followers.length > 0) {
            delays.push((followers[0].start.getTime() - s1.start.getTime()) / 1000);
        }
    }
    const avgFollowDelaySec = delays.length > 0 ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : null;

    // Classify relationship
    let relationship: 'strong' | 'moderate' | 'weak' | 'none';
    if (hourlyCorrelation > 0.7 && overlapPercentage > 30) relationship = 'strong';
    else if (hourlyCorrelation > 0.4 || overlapPercentage > 15) relationship = 'moderate';
    else if (hourlyCorrelation > 0.2 || simultaneousCount > 5) relationship = 'weak';
    else relationship = 'none';

    return {
        jid1, jid2, overlapMinutes, overlapPercentage,
        hourlyCorrelation: parseFloat(hourlyCorrelation.toFixed(3)),
        simultaneousCount, avgFollowDelaySec, relationship
    };
}

function pearson(x: number[], y: number[]): number {
    const n = x.length;
    if (n === 0) return 0;
    const mx = x.reduce((a, b) => a + b, 0) / n;
    const my = y.reduce((a, b) => a + b, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
        const xi = x[i] - mx;
        const yi = y[i] - my;
        num += xi * yi;
        dx += xi * xi;
        dy += yi * yi;
    }
    const denom = Math.sqrt(dx * dy);
    return denom === 0 ? 0 : num / denom;
}

/* ================================================================== */
/*  COMPOUND: Full intelligence report                                */
/* ================================================================== */

export async function getFullIntelligence(jid: string, days: number = 14) {
    const [routine, availability, sessionStats, heatmap, habits] = await Promise.all([
        getDailyRoutine(jid, days),
        getAvailabilityProfile(jid, days),
        getSessionStats(jid, days),
        getWeeklyHeatmap(jid, Math.ceil(days / 7)),
        getHabitProfile(jid, days),
    ]);

    return { routine, availability, sessionStats, heatmap, habits };
}

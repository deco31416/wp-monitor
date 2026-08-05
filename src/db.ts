/**
 * MongoDB Persistence Service
 *
 * Stores RTT measurements, contact info, activity history,
 * and call analysis results so data is not lost when the server restarts.
 */

import { MongoClient, Db, Collection } from 'mongodb';
import 'dotenv/config';
import type { CallAnalysisResult } from './call-analyzer.js';
import { buildStatsInsights, StatsInsights } from './stats-insights.js';

// Types
export interface MeasurementDoc {
    jid: string;
    rtt: number;
    avg: number;
    median: number;
    threshold: number;
    state: string;
    devices: Array<{
        jid: string;
        state: string;
        rtt: number;
        avg: number;
    }>;
    deviceCount: number;
    timestamp: Date;
}

export type ActivityEventSource = 'presence' | 'call' | 'message' | 'rtt_probe' | 'system';

export interface ActivityEventDoc {
    jid: string;
    source: ActivityEventSource;
    type: string;
    label: string;
    confidence: 'none' | 'low' | 'medium' | 'high';
    details?: Record<string, unknown>;
    timestamp: Date;
    timestampUtc: string;
}

export interface ContactDoc {
    jid: string;
    number: string;
    contactName: string;
    customName: string | null;
    profilePic: string | null;
    about: string | null;
    aboutSetAt: Date | null;
    isBusinessAccount: boolean;
    businessProfile: {
        description?: string;
        category?: string;
        website?: string;
        email?: string;
        address?: string;
    } | null;
    verifiedOnWhatsApp: boolean;
    pushName: string | null;
    addedAt: Date;
    lastSeen: Date;
    lastProfileUpdate: Date | null;
    isActive: boolean;
}

export interface SessionDoc {
    startedAt: Date;
    endedAt: Date | null;
    contactsTracked: string[];
}

export interface AuditEventDoc {
    caseId: string;
    operatorName: string;
    authorizationNote: string;
    action: string;
    scope: 'network' | 'call' | 'contact' | 'report' | 'system';
    targetJid?: string | null;
    details?: Record<string, unknown>;
    timestamp: Date;
    timestampUtc: string;
}

export type CaseStatus = 'draft' | 'authorized' | 'active' | 'closed' | 'archived';

export interface CaseDoc {
    caseId: string;
    title: string;
    description: string | null;
    status: CaseStatus;
    primaryOperator: string;
    authorizationNote: string;
    tags: string[];
    createdAt: Date;
    updatedAt: Date;
    openedAt: Date | null;
    closedAt: Date | null;
    lastAuditAt: Date | null;
    lastAuditAction: string | null;
}

export type CaseEvidenceType = 'contact' | 'network_capture' | 'call_analysis' | 'report' | 'evidence_package' | 'check_in';

export interface CaseEvidenceLinkDoc {
    caseId: string;
    type: CaseEvidenceType;
    refId: string;
    label: string;
    targetJid?: string | null;
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}

export type CheckInStatus = 'pending' | 'completed' | 'expired' | 'revoked';

export interface CheckInDoc {
    token: string;
    caseId: string;
    operatorName: string;
    authorizationNote: string;
    label: string;
    targetName: string | null;
    targetJid: string | null;
    content?: {
        pageTitle?: string;
        pageDescription?: string;
        ogImageUrl?: string | null;
        brandName?: string;
        accentColor?: string;
        backgroundColor?: string;
        panelColor?: string;
        textColor?: string;
        layout?: 'classic' | 'hero' | 'compact';
        requestGps?: boolean;
        caseLabel?: string;
        operatorLabel?: string;
        checkInLabel?: string;
        expiresLabel?: string;
        consentText?: string;
        submitButtonText?: string;
        successMessage?: string;
        redirectUrl?: string | null;
    };
    status: CheckInStatus;
    createdAt: Date;
    updatedAt: Date;
    expiresAt: Date | null;
    completedAt: Date | null;
    request: {
        ip: string;
        userAgent: string;
        acceptLanguage: string;
        referer: string | null;
    } | null;
    browser: {
        timezone?: string;
        language?: string;
        languages?: string[];
        platform?: string;
        userAgentData?: {
            platform?: string;
            mobile?: boolean;
            brands?: Array<{ brand?: string; version?: string }>;
        };
        device?: {
            type?: 'mobile' | 'tablet' | 'desktop' | 'unknown';
            os?: string;
            browser?: string;
            engine?: string;
            isTouch?: boolean;
            maxTouchPoints?: number;
            hardwareConcurrency?: number;
            deviceMemoryGb?: number;
        };
        viewport?: {
            width: number;
            height: number;
        };
        screen?: {
            width: number;
            height: number;
            pixelRatio: number;
            colorDepth?: number;
            orientation?: string;
        };
        network?: {
            online?: boolean;
            effectiveType?: string;
            downlink?: number;
            rtt?: number;
            saveData?: boolean;
        };
        privacy?: {
            cookiesEnabled?: boolean;
            doNotTrack?: string | null;
        };
    } | null;
    consent: {
        accepted: boolean;
        text: string;
        acceptedAt: Date | null;
    };
    location: {
        permission: 'granted' | 'denied' | 'unavailable' | 'unsupported';
        lat?: number;
        lon?: number;
        accuracy?: number;
        altitude?: number | null;
        altitudeAccuracy?: number | null;
        heading?: number | null;
        speed?: number | null;
        capturedAt?: Date | null;
    } | null;
    consistency?: {
        score: number;
        level: 'high' | 'medium' | 'low';
        summary: string;
        signals: Array<{
            severity: 'ok' | 'info' | 'warning' | 'danger';
            label: string;
            detail: string;
        }>;
    } | null;
    ipEnrichment?: Record<string, unknown> | null;
    hash: string;
}

// Singleton
let client: MongoClient | null = null;
let db: Db | null = null;

let measurements: Collection<MeasurementDoc>;
let activityEvents: Collection<ActivityEventDoc>;
let contacts: Collection<ContactDoc>;
let sessions: Collection<SessionDoc>;
let callAnalyses: Collection<CallAnalysisResult & { savedAt?: Date; updatedAt?: Date }>;
let auditEvents: Collection<AuditEventDoc>;
let caseRecords: Collection<CaseDoc>;
let caseEvidenceLinks: Collection<CaseEvidenceLinkDoc>;
let checkIns: Collection<CheckInDoc>;

const MONGO_URI = process.env.MONGODB_URI || '';
const DB_NAME = process.env.MONGODB_DB || 'activity-tracker';

/**
 * Connect to MongoDB. Returns true if connected, false otherwise.
 * Silently fails if no URI is configured (runs without persistence).
 */
export async function connectDB(): Promise<boolean> {
    if (!MONGO_URI) {
        console.log('[DB] No MONGODB_URI configured — running without persistence');
        return false;
    }

    try {
        client = new MongoClient(MONGO_URI);
        await client.connect();
        db = client.db(DB_NAME);

        measurements = db.collection<MeasurementDoc>('measurements');
        activityEvents = db.collection<ActivityEventDoc>('activity_events');
        contacts = db.collection<ContactDoc>('contacts');
        sessions = db.collection<SessionDoc>('sessions');
        callAnalyses = db.collection<CallAnalysisResult & { savedAt?: Date; updatedAt?: Date }>('call_analyses');
        auditEvents = db.collection<AuditEventDoc>('audit_events');
        caseRecords = db.collection<CaseDoc>('cases');
        caseEvidenceLinks = db.collection<CaseEvidenceLinkDoc>('case_evidence_links');
        checkIns = db.collection<CheckInDoc>('check_ins');

        // Create indexes for efficient queries
        await measurements.createIndex({ jid: 1, timestamp: -1 });
        await measurements.createIndex({ timestamp: 1 }, { expireAfterSeconds: 30 * 24 * 3600 }); // TTL: 30 days
        await activityEvents.createIndex({ jid: 1, timestamp: -1 });
        await activityEvents.createIndex({ source: 1, type: 1, timestamp: -1 });
        await activityEvents.createIndex({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 3600 }); // TTL: 90 days
        await contacts.createIndex({ jid: 1 }, { unique: true });
        await callAnalyses.createIndex({ callId: 1 });
        await callAnalyses.createIndex({ targetJid: 1, startTime: -1 });
        await callAnalyses.createIndex({ startTime: 1 }, { expireAfterSeconds: 90 * 24 * 3600 }); // TTL: 90 days
        await auditEvents.createIndex({ caseId: 1, timestamp: -1 });
        await auditEvents.createIndex({ scope: 1, action: 1, timestamp: -1 });
        await caseRecords.createIndex({ caseId: 1 }, { unique: true });
        await caseRecords.createIndex({ status: 1, updatedAt: -1 });
        await caseEvidenceLinks.createIndex({ caseId: 1, type: 1, updatedAt: -1 });
        await caseEvidenceLinks.createIndex({ caseId: 1, type: 1, refId: 1 }, { unique: true });
        await checkIns.createIndex({ token: 1 }, { unique: true });
        await checkIns.createIndex({ caseId: 1, createdAt: -1 });
        await checkIns.createIndex({ status: 1, expiresAt: 1 });

        console.log('[DB] Connected to MongoDB');
        return true;
    } catch (err) {
        console.error('[DB] Failed to connect to MongoDB:', err);
        client = null;
        db = null;
        return false;
    }
}

/**
 * Check if DB is connected
 */
export function isDBConnected(): boolean {
    return db !== null;
}

/**
 * Save a single RTT measurement
 */
export async function saveMeasurement(data: Omit<MeasurementDoc, 'timestamp'>): Promise<void> {
    if (!db) return;
    try {
        await measurements.insertOne({
            ...data,
            timestamp: new Date()
        });
    } catch (err) {
        console.error('[DB] Error saving measurement:', err);
    }
}

/**
 * Save a high-value observed activity event (presence, call, message).
 * RTT probes remain in the measurements collection to avoid duplicate volume.
 */
export async function saveActivityEvent(data: Omit<ActivityEventDoc, 'timestamp' | 'timestampUtc'> & { timestamp?: Date | number | string }): Promise<void> {
    if (!db) return;
    try {
        const timestamp = data.timestamp ? new Date(data.timestamp) : new Date();
        await activityEvents.insertOne({
            jid: data.jid,
            source: data.source,
            type: data.type,
            label: data.label,
            confidence: data.confidence,
            details: data.details,
            timestamp,
            timestampUtc: timestamp.toISOString(),
        });
    } catch (err) {
        console.error('[DB] Error saving activity event:', err);
    }
}

/**
 * Save/update contact info
 */
export async function saveContact(jid: string, number: string, contactName?: string, profilePic?: string | null, customName?: string | null): Promise<void> {
    if (!db) return;
    try {
        const setFields: Partial<ContactDoc> = {
            jid,
            number,
            ...(contactName && { contactName }),
            ...(profilePic !== undefined && { profilePic }),
            lastSeen: new Date()
        };
        // Only set customName if explicitly provided (not undefined)
        if (customName !== undefined) setFields.customName = customName;

        const setOnInsertFields: Partial<ContactDoc> = {
            addedAt: new Date(),
            about: null,
            aboutSetAt: null,
            isBusinessAccount: false,
            businessProfile: null,
            verifiedOnWhatsApp: true,
            pushName: null,
            lastProfileUpdate: null,
            isActive: true,
        };

        await contacts.updateOne(
            { jid },
            {
                $set: setFields,
                $setOnInsert: setOnInsertFields
            },
            { upsert: true }
        );
    } catch (err) {
        console.error('[DB] Error saving contact:', err);
    }
}

/**
 * Update custom name (alias) for a contact
 */
export async function updateCustomName(jid: string, customName: string | null): Promise<void> {
    if (!db) return;
    try {
        await contacts.updateOne(
            { jid },
            { $set: { customName, lastSeen: new Date() } }
        );
    } catch (err) {
        console.error('[DB] Error updating custom name:', err);
    }
}

/**
 * Update contact profile (about, business info, etc.)
 */
export async function updateContactProfile(jid: string, profile: {
    about?: string | null;
    aboutSetAt?: Date | null;
    isBusinessAccount?: boolean;
    businessProfile?: ContactDoc['businessProfile'];
    pushName?: string | null;
    profilePic?: string | null;
}): Promise<void> {
    if (!db) return;
    try {
        const updateFields: Partial<ContactDoc> = { lastProfileUpdate: new Date() };
        if (profile.about !== undefined) updateFields.about = profile.about;
        if (profile.aboutSetAt !== undefined) updateFields.aboutSetAt = profile.aboutSetAt;
        if (profile.isBusinessAccount !== undefined) updateFields.isBusinessAccount = profile.isBusinessAccount;
        if (profile.businessProfile !== undefined) updateFields.businessProfile = profile.businessProfile;
        if (profile.pushName !== undefined) updateFields.pushName = profile.pushName;
        if (profile.profilePic !== undefined) updateFields.profilePic = profile.profilePic;

        await contacts.updateOne({ jid }, { $set: updateFields });
    } catch (err) {
        console.error('[DB] Error updating contact profile:', err);
    }
}

/**
 * Get a single contact's full profile from the database
 */
export async function getContactProfile(jid: string): Promise<ContactDoc | null> {
    if (!db) return null;
    try {
        return await contacts.findOne({ jid });
    } catch (err) {
        console.error('[DB] Error fetching contact profile:', err);
        return null;
    }
}

/**
 * Get online activity patterns (hourly distribution)
 * Shows what hours of the day the contact is most active
 */
export async function getOnlinePatterns(jid: string): Promise<{
    hourly: Array<{ hour: number; total: number; online: number; pct: number }>;
    peakHour: number;
    avgSessionLength: number;
    totalOnlineMinutes: number;
}> {
    const empty = { hourly: [], peakHour: -1, avgSessionLength: 0, totalOnlineMinutes: 0 };
    if (!db) return empty;
    try {
        // Aggregate measurements by hour of day
        const pipeline = [
            { $match: { jid } },
            {
                $group: {
                    _id: { $hour: '$timestamp' },
                    total: { $sum: 1 },
                    online: {
                        $sum: {
                            $cond: [{ $regexMatch: { input: '$state', regex: /online/i } }, 1, 0]
                        }
                    }
                }
            },
            { $sort: { '_id': 1 } }
        ];

        const results = await measurements.aggregate<{ _id: number; total: number; online: number }>(pipeline).toArray();

        // Build full 24h array
        const hourly = Array.from({ length: 24 }, (_, h) => {
            const found = results.find((r: { _id: number; total: number; online: number }) => r._id === h);
            const total = found ? found.total : 0;
            const online = found ? found.online : 0;
            return { hour: h, total, online, pct: total > 0 ? Math.round((online / total) * 100) : 0 };
        });

        // Find peak hour
        let peakHour = 0;
        let maxOnline = 0;
        for (const h of hourly) {
            if (h.online > maxOnline) {
                maxOnline = h.online;
                peakHour = h.hour;
            }
        }

        // Estimate online sessions = consecutive online measurements
        // Each measurement cycle is ~2-3 seconds (probe interval)
        const onlineDocs = await measurements
            .find({ jid, state: { $regex: /online/i } })
            .sort({ timestamp: 1 })
            .toArray();

        let sessions = 0;
        let totalOnlineSec = 0;
        let sessionStart: Date | null = null;
        let prevTimestamp: Date | null = null;

        for (const doc of onlineDocs) {
            if (!prevTimestamp || (doc.timestamp.getTime() - prevTimestamp.getTime()) > 30000) {
                // New session (gap > 30s)
                if (sessionStart && prevTimestamp) {
                    totalOnlineSec += (prevTimestamp.getTime() - sessionStart.getTime()) / 1000;
                }
                sessions++;
                sessionStart = doc.timestamp;
            }
            prevTimestamp = doc.timestamp;
        }
        // Close last session
        if (sessionStart && prevTimestamp) {
            totalOnlineSec += (prevTimestamp.getTime() - sessionStart.getTime()) / 1000;
        }

        const avgSessionLength = sessions > 0 ? Math.round(totalOnlineSec / sessions) : 0;
        const totalOnlineMinutes = Math.round(totalOnlineSec / 60);

        return { hourly, peakHour, avgSessionLength, totalOnlineMinutes };
    } catch (err) {
        console.error('[DB] Error fetching online patterns:', err);
        return empty;
    }
}

/**
 * Soft-delete a contact (mark as inactive but keep history)
 */
export async function removeContact(jid: string): Promise<void> {
    if (!db) return;
    try {
        await contacts.updateOne({ jid }, { $set: { isActive: false } });
    } catch (err) {
        console.error('[DB] Error removing contact:', err);
    }
}

/**
 * Re-activate a previously tracked contact
 */
export async function reactivateContact(jid: string): Promise<void> {
    if (!db) return;
    try {
        await contacts.updateOne({ jid }, { $set: { isActive: true, lastSeen: new Date() } });
    } catch (err) {
        console.error('[DB] Error reactivating contact:', err);
    }
}

/**
 * Get active contacts (for auto-restore on reconnection)
 * Contacts without isActive field are treated as active (backwards compat)
 */
export async function getActiveContacts(): Promise<ContactDoc[]> {
    if (!db) return [];
    try {
        return await contacts.find({ isActive: { $ne: false } }).toArray();
    } catch (err) {
        console.error('[DB] Error fetching active contacts:', err);
        return [];
    }
}

/**
 * Get recent measurements for a contact (last N entries)
 */
export async function getRecentMeasurements(jid: string, limit: number = 200): Promise<MeasurementDoc[]> {
    if (!db) return [];
    try {
        return await measurements
            .find({ jid })
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray()
            .then(docs => docs.reverse()); // Return in chronological order
    } catch (err) {
        console.error('[DB] Error fetching measurements:', err);
        return [];
    }
}

/**
 * Get all saved contacts
 */
export async function getSavedContacts(): Promise<ContactDoc[]> {
    if (!db) return [];
    try {
        return await contacts.find().toArray();
    } catch (err) {
        console.error('[DB] Error fetching contacts:', err);
        return [];
    }
}

/**
 * Get measurement stats for a contact (summary)
 */
export async function getContactStats(jid: string): Promise<{
    totalMeasurements: number;
    firstSeen: Date | null;
    lastSeen: Date | null;
} | null> {
    if (!db) return null;
    try {
        const stats = await measurements.aggregate([
            { $match: { jid } },
            {
                $group: {
                    _id: '$jid',
                    totalMeasurements: { $sum: 1 },
                    firstSeen: { $min: '$timestamp' },
                    lastSeen: { $max: '$timestamp' }
                }
            }
        ]).toArray();

        if (stats.length === 0) return null;
        return {
            totalMeasurements: stats[0].totalMeasurements,
            firstSeen: stats[0].firstSeen,
            lastSeen: stats[0].lastSeen
        };
    } catch (err) {
        console.error('[DB] Error fetching stats:', err);
        return null;
    }
}

/**
 * Log a session start
 */
export async function logSessionStart(): Promise<string | null> {
    if (!db) return null;
    try {
        const result = await sessions.insertOne({
            startedAt: new Date(),
            endedAt: null,
            contactsTracked: []
        });
        return result.insertedId.toString();
    } catch (err) {
        console.error('[DB] Error logging session:', err);
        return null;
    }
}

/**
 * Get activity state changes (transitions) for a contact
 */
export async function getActivityHistory(jid: string, limit: number = 50): Promise<Array<{
    state: string;
    timestamp: Date;
    rtt: number;
}>> {
    if (!db) return [];
    try {
        // Get measurements and detect state transitions
        const docs = await measurements
            .find({ jid })
            .sort({ timestamp: -1 })
            .limit(500)
            .toArray();

        if (docs.length === 0) return [];

        // Detect state transitions
        const transitions: Array<{ state: string; timestamp: Date; rtt: number }> = [];
        let prevState = '';

        // Process in chronological order
        for (const doc of docs.reverse()) {
            if (doc.state !== prevState) {
                transitions.push({
                    state: doc.state,
                    timestamp: doc.timestamp,
                    rtt: doc.rtt
                });
                prevState = doc.state;
            }
        }

        return transitions.slice(-limit);
    } catch (err) {
        console.error('[DB] Error fetching activity history:', err);
        return [];
    }
}

export async function getObservedActivitySummary(jid: string, days: number = 30): Promise<{
    totalEvents: number;
    activeEvents: number;
    lastEvent: ActivityEventDoc | null;
    lastPresence: ActivityEventDoc | null;
    lastCall: ActivityEventDoc | null;
    lastMessage: ActivityEventDoc | null;
    bySource: Record<string, number>;
    byType: Array<{ type: string; label: string; count: number; source: string }>;
    confidence: Record<string, number>;
    activeDays: number;
    windowDays: number;
}> {
    const empty = {
        totalEvents: 0,
        activeEvents: 0,
        lastEvent: null,
        lastPresence: null,
        lastCall: null,
        lastMessage: null,
        bySource: {},
        byType: [],
        confidence: {},
        activeDays: 0,
        windowDays: days,
    };
    if (!db) return empty;
    try {
        const since = new Date(Date.now() - days * 86_400_000);
        const [events, grouped] = await Promise.all([
            activityEvents
                .find({ jid, timestamp: { $gte: since } })
                .sort({ timestamp: -1 })
                .limit(500)
                .toArray(),
            activityEvents.aggregate<{
                _id: { source: string; type: string; label: string; confidence: string };
                count: number;
                activeDays: string[];
            }>([
                { $match: { jid, timestamp: { $gte: since } } },
                {
                    $group: {
                        _id: { source: '$source', type: '$type', label: '$label', confidence: '$confidence' },
                        count: { $sum: 1 },
                        activeDays: { $addToSet: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } } },
                    },
                },
                { $sort: { count: -1 } },
            ]).toArray(),
        ]);

        const bySource: Record<string, number> = {};
        const confidence: Record<string, number> = {};
        const daySet = new Set<string>();
        let totalEvents = 0;
        grouped.forEach(group => {
            totalEvents += group.count;
            bySource[group._id.source] = (bySource[group._id.source] || 0) + group.count;
            confidence[group._id.confidence] = (confidence[group._id.confidence] || 0) + group.count;
            group.activeDays.forEach(day => daySet.add(day));
        });

        const activeTypes = new Set([
            'composing',
            'recording',
            'available',
            'incoming',
            'outgoing',
            'offer',
            'ringing',
            'accept',
            'busy',
        ]);
        const activeEvents = grouped
            .filter(group => activeTypes.has(group._id.type))
            .reduce((sum, group) => sum + group.count, 0);

        return {
            totalEvents,
            activeEvents,
            lastEvent: events[0] || null,
            lastPresence: events.find(event => event.source === 'presence') || null,
            lastCall: events.find(event => event.source === 'call') || null,
            lastMessage: events.find(event => event.source === 'message') || null,
            bySource,
            byType: grouped.slice(0, 8).map(group => ({
                type: group._id.type,
                label: group._id.label,
                source: group._id.source,
                count: group.count,
            })),
            confidence,
            activeDays: daySet.size,
            windowDays: days,
        };
    } catch (err) {
        console.error('[DB] Error fetching observed activity summary:', err);
        return empty;
    }
}

/**
 * Get state distribution (% time in each state)
 */
export async function getStateDistribution(jid: string): Promise<{
    online: number;
    standby: number;
    offline: number;
    totalMeasurements: number;
    firstSeen: Date | null;
    lastSeen: Date | null;
    lastOnline: Date | null;
    avgRtt: number;
    insights: StatsInsights;
    observedActivity: Awaited<ReturnType<typeof getObservedActivitySummary>>;
}> {
    const empty = {
        online: 0,
        standby: 0,
        offline: 0,
        totalMeasurements: 0,
        firstSeen: null,
        lastSeen: null,
        lastOnline: null,
        avgRtt: 0,
        insights: buildStatsInsights([]),
        observedActivity: {
            totalEvents: 0,
            activeEvents: 0,
            lastEvent: null,
            lastPresence: null,
            lastCall: null,
            lastMessage: null,
            bySource: {},
            byType: [],
            confidence: {},
            activeDays: 0,
            windowDays: 30,
        },
    };
    if (!db) return empty;
    try {
        const pipeline = [
            { $match: { jid } },
            {
                $group: {
                    _id: '$jid',
                    totalMeasurements: { $sum: 1 },
                    firstSeen: { $min: '$timestamp' },
                    lastSeen: { $max: '$timestamp' },
                    avgRtt: { $avg: '$rtt' },
                    states: { $push: '$state' }
                }
            }
        ];

        const result = await measurements.aggregate(pipeline).toArray();
        if (result.length === 0) return empty;

        const r = result[0];
        const states = r.states as string[];
        const total = states.length;

        const onlineCount = states.filter((s: string) => s.includes('Online')).length;
        const offlineCount = states.filter((s: string) => s === 'OFFLINE').length;
        const standbyCount = total - onlineCount - offlineCount;

        // Find last online timestamp
        const lastOnlineDoc = await measurements
            .find({ jid, state: { $regex: /online/i } })
            .sort({ timestamp: -1 })
            .limit(1)
            .toArray();
        const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
        const insightDocs = await measurements
            .find({ jid, timestamp: { $gte: since } }, { projection: { state: 1, rtt: 1, timestamp: 1 } })
            .sort({ timestamp: 1 })
            .toArray();

        const observedActivity = await getObservedActivitySummary(jid, 30);

        return {
            online: total > 0 ? Math.round((onlineCount / total) * 100) : 0,
            standby: total > 0 ? Math.round((standbyCount / total) * 100) : 0,
            offline: total > 0 ? Math.round((offlineCount / total) * 100) : 0,
            totalMeasurements: total,
            firstSeen: r.firstSeen,
            lastSeen: r.lastSeen,
            lastOnline: lastOnlineDoc.length > 0 ? lastOnlineDoc[0].timestamp : null,
            avgRtt: Math.round(r.avgRtt || 0),
            insights: buildStatsInsights(insightDocs.map(doc => ({
                state: doc.state,
                rtt: doc.rtt,
                timestamp: doc.timestamp,
            }))),
            observedActivity,
        };
    } catch (err) {
        console.error('[DB] Error fetching state distribution:', err);
        return empty;
    }
}

/**
 * Generate a comprehensive report for a contact
 * Includes profile, stats, activity patterns, and recent measurements
 */
export async function generateReport(jid: string): Promise<{
    generatedAt: Date;
    contact: ContactDoc | null;
    stats: Awaited<ReturnType<typeof getStateDistribution>>;
    patterns: Awaited<ReturnType<typeof getOnlinePatterns>>;
    activityHistory: Awaited<ReturnType<typeof getActivityHistory>>;
    recentMeasurements: MeasurementDoc[];
    summary: {
        trackingDuration: string;
        totalDataPoints: number;
        avgResponseTime: number;
        onlinePercentage: number;
        peakActivityHour: string;
        estimatedDailyUsage: string;
    };
}> {
    const [contact, stats, patterns, activity, recent] = await Promise.all([
        getContactProfile(jid),
        getStateDistribution(jid),
        getOnlinePatterns(jid),
        getActivityHistory(jid, 200),
        getRecentMeasurements(jid, 500),
    ]);

    // Calculate tracking duration
    const firstSeen = stats.firstSeen ? new Date(stats.firstSeen) : new Date();
    const lastSeen = stats.lastSeen ? new Date(stats.lastSeen) : new Date();
    const durationMs = lastSeen.getTime() - firstSeen.getTime();
    const durationHours = durationMs / (1000 * 60 * 60);
    const durationDays = durationHours / 24;

    let trackingDuration = '';
    if (durationDays >= 1) {
        trackingDuration = `${Math.floor(durationDays)}d ${Math.floor(durationHours % 24)}h`;
    } else {
        trackingDuration = `${Math.floor(durationHours)}h ${Math.floor((durationMs / 60000) % 60)}m`;
    }

    // Peak activity hour formatted
    const peakHour = patterns.peakHour >= 0 ? `${patterns.peakHour}:00 - ${patterns.peakHour + 1}:00` : 'N/A';

    // Estimated daily usage
    const totalMinutes = patterns.totalOnlineMinutes;
    const monitoredDays = Math.max(1, durationDays);
    const dailyMinutes = Math.round(totalMinutes / monitoredDays);
    const estimatedDailyUsage = dailyMinutes > 60
        ? `${Math.floor(dailyMinutes / 60)}h ${dailyMinutes % 60}m`
        : `${dailyMinutes}m`;

    return {
        generatedAt: new Date(),
        contact,
        stats,
        patterns,
        activityHistory: activity,
        recentMeasurements: recent,
        summary: {
            trackingDuration,
            totalDataPoints: stats.totalMeasurements,
            avgResponseTime: stats.avgRtt,
            onlinePercentage: stats.online,
            peakActivityHour: peakHour,
            estimatedDailyUsage,
        },
    };
}

// ── Call Analysis Persistence ─────────────────────────────────

/**
 * Save a call analysis result to MongoDB
 */
export async function saveCallAnalysis(result: CallAnalysisResult): Promise<void> {
    if (!db) return;
    try {
        await callAnalyses.updateOne(
            { callId: result.callId },
            {
                $set: {
                    ...result,
                    updatedAt: new Date(),
                },
                $setOnInsert: {
                    savedAt: new Date(),
                },
            },
            { upsert: true }
        );
        console.log(`[DB] Call analysis saved for ${result.targetJid} (${result.verdict})`);
    } catch (err) {
        console.error('[DB] Error saving call analysis:', err);
    }
}

/**
 * Get call analysis history for a contact
 */
export async function getCallAnalyses(jid: string, limit: number = 20): Promise<CallAnalysisResult[]> {
    if (!db) return [];
    try {
        return await callAnalyses
            .find({ targetJid: jid })
            .sort({ startTime: -1 })
            .limit(limit)
            .toArray();
    } catch (err) {
        console.error('[DB] Error fetching call analyses:', err);
        return [];
    }
}

// ── Audit Log Persistence ─────────────────────────────────────

export interface CaseInput {
    caseId: string;
    title?: string;
    description?: string | null;
    status?: CaseStatus;
    primaryOperator: string;
    authorizationNote: string;
    tags?: string[];
}

export async function createCase(input: CaseInput): Promise<CaseDoc | null> {
    if (!db) return null;
    const now = new Date();
    const caseId = input.caseId.trim();
    if (!caseId) return null;

    const doc: CaseDoc = {
        caseId,
        title: input.title?.trim() || caseId,
        description: input.description?.trim() || null,
        status: input.status || 'authorized',
        primaryOperator: input.primaryOperator.trim(),
        authorizationNote: input.authorizationNote.trim(),
        tags: input.tags || [],
        createdAt: now,
        updatedAt: now,
        openedAt: input.status === 'active' ? now : null,
        closedAt: null,
        lastAuditAt: null,
        lastAuditAction: null,
    };

    try {
        const existing = await caseRecords.findOne({ caseId });
        if (!existing) {
            await caseRecords.insertOne(doc);
        } else {
            await caseRecords.updateOne(
                { caseId },
                {
                    $set: {
                        title: doc.title,
                        description: doc.description,
                        primaryOperator: doc.primaryOperator,
                        authorizationNote: doc.authorizationNote,
                        tags: doc.tags,
                        updatedAt: now,
                    },
                }
            );
        }
        return await getCase(caseId);
    } catch (err) {
        console.error('[DB] Error creating case:', err);
        return null;
    }
}

export async function getCase(caseId: string): Promise<CaseDoc | null> {
    if (!db) return null;
    try {
        return await caseRecords.findOne({ caseId });
    } catch (err) {
        console.error('[DB] Error fetching case:', err);
        return null;
    }
}

export async function listCases(limit: number = 50, status?: CaseStatus): Promise<CaseDoc[]> {
    if (!db) return [];
    try {
        const query = status ? { status } : {};
        return await caseRecords
            .find(query)
            .sort({ updatedAt: -1 })
            .limit(limit)
            .toArray();
    } catch (err) {
        console.error('[DB] Error listing cases:', err);
        return [];
    }
}

export async function getCallAnalysesByCallIds(callIds: string[]): Promise<CallAnalysisResult[]> {
    if (!db || callIds.length === 0) return [];
    try {
        return await callAnalyses
            .find({ callId: { $in: Array.from(new Set(callIds)) } })
            .sort({ startTime: -1 })
            .toArray();
    } catch (err) {
        console.error('[DB] Error fetching call analyses by callId:', err);
        return [];
    }
}

export async function updateCase(caseId: string, patch: Partial<Pick<CaseDoc, 'title' | 'description' | 'status' | 'primaryOperator' | 'authorizationNote' | 'tags'>>): Promise<CaseDoc | null> {
    if (!db) return null;
    const update: Partial<CaseDoc> = { updatedAt: new Date() };
    if (patch.title !== undefined) update.title = patch.title.trim();
    if (patch.description !== undefined) update.description = patch.description?.trim() || null;
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.primaryOperator !== undefined) update.primaryOperator = patch.primaryOperator.trim();
    if (patch.authorizationNote !== undefined) update.authorizationNote = patch.authorizationNote.trim();
    if (patch.tags !== undefined) update.tags = patch.tags;

    if (patch.status === 'active') update.openedAt = new Date();
    if (patch.status === 'closed') update.closedAt = new Date();

    try {
        await caseRecords.updateOne({ caseId }, { $set: update });
        return await getCase(caseId);
    } catch (err) {
        console.error('[DB] Error updating case:', err);
        return null;
    }
}

export async function closeCase(caseId: string): Promise<CaseDoc | null> {
    return updateCase(caseId, { status: 'closed' });
}

export async function saveCaseEvidenceLink(link: Omit<CaseEvidenceLinkDoc, 'createdAt' | 'updatedAt'>): Promise<void> {
    if (!db) return;
    const now = new Date();
    try {
        await caseEvidenceLinks.updateOne(
            { caseId: link.caseId, type: link.type, refId: link.refId },
            {
                $set: {
                    label: link.label,
                    targetJid: link.targetJid || null,
                    metadata: link.metadata,
                    updatedAt: now,
                },
                $setOnInsert: {
                    caseId: link.caseId,
                    type: link.type,
                    refId: link.refId,
                    createdAt: now,
                },
            },
            { upsert: true }
        );
    } catch (err) {
        console.error('[DB] Error saving case evidence link:', err);
    }
}

export async function getCaseEvidenceLinks(caseId: string): Promise<CaseEvidenceLinkDoc[]> {
    if (!db) return [];
    try {
        return await caseEvidenceLinks
            .find({ caseId })
            .sort({ updatedAt: -1 })
            .toArray();
    } catch (err) {
        console.error('[DB] Error fetching case evidence links:', err);
        return [];
    }
}

export async function deleteCaseEvidenceLink(caseId: string, type: CaseEvidenceType, refId: string): Promise<boolean> {
    if (!db) return false;
    try {
        const result = await caseEvidenceLinks.deleteOne({ caseId, type, refId });
        return result.deletedCount === 1;
    } catch (err) {
        console.error('[DB] Error deleting case evidence link:', err);
        return false;
    }
}

export async function saveAuditEvent(event: Omit<AuditEventDoc, 'timestamp' | 'timestampUtc'>): Promise<void> {
    if (!db) return;
    try {
        const timestamp = new Date();
        await caseRecords.updateOne(
            { caseId: event.caseId },
            {
                $setOnInsert: {
                    caseId: event.caseId,
                    title: event.caseId,
                    description: null,
                    status: event.scope === 'system' ? 'authorized' : 'active',
                    primaryOperator: event.operatorName,
                    authorizationNote: event.authorizationNote,
                    tags: [],
                    createdAt: timestamp,
                    openedAt: event.scope === 'system' ? null : timestamp,
                    closedAt: null,
                },
                $set: {
                    updatedAt: timestamp,
                    lastAuditAt: timestamp,
                    lastAuditAction: event.action,
                },
            },
            { upsert: true }
        );
        await auditEvents.insertOne({
            ...event,
            timestamp,
            timestampUtc: timestamp.toISOString(),
        });
        console.log(`[AUDIT] ${event.caseId} ${event.scope}:${event.action}`);
    } catch (err) {
        console.error('[DB] Error saving audit event:', err);
    }
}

export async function getAuditEvents(caseId: string, limit: number = 100): Promise<AuditEventDoc[]> {
    if (!db) return [];
    try {
        return await auditEvents
            .find({ caseId })
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();
    } catch (err) {
        console.error('[DB] Error fetching audit events:', err);
        return [];
    }
}

// -- Authorized Check-In Persistence ---------------------------------------

export async function saveCheckInRequest(doc: CheckInDoc): Promise<boolean> {
    if (!db) return false;
    try {
        await checkIns.insertOne(doc);
        return true;
    } catch (err) {
        console.error('[DB] Error saving check-in request:', err);
        return false;
    }
}

export async function getCheckInByToken(token: string): Promise<CheckInDoc | null> {
    if (!db) return null;
    try {
        return await checkIns.findOne({ token });
    } catch (err) {
        console.error('[DB] Error fetching check-in:', err);
        return null;
    }
}

export async function updateCheckIn(token: string, patch: Partial<CheckInDoc>): Promise<CheckInDoc | null> {
    if (!db) return null;
    try {
        await checkIns.updateOne(
            { token },
            {
                $set: {
                    ...patch,
                    updatedAt: patch.updatedAt || new Date(),
                },
            }
        );
        return await getCheckInByToken(token);
    } catch (err) {
        console.error('[DB] Error updating check-in:', err);
        return null;
    }
}

export async function completeCheckIn(token: string, patch: Partial<CheckInDoc>): Promise<CheckInDoc | null> {
    if (!db) return null;
    try {
        const result = await checkIns.updateOne(
            { token, status: 'pending' },
            {
                $set: {
                    ...patch,
                    status: 'completed',
                    updatedAt: patch.updatedAt || new Date(),
                },
            }
        );
        if (result.modifiedCount !== 1) return null;
        return await getCheckInByToken(token);
    } catch (err) {
        console.error('[DB] Error completing check-in:', err);
        return null;
    }
}

export async function deleteCheckIn(token: string): Promise<boolean> {
    if (!db) return false;
    try {
        const result = await checkIns.deleteOne({ token });
        return result.deletedCount === 1;
    } catch (err) {
        console.error('[DB] Error deleting check-in:', err);
        return false;
    }
}

export async function listCheckIns(caseId?: string, limit: number = 50): Promise<CheckInDoc[]> {
    if (!db) return [];
    try {
        const query = caseId ? { caseId } : {};
        return await checkIns
            .find(query)
            .sort({ createdAt: -1 })
            .limit(limit)
            .toArray();
    } catch (err) {
        console.error('[DB] Error listing check-ins:', err);
        return [];
    }
}

/**
 * Graceful disconnect
 */
export async function disconnectDB(): Promise<void> {
    if (client) {
        await client.close();
        client = null;
        db = null;
        console.log('[DB] Disconnected from MongoDB');
    }
}

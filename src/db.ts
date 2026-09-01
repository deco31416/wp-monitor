/**
 * MongoDB Persistence Service
 *
 * Stores RTT measurements, contact info, activity history,
 * and call analysis results so data is not lost when the server restarts.
 */

import { MongoClient, Db, Collection } from 'mongodb';
import 'dotenv/config';
import type { CallAnalysisResult } from './call-analyzer.js';
import { PRIMARY_OPERATOR_ID } from './operator-auth.js';
import type { OperatorUserDoc } from './operator-auth.js';
import { buildStatsInsights } from './stats-insights.js';
import type { StatsInsights } from './stats-insights.js';
import { buildPageMetadata, type PageMetadata } from './page-metadata.js';
import {
    buildCommercialCallActivity,
    COMMERCIAL_CALL_STATUSES,
    type CommercialCallMetadata,
    type CommercialCallOutcome,
    type RawCallActivitySignal,
} from './call-activity.js';
import {
    CONCLUSIVE_TRACKER_STATE_REGEX,
    ONLINE_TRACKER_STATE_REGEX,
    hasAcknowledgedTrackerRtt,
    isConclusiveTrackerState,
    summarizeTrackerStates,
    type TrackerDeviceUpdate,
} from './tracker-signals.js';

// Types
export interface MeasurementDoc {
    caseId: string;
    trackingSessionId: string;
    jid: string;
    rtt: number;
    avg: number;
    median: number;
    threshold: number;
    state: string;
    devices: TrackerDeviceUpdate[];
    deviceCount: number;
    timestamp: Date;
}

export type ActivityEventSource = 'presence' | 'call' | 'message' | 'receipt' | 'rtt_probe' | 'system';

export interface ActivityEventDoc {
    caseId: string;
    trackingSessionId: string;
    jid: string;
    source: ActivityEventSource;
    type: string;
    label: string;
    confidence: 'none' | 'low' | 'medium' | 'high';
    details?: Record<string, unknown>;
    timestamp: Date;
    timestampUtc: string;
}

export interface ObservedActivityListItem {
    source: ActivityEventSource;
    type: string;
    label: string;
    confidence: ActivityEventDoc['confidence'];
    timestamp: Date;
    timestampUtc: string;
}

export interface CommercialObservedActivityListItem extends ObservedActivityListItem {
    call?: CommercialCallMetadata;
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

export type TrackingSessionStatus = 'active' | 'stopped' | 'interrupted' | 'failed';

export interface TrackingSessionDoc {
    trackingSessionId: string;
    caseId: string;
    jid: string;
    operatorName: string;
    authorizationNote: string;
    probeMethod: 'passive' | 'delete' | 'reaction';
    status: TrackingSessionStatus;
    startedAt: Date;
    stoppedAt: Date | null;
    stopReason: string | null;
    createdAt: Date;
    updatedAt: Date;
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
let trackingSessions: Collection<TrackingSessionDoc>;
type StoredCallAnalysis = CallAnalysisResult & {
    caseId?: string;
    savedAt?: Date;
    updatedAt?: Date;
};

let callAnalyses: Collection<StoredCallAnalysis>;
let auditEvents: Collection<AuditEventDoc>;
let caseRecords: Collection<CaseDoc>;
let caseEvidenceLinks: Collection<CaseEvidenceLinkDoc>;
let checkIns: Collection<CheckInDoc>;
let operatorUsers: Collection<OperatorUserDoc>;

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
        trackingSessions = db.collection<TrackingSessionDoc>('tracking_sessions');
        callAnalyses = db.collection<StoredCallAnalysis>('call_analyses');
        auditEvents = db.collection<AuditEventDoc>('audit_events');
        caseRecords = db.collection<CaseDoc>('cases');
        caseEvidenceLinks = db.collection<CaseEvidenceLinkDoc>('case_evidence_links');
        checkIns = db.collection<CheckInDoc>('check_ins');
        operatorUsers = db.collection<OperatorUserDoc>('operator_users');

        // Create indexes for efficient queries
        await measurements.createIndex({ jid: 1, timestamp: -1 });
        await measurements.createIndex({ timestamp: 1 }, { expireAfterSeconds: 30 * 24 * 3600 }); // TTL: 30 days
        await activityEvents.createIndex({ jid: 1, timestamp: -1 });
        await activityEvents.createIndex({ source: 1, type: 1, timestamp: -1 });
        await activityEvents.createIndex({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 3600 }); // TTL: 90 days
        await measurements.createIndex({ caseId: 1, jid: 1, timestamp: -1 });
        await measurements.createIndex({ trackingSessionId: 1, timestamp: -1 });
        await activityEvents.createIndex({ caseId: 1, jid: 1, timestamp: -1 });
        await activityEvents.createIndex({ trackingSessionId: 1, timestamp: -1 });
        await contacts.createIndex({ jid: 1 }, { unique: true });
        await trackingSessions.createIndex({ trackingSessionId: 1 }, { unique: true });
        await trackingSessions.createIndex({ caseId: 1, startedAt: -1 });
        await trackingSessions.createIndex({ jid: 1, startedAt: -1 });
        await trackingSessions.createIndex(
            { jid: 1 },
            { unique: true, partialFilterExpression: { status: 'active' } }
        );
        await callAnalyses.createIndex({ callId: 1 });
        await callAnalyses.createIndex(
            { caseId: 1, callId: 1 },
            { unique: true, partialFilterExpression: { caseId: { $type: 'string' } } }
        );
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
        await operatorUsers.createIndex({ normalizedUsername: 1 }, { unique: true });

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
    await measurements.insertOne({
        ...data,
        timestamp: new Date()
    });
}

/**
 * Save a high-value observed activity event (presence, call, message).
 * RTT probes remain in the measurements collection to avoid duplicate volume.
 */
export async function saveActivityEvent(data: Omit<ActivityEventDoc, 'timestamp' | 'timestampUtc'> & { timestamp?: Date | number | string }): Promise<void> {
    if (!db) return;
    try {
        await activityEvents.insertOne(buildActivityEventDoc(data));
    } catch (err) {
        console.error('[DB] Error saving activity event:', err);
    }
}

export function buildActivityEventDoc(
    data: Omit<ActivityEventDoc, 'timestamp' | 'timestampUtc'> & { timestamp?: Date | number | string },
): ActivityEventDoc {
    const timestamp = data.timestamp ? new Date(data.timestamp) : new Date();
    return {
        caseId: data.caseId,
        trackingSessionId: data.trackingSessionId,
        jid: data.jid,
        source: data.source,
        type: data.type,
        label: data.label,
        confidence: data.confidence,
        ...(data.details !== undefined ? { details: data.details } : {}),
        timestamp,
        timestampUtc: timestamp.toISOString(),
    };
}

export function buildObservationScope(
    jid: string,
    caseId?: string,
    trackingSessionId?: string,
): { jid: string; caseId?: string; trackingSessionId?: string } {
    return {
        jid,
        ...(caseId ? { caseId } : {}),
        ...(trackingSessionId ? { trackingSessionId } : {}),
    };
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
            lastSeen: new Date(),
            isActive: true,
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
export async function getOnlinePatterns(jid: string, trackingSessionId?: string): Promise<{
    hourly: Array<{ hour: number; total: number; conclusive: number; online: number; pct: number }>;
    peakHour: number;
    avgSessionLength: number;
    totalOnlineMinutes: number;
}> {
    const empty = { hourly: [], peakHour: -1, avgSessionLength: 0, totalOnlineMinutes: 0 };
    if (!db) return empty;
    try {
        // Aggregate measurements by hour of day
        const measurementScope = buildObservationScope(jid, undefined, trackingSessionId);
        const pipeline = [
            { $match: measurementScope },
            {
                $group: {
                    _id: { $hour: '$timestamp' },
                    total: { $sum: 1 },
                    conclusive: {
                        $sum: {
                            $cond: [{ $regexMatch: { input: '$state', regex: CONCLUSIVE_TRACKER_STATE_REGEX } }, 1, 0]
                        }
                    },
                    online: {
                        $sum: {
                            $cond: [{ $regexMatch: { input: '$state', regex: ONLINE_TRACKER_STATE_REGEX } }, 1, 0]
                        }
                    }
                }
            },
            { $sort: { '_id': 1 } }
        ];

        const results = await measurements.aggregate<{ _id: number; total: number; conclusive: number; online: number }>(pipeline).toArray();

        // Build full 24h array
        const hourly = Array.from({ length: 24 }, (_, h) => {
            const found = results.find(result => result._id === h);
            const total = found ? found.total : 0;
            const conclusive = found ? found.conclusive : 0;
            const online = found ? found.online : 0;
            return { hour: h, total, conclusive, online, pct: conclusive > 0 ? Math.round((online / conclusive) * 100) : 0 };
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
            .find({ ...measurementScope, state: { $regex: ONLINE_TRACKER_STATE_REGEX } })
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
export async function getRecentMeasurements(
    jid: string,
    limit: number = 200,
    trackingSessionId?: string,
): Promise<MeasurementDoc[]> {
    if (!db) return [];
    try {
        return await measurements
            .find({ jid, ...(trackingSessionId ? { trackingSessionId } : {}) })
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
        const stats = await measurements.aggregate<{
            totalMeasurements: number;
            firstSeen: Date | null;
            lastSeen: Date | null;
        }>([
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

        const [stat] = stats;
        if (!stat) return null;
        return {
            totalMeasurements: stat.totalMeasurements,
            firstSeen: stat.firstSeen,
            lastSeen: stat.lastSeen
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

export async function createTrackingSession(input: Omit<TrackingSessionDoc, 'status' | 'startedAt' | 'stoppedAt' | 'stopReason' | 'createdAt' | 'updatedAt'>): Promise<TrackingSessionDoc | null> {
    if (!db) return null;
    const now = new Date();
    const doc: TrackingSessionDoc = {
        ...input,
        status: 'active',
        startedAt: now,
        stoppedAt: null,
        stopReason: null,
        createdAt: now,
        updatedAt: now,
    };
    try {
        await trackingSessions.insertOne(doc);
        return doc;
    } catch (err) {
        console.error('[DB] Error creating tracking session:', err);
        return null;
    }
}

export async function finishTrackingSession(
    trackingSessionId: string,
    status: Extract<TrackingSessionStatus, 'stopped' | 'interrupted' | 'failed'>,
    stopReason: string,
): Promise<TrackingSessionDoc | null> {
    if (!db) return null;
    try {
        return await trackingSessions.findOneAndUpdate(
            { trackingSessionId, status: 'active' },
            {
                $set: {
                    status,
                    stoppedAt: new Date(),
                    stopReason,
                    updatedAt: new Date(),
                },
            },
            { returnDocument: 'after' },
        );
    } catch (err) {
        console.error('[DB] Error finishing tracking session:', err);
        return null;
    }
}

export async function getActiveTrackingSessions(caseId?: string): Promise<TrackingSessionDoc[] | null> {
    if (!db) return null;
    try {
        return await trackingSessions
            .find({ status: 'active', ...(caseId ? { caseId } : {}) })
            .sort({ startedAt: 1 })
            .toArray();
    } catch (err) {
        console.error('[DB] Error fetching active tracking sessions:', err);
        return null;
    }
}

export async function updateTrackingSessionProbeMethod(
    trackingSessionId: string,
    probeMethod: TrackingSessionDoc['probeMethod'],
): Promise<boolean> {
    if (!db) return false;
    try {
        const result = await trackingSessions.updateOne(
            { trackingSessionId, status: 'active' },
            { $set: { probeMethod, updatedAt: new Date() } },
        );
        return result.modifiedCount === 1 || result.matchedCount === 1;
    } catch (err) {
        console.error('[DB] Error updating tracking session probe method:', err);
        return false;
    }
}

/**
 * Get activity state changes (transitions) for a contact
 */
export async function getActivityHistory(
    jid: string,
    limit: number = 50,
    trackingSessionId?: string,
): Promise<Array<{
    state: string;
    timestamp: Date;
    rtt: number;
}>> {
    if (!db) return [];
    try {
        // Get measurements and detect state transitions
        const docs = await measurements
            .find({ jid, ...(trackingSessionId ? { trackingSessionId } : {}) })
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

export function buildObservedActivityScope(
    jid: string,
    caseId?: string,
    trackingSessionId?: string,
): Record<string, unknown> {
    return {
        ...buildObservationScope(jid, caseId),
        ...(trackingSessionId ? { trackingSessionId } : {}),
        // Historical reaction probes were persisted before probes carried an
        // explicit classification. Keep them out unless they were reviewed as
        // genuine user activity by the current message pipeline.
        $nor: [{
            source: 'message',
            'details.messageType': 'reaction',
            'details.syntheticProbe': { $ne: false },
        }],
    };
}

export async function getObservedActivityEvents(
    jid: string,
    trackingSessionId: string,
    limit: number = 50,
): Promise<ObservedActivityListItem[]> {
    if (!db) return [];
    try {
        return await activityEvents
            .find(buildObservedActivityScope(jid, undefined, trackingSessionId), {
                projection: {
                    _id: 0,
                    source: 1,
                    type: 1,
                    label: 1,
                    confidence: 1,
                    timestamp: 1,
                    timestampUtc: 1,
                },
            })
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray() as ObservedActivityListItem[];
    } catch (err) {
        console.error('[DB] Error fetching observed activity events:', err);
        return [];
    }
}

interface CommercialActivityAggregate {
    source: ActivityEventSource;
    type: string;
    label: string;
    confidence: ActivityEventDoc['confidence'];
    timestamp: Date;
    timestampUtc: string;
    lastTimestamp: Date;
    callTypes: string[];
    callSignals: RawCallActivitySignal[];
}

function commercialActivityGroupingStages(scope: Record<string, unknown>): Record<string, unknown>[] {
    return [
        { $match: scope },
        { $sort: { timestamp: 1, _id: 1 } },
        {
            $set: {
                commercialActivityKey: {
                    $cond: [
                        {
                            $and: [
                                { $eq: ['$source', 'call'] },
                                { $eq: [{ $type: '$details.callIdHash' }, 'string'] },
                                { $ne: ['$details.callIdHash', ''] },
                            ],
                        },
                        {
                            $concat: [
                                'call:',
                                { $ifNull: ['$trackingSessionId', 'legacy'] },
                                ':',
                                '$details.callIdHash',
                            ],
                        },
                        { $concat: ['event:', { $toString: '$_id' }] },
                    ],
                },
            },
        },
        {
            $group: {
                _id: '$commercialActivityKey',
                source: { $first: '$source' },
                type: { $first: '$type' },
                label: { $first: '$label' },
                confidence: { $first: '$confidence' },
                timestamp: { $first: '$timestamp' },
                timestampUtc: { $first: '$timestampUtc' },
                lastTimestamp: { $last: '$timestamp' },
                callTypes: { $push: '$type' },
                callSignals: {
                    $push: {
                        type: '$type',
                        confidence: '$confidence',
                        timestamp: '$timestamp',
                        timestampUtc: '$timestampUtc',
                        details: '$details',
                    },
                },
            },
        },
        {
            $match: {
                $or: [
                    { source: { $ne: 'call' } },
                    { callTypes: { $in: [...COMMERCIAL_CALL_STATUSES] } },
                ],
            },
        },
    ];
}

function commercialCallOutcomeExpression(): Record<string, unknown> {
    return {
        $switch: {
            branches: [
                { case: { $in: ['reject', '$callTypes'] }, then: 'rejected' },
                { case: { $in: ['timeout', '$callTypes'] }, then: 'missed' },
                {
                    case: {
                        $and: [
                            { $in: ['accept', '$callTypes'] },
                            { $in: ['terminate', '$callTypes'] },
                        ],
                    },
                    then: 'completed',
                },
                { case: { $in: ['accept', '$callTypes'] }, then: 'active' },
                { case: { $in: ['busy', '$callTypes'] }, then: 'busy' },
                { case: { $in: ['terminate', '$callTypes'] }, then: 'ended_unconfirmed' },
                { case: { $in: ['offer', '$callTypes'] }, then: 'incoming' },
            ],
            default: 'ringing',
        },
    };
}

function emptyCallOutcomeCounts(): Record<CommercialCallOutcome, number> {
    return {
        incoming: 0,
        ringing: 0,
        active: 0,
        completed: 0,
        busy: 0,
        rejected: 0,
        missed: 0,
        ended_unconfirmed: 0,
    };
}

function mapCommercialActivityAggregate(
    row: CommercialActivityAggregate,
): CommercialObservedActivityListItem | null {
    if (row.source !== 'call') {
        return {
            source: row.source,
            type: row.type,
            label: row.label,
            confidence: row.confidence,
            timestamp: row.timestamp,
            timestampUtc: row.timestampUtc,
        };
    }

    const callEvent = buildCommercialCallActivity(row.callSignals);
    if (!callEvent) return null;
    return {
        ...callEvent,
        timestamp: callEvent.timestamp instanceof Date
            ? callEvent.timestamp
            : new Date(callEvent.timestamp),
    };
}

/**
 * Return the customer-facing activity timeline. Raw call protocol signals stay
 * persisted, while all signals sharing one call ID become one truthful call.
 */
export async function getCommercialObservedActivityEvents(
    jid: string,
    trackingSessionId: string,
    limit: number = 50,
): Promise<CommercialObservedActivityListItem[]> {
    if (!db) return [];
    try {
        const rows = await activityEvents.aggregate<CommercialActivityAggregate>([
            ...commercialActivityGroupingStages(
                buildObservedActivityScope(jid, undefined, trackingSessionId),
            ),
            { $sort: { lastTimestamp: -1 } },
            { $limit: limit },
        ]).toArray();

        return rows
            .map(mapCommercialActivityAggregate)
            .filter((event): event is CommercialObservedActivityListItem => event !== null);
    } catch (err) {
        console.error('[DB] Error fetching commercial observed activity:', err);
        return [];
    }
}

export async function countCommercialObservedActivityEvents(
    jid: string,
    caseId?: string,
    trackingSessionId?: string,
): Promise<number> {
    if (!db) return 0;
    try {
        const rows = await activityEvents.aggregate<{ total: number }>([
            ...commercialActivityGroupingStages(
                buildObservedActivityScope(jid, caseId, trackingSessionId),
            ),
            { $count: 'total' },
        ]).toArray();
        return rows[0]?.total || 0;
    } catch (err) {
        console.error('[DB] Error counting commercial observed activity:', err);
        return 0;
    }
}

export async function getObservedActivityEventsForCase(
    jid: string,
    caseId: string,
    limit: number = 5000,
): Promise<ObservedActivityListItem[]> {
    if (!db) return [];
    try {
        return await activityEvents
            .find(buildObservedActivityScope(jid, caseId), {
                projection: {
                    _id: 0,
                    source: 1,
                    type: 1,
                    label: 1,
                    confidence: 1,
                    timestamp: 1,
                    timestampUtc: 1,
                },
            })
            .sort({ timestamp: 1 })
            .limit(limit)
            .toArray() as ObservedActivityListItem[];
    } catch (err) {
        console.error('[DB] Error fetching case observed activity events:', err);
        return [];
    }
}

export async function countObservedActivityEvents(
    jid: string,
    caseId?: string,
    trackingSessionId?: string,
): Promise<number> {
    if (!db) return 0;
    try {
        return await activityEvents.countDocuments(
            buildObservedActivityScope(jid, caseId, trackingSessionId),
        );
    } catch (err) {
        console.error('[DB] Error counting observed activity events:', err);
        return 0;
    }
}

export async function getObservedActivityBounds(
    jid: string,
    caseId?: string,
    trackingSessionId?: string,
): Promise<{ firstEventAt: Date | null; lastEventAt: Date | null }> {
    if (!db) return { firstEventAt: null, lastEventAt: null };
    try {
        const [result] = await activityEvents.aggregate<{
            firstEventAt: Date | null;
            lastEventAt: Date | null;
        }>([
            { $match: buildObservedActivityScope(jid, caseId, trackingSessionId) },
            {
                $group: {
                    _id: null,
                    firstEventAt: { $min: '$timestamp' },
                    lastEventAt: { $max: '$timestamp' },
                },
            },
        ]).toArray();
        return result || { firstEventAt: null, lastEventAt: null };
    } catch (err) {
        console.error('[DB] Error fetching observed activity bounds:', err);
        return { firstEventAt: null, lastEventAt: null };
    }
}

export function buildObservationWindow(
    technicalFirst: Date | null,
    technicalLast: Date | null,
    observedFirst: Date | null,
    observedLast: Date | null,
): { firstSeen: Date | null; lastSeen: Date | null; durationMs: number; label: string } {
    const firstCandidates = [technicalFirst, observedFirst].filter((value): value is Date => (
        value instanceof Date && Number.isFinite(value.getTime())
    ));
    const lastCandidates = [technicalLast, observedLast].filter((value): value is Date => (
        value instanceof Date && Number.isFinite(value.getTime())
    ));
    const firstSeen = firstCandidates.length > 0
        ? new Date(Math.min(...firstCandidates.map(value => value.getTime())))
        : null;
    const lastSeen = lastCandidates.length > 0
        ? new Date(Math.max(...lastCandidates.map(value => value.getTime())))
        : null;
    const durationMs = firstSeen && lastSeen
        ? Math.max(0, lastSeen.getTime() - firstSeen.getTime())
        : 0;
    const durationHours = durationMs / (1000 * 60 * 60);
    const durationDays = durationHours / 24;
    const label = durationDays >= 1
        ? `${Math.floor(durationDays)}d ${Math.floor(durationHours % 24)}h`
        : `${Math.floor(durationHours)}h ${Math.floor((durationMs / 60000) % 60)}m`;

    return { firstSeen, lastSeen, durationMs, label };
}

export function consolidateObservedActivityTypes(
    groups: Array<{
        source: string;
        type: string;
        label: string;
        count: number;
    }>,
): Array<{ source: string; type: string; label: string; count: number }> {
    const consolidated = new Map<string, { source: string; type: string; label: string; count: number }>();
    groups.forEach(group => {
        const key = `${group.source}:${group.type}:${group.label}`;
        const current = consolidated.get(key);
        consolidated.set(key, {
            source: group.source,
            type: group.type,
            label: group.label,
            count: (current?.count || 0) + group.count,
        });
    });
    return [...consolidated.values()].sort((left, right) => right.count - left.count);
}

export async function getObservedActivitySummary(
    jid: string,
    days: number = 30,
    caseId?: string,
    trackingSessionId?: string,
): Promise<{
    totalEvents: number;
    activeEvents: number;
    firstEvent: CommercialObservedActivityListItem | null;
    lastEvent: CommercialObservedActivityListItem | null;
    lastPresence: CommercialObservedActivityListItem | null;
    lastCall: CommercialObservedActivityListItem | null;
    lastMessage: CommercialObservedActivityListItem | null;
    bySource: Record<string, number>;
    byType: Array<{ type: string; label: string; count: number; source: string }>;
    confidence: Record<string, number>;
    callOutcomes: Record<CommercialCallOutcome, number>;
    messageDirections: { incoming: number; outgoing: number };
    activeDays: number;
    windowDays: number;
}> {
    const empty = {
        totalEvents: 0,
        activeEvents: 0,
        firstEvent: null,
        lastEvent: null,
        lastPresence: null,
        lastCall: null,
        lastMessage: null,
        bySource: {},
        byType: [],
        confidence: {},
        callOutcomes: emptyCallOutcomeCounts(),
        messageDirections: { incoming: 0, outgoing: 0 },
        activeDays: 0,
        windowDays: days,
    };
    if (!db) return empty;
    try {
        const since = new Date(Date.now() - days * 86_400_000);
        const match = {
            ...buildObservedActivityScope(jid, caseId, trackingSessionId),
            timestamp: { $gte: since },
        };
        const [eventRows, firstEventRows, grouped, callOutcomeGroups] = await Promise.all([
            activityEvents.aggregate<CommercialActivityAggregate>([
                ...commercialActivityGroupingStages(match),
                { $sort: { lastTimestamp: -1 } },
                { $limit: 500 },
            ]).toArray(),
            activityEvents.aggregate<CommercialActivityAggregate>([
                ...commercialActivityGroupingStages(match),
                { $sort: { lastTimestamp: 1 } },
                { $limit: 1 },
            ]).toArray(),
            activityEvents.aggregate<{
                _id: { source: string; type: string; label: string; confidence: string };
                count: number;
                activeDays: string[];
            }>([
                ...commercialActivityGroupingStages(match),
                {
                    $set: {
                        commercialType: {
                            $cond: [{ $eq: ['$source', 'call'] }, 'call_session', '$type'],
                        },
                        commercialLabel: {
                            $cond: [{ $eq: ['$source', 'call'] }, 'Llamada observada', '$label'],
                        },
                        commercialConfidence: {
                            $cond: [
                                { $eq: ['$source', 'call'] },
                                {
                                    $cond: [
                                        {
                                            $or: [
                                                { $in: ['accept', '$callTypes'] },
                                                { $in: ['reject', '$callTypes'] },
                                                { $in: ['timeout', '$callTypes'] },
                                                { $in: ['busy', '$callTypes'] },
                                            ],
                                        },
                                        'high',
                                        'medium',
                                    ],
                                },
                                '$confidence',
                            ],
                        },
                        commercialTimestamp: {
                            $cond: [{ $eq: ['$source', 'call'] }, '$lastTimestamp', '$timestamp'],
                        },
                    },
                },
                {
                    $group: {
                        _id: {
                            source: '$source',
                            type: '$commercialType',
                            label: '$commercialLabel',
                            confidence: '$commercialConfidence',
                        },
                        count: { $sum: 1 },
                        activeDays: { $addToSet: { $dateToString: { format: '%Y-%m-%d', date: '$commercialTimestamp' } } },
                    },
                },
                { $sort: { count: -1 } },
            ]).toArray(),
            activityEvents.aggregate<{ _id: CommercialCallOutcome; count: number }>([
                ...commercialActivityGroupingStages(match),
                { $match: { source: 'call' } },
                { $set: { commercialOutcome: commercialCallOutcomeExpression() } },
                { $group: { _id: '$commercialOutcome', count: { $sum: 1 } } },
            ]).toArray(),
        ]);
        const events = eventRows
            .map(mapCommercialActivityAggregate)
            .filter((event): event is CommercialObservedActivityListItem => event !== null);
        const firstEvents = firstEventRows
            .map(mapCommercialActivityAggregate)
            .filter((event): event is CommercialObservedActivityListItem => event !== null);

        const bySource: Record<string, number> = {};
        const confidence: Record<string, number> = {};
        const messageDirections = { incoming: 0, outgoing: 0 };
        const daySet = new Set<string>();
        let totalEvents = 0;
        grouped.forEach(group => {
            totalEvents += group.count;
            bySource[group._id.source] = (bySource[group._id.source] || 0) + group.count;
            confidence[group._id.confidence] = (confidence[group._id.confidence] || 0) + group.count;
            if (group._id.source === 'message' && group._id.type === 'incoming') {
                messageDirections.incoming += group.count;
            }
            if (group._id.source === 'message' && group._id.type === 'outgoing') {
                messageDirections.outgoing += group.count;
            }
            group.activeDays.forEach(day => daySet.add(day));
        });
        const consolidatedTypes = consolidateObservedActivityTypes(grouped.map(group => ({
            source: group._id.source,
            type: group._id.type,
            label: group._id.label,
            count: group.count,
        })));
        const callOutcomes = emptyCallOutcomeCounts();
        callOutcomeGroups.forEach(group => {
            callOutcomes[group._id] = group.count;
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
            'accepted',
            'delivered',
            'read',
            'played',
            'call_session',
        ]);
        const activeEvents = grouped
            .filter(group => activeTypes.has(group._id.type))
            .reduce((sum, group) => sum + group.count, 0);

        return {
            totalEvents,
            activeEvents,
            firstEvent: firstEvents[0] || null,
            lastEvent: events[0] || null,
            lastPresence: events.find(event => event.source === 'presence') || null,
            lastCall: events.find(event => event.source === 'call') || null,
            lastMessage: events.find(event => event.source === 'message') || null,
            bySource,
            byType: consolidatedTypes.slice(0, 8),
            confidence,
            callOutcomes,
            messageDirections,
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
export async function getStateDistribution(
    jid: string,
    caseId?: string,
    trackingSessionId?: string,
): Promise<{
    online: number;
    standby: number;
    calibrating: number;
    noAck: number;
    unknown: number;
    /** @deprecated Compatibility alias for clients that predate the NO_ACK state. */
    offline: number;
    totalMeasurements: number;
    conclusiveMeasurements: number;
    inconclusiveMeasurements: number;
    acknowledgedRttMeasurements: number;
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
        calibrating: 0,
        noAck: 0,
        unknown: 0,
        offline: 0,
        totalMeasurements: 0,
        conclusiveMeasurements: 0,
        inconclusiveMeasurements: 0,
        acknowledgedRttMeasurements: 0,
        firstSeen: null,
        lastSeen: null,
        lastOnline: null,
        avgRtt: 0,
        insights: buildStatsInsights([]),
        observedActivity: {
            totalEvents: 0,
            activeEvents: 0,
            firstEvent: null,
            lastEvent: null,
            lastPresence: null,
            lastCall: null,
            lastMessage: null,
            bySource: {},
            byType: [],
            confidence: {},
            callOutcomes: emptyCallOutcomeCounts(),
            messageDirections: { incoming: 0, outgoing: 0 },
            activeDays: 0,
            windowDays: 30,
        },
    };
    if (!db) return empty;
    try {
        const measurementMatch = buildObservationScope(jid, caseId, trackingSessionId);
        const pipeline = [
            { $match: measurementMatch },
            {
                $group: {
                    _id: '$jid',
                    totalMeasurements: { $sum: 1 },
                    firstSeen: { $min: '$timestamp' },
                    lastSeen: { $max: '$timestamp' },
                    samples: { $push: { state: '$state', rtt: '$rtt' } }
                }
            }
        ];

        const result = await measurements.aggregate<{
            firstSeen: Date | null;
            lastSeen: Date | null;
            samples?: Array<{ state?: unknown; rtt?: unknown }>;
        }>(pipeline).toArray();
        const [r] = result;
        if (!r) {
            return {
                ...empty,
                observedActivity: await getObservedActivitySummary(jid, 30, caseId, trackingSessionId),
            };
        }

        const samples = Array.isArray(r.samples)
            ? r.samples as Array<{ state?: unknown; rtt?: unknown }>
            : [];
        const states = samples.map(sample => sample.state);
        const stateCounts = summarizeTrackerStates(states);
        const total = stateCounts.total;
        const conclusiveMeasurements = states.filter(isConclusiveTrackerState).length;
        const acknowledgedRtts = samples
            .filter(sample => (
                hasAcknowledgedTrackerRtt(sample.state)
                && typeof sample.rtt === 'number'
                && Number.isFinite(sample.rtt)
            ))
            .map(sample => sample.rtt as number);
        const percentage = (count: number) => total > 0 ? Math.round((count / total) * 100) : 0;
        const noAckPercentage = percentage(stateCounts.noAck);

        // Find last online timestamp
        const lastOnlineDoc = await measurements
            .find({ ...measurementMatch, state: { $regex: ONLINE_TRACKER_STATE_REGEX } })
            .sort({ timestamp: -1 })
            .limit(1)
            .toArray();
        const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
        const insightDocs = await measurements
            .find({ ...measurementMatch, timestamp: { $gte: since } }, { projection: { state: 1, rtt: 1, timestamp: 1 } })
            .sort({ timestamp: 1 })
            .toArray();

        const observedActivity = await getObservedActivitySummary(jid, 30, caseId, trackingSessionId);

        const [lastOnline] = lastOnlineDoc;
        return {
            online: percentage(stateCounts.online),
            standby: percentage(stateCounts.standby),
            calibrating: percentage(stateCounts.calibrating),
            noAck: noAckPercentage,
            unknown: percentage(stateCounts.unknown),
            offline: noAckPercentage,
            totalMeasurements: total,
            conclusiveMeasurements,
            inconclusiveMeasurements: total - conclusiveMeasurements,
            acknowledgedRttMeasurements: acknowledgedRtts.length,
            firstSeen: r.firstSeen,
            lastSeen: r.lastSeen,
            lastOnline: lastOnline?.timestamp ?? null,
            avgRtt: acknowledgedRtts.length > 0
                ? Math.round(acknowledgedRtts.reduce((sum, rtt) => sum + rtt, 0) / acknowledgedRtts.length)
                : 0,
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
export async function generateReport(
    jid: string,
    caseId?: string,
    trackingSessionId?: string,
): Promise<{
    generatedAt: Date;
    contact: ContactDoc | null;
    stats: Awaited<ReturnType<typeof getStateDistribution>>;
    patterns: Awaited<ReturnType<typeof getOnlinePatterns>>;
    activityHistory: Awaited<ReturnType<typeof getActivityHistory>>;
    recentMeasurements: MeasurementDoc[];
    scope: {
        caseId: string | null;
        trackingSessionId: string | null;
    };
    observedActivityEvents: CommercialObservedActivityListItem[];
    observedActivityPage: PageMetadata;
    summary: {
        trackingDuration: string;
        totalAttempts: number;
        totalDataPoints: number;
        totalObservedEvents: number;
        measurementAvailable: boolean;
        avgResponseTime: number | null;
        onlinePercentage: number | null;
        peakActivityHour: string | null;
        estimatedDailyUsage: string | null;
    };
}> {
    const observedEventLimit = 5000;
    const [contact, stats, patterns, activity, recent, observedEvents, observedEventCount, observedBounds] = await Promise.all([
        getContactProfile(jid),
        getStateDistribution(jid, caseId, trackingSessionId),
        getOnlinePatterns(jid, trackingSessionId),
        getActivityHistory(jid, 200, trackingSessionId),
        getRecentMeasurements(jid, 500, trackingSessionId),
        trackingSessionId ? getCommercialObservedActivityEvents(jid, trackingSessionId, observedEventLimit) : Promise.resolve([]),
        trackingSessionId ? countCommercialObservedActivityEvents(jid, caseId, trackingSessionId) : Promise.resolve(0),
        trackingSessionId
            ? getObservedActivityBounds(jid, caseId, trackingSessionId)
            : Promise.resolve({ firstEventAt: null, lastEventAt: null }),
    ]);

    // Calculate the observation window from both technical measurements and
    // passive events. Passive-only sessions must not report a zero/unknown
    // duration merely because RTT is unavailable.
    const observationWindow = buildObservationWindow(
        stats.firstSeen,
        stats.lastSeen,
        observedBounds.firstEventAt,
        observedBounds.lastEventAt,
    );
    const durationHours = observationWindow.durationMs / (1000 * 60 * 60);
    const durationDays = durationHours / 24;

    // Peak activity hour formatted
    const peakHour = patterns.peakHour >= 0 ? `${patterns.peakHour}:00 - ${patterns.peakHour + 1}:00` : null;

    // Estimated daily usage
    const totalMinutes = patterns.totalOnlineMinutes;
    const monitoredDays = Math.max(1, durationDays);
    const dailyMinutes = Math.round(totalMinutes / monitoredDays);
    const estimatedDailyUsage = stats.conclusiveMeasurements <= 0
        ? null
        : dailyMinutes > 60
            ? `${Math.floor(dailyMinutes / 60)}h ${dailyMinutes % 60}m`
            : `${dailyMinutes}m`;
    const observedActivityPage = buildPageMetadata(
        observedEvents.length,
        observedEventCount,
        observedEventLimit,
    );

    return {
        generatedAt: new Date(),
        contact,
        stats,
        patterns,
        activityHistory: activity,
        recentMeasurements: recent,
        scope: {
            caseId: caseId || null,
            trackingSessionId: trackingSessionId || null,
        },
        observedActivityEvents: observedEvents,
        observedActivityPage,
        summary: {
            trackingDuration: observationWindow.label,
            totalAttempts: stats.totalMeasurements,
            totalDataPoints: stats.conclusiveMeasurements,
            totalObservedEvents: observedActivityPage.total,
            measurementAvailable: stats.acknowledgedRttMeasurements > 0,
            avgResponseTime: stats.acknowledgedRttMeasurements > 0 ? stats.avgRtt : null,
            onlinePercentage: stats.conclusiveMeasurements > 0 ? stats.online : null,
            peakActivityHour: peakHour,
            estimatedDailyUsage,
        },
    };
}

// ── Call Analysis Persistence ─────────────────────────────────

/**
 * Save a call analysis result to MongoDB
 */
export async function saveCallAnalysis(result: CallAnalysisResult, caseId: string): Promise<void> {
    if (!db) return;
    try {
        await callAnalyses.updateOne(
            { caseId, callId: result.callId },
            {
                $set: {
                    ...result,
                    caseId,
                    updatedAt: new Date(),
                },
                $setOnInsert: {
                    savedAt: new Date(),
                },
            },
            { upsert: true }
        );
        console.log(`[DB] Call analysis saved (${result.verdict})`);
    } catch (err) {
        console.error('[DB] Error saving call analysis:', err);
    }
}

/**
 * Get call analysis history for a contact
 */
export function buildCallAnalysisScope(jid: string, caseId?: string): Record<string, unknown> {
    return { targetJid: jid, ...(caseId ? { caseId } : {}) };
}

export async function getCallAnalyses(
    jid: string,
    limit: number = 20,
    caseId?: string,
): Promise<CallAnalysisResult[]> {
    if (!db) return [];
    try {
        return await callAnalyses
            .find(buildCallAnalysisScope(jid, caseId))
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

export async function getCallAnalysesByCallIds(callIds: string[], caseId?: string): Promise<CallAnalysisResult[]> {
    if (!db || callIds.length === 0) return [];
    try {
        return await callAnalyses
            .find({
                callId: { $in: Array.from(new Set(callIds)) },
                ...(caseId ? { caseId } : {}),
            })
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
        console.log(`[AUDIT] ${event.scope}:${event.action}`);
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

// -- Single-operator authentication ---------------------------------------

function requireOperatorUsersCollection(): Collection<OperatorUserDoc> {
    if (!db || !operatorUsers) throw new Error('MongoDB operator repository is unavailable');
    return operatorUsers;
}

export async function getPrimaryOperator(): Promise<OperatorUserDoc | null> {
    return requireOperatorUsersCollection().findOne({ _id: PRIMARY_OPERATOR_ID });
}

export async function findOperatorByNormalizedUsername(normalizedUsername: string): Promise<OperatorUserDoc | null> {
    return requireOperatorUsersCollection().findOne({
        _id: PRIMARY_OPERATOR_ID,
        normalizedUsername,
    });
}

export async function createPrimaryOperator(input: {
    username: string;
    normalizedUsername: string;
    passwordHash: string;
    now: Date;
}): Promise<{ user: OperatorUserDoc; created: boolean }> {
    const collection = requireOperatorUsersCollection();
    let created = false;
    try {
        const result = await collection.updateOne(
            { _id: PRIMARY_OPERATOR_ID },
            {
                $setOnInsert: {
                    _id: PRIMARY_OPERATOR_ID,
                    username: input.username,
                    normalizedUsername: input.normalizedUsername,
                    passwordHash: input.passwordHash,
                    credentialVersion: 1,
                    createdAt: input.now,
                    updatedAt: input.now,
                    passwordChangedAt: input.now,
                    lastLoginAt: null,
                },
            },
            { upsert: true },
        );
        created = result.upsertedCount === 1;
    } catch (error) {
        const mongoCode = typeof error === 'object' && error !== null && 'code' in error
            ? Number((error as { code?: unknown }).code)
            : null;
        if (mongoCode !== 11_000) throw error;
    }

    const user = await collection.findOne({ _id: PRIMARY_OPERATOR_ID });
    if (!user) throw new Error('MongoDB failed to persist the primary operator');
    return { user, created };
}

export async function updatePrimaryOperatorCredentials(input: {
    expectedCredentialVersion: number;
    username: string;
    normalizedUsername: string;
    passwordHash: string;
    passwordChanged: boolean;
    now: Date;
}): Promise<OperatorUserDoc | null> {
    const setFields: Partial<OperatorUserDoc> = {
        username: input.username,
        normalizedUsername: input.normalizedUsername,
        passwordHash: input.passwordHash,
        updatedAt: input.now,
    };
    if (input.passwordChanged) setFields.passwordChangedAt = input.now;

    return requireOperatorUsersCollection().findOneAndUpdate(
        {
            _id: PRIMARY_OPERATOR_ID,
            credentialVersion: input.expectedCredentialVersion,
        },
        {
            $set: setFields,
            $inc: { credentialVersion: 1 },
        },
        { returnDocument: 'after' },
    );
}

export async function recordPrimaryOperatorLogin(now: Date): Promise<void> {
    const result = await requireOperatorUsersCollection().updateOne(
        { _id: PRIMARY_OPERATOR_ID },
        { $set: { lastLoginAt: now } },
    );
    if (result.matchedCount !== 1) throw new Error('Primary operator does not exist');
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

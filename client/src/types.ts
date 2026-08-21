export interface CallGeoInfo {
    country: string;
    region: string;
    city: string;
    lat: number;
    lon: number;
    timezone: string;
}

export interface CandidateIP {
    ip: string;
    packets: number;
    bytesTotal: number;
    firstSeen: string;
    lastSeen: string;
    avgSize: number;
    ports: number[];
    direction: 'incoming' | 'outgoing' | 'bidirectional';
    provider: 'meta' | 'google' | 'cloudflare' | 'unknown';
    networkCategory?: 'meta' | 'stun_turn' | 'cdn' | 'cloud_hosting' | 'consumer_isp_or_unknown' | 'unknown_public';
    networkIntelligence?: {
        asn: number | null;
        org: string;
        category: 'meta' | 'stun_turn' | 'cdn' | 'cloud_hosting' | 'consumer_isp_or_unknown' | 'unknown';
        source: 'local_rules';
        isDatacenterLikely: boolean;
        caution: string;
    };
    geo: CallGeoInfo | null;
    confidence: 'high' | 'medium' | 'low';
    confidenceScore?: number;
    reasonCodes?: Array<{
        code: string;
        label: string;
        delta: number;
    }>;
    technicalNote?: string;
    isP2P: boolean;
    correlation?: {
        classification: 'candidate' | 'weak' | 'insufficient' | 'context_mismatch' | 'infrastructure';
        label: string;
        summary: string;
        phoneCountryCode?: string | null;
        observedCountryCode?: string | null;
        caps: string[];
    };
    ipEnrichment?: {
        ip: string;
        provider: 'db-ip' | 'db-ip+ip-api' | 'ip-api';
        sourceUrl: string;
        sources?: Array<{
            provider: 'db-ip' | 'ip-api';
            sourceUrl: string;
            status: 'success' | 'fail' | 'skipped';
            message?: string;
            fetchedAt: string;
        }>;
        status: 'success' | 'fail' | 'skipped';
        message?: string;
        continent?: string;
        country?: string;
        countryCode?: string;
        region?: string;
        regionName?: string;
        city?: string;
        postalCode?: string;
        lat?: number;
        lon?: number;
        timezone?: string;
        isp?: string;
        org?: string;
        asn?: number | null;
        asName?: string;
        mobile?: boolean;
        proxy?: boolean;
        hosting?: boolean;
        mapsUrl?: string;
        fetchedAt: string;
        cacheTtlSec: number;
        accuracyNote: string;
    };
}

export interface CallAnalysisResult {
    callId: string;
    targetJid: string;
    startTime: string;
    endTime: string | null;
    durationSec: number;
    isVideo: boolean;
    totalPackets: number;
    candidateIps: CandidateIP[];
    metaIps: string[];
    verdict: 'p2p' | 'relay' | 'mixed' | 'insufficient_data';
    captureInterface: string;
}

export interface CallEvent {
    callId: string;
    from: string;
    status: string;
    isVideo: boolean;
    date?: string | number;
    offline?: boolean;
    latencyMs?: number;
}

export interface CallCaptureStarted {
    callId: string;
    targetJid: string;
}

export interface TrackerDeviceInfo {
    jid: string;
    state: string;
    rtt: number;
    avg: number;
}

function trackerStatePriority(state: string): number {
    const normalized = state.trim().toUpperCase();
    if (normalized.startsWith('ONLINE')) return 0;
    if (normalized === 'STANDBY') return 1;
    if (normalized.startsWith('CALIBRATING')) return 2;
    if (normalized === 'NO_ACK' || normalized === 'OFFLINE' || normalized === 'SIN ACK') return 3;
    return 4;
}

export function selectPrimaryTrackerDevice<T extends TrackerDeviceInfo>(devices: readonly T[]): T | undefined {
    return devices.reduce<T | undefined>((selected, device) => (
        !selected || trackerStatePriority(device.state) < trackerStatePriority(selected.state)
            ? device
            : selected
    ), undefined);
}

export interface AuditEvent {
    _id?: string;
    caseId: string;
    operatorName: string;
    authorizationNote: string;
    action: string;
    scope: 'network' | 'call' | 'contact' | 'report' | 'system';
    targetJid?: string | null;
    details?: Record<string, unknown>;
    timestamp: string;
    timestampUtc: string;
}

export interface ObservedActivityEvent {
    source: 'presence' | 'call' | 'message' | 'receipt';
    type: string;
    label: string;
    confidence: 'none' | 'low' | 'medium' | 'high';
    timestamp: string;
    timestampUtc: string;
}

export interface ObservedActivityResponse {
    active: boolean;
    caseId: string | null;
    trackingSessionId: string | null;
    trackingStartedAt: string | null;
    events: ObservedActivityEvent[];
}

export type CaseStatus = 'draft' | 'authorized' | 'active' | 'closed' | 'archived';

export interface CaseRecord {
    _id?: string;
    caseId: string;
    title: string;
    description: string | null;
    status: CaseStatus;
    primaryOperator: string;
    authorizationNote: string;
    tags: string[];
    createdAt: string;
    updatedAt: string;
    openedAt: string | null;
    closedAt: string | null;
    lastAuditAt: string | null;
    lastAuditAction: string | null;
}

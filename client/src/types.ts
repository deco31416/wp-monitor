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
    networkCategory?: 'meta' | 'stun_turn' | 'dns' | 'cdn' | 'cloud_hosting' | 'consumer_isp_or_unknown' | 'unknown_public';
    networkIntelligence?: {
        asn: number | null;
        org: string;
        category: 'meta' | 'stun_turn' | 'dns' | 'cdn' | 'cloud_hosting' | 'consumer_isp_or_unknown' | 'unknown';
        source: 'local_rules' | 'enrichment';
        isDatacenterLikely: boolean;
        caution: string;
        registryEvidence?: {
            schemaVersion: 1;
            registryVersion: string;
            registryPublishedAt: string;
            status: 'fresh' | 'stale' | 'source_unavailable' | 'unknown' | 'invalid';
            entryId: string | null;
            matchedCidr: string | null;
            provider: 'meta' | 'google' | 'cloudflare' | 'unknown';
            category: 'meta' | 'stun_turn' | 'dns' | 'cdn' | 'cloud_hosting' | null;
            endpointRole: 'relay' | 'stun_turn' | 'dns' | 'cdn' | 'cloud_hosting' | 'own_public_endpoint' | 'unknown';
            asn: number | null;
            org: string;
            source: {
                id: string;
                label: string;
                uri: string | null;
                kind: 'authoritative' | 'community_snapshot' | 'observed_heuristic' | 'runtime_observation';
                retrievedAt: string;
                validUntil: string;
            } | null;
            competingEntryIds: string[];
            degraded: boolean;
            caution: string;
        };
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
    addressFamily?: 4 | 6;
    endpointRole?: 'direct_candidate' | 'relay' | 'stun_turn' | 'dns' | 'background' | 'own_public_endpoint' | 'unknown';
    baselinePackets?: number;
    activeCallPackets?: number;
    protocolEvidence?: Array<'stun_binding_request' | 'stun_binding_response' | 'stun_other' | 'transport_flow' | 'frame_length_86'>;
    scoreVersion?: 2;
}

export interface SanitizedCallEndpoint {
    ip: string;
    port: number;
    addressFamily: 4 | 6;
    role: 'peer_candidate' | 'relay' | 'unknown';
    source: 'baileys_transport';
    relayName?: string;
    rttMs?: number;
}

export interface CallTransportEvidence {
    firstObservedAt: string;
    lastObservedAt: string;
    peerNegotiationObserved: boolean;
    relayNegotiationObserved: boolean;
    keepaliveObserved: boolean;
    candidateRounds: number[];
    endpoints: SanitizedCallEndpoint[];
    limitations: string[];
}

export interface CallRouteAssessment {
    assessmentVersion: 2;
    classification: 'direct_confirmed' | 'direct_probable' | 'relay_confirmed' | 'mixed' | 'unresolved';
    confidenceScore: number;
    evidenceSources: Array<'baileys_transport' | 'packet_flow' | 'stun' | 'baseline' | 'infrastructure_registry' | 'ip_enrichment'>;
    independentDirectEvidenceCount: number;
    primaryCandidateIp: string | null;
    reasonCodes: string[];
    limitations: string[];
}

export interface SanitizedStunEndpoint {
    ip: string;
    port: number;
    addressFamily: 4 | 6;
    role: 'own_public_endpoint' | 'peer_candidate' | 'relay' | 'stun_turn';
    source: 'stun';
}

export interface CallCapturePhases {
    baselineAvailable: boolean;
    baselineStartedAt: string | null;
    baselineEndedAt: string | null;
    negotiationStartedAt: string | null;
    activeCallStartedAt: string | null;
    callEndedAt?: string | null;
    captureEndedAt?: string | null;
    phaseEvidenceVersion?: 1;
    phaseEvidence?: CallCapturePhaseEvidence[];
}

export interface CallCapturePhaseEvidence {
    sequence: number;
    kind: 'baseline_started' | 'negotiation_started' | 'active_started' | 'call_ended' | 'capture_ended';
    at: string;
    source: 'capture_start' | 'capture_stop' | 'baileys_normalized' | 'baileys_raw' | 'operator_marker' | 'network_onset';
    confidence: 'system' | 'protocol' | 'operator_asserted' | 'inferred';
    status?: 'offer' | 'ringing' | 'preaccept' | 'transport' | 'relaylatency' | 'accept' | 'reject' | 'timeout' | 'terminate';
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
    schemaVersion?: 2;
    capturePhases?: CallCapturePhases;
    stunEndpoints?: SanitizedStunEndpoint[];
    transportEvidence?: CallTransportEvidence;
    routeAssessment?: CallRouteAssessment;
    captureBounds?: {
        packetLimit: number;
        storedPackets: number;
        droppedPackets: number;
        truncated: boolean;
    };
}

export interface CallEvent {
    callId: string;
    from: string;
    status: string;
    label?: string;
    isVideo: boolean;
    date?: string | number;
    offline?: boolean;
    latencyMs?: number;
}

export interface CallCaptureStarted {
    callId: string;
    targetJid: string;
    trigger: 'manual' | 'auto';
}

export type OperatorCallMarker = 'call_started' | 'call_connected' | 'call_ended';

export interface CallCaptureMarkerAcknowledgement {
    ok: true;
    callId: string;
    targetJid: string;
    marker: OperatorCallMarker;
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
    call?: {
        outcome: 'incoming' | 'ringing' | 'active' | 'completed' | 'busy' | 'rejected' | 'missed' | 'ended_unconfirmed';
        direction: 'incoming' | 'outgoing' | 'unknown';
        evidence: 'protocol_confirmed' | 'protocol_observed';
        signalCount: number;
        technicalSignalCount: number;
        startedAt: string;
        endedAt: string | null;
        durationSec: number | null;
        relayLatencyMs: number | null;
        isVideo: boolean;
    };
}

export interface ObservedActivityResponse {
    active: boolean;
    caseId: string | null;
    trackingSessionId: string | null;
    trackingStartedAt: string | null;
    page: {
        returned: number;
        total: number;
        truncated: boolean;
        limit: number;
    };
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

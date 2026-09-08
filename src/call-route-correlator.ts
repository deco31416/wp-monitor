import type {
    CallAnalysisResult,
    CallRouteAssessment,
    CallRouteEvidenceSource,
    CandidateIP,
} from './call-analyzer.js';

const INFRASTRUCTURE_ROLES = new Set([
    'relay',
    'stun_turn',
    'dns',
    'background',
    'own_public_endpoint',
]);

const INFRASTRUCTURE_CATEGORIES = new Set([
    'meta',
    'stun_turn',
    'dns',
    'cdn',
    'cloud_hosting',
    'cloud_or_cdn',
]);

function activePackets(candidate: CandidateIP): number {
    return candidate.activeCallPackets ?? candidate.packets;
}

function isInfrastructure(candidate: CandidateIP): boolean {
    return candidate.provider === 'meta'
        || INFRASTRUCTURE_ROLES.has(candidate.endpointRole ?? 'unknown')
        || INFRASTRUCTURE_CATEGORIES.has(candidate.networkCategory)
        || candidate.networkIntelligence.isDatacenterLikely;
}

function isDirectPacketCandidate(candidate: CandidateIP): boolean {
    return !isInfrastructure(candidate)
        && candidate.isP2P
        && candidate.direction === 'bidirectional'
        && activePackets(candidate) >= 20
        && candidate.confidenceScore >= 35;
}

function addSource(sources: Set<CallRouteEvidenceSource>, source: CallRouteEvidenceSource, condition = true): void {
    if (condition) sources.add(source);
}

function unique(values: string[]): string[] {
    return [...new Set(values)];
}

function legacyVerdict(classification: CallRouteAssessment['classification']): CallAnalysisResult['verdict'] {
    if (classification === 'direct_confirmed' || classification === 'direct_probable') return 'p2p';
    if (classification === 'relay_confirmed') return 'relay';
    if (classification === 'mixed') return 'mixed';
    return 'insufficient_data';
}

/**
 * Produces the backend-owned route conclusion. Enrichment and registry data can
 * classify or limit evidence, but can never prove a direct route by themselves.
 */
export function correlateCallRoute(result: CallAnalysisResult): CallAnalysisResult {
    const sources = new Set<CallRouteEvidenceSource>();
    const reasons: string[] = [];
    const limitations: string[] = [...(result.transportEvidence?.limitations ?? [])];
    const transportPeerIps = new Set(
        (result.transportEvidence?.endpoints ?? [])
            .filter(endpoint => endpoint.role === 'peer_candidate')
            .map(endpoint => endpoint.ip),
    );
    const transportRelayObserved = Boolean(
        result.transportEvidence?.relayNegotiationObserved
        || result.transportEvidence?.endpoints.some(endpoint => endpoint.role === 'relay'),
    );
    const stunPeerIps = new Set(
        (result.stunEndpoints ?? [])
            .filter(endpoint => endpoint.role === 'peer_candidate')
            .map(endpoint => endpoint.ip),
    );

    const directCandidates = result.candidateIps
        .filter(isDirectPacketCandidate)
        .sort((left, right) => (
            right.confidenceScore - left.confidenceScore
            || activePackets(right) - activePackets(left)
        ));
    const exactTransportCandidate = directCandidates.find(candidate => transportPeerIps.has(candidate.ip));
    const exactStunCandidate = directCandidates.find(candidate => stunPeerIps.has(candidate.ip));
    const primaryCandidate = exactTransportCandidate ?? exactStunCandidate ?? directCandidates[0] ?? null;

    const packetRelayObserved = result.candidateIps.some(candidate => (
        (candidate.provider === 'meta' || candidate.endpointRole === 'relay' || candidate.networkCategory === 'meta')
        && activePackets(candidate) >= 10
    ));
    const relayObserved = packetRelayObserved || transportRelayObserved;

    addSource(sources, 'packet_flow', result.totalPackets > 0);
    addSource(sources, 'baileys_transport', Boolean(result.transportEvidence));
    addSource(sources, 'stun', Boolean(result.stunEndpoints?.length));
    addSource(sources, 'baseline', result.capturePhases?.baselineAvailable === true);
    addSource(sources, 'infrastructure_registry', result.candidateIps.some(candidate => (
        candidate.networkIntelligence.registryEvidence?.entryId !== null
        && candidate.networkIntelligence.registryEvidence?.entryId !== undefined
    )));
    addSource(sources, 'ip_enrichment', result.candidateIps.some(candidate => candidate.ipEnrichment?.status === 'success'));

    let directClassification: 'direct_confirmed' | 'direct_probable' | null = null;
    let independentDirectEvidenceCount = 0;
    if (exactTransportCandidate) {
        directClassification = 'direct_confirmed';
        independentDirectEvidenceCount = 2;
        reasons.push('PACKET_FLOW_MATCHES_BAILEYS_PEER');
    } else if (primaryCandidate && primaryCandidate.confidenceScore >= 45) {
        directClassification = 'direct_probable';
        independentDirectEvidenceCount = 1;
        reasons.push(exactStunCandidate
            ? 'PACKET_FLOW_MATCHES_STUN_PEER_ONLY'
            : 'STRONG_DIRECT_PACKET_PATTERN');
    }

    if (result.transportEvidence?.peerNegotiationObserved && !exactTransportCandidate) {
        limitations.push('peer_signaling_without_attributable_endpoint');
    }
    if (exactStunCandidate && !exactTransportCandidate) {
        limitations.push('stun_peer_is_not_independent_confirmation');
    }
    if (result.capturePhases && !result.capturePhases.baselineAvailable) {
        limitations.push('baseline_unavailable');
    }
    if (result.captureBounds?.truncated) limitations.push('packet_capture_truncated');
    if (result.candidateIps.some(candidate => candidate.networkIntelligence.registryEvidence?.degraded)) {
        limitations.push('infrastructure_registry_degraded');
    }

    let classification: CallRouteAssessment['classification'];
    if (directClassification && relayObserved) {
        classification = 'mixed';
        reasons.push(
            directClassification === 'direct_confirmed'
                ? 'DIRECT_CONFIRMED_WITH_RELAY'
                : 'DIRECT_PROBABLE_WITH_RELAY',
        );
    } else if (directClassification) {
        classification = directClassification;
    } else if (relayObserved) {
        classification = 'relay_confirmed';
        reasons.push(transportRelayObserved ? 'BAILEYS_RELAY_OBSERVED' : 'RELAY_PACKET_FLOW_OBSERVED');
    } else {
        classification = 'unresolved';
        reasons.push('NO_CONCLUSIVE_ROUTE_EVIDENCE');
    }

    if (result.candidateIps.some(candidate => candidate.endpointRole === 'dns' || candidate.networkCategory === 'dns')) {
        reasons.push('DNS_EXCLUDED_FROM_DIRECT_EVIDENCE');
    }
    if (result.stunEndpoints?.length && !exactStunCandidate) reasons.push('STUN_CONTEXT_ONLY');
    if (!primaryCandidate) limitations.push('no_eligible_direct_candidate');

    let confidenceScore = classification === 'direct_confirmed'
        ? Math.min(95, Math.max(75, primaryCandidate?.confidenceScore ?? 75))
        : classification === 'direct_probable'
            ? Math.min(74, Math.max(45, primaryCandidate?.confidenceScore ?? 45))
            : classification === 'relay_confirmed'
                ? transportRelayObserved && packetRelayObserved ? 90 : 78
                : classification === 'mixed'
                    ? independentDirectEvidenceCount >= 2 ? 88 : 68
                    : Math.min(30, primaryCandidate?.confidenceScore ?? 0);
    if (result.captureBounds?.truncated) confidenceScore = Math.min(confidenceScore, 69);
    if (result.candidateIps.some(candidate => candidate.networkIntelligence.registryEvidence?.degraded)) {
        confidenceScore = Math.min(confidenceScore, 69);
    }

    const routeAssessment: CallRouteAssessment = {
        assessmentVersion: 2,
        classification,
        confidenceScore,
        evidenceSources: [...sources],
        independentDirectEvidenceCount,
        primaryCandidateIp: primaryCandidate?.ip ?? null,
        reasonCodes: unique(reasons),
        limitations: unique(limitations),
    };

    return {
        ...result,
        schemaVersion: 2,
        verdict: legacyVerdict(classification),
        routeAssessment,
    };
}

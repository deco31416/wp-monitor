import { isIP } from 'node:net';
import type { CallAnalysisResult, CallRouteAssessment, CallRouteEvidenceSource } from './call-analyzer.js';

const ROUTE_CLASSIFICATIONS = new Set<CallRouteAssessment['classification']>([
    'direct_confirmed',
    'direct_probable',
    'relay_confirmed',
    'mixed',
    'unresolved',
]);

const ROUTE_EVIDENCE_SOURCES = new Set<CallRouteEvidenceSource>([
    'baileys_transport',
    'packet_flow',
    'stun',
    'baseline',
    'infrastructure_registry',
    'ip_enrichment',
    'browser_webrtc',
    'five_tuple_flow',
    'stun_turn',
]);

const MAX_ROUTE_CODES = 16;
const MAX_ROUTE_CODE_LENGTH = 120;

function invalidStoredAssessment(): CallRouteAssessment {
    return {
        assessmentVersion: 2,
        classification: 'unresolved',
        confidenceScore: 0,
        evidenceSources: [],
        independentDirectEvidenceCount: 0,
        primaryCandidateIp: null,
        reasonCodes: [],
        limitations: ['stored_observation_invalid'],
    };
}

function isBoundedStringArray(value: unknown): value is string[] {
    return Array.isArray(value)
        && value.length <= MAX_ROUTE_CODES
        && value.every(item => typeof item === 'string' && item.length > 0 && item.length <= MAX_ROUTE_CODE_LENGTH);
}

/**
 * Treat persisted route assessments as untrusted historical input. Missing
 * assessments remain legacy data; malformed assessments degrade to an explicit
 * unresolved result instead of breaking the UI or report exports.
 */
export function normalizeStoredRouteAssessment(
    value: unknown,
    evidence?: Pick<CallAnalysisResult, 'browserWebRtcEvidence' | 'flowEvidence' | 'stunTurnEvidence'>,
): CallRouteAssessment | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'object' || Array.isArray(value)) return invalidStoredAssessment();

    const candidate = value as Record<string, unknown>;
    const classification = candidate.classification;
    const confidenceScore = candidate.confidenceScore;
    const independentDirectEvidenceCount = candidate.independentDirectEvidenceCount;
    const primaryCandidateIp = candidate.primaryCandidateIp;
    const evidenceSources = candidate.evidenceSources;
    const reasonCodes = candidate.reasonCodes;
    const limitations = candidate.limitations;

    const validAssessmentVersion = candidate.assessmentVersion === 2
        || candidate.assessmentVersion === 3
        || candidate.assessmentVersion === 4;
    const validShape = validAssessmentVersion
        && typeof classification === 'string'
        && ROUTE_CLASSIFICATIONS.has(classification as CallRouteAssessment['classification'])
        && typeof confidenceScore === 'number'
        && Number.isFinite(confidenceScore)
        && confidenceScore >= 0
        && confidenceScore <= 100
        && Number.isInteger(independentDirectEvidenceCount)
        && Number(independentDirectEvidenceCount) >= 0
        && Number(independentDirectEvidenceCount) <= ROUTE_EVIDENCE_SOURCES.size
        && (primaryCandidateIp === null || (typeof primaryCandidateIp === 'string' && isIP(primaryCandidateIp) !== 0))
        && isBoundedStringArray(evidenceSources)
        && evidenceSources.every(source => ROUTE_EVIDENCE_SOURCES.has(source as CallRouteEvidenceSource))
        && isBoundedStringArray(reasonCodes)
        && isBoundedStringArray(limitations);

    if (!validShape) return invalidStoredAssessment();

    const uniqueEvidenceSources = [...new Set(evidenceSources)] as CallRouteEvidenceSource[];
    const directEvidenceCount = Number(independentDirectEvidenceCount);
    const hasPrimaryCandidate = typeof primaryCandidateIp === 'string';
    const hasPacketEvidence = uniqueEvidenceSources.includes('packet_flow');
    const hasTransportEvidence = uniqueEvidenceSources.includes('baileys_transport');
    const hasBrowserFlowEvidence = uniqueEvidenceSources.includes('browser_webrtc')
        && uniqueEvidenceSources.includes('five_tuple_flow');
    const declaredBooksAvailable = evidence === undefined || (
        (!uniqueEvidenceSources.includes('browser_webrtc') || Boolean(evidence.browserWebRtcEvidence))
        && (!uniqueEvidenceSources.includes('five_tuple_flow') || Boolean(evidence.flowEvidence))
        && (!uniqueEvidenceSources.includes('stun_turn') || Boolean(evidence.stunTurnEvidence))
    );
    const browserFlowMatchAvailable = evidence === undefined || hasTransportEvidence || !hasBrowserFlowEvidence
        || evidence.browserWebRtcEvidence?.status === 'available'
            && evidence.browserWebRtcEvidence.selectedPairs.some(pair => (
                pair.selected
                && pair.state === 'succeeded'
                && pair.remote.address === primaryCandidateIp
                && pair.remote.port !== null
                && pair.local.candidateType !== 'relay'
                && pair.remote.candidateType !== 'relay'
                && evidence.flowEvidence?.flows.some(flow => (
                    flow.remoteIp === pair.remote.address
                    && flow.remotePort === pair.remote.port
                    && flow.protocol === pair.remote.protocol
                    && flow.direction === 'bidirectional'
                    && flow.phaseCounts.negotiation.packets + flow.phaseCounts.active.packets >= 20
                ))
            )) === true;
    const classificationSemanticsValid = classification === 'direct_confirmed'
        ? directEvidenceCount === 2
            && hasPrimaryCandidate
            && hasPacketEvidence
            && (hasTransportEvidence || hasBrowserFlowEvidence)
        : classification === 'direct_probable'
            ? directEvidenceCount === 1 && hasPrimaryCandidate && hasPacketEvidence
            : classification === 'mixed'
                ? (directEvidenceCount === 1 || directEvidenceCount === 2)
                    && hasPrimaryCandidate
                    && hasPacketEvidence
                    && (directEvidenceCount !== 2 || hasTransportEvidence || hasBrowserFlowEvidence)
                : directEvidenceCount === 0;
    const evidenceCardinalityValid = directEvidenceCount <= uniqueEvidenceSources.length;
    const unresolvedConfidenceValid = classification !== 'unresolved' || confidenceScore <= 30;

    if (
        !classificationSemanticsValid
        || !evidenceCardinalityValid
        || !unresolvedConfidenceValid
        || !declaredBooksAvailable
        || !browserFlowMatchAvailable
    ) {
        return invalidStoredAssessment();
    }

    return {
        assessmentVersion: candidate.assessmentVersion as 2 | 3 | 4,
        classification: classification as CallRouteAssessment['classification'],
        confidenceScore,
        evidenceSources: uniqueEvidenceSources,
        independentDirectEvidenceCount: directEvidenceCount,
        primaryCandidateIp: primaryCandidateIp as string | null,
        reasonCodes: [...new Set(reasonCodes)],
        limitations: [...new Set(limitations)],
    };
}

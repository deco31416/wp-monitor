import type { CallAnalysisResult, CandidateIP } from './call-analyzer.js';
import {
    normalizeCallCapturePhaseCounts,
    sumCallCapturePhaseCounts,
} from './call-capture-phases.js';

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function stripV3Scoring(candidate: CandidateIP): CandidateIP {
    const {
        scoreVersion: _scoreVersion,
        networkContext: _networkContext,
        scoreBreakdown: _scoreBreakdown,
        ...legacyCandidate
    } = candidate;
    return legacyCandidate;
}

function normalizeStoredCandidateScoring(candidate: CandidateIP): CandidateIP {
    if (candidate.scoreVersion === 2) {
        const { networkContext: _networkContext, scoreBreakdown: _scoreBreakdown, ...v2Candidate } = candidate;
        return v2Candidate;
    }
    if (candidate.scoreVersion !== 3) return stripV3Scoring(candidate);

    const context = asRecord(candidate.networkContext);
    const breakdown = asRecord(candidate.scoreBreakdown);
    const inputs = asRecord(breakdown?.inputs);
    const components = Array.isArray(breakdown?.components) ? breakdown.components : null;
    const caps = Array.isArray(breakdown?.caps) ? breakdown.caps : null;
    const componentTotal = components?.reduce((total, value) => {
        const component = asRecord(value);
        return typeof component?.delta === 'number' && Number.isInteger(component.delta)
            ? total + component.delta
            : Number.NaN;
    }, 0);
    let reconstructed = typeof breakdown?.rawScore === 'number' ? breakdown.rawScore : Number.NaN;
    const capsValid = caps !== null && caps.length <= 8 && caps.every(value => {
        const item = asRecord(value);
        if (
            typeof item?.maximum !== 'number'
            || typeof item.before !== 'number'
            || typeof item.after !== 'number'
        ) return false;
        const expected = Math.min(reconstructed, item.maximum);
        const valid = item.before === reconstructed && item.after === expected && item.after < item.before;
        reconstructed = item.after;
        return valid;
    });
    const targetCountryCode = context?.targetCountryCode;
    const observedCountryCode = context?.observedCountryCode;
    const expectedRelationship = typeof targetCountryCode === 'string' && typeof observedCountryCode === 'string'
        ? targetCountryCode === observedCountryCode ? 'match' : 'mismatch'
        : 'unavailable';
    const valid = context?.version === 1
        && context.affectsRouteScore === false
        && context.relationship === expectedRelationship
        && Array.isArray(context.reasonCodes)
        && context.reasonCodes.length <= 8
        && Array.isArray(context.limitations)
        && context.limitations.length <= 8
        && breakdown?.version === 3
        && Number.isInteger(breakdown.rawScore)
        && Number.isInteger(breakdown.finalScore)
        && breakdown.finalScore === candidate.confidenceScore
        && components !== null
        && components.length <= 32
        && JSON.stringify(components) === JSON.stringify(candidate.reasonCodes)
        && componentTotal === breakdown.rawScore
        && capsValid
        && Math.min(100, Math.max(0, reconstructed)) === breakdown.finalScore
        && inputs !== null
        && inputs.packets === (candidate.activeCallPackets ?? candidate.packets)
        && inputs.baselinePackets === (candidate.baselinePackets ?? 0)
        && Array.isArray(inputs.ports)
        && Array.isArray(inputs.protocolEvidence);
    return valid ? candidate : stripV3Scoring(candidate);
}

function withoutDetailedPhaseCounts(candidate: CandidateIP): CandidateIP {
    const { phaseCounts: _phaseCounts, ...legacyCandidate } = candidate;
    return legacyCandidate;
}

function normalizeLegacyCandidateCounts(candidate: CandidateIP): CandidateIP {
    const baseline = candidate.baselinePackets;
    const active = candidate.activeCallPackets;
    const valid = Number.isSafeInteger(baseline)
        && Number(baseline) >= 0
        && Number.isSafeInteger(active)
        && Number(active) >= 0
        && Number(baseline) + Number(active) === candidate.packets;
    if (valid) return candidate;
    const {
        baselinePackets: _baselinePackets,
        activeCallPackets: _activeCallPackets,
        ...candidateWithoutLegacyCounts
    } = candidate;
    return candidateWithoutLegacyCounts;
}

/**
 * Normalizes historical phase counters at the read boundary without rewriting
 * stored evidence. A detailed C5 book is all-or-nothing: partial or malformed
 * data is removed instead of being completed with inferred phase assignments.
 */
export function normalizeStoredCallPhaseData(result: CallAnalysisResult): CallAnalysisResult {
    const candidates = result.candidateIps.map(candidate => (
        normalizeStoredCandidateScoring(normalizeLegacyCandidateCounts(withoutDetailedPhaseCounts(candidate)))
    ));
    const globalCounts = normalizeCallCapturePhaseCounts(result.phaseCounts);
    const storedPackets = result.captureBounds?.storedPackets;
    const globalValid = globalCounts !== undefined
        && Number.isSafeInteger(storedPackets)
        && Number(storedPackets) >= 0
        && sumCallCapturePhaseCounts(globalCounts).packets === storedPackets;

    if (!globalValid) {
        const { phaseCounts: _phaseCounts, ...legacyResult } = result;
        return { ...legacyResult, candidateIps: candidates };
    }

    const detailedCandidates = result.candidateIps.map((candidate, index) => {
        const counts = normalizeCallCapturePhaseCounts(candidate.phaseCounts);
        if (!counts) return null;
        const totals = sumCallCapturePhaseCounts(counts);
        if (totals.packets !== candidate.packets || totals.bytes !== candidate.bytesTotal) return null;
        return { ...candidates[index]!, phaseCounts: counts };
    });
    if (detailedCandidates.some(candidate => candidate === null)) {
        const { phaseCounts: _phaseCounts, ...legacyResult } = result;
        return { ...legacyResult, candidateIps: candidates };
    }

    return {
        ...result,
        candidateIps: detailedCandidates as CandidateIP[],
        phaseCounts: globalCounts,
    };
}

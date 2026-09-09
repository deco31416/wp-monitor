import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { signCaptureAgentRequest, validateCaptureAgentSecret } from './capture-agent-auth.js';
import type { CallAnalysisResult, CallCaptureStatus, CandidateIP } from './call-analyzer.js';
import {
    CALL_CAPTURE_PHASE_STATUSES,
    type CallCapturePhaseStatus,
    type CallCaptureTrigger,
} from './call-capture-phases.js';
import type { NetworkInterface } from './packet-capture.js';
import type { NetworkIntelligence } from './call-scoring.js';
import { validateJid } from './validation.js';

export interface CaptureAgentClientOptions {
    baseUrl: string;
    sharedSecret: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    now?: () => number;
    nonce?: () => string;
}

export class CaptureAgentClientError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code: string,
    ) {
        super(message);
        this.name = 'CaptureAgentClientError';
    }
}

type JsonObject = Record<string, unknown>;

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const CALL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,119}$/;

function requireObject(value: unknown, context: string): JsonObject {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new CaptureAgentClientError(`${context} returned an invalid object`, 502, 'invalid_agent_response');
    }
    return value as JsonObject;
}

function requireString(value: unknown, field: string): string {
    if (typeof value !== 'string') {
        throw new CaptureAgentClientError(`Capture agent returned an invalid ${field}`, 502, 'invalid_agent_response');
    }
    return value;
}

function requireBoundedString(value: unknown, field: string, maximum: number): string {
    const string = requireString(value, field);
    if (string.length > maximum) {
        throw new CaptureAgentClientError(`Capture agent returned an invalid ${field}`, 502, 'invalid_agent_response');
    }
    return string;
}

function requireBoolean(value: unknown, field: string): boolean {
    if (typeof value !== 'boolean') {
        throw new CaptureAgentClientError(`Capture agent returned an invalid ${field}`, 502, 'invalid_agent_response');
    }
    return value;
}

function requireEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
    const string = requireString(value, field);
    if (!allowed.includes(string as T)) {
        throw new CaptureAgentClientError(`Capture agent returned an invalid ${field}`, 502, 'invalid_agent_response');
    }
    return string as T;
}

function requireArray(value: unknown, field: string, maximum: number): unknown[] {
    if (!Array.isArray(value) || value.length > maximum) {
        throw new CaptureAgentClientError(`Capture agent returned an invalid ${field}`, 502, 'invalid_agent_response');
    }
    return value;
}

function requireFiniteNumber(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new CaptureAgentClientError(`Capture agent returned an invalid ${field}`, 502, 'invalid_agent_response');
    }
    return value;
}

function requireNonNegativeNumber(value: unknown, field: string): number {
    const number = requireFiniteNumber(value, field);
    if (number < 0) {
        throw new CaptureAgentClientError(`Capture agent returned an invalid ${field}`, 502, 'invalid_agent_response');
    }
    return number;
}

function requireNonNegativeInteger(value: unknown, field: string): number {
    const number = requireNonNegativeNumber(value, field);
    if (!Number.isSafeInteger(number)) {
        throw new CaptureAgentClientError(`Capture agent returned an invalid ${field}`, 502, 'invalid_agent_response');
    }
    return number;
}

function requireIntegerInRange(value: unknown, field: string, minimum: number, maximum: number): number {
    const number = requireFiniteNumber(value, field);
    if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
        throw new CaptureAgentClientError(`Capture agent returned an invalid ${field}`, 502, 'invalid_agent_response');
    }
    return number;
}

function requireNumberInRange(value: unknown, field: string, minimum: number, maximum: number): number {
    const number = requireFiniteNumber(value, field);
    if (number < minimum || number > maximum) {
        throw new CaptureAgentClientError(`Capture agent returned an invalid ${field}`, 502, 'invalid_agent_response');
    }
    return number;
}

async function readBoundedResponseText(response: Response): Promise<string> {
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > MAX_RESPONSE_BYTES) {
        throw new CaptureAgentClientError('Capture agent response exceeded the allowed size', 502, 'agent_response_too_large');
    }
    if (!response.body) return '';

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw new CaptureAgentClientError('Capture agent response exceeded the allowed size', 502, 'agent_response_too_large');
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks, totalBytes).toString('utf8');
}

async function parseResponseJson(response: Response, label: string): Promise<unknown> {
    const text = await readBoundedResponseText(response);
    try {
        return text ? JSON.parse(text) : {};
    } catch {
        throw new CaptureAgentClientError(`${label} returned malformed JSON`, 502, 'invalid_agent_response');
    }
}

function requireDate(value: unknown, field: string): Date {
    const date = new Date(requireString(value, field));
    if (Number.isNaN(date.getTime())) {
        throw new CaptureAgentClientError(`Capture agent returned an invalid ${field}`, 502, 'invalid_agent_response');
    }
    return date;
}

function optionalDate(value: unknown, field: string): Date | null {
    return value === null ? null : requireDate(value, field);
}

function requireCallId(value: unknown, field: string): string {
    const callId = requireBoundedString(value, field, 120);
    if (!CALL_ID_PATTERN.test(callId)) {
        throw new CaptureAgentClientError(`Capture agent returned an invalid ${field}`, 502, 'invalid_agent_response');
    }
    return callId;
}

function requireJid(value: unknown, field: string): string {
    const parsed = validateJid(value, field);
    if (!parsed.ok || !parsed.value) {
        throw new CaptureAgentClientError(`Capture agent returned an invalid ${field}`, 502, 'invalid_agent_response');
    }
    return parsed.value;
}

function parseStatus(payload: unknown): CallCaptureStatus {
    const object = requireObject(payload, 'Capture agent');
    const isCapturing = requireBoolean(object.isCapturing, 'isCapturing');
    const targetJid = object.targetJid === null ? null : requireJid(object.targetJid, 'targetJid');
    const callId = object.callId === null ? null : requireCallId(object.callId, 'callId');
    const startTime = optionalDate(object.startTime, 'startTime');
    if (isCapturing !== Boolean(targetJid && callId && startTime)) {
        throw new CaptureAgentClientError('Capture agent returned an inconsistent capture status', 502, 'invalid_agent_response');
    }
    return {
        isCapturing,
        targetJid,
        callId,
        startTime,
        packetsCollected: requireNonNegativeInteger(object.packetsCollected, 'packetsCollected'),
        elapsed: requireNonNegativeNumber(object.elapsed, 'elapsed'),
    };
}

function parseRegistryEvidence(value: unknown): NonNullable<NetworkIntelligence['registryEvidence']> {
    const object = requireObject(value, 'candidate networkIntelligence.registryEvidence');
    const sourceObject = object.source === null
        ? null
        : requireObject(object.source, 'candidate networkIntelligence.registryEvidence.source');
    const source = sourceObject === null ? null : {
        id: requireBoundedString(sourceObject.id, 'registry source.id', 128),
        label: requireBoundedString(sourceObject.label, 'registry source.label', 512),
        uri: sourceObject.uri === null ? null : requireBoundedString(sourceObject.uri, 'registry source.uri', 2_048),
        kind: requireEnum(sourceObject.kind, 'registry source.kind', [
            'authoritative',
            'community_snapshot',
            'observed_heuristic',
            'runtime_observation',
        ]),
        retrievedAt: requireDate(sourceObject.retrievedAt, 'registry source.retrievedAt').toISOString(),
        validUntil: requireDate(sourceObject.validUntil, 'registry source.validUntil').toISOString(),
    };
    return {
        schemaVersion: requireIntegerInRange(object.schemaVersion, 'registry schemaVersion', 1, 1) as 1,
        registryVersion: requireBoundedString(object.registryVersion, 'registry registryVersion', 128),
        registryPublishedAt: requireDate(object.registryPublishedAt, 'registry registryPublishedAt').toISOString(),
        status: requireEnum(object.status, 'registry status', [
            'fresh', 'stale', 'source_unavailable', 'unknown', 'invalid',
        ]),
        entryId: object.entryId === null ? null : requireBoundedString(object.entryId, 'registry entryId', 128),
        matchedCidr: object.matchedCidr === null
            ? null
            : requireBoundedString(object.matchedCidr, 'registry matchedCidr', 128),
        provider: requireEnum(object.provider, 'registry provider', ['meta', 'google', 'cloudflare', 'unknown']),
        category: object.category === null
            ? null
            : requireEnum<NonNullable<NonNullable<NetworkIntelligence['registryEvidence']>['category']>>(
                object.category,
                'registry category',
                ['meta', 'stun_turn', 'dns', 'cdn', 'cloud_hosting'],
            ),
        endpointRole: requireEnum(object.endpointRole, 'registry endpointRole', [
            'relay', 'stun_turn', 'dns', 'cdn', 'cloud_hosting', 'own_public_endpoint', 'unknown',
        ]),
        asn: object.asn === null ? null : requireIntegerInRange(object.asn, 'registry asn', 0, 4_294_967_295),
        org: requireBoundedString(object.org, 'registry org', 512),
        source,
        competingEntryIds: requireArray(object.competingEntryIds, 'registry competingEntryIds', 64)
            .map((entry, index) => requireBoundedString(entry, `registry competingEntryIds[${index}]`, 128)),
        degraded: requireBoolean(object.degraded, 'registry degraded'),
        caution: requireBoundedString(object.caution, 'registry caution', 2_048),
    };
}

function parseCandidate(value: unknown): CandidateIP {
    const object = requireObject(value, 'Capture candidate');
    const ip = requireString(object.ip, 'candidate ip');
    const detectedAddressFamily = isIP(ip);
    if (detectedAddressFamily !== 4 && detectedAddressFamily !== 6) {
        throw new CaptureAgentClientError('Capture agent returned an invalid candidate ip', 502, 'invalid_agent_response');
    }
    const firstSeen = requireDate(object.firstSeen, 'candidate firstSeen');
    const lastSeen = requireDate(object.lastSeen, 'candidate lastSeen');
    if (lastSeen.getTime() < firstSeen.getTime()) {
        throw new CaptureAgentClientError('Capture agent returned an invalid candidate time range', 502, 'invalid_agent_response');
    }

    const networkIntelligenceObject = requireObject(object.networkIntelligence, 'candidate networkIntelligence');
    const asn = networkIntelligenceObject.asn === null
        ? null
        : requireIntegerInRange(networkIntelligenceObject.asn, 'candidate networkIntelligence.asn', 0, 4_294_967_295);
    const geoObject = object.geo === null ? null : requireObject(object.geo, 'candidate geo');
    const reasonCodes = requireArray(object.reasonCodes, 'candidate reasonCodes', 64).map((reason, index) => {
        const reasonObject = requireObject(reason, `candidate reasonCodes[${index}]`);
        return {
            code: requireBoundedString(reasonObject.code, `candidate reasonCodes[${index}].code`, 128),
            label: requireBoundedString(reasonObject.label, `candidate reasonCodes[${index}].label`, 512),
            delta: requireNumberInRange(reasonObject.delta, `candidate reasonCodes[${index}].delta`, -1_000, 1_000),
        };
    });
    const correlationObject = object.correlation === undefined
        ? null
        : requireObject(object.correlation, 'candidate correlation');
    if (object.ipEnrichment !== undefined) {
        throw new CaptureAgentClientError('Capture agent returned unexpected candidate enrichment', 502, 'invalid_agent_response');
    }
    const addressFamily = object.addressFamily === undefined
        ? undefined
        : requireIntegerInRange(object.addressFamily, 'candidate addressFamily', 4, 6);
    if (addressFamily !== undefined && addressFamily !== 4 && addressFamily !== 6) {
        throw new CaptureAgentClientError('Capture agent returned an invalid candidate addressFamily', 502, 'invalid_agent_response');
    }
    if (addressFamily !== undefined && addressFamily !== detectedAddressFamily) {
        throw new CaptureAgentClientError('Capture agent returned an inconsistent candidate addressFamily', 502, 'invalid_agent_response');
    }
    const packets = requireNonNegativeInteger(object.packets, 'candidate packets');
    const baselinePackets = object.baselinePackets === undefined
        ? undefined
        : requireNonNegativeInteger(object.baselinePackets, 'candidate baselinePackets');
    const activeCallPackets = object.activeCallPackets === undefined
        ? undefined
        : requireNonNegativeInteger(object.activeCallPackets, 'candidate activeCallPackets');
    if ((baselinePackets === undefined) !== (activeCallPackets === undefined)) {
        throw new CaptureAgentClientError('Capture agent returned incomplete candidate phase counts', 502, 'invalid_agent_response');
    }
    if (baselinePackets !== undefined && activeCallPackets !== undefined && baselinePackets + activeCallPackets !== packets) {
        throw new CaptureAgentClientError('Capture agent returned inconsistent candidate phase counts', 502, 'invalid_agent_response');
    }

    return {
        ip,
        packets,
        bytesTotal: requireNonNegativeInteger(object.bytesTotal, 'candidate bytesTotal'),
        firstSeen,
        lastSeen,
        avgSize: requireNumberInRange(object.avgSize, 'candidate avgSize', 0, 65_535),
        ports: requireArray(object.ports, 'candidate ports', 4_096).map((port, index) => (
            requireIntegerInRange(port, `candidate ports[${index}]`, 0, 65_535)
        )),
        direction: requireEnum(object.direction, 'candidate direction', ['incoming', 'outgoing', 'bidirectional']),
        provider: requireEnum(object.provider, 'candidate provider', ['meta', 'google', 'cloudflare', 'unknown']),
        networkCategory: requireEnum(object.networkCategory, 'candidate networkCategory', [
            'meta',
            'stun_turn',
            'dns',
            'cdn',
            'cloud_hosting',
            'consumer_isp_or_unknown',
            'unknown_public',
        ]),
        networkIntelligence: {
            asn,
            org: requireBoundedString(networkIntelligenceObject.org, 'candidate networkIntelligence.org', 2_048),
            category: requireEnum(networkIntelligenceObject.category, 'candidate networkIntelligence.category', [
                'meta',
                'stun_turn',
                'dns',
                'cdn',
                'cloud_hosting',
                'consumer_isp_or_unknown',
                'unknown',
            ]),
            source: requireEnum(networkIntelligenceObject.source, 'candidate networkIntelligence.source', [
                'local_rules',
                'enrichment',
            ]),
            isDatacenterLikely: requireBoolean(
                networkIntelligenceObject.isDatacenterLikely,
                'candidate networkIntelligence.isDatacenterLikely',
            ),
            caution: requireBoundedString(
                networkIntelligenceObject.caution,
                'candidate networkIntelligence.caution',
                4_096,
            ),
            ...(networkIntelligenceObject.registryEvidence === undefined ? {} : {
                registryEvidence: parseRegistryEvidence(networkIntelligenceObject.registryEvidence),
            }),
        },
        geo: geoObject === null ? null : {
            country: requireBoundedString(geoObject.country, 'candidate geo.country', 128),
            region: requireBoundedString(geoObject.region, 'candidate geo.region', 256),
            city: requireBoundedString(geoObject.city, 'candidate geo.city', 256),
            lat: requireNumberInRange(geoObject.lat, 'candidate geo.lat', -90, 90),
            lon: requireNumberInRange(geoObject.lon, 'candidate geo.lon', -180, 180),
            timezone: requireBoundedString(geoObject.timezone, 'candidate geo.timezone', 128),
        },
        confidence: requireEnum(object.confidence, 'candidate confidence', ['high', 'medium', 'low']),
        confidenceScore: requireIntegerInRange(object.confidenceScore, 'candidate confidenceScore', 0, 100),
        reasonCodes,
        technicalNote: requireBoundedString(object.technicalNote, 'candidate technicalNote', 4_096),
        isP2P: requireBoolean(object.isP2P, 'candidate isP2P'),
        ...(addressFamily === undefined ? {} : { addressFamily: addressFamily as 4 | 6 }),
        ...(object.endpointRole === undefined ? {} : {
            endpointRole: requireEnum(object.endpointRole, 'candidate endpointRole', [
                'direct_candidate',
                'relay',
                'stun_turn',
                'dns',
                'background',
                'own_public_endpoint',
                'unknown',
            ]),
        }),
        ...(baselinePackets === undefined ? {} : { baselinePackets }),
        ...(activeCallPackets === undefined ? {} : { activeCallPackets }),
        ...(object.protocolEvidence === undefined ? {} : {
            protocolEvidence: requireArray(object.protocolEvidence, 'candidate protocolEvidence', 16).map((entry, index) => (
                requireEnum(entry, `candidate protocolEvidence[${index}]`, [
                    'stun_binding_request',
                    'stun_binding_response',
                    'stun_other',
                    'transport_flow',
                    'frame_length_86',
                ])
            )),
        }),
        ...(object.scoreVersion === undefined ? {} : {
            scoreVersion: requireIntegerInRange(object.scoreVersion, 'candidate scoreVersion', 2, 2) as 2,
        }),
        ...(correlationObject ? {
            correlation: {
                classification: requireEnum(correlationObject.classification, 'candidate correlation.classification', [
                    'candidate',
                    'weak',
                    'insufficient',
                    'context_mismatch',
                    'infrastructure',
                ]),
                label: requireBoundedString(correlationObject.label, 'candidate correlation.label', 512),
                summary: requireBoundedString(correlationObject.summary, 'candidate correlation.summary', 2_048),
                ...(correlationObject.phoneCountryCode === undefined ? {} : {
                    phoneCountryCode: correlationObject.phoneCountryCode === null
                        ? null
                        : requireBoundedString(
                            correlationObject.phoneCountryCode,
                            'candidate correlation.phoneCountryCode',
                            8,
                        ),
                }),
                ...(correlationObject.observedCountryCode === undefined ? {} : {
                    observedCountryCode: correlationObject.observedCountryCode === null
                        ? null
                        : requireBoundedString(
                            correlationObject.observedCountryCode,
                            'candidate correlation.observedCountryCode',
                            8,
                        ),
                }),
                caps: requireArray(correlationObject.caps, 'candidate correlation.caps', 64).map((cap, index) => (
                    requireBoundedString(cap, `candidate correlation.caps[${index}]`, 512)
                )),
            },
        } : {}),
    };
}

function parseCapturePhases(value: unknown): NonNullable<CallAnalysisResult['capturePhases']> {
    const object = requireObject(value, 'capturePhases');
    const baselineAvailable = requireBoolean(object.baselineAvailable, 'capturePhases.baselineAvailable');
    const baselineStartedAt = optionalDate(object.baselineStartedAt, 'capturePhases.baselineStartedAt');
    const baselineEndedAt = optionalDate(object.baselineEndedAt, 'capturePhases.baselineEndedAt');
    const negotiationStartedAt = optionalDate(object.negotiationStartedAt, 'capturePhases.negotiationStartedAt');
    const activeCallStartedAt = optionalDate(object.activeCallStartedAt, 'capturePhases.activeCallStartedAt');

    if (baselineAvailable !== Boolean(baselineStartedAt && baselineEndedAt)) {
        throw new CaptureAgentClientError('Capture agent returned inconsistent baseline phases', 502, 'invalid_agent_response');
    }
    if (baselineStartedAt && baselineEndedAt && baselineEndedAt.getTime() < baselineStartedAt.getTime()) {
        throw new CaptureAgentClientError('Capture agent returned an invalid baseline time range', 502, 'invalid_agent_response');
    }
    if (baselineEndedAt && negotiationStartedAt && negotiationStartedAt.getTime() < baselineEndedAt.getTime()) {
        throw new CaptureAgentClientError('Capture agent returned overlapping baseline and negotiation phases', 502, 'invalid_agent_response');
    }
    if (negotiationStartedAt && activeCallStartedAt && activeCallStartedAt.getTime() < negotiationStartedAt.getTime()) {
        throw new CaptureAgentClientError('Capture agent returned an invalid active call phase', 502, 'invalid_agent_response');
    }
    if (activeCallStartedAt && !negotiationStartedAt) {
        throw new CaptureAgentClientError('Capture agent returned an active phase without negotiation', 502, 'invalid_agent_response');
    }

    return {
        baselineAvailable,
        baselineStartedAt,
        baselineEndedAt,
        negotiationStartedAt,
        activeCallStartedAt,
    };
}

function parseCaptureBounds(value: unknown): NonNullable<CallAnalysisResult['captureBounds']> {
    const object = requireObject(value, 'captureBounds');
    const packetLimit = requireIntegerInRange(object.packetLimit, 'captureBounds.packetLimit', 1, 1_000_000);
    const storedPackets = requireIntegerInRange(object.storedPackets, 'captureBounds.storedPackets', 0, packetLimit);
    const droppedPackets = requireNonNegativeInteger(object.droppedPackets, 'captureBounds.droppedPackets');
    const truncated = requireBoolean(object.truncated, 'captureBounds.truncated');
    if (truncated !== (droppedPackets > 0)) {
        throw new CaptureAgentClientError('Capture agent returned inconsistent capture bounds', 502, 'invalid_agent_response');
    }
    return { packetLimit, storedPackets, droppedPackets, truncated };
}

function parseStunEndpoints(value: unknown): NonNullable<CallAnalysisResult['stunEndpoints']> {
    return requireArray(value, 'stunEndpoints', 256).map((entry, index) => {
        const endpoint = requireObject(entry, `stunEndpoints[${index}]`);
        const ip = requireString(endpoint.ip, `stunEndpoints[${index}].ip`);
        const addressFamily = isIP(ip);
        if ((addressFamily !== 4 && addressFamily !== 6) || endpoint.addressFamily !== addressFamily) {
            throw new CaptureAgentClientError('Capture agent returned an invalid STUN endpoint address', 502, 'invalid_agent_response');
        }
        const role = requireEnum(endpoint.role, `stunEndpoints[${index}].role`, [
            'own_public_endpoint',
            'peer_candidate',
            'relay',
            'stun_turn',
        ] as const);
        const minimumPort = role === 'peer_candidate' ? 0 : 1;
        return {
            ip,
            port: requireIntegerInRange(endpoint.port, `stunEndpoints[${index}].port`, minimumPort, 65_535),
            addressFamily,
            role,
            source: requireEnum(endpoint.source, `stunEndpoints[${index}].source`, ['stun'] as const),
        };
    });
}

function parseAnalysis(payload: unknown): CallAnalysisResult {
    const object = requireObject(payload, 'Capture agent');
    if (object.transportEvidence !== undefined || object.routeAssessment !== undefined) {
        throw new CaptureAgentClientError('Capture agent returned backend-owned route evidence', 502, 'invalid_agent_response');
    }
    const verdict = requireString(object.verdict, 'verdict');
    if (!['p2p', 'relay', 'mixed', 'insufficient_data'].includes(verdict)) {
        throw new CaptureAgentClientError('Capture agent returned an invalid verdict', 502, 'invalid_agent_response');
    }
    const startTime = requireDate(object.startTime, 'startTime');
    const endTime = optionalDate(object.endTime, 'endTime');
    if (endTime && endTime.getTime() < startTime.getTime()) {
        throw new CaptureAgentClientError('Capture agent returned an invalid analysis time range', 502, 'invalid_agent_response');
    }
    const totalPackets = requireNonNegativeInteger(object.totalPackets, 'totalPackets');
    const candidateIps = requireArray(object.candidateIps, 'candidateIps', 4_096).map(parseCandidate);
    if (candidateIps.some(candidate => candidate.packets > totalPackets)) {
        throw new CaptureAgentClientError('Capture agent returned inconsistent candidate packet totals', 502, 'invalid_agent_response');
    }
    const captureInterface = requireString(object.captureInterface, 'captureInterface');
    if (isIP(captureInterface) !== 4) {
        throw new CaptureAgentClientError('Capture agent returned an invalid captureInterface', 502, 'invalid_agent_response');
    }
    const schemaVersion = object.schemaVersion === undefined
        ? undefined
        : requireIntegerInRange(object.schemaVersion, 'schemaVersion', 2, 2);
    const capturePhases = object.capturePhases === undefined
        ? undefined
        : parseCapturePhases(object.capturePhases);
    const captureBounds = object.captureBounds === undefined
        ? undefined
        : parseCaptureBounds(object.captureBounds);
    const stunEndpoints = object.stunEndpoints === undefined
        ? undefined
        : parseStunEndpoints(object.stunEndpoints);
    if (capturePhases) {
        const phaseDates = [
            capturePhases.baselineStartedAt,
            capturePhases.baselineEndedAt,
            capturePhases.negotiationStartedAt,
            capturePhases.activeCallStartedAt,
        ].filter((value): value is Date => value !== null);
        if (phaseDates.some(value => value.getTime() < startTime.getTime())) {
            throw new CaptureAgentClientError('Capture agent returned a phase before capture start', 502, 'invalid_agent_response');
        }
        if (endTime && phaseDates.some(value => value.getTime() > endTime.getTime())) {
            throw new CaptureAgentClientError('Capture agent returned a phase after capture end', 502, 'invalid_agent_response');
        }
    }
    if (captureBounds && captureBounds.storedPackets + captureBounds.droppedPackets !== totalPackets) {
        throw new CaptureAgentClientError('Capture agent returned inconsistent packet totals', 502, 'invalid_agent_response');
    }
    return {
        callId: requireCallId(object.callId, 'callId'),
        targetJid: requireJid(object.targetJid, 'targetJid'),
        startTime,
        endTime,
        durationSec: requireNonNegativeNumber(object.durationSec, 'durationSec'),
        isVideo: requireBoolean(object.isVideo, 'isVideo'),
        totalPackets,
        candidateIps,
        metaIps: requireArray(object.metaIps, 'metaIps', 4_096).map(value => {
            const ip = requireString(value, 'metaIps entry');
            if (isIP(ip) === 0) {
                throw new CaptureAgentClientError('Capture agent returned an invalid metaIps entry', 502, 'invalid_agent_response');
            }
            return ip;
        }),
        verdict: verdict as CallAnalysisResult['verdict'],
        captureInterface,
        ...(schemaVersion === undefined ? {} : { schemaVersion: schemaVersion as 2 }),
        ...(capturePhases === undefined ? {} : { capturePhases }),
        ...(stunEndpoints === undefined ? {} : { stunEndpoints }),
        ...(captureBounds === undefined ? {} : { captureBounds }),
    };
}

function parseInterfaces(payload: unknown): NetworkInterface[] {
    return requireArray(payload, 'interface list', 256).map(value => {
        const object = requireObject(value, 'Capture interface');
        const address = requireString(object.address, 'interface address');
        if (isIP(address) !== 4) {
            throw new CaptureAgentClientError('Capture agent returned a non-IPv4 interface', 502, 'invalid_agent_response');
        }
        return {
            name: requireString(object.name, 'interface name'),
            address,
            description: requireString(object.description, 'interface description'),
        };
    });
}

export class CaptureAgentClient {
    private readonly baseUrl: URL;
    private readonly sharedSecret: string;
    private readonly timeoutMs: number;
    private readonly fetchImpl: typeof fetch;
    private readonly now: () => number;
    private readonly nonce: () => string;

    constructor(options: CaptureAgentClientOptions) {
        validateCaptureAgentSecret(options.sharedSecret);
        const baseUrl = new URL(options.baseUrl);
        if (
            !['http:', 'https:'].includes(baseUrl.protocol)
            || baseUrl.username
            || baseUrl.password
            || baseUrl.pathname !== '/'
            || baseUrl.search
            || baseUrl.hash
        ) {
            throw new Error('CAPTURE_AGENT_URL must be an HTTP(S) origin without credentials, path, query, or fragment');
        }
        const timeoutMs = options.timeoutMs ?? 5_000;
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 30_000) {
            throw new Error('CAPTURE_AGENT_TIMEOUT_MS must be an integer between 500 and 30000');
        }

        this.baseUrl = baseUrl;
        this.sharedSecret = options.sharedSecret;
        this.timeoutMs = timeoutMs;
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.now = options.now ?? Date.now;
        this.nonce = options.nonce ?? (() => randomBytes(18).toString('base64url'));
    }

    async ready(): Promise<boolean> {
        try {
            const response = await this.fetchImpl(new URL('/v1/health/ready', this.baseUrl), {
                signal: AbortSignal.timeout(this.timeoutMs),
                redirect: 'error',
            });
            if (!response.ok) return false;
            const payload = requireObject(await parseResponseJson(response, 'Capture agent readiness'), 'Capture agent readiness');
            const capabilities = requireObject(payload.capabilities, 'Capture agent readiness capabilities');
            return payload.status === 'ready'
                && payload.capturePrivileges === true
                && capabilities.callCapturePhases === 1;
        } catch {
            return false;
        }
    }

    async listInterfaces(): Promise<NetworkInterface[]> {
        return parseInterfaces(await this.request('GET', '/v1/interfaces'));
    }

    async getCallCaptureStatus(): Promise<CallCaptureStatus> {
        return parseStatus(await this.request('GET', '/v1/call/status'));
    }

    async startCallCapture(input: {
        interfaceAddr: string;
        targetJid: string;
        callId: string;
        isVideo: boolean;
        trigger: CallCaptureTrigger;
        observedCallId?: string;
        initialCallStatus?: CallCapturePhaseStatus;
    }): Promise<boolean> {
        const payload = requireObject(await this.request('POST', '/v1/call/start', input), 'Capture agent');
        return payload.ok === true;
    }

    async observeCallCapturePhase(input: {
        captureCallId: string;
        targetJid: string;
        observedCallId: string;
        status: CallCapturePhaseStatus;
    }): Promise<boolean> {
        const payload = requireObject(await this.request('POST', '/v1/call/phase', input), 'Capture agent');
        if (
            payload.ok !== true
            || requireCallId(payload.captureCallId, 'captureCallId') !== input.captureCallId
            || requireCallId(payload.observedCallId, 'observedCallId') !== input.observedCallId
            || requireEnum(payload.status, 'status', CALL_CAPTURE_PHASE_STATUSES) !== input.status
        ) {
            throw new CaptureAgentClientError(
                'Capture agent returned an inconsistent call phase acknowledgement',
                502,
                'invalid_agent_response',
            );
        }
        return true;
    }

    async stopCallCapture(callId: string): Promise<CallAnalysisResult> {
        return parseAnalysis(await this.request('POST', '/v1/call/stop', {
            callId: requireCallId(callId, 'callId'),
        }));
    }

    private async request(method: 'GET' | 'POST', path: string, payload?: JsonObject): Promise<unknown> {
        const body = payload === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(payload));
        const timestamp = String(this.now());
        const nonce = this.nonce();
        const signature = signCaptureAgentRequest(this.sharedSecret, {
            method,
            path,
            timestamp,
            nonce,
            body,
        });
        try {
            const response = await this.fetchImpl(new URL(path, this.baseUrl), {
                method,
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json',
                    'x-wp-timestamp': timestamp,
                    'x-wp-nonce': nonce,
                    'x-wp-signature': signature,
                },
                ...(body.length > 0 ? { body } : {}),
                signal: AbortSignal.timeout(this.timeoutMs),
                redirect: 'error',
            });
            const result = await parseResponseJson(response, 'Capture agent');
            if (!response.ok) {
                const error = requireObject(result, 'Capture agent error');
                throw new CaptureAgentClientError(
                    typeof error.error === 'string' ? error.error : 'Capture agent request failed',
                    response.status,
                    typeof error.code === 'string' ? error.code : 'capture_agent_error',
                );
            }
            return result;
        } catch (error) {
            if (error instanceof CaptureAgentClientError) throw error;
            throw new CaptureAgentClientError('Capture agent is unavailable', 503, 'capture_agent_unavailable');
        }
    }
}

import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { signCaptureAgentRequest, validateCaptureAgentSecret } from './capture-agent-auth.js';
import type { CallAnalysisResult, CallCaptureStatus, CandidateIP } from './call-analyzer.js';
import type { NetworkInterface } from './packet-capture.js';
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

function parseCandidate(value: unknown): CandidateIP {
    const object = requireObject(value, 'Capture candidate');
    const ip = requireString(object.ip, 'candidate ip');
    if (isIP(ip) !== 4) {
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

    return {
        ip,
        packets: requireNonNegativeInteger(object.packets, 'candidate packets'),
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

function parseAnalysis(payload: unknown): CallAnalysisResult {
    const object = requireObject(payload, 'Capture agent');
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
            if (isIP(ip) !== 4) {
                throw new CaptureAgentClientError('Capture agent returned an invalid metaIps entry', 502, 'invalid_agent_response');
            }
            return ip;
        }),
        verdict: verdict as CallAnalysisResult['verdict'],
        captureInterface,
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
            return payload.status === 'ready' && payload.capturePrivileges === true;
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
    }): Promise<boolean> {
        const payload = requireObject(await this.request('POST', '/v1/call/start', input), 'Capture agent');
        return payload.ok === true;
    }

    async stopCallCapture(): Promise<CallAnalysisResult> {
        return parseAnalysis(await this.request('POST', '/v1/call/stop', {}));
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

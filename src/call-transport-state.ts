import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import type { CallTransportEvidence, SanitizedCallEndpoint } from './call-analyzer.js';
import type { CallTransportObservation } from './call-transport-observer.js';
import type { RedisCommandExecutor } from './rate-limit.js';

export interface CallTransportScope {
    callId: string;
    targetJid: string;
    caseId: string;
    trackingSessionId: string;
}

export type CallTransportWriteStatus = 'stored' | 'duplicate' | 'limit_reached' | 'degraded';

export interface CallTransportWriteResult {
    status: CallTransportWriteStatus;
    observationCount: number;
}

export interface CallTransportReadResult {
    evidence: CallTransportEvidence | null;
    observationCount: number;
    invalidEntries: number;
    degraded: boolean;
}

interface StoredCallTransportObservation {
    observedAt: string;
    action: CallTransportObservation['action'];
    peerNegotiationObserved: boolean;
    relayNegotiationObserved: boolean;
    keepaliveObserved: boolean;
    candidateRound: number | null;
    endpoints: SanitizedCallEndpoint[];
    limitations: string[];
}

const WRITE_SCRIPT = `
local added = redis.call('SADD', KEYS[2], ARGV[2])
local current = redis.call('LLEN', KEYS[1])
if added == 0 then
    redis.call('PEXPIRE', KEYS[1], ARGV[3])
    redis.call('PEXPIRE', KEYS[2], ARGV[3])
    return {0, current}
end
if current >= tonumber(ARGV[4]) then
    redis.call('SREM', KEYS[2], ARGV[2])
    redis.call('PEXPIRE', KEYS[1], ARGV[3])
    redis.call('PEXPIRE', KEYS[2], ARGV[3])
    return {-1, current}
end
local count = redis.call('RPUSH', KEYS[1], ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
redis.call('PEXPIRE', KEYS[2], ARGV[3])
return {1, count}
`;

const TAKE_SCRIPT = `
local entries = redis.call('LRANGE', KEYS[1], 0, ARGV[1])
redis.call('DEL', KEYS[1], KEYS[2])
return entries
`;

const CALL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,119}$/;
const SCOPE_PART_PATTERN = /^[^\u0000]{1,240}$/;
const LIMITATION_PATTERN = /^[a-z0-9_:-]{1,96}$/;
const RELAY_NAME_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/;
const MAX_SERIALIZED_BYTES = 16 * 1024;

function normalizePrefix(value: string): string {
    return value.replace(/[^a-zA-Z0-9:_-]/g, '-').replace(/-+/g, '-').slice(0, 80) || 'wp-monitor';
}

function validateScope(scope: CallTransportScope): void {
    if (!CALL_ID_PATTERN.test(scope.callId)) throw new Error('Invalid call transport call ID');
    for (const value of [scope.targetJid, scope.caseId, scope.trackingSessionId]) {
        if (!SCOPE_PART_PATTERN.test(value)) throw new Error('Invalid call transport scope');
    }
}

function isEndpoint(value: unknown): value is SanitizedCallEndpoint {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const endpoint = value as Partial<SanitizedCallEndpoint>;
    const family = isIP(typeof endpoint.ip === 'string' ? endpoint.ip : '');
    return (family === 4 || family === 6)
        && endpoint.addressFamily === family
        && Number.isSafeInteger(endpoint.port)
        && Number(endpoint.port) >= 1
        && Number(endpoint.port) <= 65_535
        && ['peer_candidate', 'relay', 'unknown'].includes(String(endpoint.role))
        && endpoint.source === 'baileys_transport'
        && (endpoint.relayName === undefined || (
            typeof endpoint.relayName === 'string' && RELAY_NAME_PATTERN.test(endpoint.relayName)
        ))
        && (endpoint.rttMs === undefined || (
            Number.isSafeInteger(endpoint.rttMs) && endpoint.rttMs >= 0 && endpoint.rttMs <= 600_000
        ));
}

function sanitizeEndpoint(value: SanitizedCallEndpoint): SanitizedCallEndpoint {
    return {
        ip: value.ip,
        port: value.port,
        addressFamily: value.addressFamily,
        role: value.role,
        source: 'baileys_transport',
        ...(value.relayName ? { relayName: value.relayName } : {}),
        ...(value.rttMs !== undefined ? { rttMs: value.rttMs } : {}),
    };
}

function toStoredObservation(observation: CallTransportObservation): StoredCallTransportObservation {
    if (!(observation.observedAt instanceof Date) || Number.isNaN(observation.observedAt.getTime())) {
        throw new Error('Invalid call transport observation timestamp');
    }
    if (observation.action !== 'transport' && observation.action !== 'relaylatency') {
        throw new Error('Invalid call transport observation action');
    }
    if (typeof observation.peerNegotiationObserved !== 'boolean'
        || typeof observation.relayNegotiationObserved !== 'boolean'
        || typeof observation.keepaliveObserved !== 'boolean') {
        throw new Error('Invalid call transport observation flags');
    }
    if (observation.candidateRound !== null && (
        !Number.isSafeInteger(observation.candidateRound)
        || observation.candidateRound < 0
        || observation.candidateRound > 1_000_000
    )) {
        throw new Error('Invalid call transport observation round');
    }
    if (observation.endpoints.length > 128 || !observation.endpoints.every(isEndpoint)) {
        throw new Error('Invalid call transport observation endpoints');
    }
    if (observation.limitations.length > 64 || !observation.limitations.every(value => LIMITATION_PATTERN.test(value))) {
        throw new Error('Invalid call transport observation limitations');
    }
    return {
        observedAt: observation.observedAt.toISOString(),
        action: observation.action,
        peerNegotiationObserved: observation.peerNegotiationObserved,
        relayNegotiationObserved: observation.relayNegotiationObserved,
        keepaliveObserved: observation.keepaliveObserved,
        candidateRound: observation.candidateRound,
        endpoints: observation.endpoints.map(sanitizeEndpoint),
        limitations: observation.limitations,
    };
}

function parseStoredObservation(value: unknown): StoredCallTransportObservation | null {
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_SERIALIZED_BYTES) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const entry = parsed as Partial<StoredCallTransportObservation>;
    const observedAt = new Date(typeof entry.observedAt === 'string' ? entry.observedAt : '');
    if (Number.isNaN(observedAt.getTime())) return null;
    if (entry.action !== 'transport' && entry.action !== 'relaylatency') return null;
    if (typeof entry.peerNegotiationObserved !== 'boolean'
        || typeof entry.relayNegotiationObserved !== 'boolean'
        || typeof entry.keepaliveObserved !== 'boolean') return null;
    if (entry.candidateRound !== null && (
        typeof entry.candidateRound !== 'number'
        || !Number.isSafeInteger(entry.candidateRound)
        || entry.candidateRound < 0
        || entry.candidateRound > 1_000_000
    )) return null;
    if (!Array.isArray(entry.endpoints) || entry.endpoints.length > 128 || !entry.endpoints.every(isEndpoint)) return null;
    if (!Array.isArray(entry.limitations)
        || entry.limitations.length > 64
        || !entry.limitations.every(item => typeof item === 'string' && LIMITATION_PATTERN.test(item))) return null;
    return {
        observedAt: entry.observedAt!,
        action: entry.action,
        peerNegotiationObserved: entry.peerNegotiationObserved,
        relayNegotiationObserved: entry.relayNegotiationObserved,
        keepaliveObserved: entry.keepaliveObserved,
        candidateRound: entry.candidateRound,
        endpoints: entry.endpoints.map(sanitizeEndpoint),
        limitations: [...entry.limitations],
    };
}

function aggregate(entries: unknown[]): CallTransportReadResult {
    const observations: StoredCallTransportObservation[] = [];
    let invalidEntries = 0;
    for (const entry of entries) {
        const parsed = parseStoredObservation(entry);
        if (parsed) observations.push(parsed);
        else invalidEntries += 1;
    }
    if (observations.length === 0) {
        return { evidence: null, observationCount: 0, invalidEntries, degraded: false };
    }

    const endpointMap = new Map<string, SanitizedCallEndpoint>();
    const candidateRounds = new Set<number>();
    const limitations = new Set<string>();
    let peerNegotiationObserved = false;
    let relayNegotiationObserved = false;
    let keepaliveObserved = false;
    let firstObservedAt = observations[0]!.observedAt;
    let lastObservedAt = observations[0]!.observedAt;

    for (const observation of observations) {
        if (observation.observedAt < firstObservedAt) firstObservedAt = observation.observedAt;
        if (observation.observedAt > lastObservedAt) lastObservedAt = observation.observedAt;
        peerNegotiationObserved ||= observation.peerNegotiationObserved;
        relayNegotiationObserved ||= observation.relayNegotiationObserved;
        keepaliveObserved ||= observation.keepaliveObserved;
        if (observation.candidateRound !== null) candidateRounds.add(observation.candidateRound);
        for (const endpoint of observation.endpoints) {
            endpointMap.set(`${endpoint.ip}\0${endpoint.port}\0${endpoint.role}\0${endpoint.source}`, endpoint);
        }
        for (const limitation of observation.limitations) limitations.add(limitation);
    }
    if (invalidEntries > 0) limitations.add('stored_observation_invalid');

    return {
        evidence: {
            firstObservedAt: new Date(firstObservedAt),
            lastObservedAt: new Date(lastObservedAt),
            peerNegotiationObserved,
            relayNegotiationObserved,
            keepaliveObserved,
            candidateRounds: [...candidateRounds].sort((a, b) => a - b),
            endpoints: [...endpointMap.values()],
            limitations: [...limitations],
        },
        observationCount: observations.length,
        invalidEntries,
        degraded: false,
    };
}

export class CallTransportStateStore {
    private readonly keyPrefix: string;

    constructor(
        private readonly redis: RedisCommandExecutor,
        keyPrefix: string,
        private readonly identitySecret: string,
        private readonly ttlMs: number = 15 * 60_000,
        private readonly maxObservations: number = 128,
    ) {
        this.keyPrefix = normalizePrefix(keyPrefix);
        if (identitySecret.length < 32) throw new Error('Call transport identity secret must contain at least 32 characters');
        if (!Number.isSafeInteger(ttlMs) || ttlMs < 10_000 || ttlMs > 24 * 60 * 60_000) {
            throw new Error('Call transport TTL must be between 10000 and 86400000 milliseconds');
        }
        if (!Number.isSafeInteger(maxObservations) || maxObservations < 1 || maxObservations > 512) {
            throw new Error('Call transport observation limit must be between 1 and 512');
        }
    }

    async record(scope: CallTransportScope, observation: CallTransportObservation): Promise<CallTransportWriteResult> {
        validateScope(scope);
        if (scope.callId !== observation.callId) throw new Error('Call transport observation does not match its scope');
        const stored = toStoredObservation(observation);
        const payload = JSON.stringify(stored);
        if (Buffer.byteLength(payload, 'utf8') > MAX_SERIALIZED_BYTES) {
            throw new Error('Call transport observation exceeds the storage limit');
        }
        const keys = this.keys(scope);
        const fingerprint = this.hmac('call-transport-observation', [keys.scopeFingerprint, payload]);
        try {
            const response = await this.redis.sendCommand([
                'EVAL', WRITE_SCRIPT, '2', keys.events, keys.dedupe,
                payload, fingerprint, String(this.ttlMs), String(this.maxObservations),
            ]);
            if (!Array.isArray(response) || response.length !== 2) throw new Error('Invalid Redis response');
            const state = Number(response[0]);
            const observationCount = Number(response[1]);
            if (![-1, 0, 1].includes(state) || !Number.isSafeInteger(observationCount) || observationCount < 0) {
                throw new Error('Invalid Redis response');
            }
            return {
                status: state === 1 ? 'stored' : state === 0 ? 'duplicate' : 'limit_reached',
                observationCount,
            };
        } catch {
            return { status: 'degraded', observationCount: 0 };
        }
    }

    async read(scope: CallTransportScope): Promise<CallTransportReadResult> {
        validateScope(scope);
        try {
            const response = await this.redis.sendCommand([
                'LRANGE', this.keys(scope).events, '0', String(this.maxObservations - 1),
            ]);
            if (!Array.isArray(response)) throw new Error('Invalid Redis response');
            return aggregate(response);
        } catch {
            return { evidence: null, observationCount: 0, invalidEntries: 0, degraded: true };
        }
    }

    async take(scope: CallTransportScope): Promise<CallTransportReadResult> {
        validateScope(scope);
        const keys = this.keys(scope);
        try {
            const response = await this.redis.sendCommand([
                'EVAL', TAKE_SCRIPT, '2', keys.events, keys.dedupe, String(this.maxObservations - 1),
            ]);
            if (!Array.isArray(response)) throw new Error('Invalid Redis response');
            return aggregate(response);
        } catch {
            return { evidence: null, observationCount: 0, invalidEntries: 0, degraded: true };
        }
    }

    async clear(scope: CallTransportScope): Promise<boolean> {
        validateScope(scope);
        const keys = this.keys(scope);
        try {
            const response = await this.redis.sendCommand(['DEL', keys.events, keys.dedupe]);
            return Number(response) >= 0;
        } catch {
            return false;
        }
    }

    private keys(scope: CallTransportScope): { events: string; dedupe: string; scopeFingerprint: string } {
        const scopeFingerprint = this.hmac('call-transport-scope', [
            scope.callId,
            scope.targetJid,
            scope.caseId,
            scope.trackingSessionId,
        ]);
        const base = `${this.keyPrefix}:call-transport:${scopeFingerprint}`;
        return { events: `${base}:events`, dedupe: `${base}:dedupe`, scopeFingerprint };
    }

    private hmac(context: string, parts: readonly string[]): string {
        const hash = createHmac('sha256', this.identitySecret);
        hash.update(context);
        for (const part of parts) hash.update('\0').update(part);
        return hash.digest('hex');
    }
}

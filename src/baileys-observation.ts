import { createHash } from 'node:crypto';

export const OBSERVATION_SCHEMA_VERSION = 1 as const;
export const DEVICE_CLASSIFIER_VERSION = 'baileys-getDevice-v1' as const;

export type ObservationSource = 'presence' | 'call' | 'message' | 'receipt' | 'profile';
export type ObservationScope =
    | 'direct_interaction'
    | 'visible_presence'
    | 'profile_metadata'
    | 'local_call_traffic';
export type ObservationConfidence = 'low' | 'medium' | 'high';
export type ObservationDetailValue = boolean | number | string | null;
export type ObservationDetails = Readonly<Record<string, ObservationDetailValue>>;

export interface ObservationEnvelopeV1 {
    schemaVersion: typeof OBSERVATION_SCHEMA_VERSION;
    caseId: string;
    trackingSessionId: string;
    jid: string;
    source: ObservationSource;
    scope: ObservationScope;
    type: string;
    label: string;
    confidence: ObservationConfidence;
    occurredAt: string;
    observedAt: string;
    idempotencyKey: string;
    details?: ObservationDetails;
}

export interface CreateObservationEnvelopeInput {
    caseId: string;
    trackingSessionId: string;
    jid: string;
    source: ObservationSource;
    scope: ObservationScope;
    type: string;
    label: string;
    confidence: ObservationConfidence;
    occurredAt: Date | number | string;
    observedAt?: Date | number | string;
    correlationParts: readonly string[];
    details?: Readonly<Record<string, unknown>>;
}

const SOURCE_SCOPES: Readonly<Record<ObservationSource, ReadonlySet<ObservationScope>>> = {
    presence: new Set(['visible_presence']),
    call: new Set(['direct_interaction', 'local_call_traffic']),
    message: new Set(['direct_interaction']),
    receipt: new Set(['direct_interaction']),
    profile: new Set(['profile_metadata']),
};

const DETAIL_ALLOWLIST: Readonly<Record<ObservationSource, ReadonlySet<string>>> = {
    presence: new Set(['presence', 'lastSeenUnix', 'coverageState']),
    call: new Set([
        'callIdHash',
        'detector',
        'direction',
        'durationSec',
        'isVideo',
        'latencyMs',
        'offline',
        'outcome',
        'signalCount',
        'technicalSignalCount',
    ]),
    message: new Set([
        'deviceClass',
        'deviceClassifier',
        'deviceClassifierVersion',
        'direction',
        'messageIdHash',
        'messageType',
        'syntheticProbe',
        'upsertType',
    ]),
    receipt: new Set([
        'latencyMs',
        'messageIdHash',
        'state',
        'status',
        'timingBasis',
    ]),
    profile: new Set(['changedField', 'visibility']),
};

const FINGERPRINT_DETAIL_KEYS = new Set(['callIdHash', 'messageIdHash']);
const FINGERPRINT_PATTERN = /^[a-f0-9]{24,64}$/;

function requireNonEmpty(value: string, field: string): string {
    const normalized = value.trim();
    if (!normalized) throw new TypeError(`${field} is required`);
    return normalized;
}

function toIsoTimestamp(value: Date | number | string, field: string): string {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new TypeError(`${field} must be a valid timestamp`);
    return date.toISOString();
}

function isDetailValue(value: unknown): value is ObservationDetailValue {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    return typeof value === 'number' && Number.isFinite(value);
}

export function sanitizeObservationDetails(
    source: ObservationSource,
    input: Readonly<Record<string, unknown>> | undefined,
): ObservationDetails | undefined {
    if (!input) return undefined;
    const allowed = DETAIL_ALLOWLIST[source];
    const output: Record<string, ObservationDetailValue> = {};

    for (const [key, value] of Object.entries(input)) {
        if (!allowed.has(key)) {
            throw new TypeError(`Observation detail ${key} is not allowed for source ${source}`);
        }
        if (!isDetailValue(value)) {
            throw new TypeError(`Observation detail ${key} must be a finite scalar or null`);
        }
        if (FINGERPRINT_DETAIL_KEYS.has(key) && value !== null) {
            if (typeof value !== 'string' || !FINGERPRINT_PATTERN.test(value)) {
                throw new TypeError(`Observation detail ${key} must be an opaque fingerprint`);
            }
        }
        output[key] = value;
    }

    return Object.keys(output).length > 0 ? Object.freeze(output) : undefined;
}

export function buildObservationIdempotencyKey(input: {
    caseId: string;
    trackingSessionId: string;
    jid: string;
    source: ObservationSource;
    type: string;
    occurredAt: string;
    correlationParts: readonly string[];
}): string {
    const canonical = JSON.stringify([
        requireNonEmpty(input.caseId, 'caseId'),
        requireNonEmpty(input.trackingSessionId, 'trackingSessionId'),
        requireNonEmpty(input.jid, 'jid'),
        input.source,
        requireNonEmpty(input.type, 'type'),
        input.occurredAt,
        ...input.correlationParts.map((part, index) => requireNonEmpty(part, `correlationParts[${index}]`)),
    ]);
    return createHash('sha256').update(canonical).digest('hex');
}

export function createObservationEnvelope(
    input: CreateObservationEnvelopeInput,
): ObservationEnvelopeV1 {
    if (!SOURCE_SCOPES[input.source].has(input.scope)) {
        throw new TypeError(`Observation scope ${input.scope} is not valid for source ${input.source}`);
    }
    if (input.correlationParts.length === 0) {
        throw new TypeError('At least one correlation part is required');
    }

    const caseId = requireNonEmpty(input.caseId, 'caseId');
    const trackingSessionId = requireNonEmpty(input.trackingSessionId, 'trackingSessionId');
    const jid = requireNonEmpty(input.jid, 'jid');
    const type = requireNonEmpty(input.type, 'type');
    const label = requireNonEmpty(input.label, 'label');
    const occurredAt = toIsoTimestamp(input.occurredAt, 'occurredAt');
    const observedAt = toIsoTimestamp(input.observedAt ?? new Date(), 'observedAt');
    const details = sanitizeObservationDetails(input.source, input.details);

    return {
        schemaVersion: OBSERVATION_SCHEMA_VERSION,
        caseId,
        trackingSessionId,
        jid,
        source: input.source,
        scope: input.scope,
        type,
        label,
        confidence: input.confidence,
        occurredAt,
        observedAt,
        idempotencyKey: buildObservationIdempotencyKey({
            caseId,
            trackingSessionId,
            jid,
            source: input.source,
            type,
            occurredAt,
            correlationParts: input.correlationParts,
        }),
        ...(details ? { details } : {}),
    };
}

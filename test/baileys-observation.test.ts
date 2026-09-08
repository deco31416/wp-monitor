import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEVICE_CLASSIFIER_VERSION,
    OBSERVATION_SCHEMA_VERSION,
    buildObservationIdempotencyKey,
    createObservationEnvelope,
    sanitizeObservationDetails,
} from '../src/baileys-observation.js';

const BASE_INPUT = {
    caseId: 'CASE-SYNTHETIC-01',
    trackingSessionId: 'session-synthetic-01',
    jid: 'synthetic-contact@s.whatsapp.net',
    source: 'message' as const,
    scope: 'direct_interaction' as const,
    type: 'incoming',
    label: 'Mensaje recibido',
    confidence: 'high' as const,
    occurredAt: '2026-09-01T20:00:00.000Z',
    observedAt: '2026-09-01T20:00:01.000Z',
    correlationParts: ['raw-message-id-used-only-for-hashing'],
};

test('creates a versioned observation without exposing raw correlation identifiers', () => {
    const envelope = createObservationEnvelope({
        ...BASE_INPUT,
        details: {
            direction: 'incoming',
            messageType: 'text',
            messageIdHash: 'a'.repeat(24),
            deviceClass: 'web',
            deviceClassifier: 'baileys.getDevice',
            deviceClassifierVersion: DEVICE_CLASSIFIER_VERSION,
        },
    });

    assert.equal(envelope.schemaVersion, OBSERVATION_SCHEMA_VERSION);
    assert.equal(envelope.occurredAt, '2026-09-01T20:00:00.000Z');
    assert.equal(envelope.idempotencyKey.length, 64);
    assert.equal(JSON.stringify(envelope).includes('raw-message-id-used-only-for-hashing'), false);
    assert.equal(envelope.details?.deviceClass, 'web');
});

test('builds a stable key per case, session, contact and correlation', () => {
    const first = createObservationEnvelope(BASE_INPUT).idempotencyKey;
    const replay = createObservationEnvelope({
        ...BASE_INPUT,
        observedAt: '2026-09-01T20:05:00.000Z',
    }).idempotencyKey;
    const otherSession = createObservationEnvelope({
        ...BASE_INPUT,
        trackingSessionId: 'session-synthetic-02',
    }).idempotencyKey;

    assert.equal(first, replay);
    assert.notEqual(first, otherSession);
});

test('rejects a scope that cannot be produced by the selected source', () => {
    assert.throws(
        () => createObservationEnvelope({ ...BASE_INPUT, scope: 'visible_presence' }),
        /not valid for source message/,
    );
});

test('fails closed for unapproved or non-scalar details', () => {
    assert.throws(
        () => sanitizeObservationDetails('message', { body: 'content must never persist' }),
        /not allowed/,
    );
    assert.throws(
        () => sanitizeObservationDetails('message', { messageType: ['text'] }),
        /finite scalar/,
    );
    assert.throws(
        () => sanitizeObservationDetails('message', { messageIdHash: 'raw-id' }),
        /opaque fingerprint/,
    );
});

test('rejects invalid timestamps and missing correlation material', () => {
    assert.throws(
        () => createObservationEnvelope({ ...BASE_INPUT, occurredAt: 'not-a-date' }),
        /valid timestamp/,
    );
    assert.throws(
        () => createObservationEnvelope({ ...BASE_INPUT, correlationParts: [] }),
        /At least one correlation part/,
    );
});

test('the low-level key builder rejects empty correlation values', () => {
    assert.throws(
        () => buildObservationIdempotencyKey({
            caseId: BASE_INPUT.caseId,
            trackingSessionId: BASE_INPUT.trackingSessionId,
            jid: BASE_INPUT.jid,
            source: BASE_INPUT.source,
            type: BASE_INPUT.type,
            occurredAt: BASE_INPUT.occurredAt,
            correlationParts: [''],
        }),
        /correlationParts\[0\] is required/,
    );
});

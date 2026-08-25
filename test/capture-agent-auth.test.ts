import test from 'node:test';
import assert from 'node:assert/strict';
import {
    CaptureAgentRequestVerifier,
    signCaptureAgentRequest,
    validateCaptureAgentSecret,
} from '../src/capture-agent-auth.js';

const SECRET = 'capture-agent-test-secret-000000000000000000000000';
const NOW = 1_787_593_200_000;

function signedRequest(body = Buffer.from('{"callId":"CALL-001"}')) {
    const input = {
        method: 'POST',
        path: '/v1/call/start',
        timestamp: String(NOW),
        nonce: 'nonce_1234567890abcdef',
        body,
    };
    return {
        input,
        signature: signCaptureAgentRequest(SECRET, input),
    };
}

test('accepts one valid HMAC request and rejects its replay', () => {
    const verifier = new CaptureAgentRequestVerifier(SECRET, { now: () => NOW });
    const request = signedRequest();

    assert.deepEqual(verifier.verify(request.input, request.signature), { ok: true });
    assert.deepEqual(verifier.verify(request.input, request.signature), {
        ok: false,
        code: 'replayed_request',
    });
});

test('rejects tampered request bodies and signatures', () => {
    const verifier = new CaptureAgentRequestVerifier(SECRET, { now: () => NOW });
    const request = signedRequest();

    assert.deepEqual(verifier.verify({
        ...request.input,
        body: Buffer.from('{"callId":"CALL-002"}'),
    }, request.signature), {
        ok: false,
        code: 'invalid_request_auth',
    });
});

test('rejects stale timestamps and malformed nonces', () => {
    const verifier = new CaptureAgentRequestVerifier(SECRET, { now: () => NOW });
    const stale = signedRequest();
    const malformed = signedRequest();

    assert.deepEqual(verifier.verify({
        ...stale.input,
        timestamp: String(NOW - 120_000),
    }, stale.signature), {
        ok: false,
        code: 'stale_request',
    });
    assert.deepEqual(verifier.verify({
        ...malformed.input,
        nonce: 'short',
    }, malformed.signature), {
        ok: false,
        code: 'invalid_request_auth',
    });
});

test('requires a strong shared secret', () => {
    assert.throws(() => validateCaptureAgentSecret('short-secret'), /at least 32 bytes/);
});

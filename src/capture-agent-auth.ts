import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface CaptureAgentSignedRequest {
    method: string;
    path: string;
    timestamp: string;
    nonce: string;
    body: Buffer;
}

export interface CaptureAgentAuthResult {
    ok: boolean;
    code?: 'invalid_request_auth' | 'stale_request' | 'replayed_request';
}

export interface CaptureAgentVerifierOptions {
    now?: () => number;
    maxClockSkewMs?: number;
    maxRememberedNonces?: number;
}

const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const TIMESTAMP_PATTERN = /^[0-9]{10,16}$/;

export function validateCaptureAgentSecret(secret: string): void {
    if (Buffer.byteLength(secret, 'utf8') < 32) {
        throw new Error('CAPTURE_AGENT_SHARED_SECRET must contain at least 32 bytes');
    }
}

export function buildCaptureAgentCanonicalRequest(input: CaptureAgentSignedRequest): string {
    const bodyHash = createHash('sha256').update(input.body).digest('hex');
    return [
        input.method.trim().toUpperCase(),
        input.path,
        input.timestamp,
        input.nonce,
        bodyHash,
    ].join('\n');
}

export function signCaptureAgentRequest(secret: string, input: CaptureAgentSignedRequest): string {
    validateCaptureAgentSecret(secret);
    return createHmac('sha256', secret)
        .update(buildCaptureAgentCanonicalRequest(input))
        .digest('hex');
}

export class CaptureAgentRequestVerifier {
    private readonly now: () => number;
    private readonly maxClockSkewMs: number;
    private readonly maxRememberedNonces: number;
    private readonly seenNonces = new Map<string, number>();

    constructor(
        private readonly secret: string,
        options: CaptureAgentVerifierOptions = {},
    ) {
        validateCaptureAgentSecret(secret);
        this.now = options.now ?? Date.now;
        this.maxClockSkewMs = options.maxClockSkewMs ?? 60_000;
        this.maxRememberedNonces = options.maxRememberedNonces ?? 10_000;
        if (this.maxClockSkewMs < 1_000 || this.maxClockSkewMs > 300_000) {
            throw new Error('Capture agent clock skew must be between 1 and 300 seconds');
        }
        if (this.maxRememberedNonces < 100 || this.maxRememberedNonces > 100_000) {
            throw new Error('Capture agent nonce capacity must be between 100 and 100000');
        }
    }

    verify(input: CaptureAgentSignedRequest, signature: string): CaptureAgentAuthResult {
        if (
            !TIMESTAMP_PATTERN.test(input.timestamp)
            || !NONCE_PATTERN.test(input.nonce)
            || !SIGNATURE_PATTERN.test(signature)
            || !input.path.startsWith('/')
        ) {
            return { ok: false, code: 'invalid_request_auth' };
        }

        const timestampMs = Number(input.timestamp);
        const now = this.now();
        if (!Number.isSafeInteger(timestampMs) || Math.abs(now - timestampMs) > this.maxClockSkewMs) {
            this.pruneExpiredNonces(now);
            return { ok: false, code: 'stale_request' };
        }

        this.pruneExpiredNonces(now);
        if (this.seenNonces.has(input.nonce)) {
            return { ok: false, code: 'replayed_request' };
        }

        const expected = signCaptureAgentRequest(this.secret, input);
        const expectedBuffer = Buffer.from(expected, 'hex');
        const receivedBuffer = Buffer.from(signature, 'hex');
        if (
            receivedBuffer.length !== expectedBuffer.length
            || !timingSafeEqual(receivedBuffer, expectedBuffer)
        ) {
            return { ok: false, code: 'invalid_request_auth' };
        }

        if (this.seenNonces.size >= this.maxRememberedNonces) {
            return { ok: false, code: 'invalid_request_auth' };
        }
        this.seenNonces.set(input.nonce, now + this.maxClockSkewMs);
        return { ok: true };
    }

    private pruneExpiredNonces(now: number): void {
        for (const [nonce, expiresAt] of this.seenNonces) {
            if (expiresAt >= now) continue;
            this.seenNonces.delete(nonce);
        }
    }
}

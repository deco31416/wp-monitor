import { randomBytes } from 'node:crypto';
import { signCaptureAgentRequest, validateCaptureAgentSecret } from './capture-agent-auth.js';
import { normalizeBrowserWebRtcEvidence, type BrowserWebRtcEvidence } from './call-observation-evidence.js';

export interface WebRtcObserverClientOptions {
    baseUrl: string;
    sharedSecret: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    now?: () => number;
    nonce?: () => string;
}

export interface WebRtcObserverStatus {
    active: boolean;
    callId: string | null;
    targetJid: string | null;
    startedAt: Date | null;
}

export class WebRtcObserverClientError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code: string,
    ) {
        super(message);
        this.name = 'WebRtcObserverClientError';
    }
}

const MAX_RESPONSE_BYTES = 512 * 1_024;

export class WebRtcObserverClient {
    private readonly baseUrl: URL;
    private readonly sharedSecret: string;
    private readonly timeoutMs: number;
    private readonly fetchImpl: typeof fetch;
    private readonly now: () => number;
    private readonly nonce: () => string;

    constructor(options: WebRtcObserverClientOptions) {
        validateCaptureAgentSecret(options.sharedSecret);
        const baseUrl = new URL(options.baseUrl);
        if (
            !['http:', 'https:'].includes(baseUrl.protocol)
            || baseUrl.username || baseUrl.password || baseUrl.pathname !== '/'
            || baseUrl.search || baseUrl.hash
        ) throw new Error('WEBRTC_OBSERVER_URL must be an HTTP(S) origin without credentials or path');
        const timeoutMs = options.timeoutMs ?? 5_000;
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 30_000) {
            throw new Error('WEBRTC_OBSERVER_TIMEOUT_MS must be between 500 and 30000');
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
            const payload = await this.readJson(response);
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
            const object = payload as Record<string, unknown>;
            const capabilities = object.capabilities as Record<string, unknown> | undefined;
            return object.status === 'ready'
                && capabilities?.browserWebRtcEvidence === 1
                && capabilities.signedScopeLifecycle === 1
                && capabilities.sdpRetention === false
                && capabilities.contentRetention === false;
        } catch {
            return false;
        }
    }

    async status(): Promise<WebRtcObserverStatus> {
        const payload = await this.request('GET', '/v1/observation/status');
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw this.invalidResponse();
        const object = payload as Record<string, unknown>;
        const active = object.active === true;
        const callId = typeof object.callId === 'string' ? object.callId : null;
        const targetJid = typeof object.targetJid === 'string' ? object.targetJid : null;
        const startedAt = typeof object.startedAt === 'string' || object.startedAt instanceof Date
            ? new Date(object.startedAt)
            : null;
        if (active !== Boolean(callId && targetJid && startedAt && !Number.isNaN(startedAt.getTime()))) {
            throw this.invalidResponse();
        }
        return { active, callId, targetJid, startedAt };
    }

    async start(callId: string, targetJid: string, ttlMs = 15 * 60_000): Promise<void> {
        const payload = await this.request('POST', '/v1/observation/start', { callId, targetJid, ttlMs });
        if (!payload || typeof payload !== 'object' || (payload as Record<string, unknown>).ok !== true) {
            throw this.invalidResponse();
        }
    }

    async stop(callId: string): Promise<BrowserWebRtcEvidence> {
        const payload = await this.request('POST', '/v1/observation/stop', { callId });
        const evidence = normalizeBrowserWebRtcEvidence(payload);
        if (!evidence) throw this.invalidResponse();
        return evidence;
    }

    private invalidResponse(): WebRtcObserverClientError {
        return new WebRtcObserverClientError('WebRTC observer returned an invalid response', 502, 'invalid_observer_response');
    }

    private async request(method: 'GET' | 'POST', path: string, payload?: Record<string, unknown>): Promise<unknown> {
        const body = payload ? Buffer.from(JSON.stringify(payload)) : Buffer.alloc(0);
        const timestamp = String(this.now());
        const nonce = this.nonce();
        const signature = signCaptureAgentRequest(this.sharedSecret, { method, path, timestamp, nonce, body });
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
                ...(body.length ? { body } : {}),
                signal: AbortSignal.timeout(this.timeoutMs),
                redirect: 'error',
            });
            const parsed = await this.readJson(response);
            if (!response.ok) {
                const object = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
                throw new WebRtcObserverClientError(
                    typeof object.error === 'string' ? object.error : 'WebRTC observer request failed',
                    response.status,
                    typeof object.code === 'string' ? object.code : 'observer_error',
                );
            }
            return parsed;
        } catch (error) {
            if (error instanceof WebRtcObserverClientError) throw error;
            throw new WebRtcObserverClientError('WebRTC observer is unavailable', 503, 'observer_unavailable');
        }
    }

    private async readJson(response: Response): Promise<unknown> {
        const declaredLength = Number(response.headers.get('content-length') ?? 0);
        if (declaredLength > MAX_RESPONSE_BYTES) throw this.invalidResponse();
        const text = await response.text();
        if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw this.invalidResponse();
        try {
            return text ? JSON.parse(text) : {};
        } catch {
            throw this.invalidResponse();
        }
    }
}

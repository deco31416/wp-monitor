import express, { type Express, type Request, type RequestHandler, type Response } from 'express';
import { CaptureAgentRequestVerifier } from './capture-agent-auth.js';
import { normalizeBrowserWebRtcEvidence, type BrowserWebRtcEvidence } from './call-observation-evidence.js';
import type { WebRtcObservationAdapter } from './webrtc-observer-cdp.js';
import { cleanText, validateJid } from './validation.js';
import { SOFTWARE_VERSION } from './version.js';

interface RawBodyRequest extends Request {
    body: Buffer;
}

export interface WebRtcObserverAppOptions {
    enabled?: boolean;
    sharedSecret?: string;
    adapter: WebRtcObservationAdapter;
    now?: () => number;
}

const CALL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,119}$/;
const MIN_TTL_MS = 30_000;
const MAX_TTL_MS = 30 * 60_000;
const COMPLETED_TTL_MS = 60 * 60_000;
const COMPLETED_LIMIT = 32;

function parseBody(req: RawBodyRequest, res: Response): Record<string, unknown> | null {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ error: 'JSON object body is required', code: 'invalid_request_body' });
        return null;
    }
    try {
        const parsed = JSON.parse(req.body.toString('utf8')) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
        return parsed as Record<string, unknown>;
    } catch {
        res.status(400).json({ error: 'Valid JSON object body is required', code: 'invalid_request_body' });
        return null;
    }
}

function authMiddleware(verifier: CaptureAgentRequestVerifier): RequestHandler {
    return (request, response, next) => {
        const req = request as RawBodyRequest;
        const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        const result = verifier.verify({
            method: req.method,
            path: req.path,
            timestamp: req.get('x-wp-timestamp') ?? '',
            nonce: req.get('x-wp-nonce') ?? '',
            body,
        }, req.get('x-wp-signature') ?? '');
        if (!result.ok) {
            response.status(401).json({ error: 'Observer request authentication failed', code: result.code });
            return;
        }
        next();
    };
}

export function createWebRtcObserverApp(options: WebRtcObserverAppOptions): Express {
    const app = express();
    const now = options.now ?? Date.now;
    const enabled = options.enabled !== false;
    const completed = new Map<string, { evidence: BrowserWebRtcEvidence; completedAt: number }>();
    let lifecycleTail: Promise<void> = Promise.resolve();

    const serializeLifecycle = async <T>(operation: () => Promise<T>): Promise<T> => {
        const previous = lifecycleTail;
        let release!: () => void;
        lifecycleTail = new Promise<void>(resolve => { release = resolve; });
        await previous;
        try {
            return await operation();
        } finally {
            release();
        }
    };

    const prune = () => {
        for (const [callId, value] of completed) {
            if (value.completedAt < now() - COMPLETED_TTL_MS) completed.delete(callId);
        }
        while (completed.size > COMPLETED_LIMIT) {
            const oldest = completed.keys().next().value as string | undefined;
            if (!oldest) break;
            completed.delete(oldest);
        }
    };

    app.disable('x-powered-by');
    app.use((_req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        next();
    });

    app.get('/v1/health/live', (_req, res) => {
        res.json({ service: 'wp-monitor-webrtc-observer', version: SOFTWARE_VERSION, status: 'alive' });
    });
    app.get('/v1/health/ready', async (_req, res) => {
        if (!enabled) {
            res.status(503).json({
                service: 'wp-monitor-webrtc-observer',
                version: SOFTWARE_VERSION,
                status: 'disabled',
                capabilities: {
                    browserWebRtcEvidence: 0,
                    signedScopeLifecycle: 0,
                    sdpRetention: false,
                    contentRetention: false,
                },
            });
            return;
        }
        const ready = await options.adapter.ready();
        res.status(ready ? 200 : 503).json({
            service: 'wp-monitor-webrtc-observer',
            version: SOFTWARE_VERSION,
            status: ready ? 'ready' : 'unavailable',
            capabilities: {
                browserWebRtcEvidence: 1,
                signedScopeLifecycle: 1,
                sdpRetention: false,
                contentRetention: false,
            },
        });
    });

    if (!enabled) {
        app.use('/v1/observation', (_req, res) => {
            res.status(503).json({ error: 'Browser WebRTC observation is disabled', code: 'observer_disabled' });
        });
        return app;
    }

    const verifier = new CaptureAgentRequestVerifier(options.sharedSecret ?? '', options.now ? { now } : {});

    app.use(express.raw({ type: 'application/json', limit: '16kb' }));
    app.use(authMiddleware(verifier));

    app.get('/v1/observation/status', (_req, res) => {
        res.json(options.adapter.status());
    });

    app.post('/v1/observation/start', async (request, res) => {
        const body = parseBody(request as RawBodyRequest, res);
        if (!body) return;
        const callId = cleanText(body.callId, 120);
        const target = validateJid(body.targetJid, 'targetJid');
        const ttlMs = Number(body.ttlMs);
        if (!CALL_ID_PATTERN.test(callId) || !target.ok || !Number.isSafeInteger(ttlMs) || ttlMs < MIN_TTL_MS || ttlMs > MAX_TTL_MS) {
            res.status(400).json({ error: 'Observer scope validation failed', code: 'invalid_observer_scope' });
            return;
        }
        await serializeLifecycle(async () => {
            prune();
            if (completed.has(callId)) {
                res.status(409).json({ error: 'Call ID was already completed recently', code: 'observer_call_id_reused' });
                return;
            }
            const status = options.adapter.status();
            if (status.active) {
                if (status.callId === callId && status.targetJid === target.value) {
                    res.json({ ok: true, callId, targetJid: target.value, idempotent: true });
                    return;
                }
                res.status(409).json({ error: 'Another observation is active', code: 'observer_already_active' });
                return;
            }
            try {
                await options.adapter.start(callId, target.value!, ttlMs);
                res.status(201).json({ ok: true, callId, targetJid: target.value, idempotent: false });
            } catch {
                res.status(503).json({ error: 'Browser WebRTC observation is unavailable', code: 'observer_start_unavailable' });
            }
        });
    });

    app.post('/v1/observation/stop', async (request, res) => {
        const body = parseBody(request as RawBodyRequest, res);
        if (!body) return;
        const callId = cleanText(body.callId, 120);
        if (!CALL_ID_PATTERN.test(callId)) {
            res.status(400).json({ error: 'callId is invalid', code: 'invalid_observer_scope' });
            return;
        }
        await serializeLifecycle(async () => {
            prune();
            const previous = completed.get(callId);
            if (previous) {
                res.json(previous.evidence);
                return;
            }
            const status = options.adapter.status();
            if (!status.active || status.callId !== callId) {
                res.status(409).json({ error: 'Observer scope does not match', code: 'observer_scope_mismatch' });
                return;
            }
            try {
                const rawEvidence = await options.adapter.stop(callId);
                const evidence = normalizeBrowserWebRtcEvidence(rawEvidence);
                if (!evidence) throw new Error('invalid_evidence');
                completed.set(callId, { evidence, completedAt: now() });
                prune();
                res.json(evidence);
            } catch {
                res.status(503).json({ error: 'Browser WebRTC evidence is unavailable', code: 'observer_stop_unavailable' });
            }
        });
    });

    app.use((_error: unknown, _req: Request, res: Response, _next: unknown) => {
        res.status(400).json({ error: 'Observer request body is invalid', code: 'invalid_request_body' });
    });
    return app;
}

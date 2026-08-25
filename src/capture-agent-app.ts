import express, {
    type ErrorRequestHandler,
    type Express,
    type Request,
    type RequestHandler,
    type Response,
} from 'express';
import { isIP } from 'node:net';
import { CaptureAgentRequestVerifier } from './capture-agent-auth.js';
import type { CallAnalysisResult, CallCaptureStatus } from './call-analyzer.js';
import type { NetworkInterface } from './packet-capture.js';
import { cleanText, validateJid } from './validation.js';
import { SOFTWARE_VERSION } from './version.js';

export interface CaptureAgentAdapter {
    capturePrivilegesAvailable(): boolean;
    listInterfaces(): NetworkInterface[];
    getCallCaptureStatus(): CallCaptureStatus;
    startCallCapture(interfaceAddr: string, targetJid: string, callId: string, isVideo: boolean): boolean;
    stopCallCapture(): CallAnalysisResult | null;
}

export interface CaptureAgentAppOptions {
    sharedSecret: string;
    adapter: CaptureAgentAdapter;
    now?: () => number;
}

interface RawBodyRequest extends Request {
    body: Buffer;
}

const CALL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,119}$/;

function parseJsonObject(req: RawBodyRequest, res: Response): Record<string, unknown> | null {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ error: 'JSON object body is required', code: 'invalid_request_body' });
        return null;
    }
    try {
        const parsed = JSON.parse(req.body.toString('utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('not an object');
        }
        return parsed as Record<string, unknown>;
    } catch {
        res.status(400).json({ error: 'Valid JSON object body is required', code: 'invalid_request_body' });
        return null;
    }
}

function buildAgentAuthMiddleware(verifier: CaptureAgentRequestVerifier): RequestHandler {
    return (request, response, next) => {
        const req = request as RawBodyRequest;
        const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        const result = verifier.verify({
            method: req.method,
            path: req.path,
            timestamp: req.get('x-wp-timestamp') || '',
            nonce: req.get('x-wp-nonce') || '',
            body,
        }, req.get('x-wp-signature') || '');

        if (!result.ok) {
            response.status(401).json({ error: 'Capture agent request authentication failed', code: result.code });
            return;
        }
        next();
    };
}

export function createCaptureAgentApp(options: CaptureAgentAppOptions): Express {
    const app = express();
    const verifier = new CaptureAgentRequestVerifier(
        options.sharedSecret,
        options.now ? { now: options.now } : {},
    );

    app.disable('x-powered-by');
    app.use((_req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        next();
    });

    app.get('/v1/health/live', (_req, res) => {
        res.json({ service: 'wp-monitor-capture-agent', version: SOFTWARE_VERSION, status: 'alive' });
    });

    app.get('/v1/health/ready', (_req, res) => {
        const ready = options.adapter.capturePrivilegesAvailable();
        res.status(ready ? 200 : 503).json({
            service: 'wp-monitor-capture-agent',
            version: SOFTWARE_VERSION,
            status: ready ? 'ready' : 'unavailable',
            capturePrivileges: ready,
        });
    });

    app.use(express.raw({ type: 'application/json', limit: '64kb' }));
    app.use(buildAgentAuthMiddleware(verifier));

    app.get('/v1/interfaces', (_req, res) => {
        if (!options.adapter.capturePrivilegesAvailable()) {
            res.status(503).json({ error: 'Packet capture privileges are unavailable', code: 'capture_privileges_missing' });
            return;
        }
        res.json(options.adapter.listInterfaces());
    });

    app.get('/v1/call/status', (_req, res) => {
        res.json(options.adapter.getCallCaptureStatus());
    });

    app.post('/v1/call/start', (request, res) => {
        if (!options.adapter.capturePrivilegesAvailable()) {
            res.status(503).json({ error: 'Packet capture privileges are unavailable', code: 'capture_privileges_missing' });
            return;
        }
        if (options.adapter.getCallCaptureStatus().isCapturing) {
            res.status(409).json({ error: 'A call capture is already active', code: 'capture_already_active' });
            return;
        }

        const body = parseJsonObject(request as RawBodyRequest, res);
        if (!body) return;
        const interfaceAddr = cleanText(body.interfaceAddr, 64);
        const target = validateJid(body.targetJid, 'targetJid');
        const callId = cleanText(body.callId, 120);
        const isVideo = body.isVideo === true;
        const validationErrors = [
            isIP(interfaceAddr) !== 4 ? 'interfaceAddr must be an IPv4 address returned by the agent' : null,
            options.adapter.listInterfaces().some(item => item.address === interfaceAddr)
                ? null
                : 'interfaceAddr is not available to the capture agent',
            target.ok ? null : target.errors?.[0] || 'targetJid is invalid',
            CALL_ID_PATTERN.test(callId) ? null : 'callId must be 3-120 safe characters',
            typeof body.isVideo === 'boolean' ? null : 'isVideo must be a boolean',
        ].filter((error): error is string => Boolean(error));

        if (validationErrors.length > 0) {
            res.status(400).json({ error: 'Capture request validation failed', details: validationErrors });
            return;
        }

        const started = options.adapter.startCallCapture(interfaceAddr, target.value!, callId, isVideo);
        if (!started) {
            res.status(500).json({ error: 'Capture agent could not start packet capture', code: 'capture_start_failed' });
            return;
        }
        res.status(201).json({ ok: true, callId, targetJid: target.value });
    });

    app.post('/v1/call/stop', (_req, res) => {
        const result = options.adapter.stopCallCapture();
        if (!result) {
            res.status(409).json({ error: 'No active call capture exists', code: 'capture_not_active' });
            return;
        }
        res.json(result);
    });

    const controlledErrorHandler: ErrorRequestHandler = (_error, req, res, next) => {
        if (res.headersSent) {
            next(_error);
            return;
        }
        console.error(`[CAPTURE-AGENT] Request failed: ${req.method} ${req.path}`);
        res.status(500).json({
            error: 'Capture agent operation failed',
            code: 'capture_agent_internal_error',
        });
    };
    app.use(controlledErrorHandler);

    return app;
}

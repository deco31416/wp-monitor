/**
 * WP MONITOR - Web Server
 *
 * HTTP server with Socket.IO for real-time tracking visualization.
 * Provides REST API and WebSocket interface for the React frontend.
 *
 * For educational and research purposes only.
 */

import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { existsSync, readFileSync } from 'fs';
import { mkdir, rename, rm, writeFile } from 'fs/promises';
import path from 'path';
import { Server } from 'socket.io';
import cors from 'cors';
import makeWASocket, { DisconnectReason, getAllBinaryNodeChildren, useMultiFileAuthState, type BinaryNode } from '@whiskeysockets/baileys';
import { pino } from 'pino';
import { Boom } from '@hapi/boom';
import { WhatsAppTracker, ProbeMethod } from './tracker.js';
import { connectDB, isDBConnected, saveMeasurement, saveActivityEvent, saveContact, removeContact, reactivateContact, getRecentMeasurements, getSavedContacts, getActiveContacts, getActivityHistory, getStateDistribution, getObservedActivitySummary, updateContactProfile, updateCustomName, getContactProfile, getOnlinePatterns, generateReport, disconnectDB, saveCallAnalysis, getCallAnalyses, saveAuditEvent, getAuditEvents, createCase, getCase, updateCase, saveCaseEvidenceLink, deleteCaseEvidenceLink, getCaseEvidenceLinks, saveCheckInRequest, getCheckInByToken, updateCheckIn, completeCheckIn, deleteCheckIn, listCheckIns, CheckInDoc } from './db.js';
import { listInterfaces, startCapture, stopCapture, getCaptureStatus, getRecentPackets, updateFilter, exportJSON, exportCSV, CaptureFilter, PacketMeta } from './packet-capture.js';
import { initAnalytics, getFullIntelligence, getDailyRoutine, getAvailabilityProfile, getSessionStats, getWeeklyHeatmap, getHabitProfile, getCorrelation } from './analytics.js';
import { startCallCapture, stopCallCapture, getCallCaptureStatus, getCallAnalysisHistory, getLatestCallAnalysis, autoDetectInterface } from './call-analyzer.js';
import { enrichCallAnalysis, lookupIpEnrichment } from './ip-enrichment.js';
import { buildCheckInConsistency, buildCheckInHash, buildConsentText, createCheckInToken, normalizeCheckInSubmission, renderCheckInPage } from './check-in.js';
import { registerAuditRoutes } from './routes/audit.js';
import { registerCaseRoutes } from './routes/cases.js';
import { registerReportRoutes } from './routes/reports.js';
import { registerRuntimeRoutes, sendCaptureUnavailableIfNeeded } from './routes/runtime.js';
import { buildRuntimeConfig, resolveTrustProxy, validateProductionSecurity } from './runtime.js';
import { CASE_STATUSES, cleanText, normalizeOptionalJid, parseLimit, socketValidationError, validateCaseId, validateJid, validateRequiredText, validationError } from './validation.js';

const originalConsoleLog = console.log.bind(console);
const originalStdoutWrite = process.stdout.write.bind(process.stdout);

function shouldSuppressSensitiveRuntimeOutput(message: string): boolean {
    const sensitiveFragments = [
        'Closing session:',
        'SessionEntry',
        '_chains',
        'registrationId',
        'currentRatchet',
        'ephemeralKeyPair',
        'pendingPreKey',
        'indexInfo',
        'baseKey',
        'remoteIdentityKey',
        'lastRemoteEphemeralKey',
        'previousCounter',
        'rootKey',
        'signedKeyId',
        'preKeyId',
        'privKey',
        '<Buffer',
    ];

    return sensitiveFragments.some(fragment => message.includes(fragment));
}

function installSensitiveRuntimeLogGuard() {
    console.log = (...args: any[]) => {
        const rendered = args.map(arg => typeof arg === 'string' ? arg : String(arg)).join(' ');
        if (!shouldSuppressSensitiveRuntimeOutput(rendered)) {
            originalConsoleLog(...args);
        }
    };

    process.stdout.write = ((chunk: any, encoding?: any, callback?: any): boolean => {
        const message = String(chunk);
        if (shouldSuppressSensitiveRuntimeOutput(message)) {
            if (typeof encoding === 'function') {
                encoding();
            } else if (typeof callback === 'function') {
                callback();
            }
            return true;
        }
        return originalStdoutWrite(chunk, encoding, callback);
    }) as typeof process.stdout.write;
}

installSensitiveRuntimeLogGuard();

// Configuration
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean)
    : [
        'http://localhost:4001',
        'http://127.0.0.1:4001',
    ];

const NODE_ENV = process.env.NODE_ENV || 'development';
function parsePositiveInteger(value: unknown, fallback: number, min = 1): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.floor(parsed));
}

const PORT = parsePositiveInteger(process.env.PORT || process.env.BACKEND_PORT, 4000);
const RUNTIME_CONFIG = buildRuntimeConfig(process.env);
const DEPLOYMENT_MODE = RUNTIME_CONFIG.deploymentMode;
const LOCAL_CAPTURE_ENABLED = RUNTIME_CONFIG.localCaptureEnabled;
const DASHBOARD_TOKEN = (process.env.DASHBOARD_TOKEN || '').trim();
const ENABLE_SWAGGER = process.env.ENABLE_SWAGGER === 'true' && NODE_ENV !== 'production';
const TRUST_PROXY = resolveTrustProxy(process.env);
const APP_VERSION = process.env.npm_package_version || '2.9.1';
const CHECKIN_SUBMIT_RATE_WINDOW_MS = parsePositiveInteger(process.env.CHECKIN_SUBMIT_RATE_WINDOW_MS, 10 * 60_000, 60_000);
const CHECKIN_SUBMIT_RATE_MAX_PER_IP = parsePositiveInteger(process.env.CHECKIN_SUBMIT_RATE_MAX_PER_IP, 60);
const CHECKIN_SUBMIT_RATE_MAX_PER_TOKEN_IP = parsePositiveInteger(process.env.CHECKIN_SUBMIT_RATE_MAX_PER_TOKEN_IP, 8);

const SERVICE_TAG = '[WP-MONITOR]';
let dbAvailableForStartupAudit = false;
let serverListeningForStartupAudit = false;
let startupAuditRecorded = false;

function bootLog(level: 'ok' | 'warn' | 'error' | 'info', message: string) {
    const icon = {
        ok: '🟢',
        warn: '🟠',
        error: '🔴',
        info: '🔵',
    }[level];
    console.log(`${icon} ${SERVICE_TAG} ${message}`);
}

function isConfigured(value: string | undefined): boolean {
    return typeof value === 'string' && value.trim().length > 0;
}

function logStartupBanner() {
    bootLog('ok', 'Backend starting...');
    bootLog('ok', 'WP MONITOR');
}

function logStartupConfiguration() {
    bootLog('ok', `Environment: ${NODE_ENV}`);
    bootLog('ok', `Port: ${PORT}`);
    bootLog(isConfigured(process.env.MONGODB_URI) ? 'ok' : NODE_ENV === 'production' ? 'error' : 'warn',
        isConfigured(process.env.MONGODB_URI)
            ? 'MongoDB: configured'
            : 'MONGODB_URI missing - persistence disabled');
    bootLog(ENABLE_SWAGGER ? 'warn' : 'ok',
        ENABLE_SWAGGER ? 'Swagger: enabled at /docs' : 'Swagger: disabled');
    bootLog('ok', `CORS origins loaded: ${ALLOWED_ORIGINS.length}`);
    bootLog(DASHBOARD_TOKEN ? 'ok' : NODE_ENV === 'production' ? 'error' : 'warn',
        DASHBOARD_TOKEN
            ? 'Internal API guard: enabled'
            : 'DASHBOARD_TOKEN missing - dashboard/API guard disabled');
    bootLog('info', `Deployment mode: ${DEPLOYMENT_MODE}`);
    bootLog('info', `Trust proxy: ${String(TRUST_PROXY)}`);
    bootLog(LOCAL_CAPTURE_ENABLED ? 'warn' : 'ok',
        LOCAL_CAPTURE_ENABLED ? 'Local capture: enabled' : 'Local capture: disabled');
}

const startupSecurityErrors = validateProductionSecurity(process.env);
if (startupSecurityErrors.length > 0) {
    for (const error of startupSecurityErrors) {
        bootLog('error', error);
    }
    bootLog('error', 'Backend startup blocked by production security validation');
    process.exit(1);
}

async function tryRecordStartupAudit() {
    if (startupAuditRecorded || !serverListeningForStartupAudit) return;
    startupAuditRecorded = true;

    if (!dbAvailableForStartupAudit) {
        bootLog('warn', 'Startup audit event skipped: MongoDB persistence unavailable');
        return;
    }

    try {
        await saveAuditEvent({
            caseId: 'SYSTEM-STARTUP',
            operatorName: 'system',
            authorizationNote: 'Backend startup operational audit event',
            action: 'backend_operational',
            scope: 'system',
            targetJid: null,
            details: {
                environment: NODE_ENV,
                port: PORT,
                deploymentMode: DEPLOYMENT_MODE,
                localCapture: LOCAL_CAPTURE_ENABLED,
                swaggerEnabled: ENABLE_SWAGGER,
                corsOriginsLoaded: ALLOWED_ORIGINS.length,
                dashboardGuardEnabled: !!DASHBOARD_TOKEN,
                developedBy: 'WP MONITOR',
            },
        });
        bootLog('ok', 'Startup audit event recorded: backend_operational');
    } catch (err) {
        bootLog('error', 'Startup audit event failed to record');
    }
}

logStartupBanner();

const app = express();
app.set('trust proxy', TRUST_PROXY);
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json({ limit: '3mb' }));
app.use('/uploads', express.static(path.join(process.cwd(), 'public', 'uploads')));

function extractAuthToken(req: express.Request): string {
    const auth = req.headers.authorization || '';
    if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
    return '';
}

function isAuthorizedToken(token: string): boolean {
    return !DASHBOARD_TOKEN || token === DASHBOARD_TOKEN;
}

function buildOpenApiDocument() {
    return {
        openapi: '3.0.3',
        info: {
            title: 'WP MONITOR API',
            version: APP_VERSION,
            description: 'Authorized activity monitoring, case management, audit trail, reports, and local capture API. WP MONITOR.',
        },
        servers: [{ url: `http://localhost:${PORT}` }],
        tags: [
            { name: 'Runtime' },
            { name: 'Cases' },
            { name: 'Audit' },
            { name: 'Contacts' },
            { name: 'Network' },
            { name: 'Call Capture' },
            { name: 'Check-In' },
            { name: 'Reports' },
            { name: 'Evidence' },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                },
            },
        },
        security: DASHBOARD_TOKEN ? [{ bearerAuth: [] }] : [],
        paths: {
            '/api/runtime-capabilities': {
                get: {
                    tags: ['Runtime'],
                    summary: 'Get runtime capabilities',
                    security: [],
                    responses: { '200': { description: 'Runtime capability document' } },
                },
            },
            '/api/health': {
                get: {
                    tags: ['Runtime'],
                    summary: 'Get operational health without secrets',
                    security: [],
                    responses: { '200': { description: 'Service operational' }, '503': { description: 'Service degraded' } },
                },
            },
            '/api/cases': {
                get: {
                    tags: ['Cases'],
                    summary: 'List cases',
                    parameters: [
                        { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
                        { name: 'status', in: 'query', schema: { type: 'string', enum: CASE_STATUSES } },
                    ],
                    responses: { '200': { description: 'Case list' } },
                },
                post: {
                    tags: ['Cases'],
                    summary: 'Create or update a case',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['caseId', 'primaryOperator', 'authorizationNote'],
                                    properties: {
                                        caseId: { type: 'string' },
                                        title: { type: 'string' },
                                        description: { type: 'string', nullable: true },
                                        status: { type: 'string', enum: CASE_STATUSES },
                                        primaryOperator: { type: 'string' },
                                        authorizationNote: { type: 'string' },
                                        tags: { type: 'array', items: { type: 'string' } },
                                    },
                                },
                            },
                        },
                    },
                    responses: { '201': { description: 'Case created or updated' }, '400': { description: 'Missing required fields' } },
                },
            },
            '/api/cases/{caseId}': {
                get: {
                    tags: ['Cases'],
                    summary: 'Get a case',
                    parameters: [{ name: 'caseId', in: 'path', required: true, schema: { type: 'string' } }],
                    responses: { '200': { description: 'Case document' }, '404': { description: 'Case not found' } },
                },
                patch: {
                    tags: ['Cases'],
                    summary: 'Update a case',
                    parameters: [{ name: 'caseId', in: 'path', required: true, schema: { type: 'string' } }],
                    responses: { '200': { description: 'Updated case' }, '404': { description: 'Case not found' } },
                },
            },
            '/api/cases/{caseId}/close': {
                post: {
                    tags: ['Cases'],
                    summary: 'Close a case',
                    parameters: [{ name: 'caseId', in: 'path', required: true, schema: { type: 'string' } }],
                    responses: { '200': { description: 'Closed case' }, '404': { description: 'Case not found' } },
                },
            },
            '/api/cases/{caseId}/evidence': {
                get: {
                    tags: ['Cases'],
                    summary: 'List direct evidence links for a case',
                    parameters: [{ name: 'caseId', in: 'path', required: true, schema: { type: 'string' } }],
                    responses: { '200': { description: 'Case evidence links' } },
                },
            },
            '/api/audit/{caseId}': {
                get: {
                    tags: ['Audit'],
                    summary: 'List audit events for a case',
                    parameters: [
                        { name: 'caseId', in: 'path', required: true, schema: { type: 'string' } },
                        { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } },
                    ],
                    responses: { '200': { description: 'Audit events' } },
                },
            },
            '/api/audit/{caseId}/export': {
                get: {
                    tags: ['Audit'],
                    summary: 'Export audit events with SHA-256 integrity hash',
                    parameters: [{ name: 'caseId', in: 'path', required: true, schema: { type: 'string' } }],
                    responses: { '200': { description: 'Audit JSON export' } },
                },
            },
            '/api/contacts': {
                get: {
                    tags: ['Contacts'],
                    summary: 'List active contacts',
                    responses: { '200': { description: 'Contact list' } },
                },
            },
            '/api/network/interfaces': {
                get: {
                    tags: ['Network'],
                    summary: 'List local capture interfaces',
                    responses: { '200': { description: 'Interfaces' }, '403': { description: 'Local capture disabled' } },
                },
            },
            '/api/network/export/json': {
                get: {
                    tags: ['Network'],
                    summary: 'Export captured packets as JSON',
                    responses: { '200': { description: 'Packet JSON export' }, '403': { description: 'Local capture disabled' } },
                },
            },
            '/api/network/export/csv': {
                get: {
                    tags: ['Network'],
                    summary: 'Export captured packets as CSV',
                    responses: { '200': { description: 'Packet CSV export' }, '403': { description: 'Local capture disabled' } },
                },
            },
            '/api/call-capture/status': {
                get: {
                    tags: ['Call Capture'],
                    summary: 'Get current call-capture status',
                    responses: { '200': { description: 'Capture status' }, '403': { description: 'Local capture disabled' } },
                },
            },
            '/api/call-capture/start': {
                post: {
                    tags: ['Call Capture'],
                    summary: 'Start manual authorized call capture',
                    responses: { '200': { description: 'Capture started' }, '409': { description: 'Case closed or archived' } },
                },
            },
            '/api/call-capture/stop': {
                post: {
                    tags: ['Call Capture'],
                    summary: 'Stop manual call capture',
                    responses: { '200': { description: 'Call analysis result' } },
                },
            },
            '/api/checkins': {
                get: {
                    tags: ['Check-In'],
                    summary: 'List authorized check-ins',
                    parameters: [
                        { name: 'caseId', in: 'query', schema: { type: 'string' } },
                        { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
                    ],
                    responses: { '200': { description: 'Check-in list' } },
                },
                post: {
                    tags: ['Check-In'],
                    summary: 'Create consent-based check-in link',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['caseId', 'operatorName', 'authorizationNote'],
                                    properties: {
                                        caseId: { type: 'string' },
                                        operatorName: { type: 'string' },
                                        authorizationNote: { type: 'string' },
                                        label: { type: 'string' },
                                        targetName: { type: 'string', nullable: true },
                                        targetJid: { type: 'string', nullable: true },
                                        ttlHours: { type: 'integer', default: 24, minimum: 1, maximum: 168 },
                                    },
                                },
                            },
                        },
                    },
                    responses: { '201': { description: 'Check-in link created' }, '400': { description: 'Missing required fields' } },
                },
            },
            '/checkin/{token}': {
                get: {
                    tags: ['Check-In'],
                    summary: 'Public consent page for an authorized check-in',
                    security: [],
                    parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
                    responses: { '200': { description: 'Consent HTML page' }, '404': { description: 'Check-in not found' }, '410': { description: 'Expired or revoked' } },
                },
            },
            '/public/checkin/{token}/submit': {
                post: {
                    tags: ['Check-In'],
                    summary: 'Submit explicit-consent check-in evidence',
                    security: [],
                    parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
                    responses: { '200': { description: 'Check-in receipt' }, '400': { description: 'Consent required' }, '410': { description: 'Expired or revoked' }, '429': { description: 'Too many submit attempts' } },
                },
            },
            '/api/report/{jid}/download': {
                get: {
                    tags: ['Reports'],
                    summary: 'Download full contact report',
                    parameters: [{ name: 'jid', in: 'path', required: true, schema: { type: 'string' } }],
                    responses: { '200': { description: 'Report file' } },
                },
            },
            '/api/evidence/{caseId}/package': {
                get: {
                    tags: ['Evidence'],
                    summary: 'Download JSON evidence package with manifest and SHA-256 hashes',
                    parameters: [{ name: 'caseId', in: 'path', required: true, schema: { type: 'string' } }],
                    responses: { '200': { description: 'Evidence package JSON' }, '404': { description: 'Case/evidence not found' } },
                },
            },
            '/api/evidence/{caseId}/package.zip': {
                get: {
                    tags: ['Evidence'],
                    summary: 'Download ZIP evidence package with separated JSON artifacts',
                    parameters: [{ name: 'caseId', in: 'path', required: true, schema: { type: 'string' } }],
                    responses: { '200': { description: 'Evidence package ZIP' }, '404': { description: 'Case/evidence not found' } },
                },
            },
            '/api/reports/{caseId}/final': {
                get: {
                    tags: ['Reports'],
                    summary: 'Download final case report as JSON',
                    parameters: [{ name: 'caseId', in: 'path', required: true, schema: { type: 'string' } }],
                    responses: { '200': { description: 'Final case report JSON' }, '404': { description: 'Case/evidence not found' } },
                },
            },
            '/api/reports/{caseId}/final.html': {
                get: {
                    tags: ['Reports'],
                    summary: 'Download final printable case report as HTML',
                    parameters: [{ name: 'caseId', in: 'path', required: true, schema: { type: 'string' } }],
                    responses: { '200': { description: 'Final case report HTML' }, '404': { description: 'Case/evidence not found' } },
                },
            },
            '/api/reports/{caseId}/final.pdf': {
                get: {
                    tags: ['Reports'],
                    summary: 'Download final case report as PDF',
                    parameters: [{ name: 'caseId', in: 'path', required: true, schema: { type: 'string' } }],
                    responses: { '200': { description: 'Final case report PDF' }, '404': { description: 'Case/evidence not found' } },
                },
            },
        },
    };
}

if (ENABLE_SWAGGER) {
    app.get('/docs/openapi.json', (_req, res) => {
        res.json(buildOpenApiDocument());
    });

    app.get('/docs', (_req, res) => {
        res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>WP MONITOR API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/docs/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      persistAuthorization: false
    });
  </script>
</body>
</html>`);
    });
}

app.use('/api', (req, res, next) => {
    if (req.path === '/runtime-capabilities' || req.path === '/health') {
        next();
        return;
    }
    if (!isAuthorizedToken(extractAuthToken(req))) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    next();
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: ALLOWED_ORIGINS,
        methods: ["GET", "POST"]
    }
});

io.use((socket, next) => {
    const token = typeof socket.handshake.auth?.token === 'string'
        ? socket.handshake.auth.token
        : '';

    if (!isAuthorizedToken(token)) {
        next(new Error('Unauthorized'));
        return;
    }

    next();
});

let sock: any;
let isWhatsAppConnected = false;
let globalProbeMethod: ProbeMethod = 'delete'; // Default to delete method
let currentWhatsAppQr: string | null = null; // Store current QR code for new clients
let isWhatsAppConnecting = false;
let isRotatingWhatsAppAuth = false;
const WHATSAPP_AUTH_DIR = 'auth_info_baileys';
let autoRestoreTimer: NodeJS.Timeout | null = null;

interface TrackerEntry {
    tracker: WhatsAppTracker;
}

const trackers: Map<string, TrackerEntry> = new Map(); // JID -> Tracker entry

type LiveSignalSource = 'presence' | 'call' | 'message' | 'rtt_probe' | 'system';
type LiveConfidence = 'none' | 'low' | 'medium' | 'high';
const EPHEMERAL_PRESENCE_TTL_MS = 12_000;
const AVAILABLE_PRESENCE_TTL_MS = 45_000;
const UNAVAILABLE_PRESENCE_TTL_MS = 90_000;
const ACTIVE_CALL_TTL_MS = 2 * 60_000;
const ENDED_CALL_TTL_MS = 8_000;

interface LiveSignal {
    source: LiveSignalSource;
    value: string;
    label: string;
    confidence: LiveConfidence;
    timestamp: number;
    details?: Record<string, unknown>;
}

interface ContactLiveState {
    jid: string;
    state: string;
    label: string;
    confidence: LiveConfidence;
    source: LiveSignalSource;
    lastSignalAt: string | null;
    signals: Partial<Record<LiveSignalSource, LiveSignal>>;
    recentSignals: LiveSignal[];
    explanation: string;
}

const liveSignals: Map<string, Partial<Record<LiveSignalSource, LiveSignal>>> = new Map();
const liveSignalHistory: Map<string, LiveSignal[]> = new Map();
const persistedActivityEventKeys: Map<string, number> = new Map();

interface CaptureAuditContext {
    caseId: string;
    operatorName: string;
    authorizationNote: string;
}

let activeNetworkAuditContext: (CaptureAuditContext & { captureSessionId: string }) | null = null;
let activeCallAuditContext: (CaptureAuditContext & { targetJid: string; callId: string }) | null = null;
const liveSignalExpiryTimers = new Map<string, NodeJS.Timeout>();

function rejectCaptureUnavailable(res: express.Response): boolean {
    return sendCaptureUnavailableIfNeeded(RUNTIME_CONFIG, res);
}

function parseCaptureAuditContext(data: any): CaptureAuditContext | null {
    const caseId = validateCaseId(data?.caseId);
    const operatorName = validateRequiredText(data?.operatorName, 'operatorName', 120);
    const authorizationNote = validateRequiredText(data?.authorizationNote, 'authorizationNote', 1000);

    if (!caseId.ok || !operatorName.ok || !authorizationNote.ok) return null;

    return {
        caseId: caseId.value!,
        operatorName: operatorName.value!,
        authorizationNote: authorizationNote.value!,
    };
}

function getDefaultCaptureAuditContext(): CaptureAuditContext | null {
    return parseCaptureAuditContext({
        caseId: process.env.DEFAULT_CASE_ID,
        operatorName: process.env.DEFAULT_OPERATOR_NAME,
        authorizationNote: process.env.DEFAULT_AUTHORIZATION_NOTE,
    });
}

async function checkCaseCanCapture(context: CaptureAuditContext): Promise<{ ok: true } | { ok: false; status: number; payload: Record<string, unknown> }> {
    const existing = await getCase(context.caseId);
    if (existing?.status === 'closed' || existing?.status === 'archived') {
        return {
            ok: false,
            status: 409,
            payload: {
                error: `Case ${context.caseId} is ${existing.status}; capture is not allowed`,
                caseId: context.caseId,
                status: existing.status,
            },
        };
    }

    if (!existing) {
        await createCase({
            caseId: context.caseId,
            title: context.caseId,
            status: 'active',
            primaryOperator: context.operatorName,
            authorizationNote: context.authorizationNote,
        });
    } else if (existing.status === 'draft' || existing.status === 'authorized') {
        await updateCase(context.caseId, { status: 'active' });
    }

    return { ok: true };
}

async function ensureCaseCanCapture(context: CaptureAuditContext, res: express.Response): Promise<boolean> {
    const result = await checkCaseCanCapture(context);
    if (result.ok) return true;
    res.status(result.status).json(result.payload);
    return false;
}

async function auditEvent(
    context: CaptureAuditContext,
    action: string,
    scope: 'network' | 'call' | 'contact' | 'report' | 'system',
    details: Record<string, unknown> = {},
    targetJid?: string | null
) {
    await saveAuditEvent({
        ...context,
        action,
        scope,
        targetJid: targetJid || null,
        details,
    });
}

function normalizeLiveJid(value: unknown): string | null {
    const text = cleanText(value, 140);
    if (!text) return null;
    const candidate = text.includes('@') ? text : `${text}@s.whatsapp.net`;
    const normalized = candidate.endsWith('@lid') ? resolveLidToPhoneJid(candidate) : candidate;
    if (!normalized) return null;
    const result = validateJid(normalized);
    return result.ok ? result.value! : null;
}

function resolveLidToPhoneJid(candidate: string): string | null {
    const lid = cleanText(candidate.split('@')[0], 80).replace(/\D/g, '');
    if (!lid) return null;
    const reverseMapPath = path.join(WHATSAPP_AUTH_DIR, `lid-mapping-${lid}_reverse.json`);
    if (!existsSync(reverseMapPath)) return null;
    try {
        const phone = JSON.parse(readFileSync(reverseMapPath, 'utf8'));
        const digits = typeof phone === 'string' ? phone.replace(/\D/g, '') : '';
        if (!digits) return null;
        return `${digits}@s.whatsapp.net`;
    } catch {
        return null;
    }
}

function signalAgeMs(signal?: LiveSignal): number | null {
    return signal ? Math.max(0, Date.now() - signal.timestamp) : null;
}

function formatPresenceLabel(value: string): string {
    switch (value) {
        case 'composing': return 'Escribiendo';
        case 'recording': return 'Grabando audio';
        case 'available': return 'Online';
        case 'unavailable': return 'No disponible';
        default: return value || 'Sin presencia';
    }
}

function formatCallLabel(value: string): string {
    switch (value) {
        case 'offer': return 'Llamada entrante';
        case 'ringing': return 'Llamando';
        case 'accept': return 'Llamada activa';
        case 'busy': return 'Ocupado en llamada';
        case 'reject': return 'Llamada rechazada';
        case 'timeout': return 'Llamada perdida';
        case 'terminate': return 'Llamada finalizada';
        default: return value || 'Evento de llamada';
    }
}

function isActiveCallStatus(value: string): boolean {
    return ['offer', 'ringing', 'accept', 'busy'].includes(value);
}

function formatMessageLabel(direction: string, messageType: string): string {
    return direction === 'outgoing'
        ? `Mensaje enviado (${messageType})`
        : `Mensaje recibido (${messageType})`;
}

function getMessageType(message: any): string {
    const payload = message?.message;
    if (!payload) return 'unknown';
    if (payload.conversation || payload.extendedTextMessage) return 'text';
    if (payload.imageMessage) return 'image';
    if (payload.videoMessage) return 'video';
    if (payload.audioMessage) return 'audio';
    if (payload.documentMessage) return 'document';
    if (payload.stickerMessage) return 'sticker';
    if (payload.locationMessage || payload.liveLocationMessage) return 'location';
    if (payload.contactMessage || payload.contactsArrayMessage) return 'contact';
    if (payload.reactionMessage) return 'reaction';
    if (payload.call) return 'call';
    return Object.keys(payload)[0] || 'unknown';
}

function publishCallLiveState(call: any, source: 'baileys' | 'raw-node' = 'baileys') {
    const resolvedCallJid = normalizeLiveJid(call.from) || normalizeLiveJid(call.chatId) || normalizeLiveJid(call.callerPn);
    console.log(`[CALL] Event: ${call.status} | From: ${call.from} | Resolved: ${resolvedCallJid || 'unmapped'} | ID: ${call.id} | Video: ${call.isVideo || false} | Source: ${source}`);
    if (resolvedCallJid) updateLiveSignal(resolvedCallJid, {
        source: 'call',
        value: call.status,
        label: formatCallLabel(call.status),
        confidence: isActiveCallStatus(call.status) ? 'high' : 'medium',
        timestamp: call.date ? new Date(call.date).getTime() : Date.now(),
        details: {
            callId: call.id,
            rawFrom: call.from,
            chatId: call.chatId || null,
            callerPn: call.callerPn || null,
            detector: source,
            isVideo: call.isVideo || false,
            offline: call.offline,
            latencyMs: call.latencyMs,
        },
    });

    io.emit('call-event', {
        callId: call.id,
        from: resolvedCallJid || call.from,
        rawFrom: call.from,
        chatId: call.chatId || null,
        callerPn: call.callerPn || null,
        status: call.status,
        isVideo: call.isVideo || false,
        date: call.date,
        offline: call.offline,
        latencyMs: call.latencyMs,
        detector: source,
    });

    return resolvedCallJid;
}

function installRawCallNodeMonitor(socket: any) {
    socket?.ws?.on?.('CB:call', (node: BinaryNode) => {
        try {
            const [infoChild] = getAllBinaryNodeChildren(node);
            if (!infoChild) return;
            const reason = infoChild.attrs?.reason || infoChild.attrs?.status || '';
            const rawStatus = infoChild.tag === 'busy' || reason === 'busy' ? 'busy' : '';
            if (!rawStatus) return;

            publishCallLiveState({
                chatId: node.attrs?.from || null,
                from: infoChild.attrs?.from || infoChild.attrs?.['call-creator'] || node.attrs?.from,
                callerPn: infoChild.attrs?.caller_pn,
                id: infoChild.attrs?.['call-id'] || node.attrs?.id || `raw-${Date.now()}`,
                date: node.attrs?.t ? new Date(Number(node.attrs.t) * 1000) : new Date(),
                offline: node.attrs?.offline === 'true' || node.attrs?.offline === '1',
                status: rawStatus,
                isVideo: getAllBinaryNodeChildren(infoChild).some(child => child.tag === 'video'),
            }, 'raw-node');
        } catch (err: any) {
            console.log(`[CALL] Raw node monitor skipped event: ${err?.message || err}`);
        }
    });
}

function shouldPersistActivitySignal(jid: string, signal: LiveSignal): boolean {
    if (signal.source === 'rtt_probe' || signal.source === 'system') return false;
    const keyParts = [jid, signal.source, signal.value];
    const details = signal.details || {};
    if (signal.source === 'message' && details.messageId) keyParts.push(String(details.messageId));
    if (signal.source === 'call' && details.callId) keyParts.push(String(details.callId));
    const key = keyParts.join(':');
    const now = Date.now();
    const previous = persistedActivityEventKeys.get(key) || 0;
    const minGap = signal.source === 'presence' ? 8_000 : signal.source === 'call' ? 2_000 : 0;
    if (previous && now - previous < minGap) return false;
    persistedActivityEventKeys.set(key, now);
    if (persistedActivityEventKeys.size > 2000) {
        const cutoff = now - 10 * 60_000;
        for (const [eventKey, timestamp] of persistedActivityEventKeys) {
            if (timestamp < cutoff) persistedActivityEventKeys.delete(eventKey);
        }
    }
    return true;
}

function persistObservedActivitySignal(jid: string, signal: LiveSignal) {
    if (!shouldPersistActivitySignal(jid, signal)) return;
    saveActivityEvent({
        jid,
        source: signal.source,
        type: signal.value,
        label: signal.label,
        confidence: signal.confidence,
        details: signal.details,
        timestamp: signal.timestamp,
    }).catch(err => console.error('[ACTIVITY] Failed to persist observed activity:', err));
}

function updateLiveSignal(jidInput: unknown, signal: Omit<LiveSignal, 'timestamp'> & { timestamp?: number }) {
    const jid = normalizeLiveJid(jidInput);
    if (!jid) return null;

    const timestamp = signal.timestamp || Date.now();
    const complete: LiveSignal = { ...signal, timestamp };
    const signals = liveSignals.get(jid) || {};
    signals[signal.source] = complete;
    liveSignals.set(jid, signals);

    const history = [complete, ...(liveSignalHistory.get(jid) || [])].slice(0, 200);
    liveSignalHistory.set(jid, history);
    persistObservedActivitySignal(jid, complete);

    const state = buildContactLiveState(jid);
    io.emit('contact-live-state', state);
    scheduleLiveSignalExpiry(jid, complete);
    return state;
}

function liveSignalMaxAge(signal: LiveSignal): number {
    if (signal.source === 'presence') {
        if (signal.value === 'composing' || signal.value === 'recording') return EPHEMERAL_PRESENCE_TTL_MS;
        if (signal.value === 'available') return AVAILABLE_PRESENCE_TTL_MS;
        return UNAVAILABLE_PRESENCE_TTL_MS;
    }
    if (signal.source === 'call') {
        return isActiveCallStatus(signal.value) ? ACTIVE_CALL_TTL_MS : ENDED_CALL_TTL_MS;
    }
    if (signal.source === 'message') return 5 * 60_000;
    if (signal.source === 'rtt_probe') return 2 * 60_000;
    return 30_000;
}

function scheduleLiveSignalExpiry(jid: string, signal: LiveSignal) {
    if (signal.source !== 'presence' && signal.source !== 'call') return;
    const key = `${jid}:${signal.source}`;
    const existing = liveSignalExpiryTimers.get(key);
    if (existing) clearTimeout(existing);

    const maxAge = liveSignalMaxAge(signal);
    const timer = setTimeout(() => {
        const signals = liveSignals.get(jid);
        const current = signals?.[signal.source];
        if (!current || current.timestamp !== signal.timestamp || current.value !== signal.value) return;
        delete signals![signal.source];
        if (Object.keys(signals!).length === 0) {
            liveSignals.delete(jid);
        } else {
            liveSignals.set(jid, signals!);
        }
        liveSignalExpiryTimers.delete(key);
        io.emit('contact-live-state', buildContactLiveState(jid));
        if (signal.source === 'presence') {
            io.emit('presence-change', { jid, presence: 'expired', timestamp: Date.now() });
        }
    }, maxAge + 250);
    liveSignalExpiryTimers.set(key, timer);
}

function buildContactLiveState(jid: string): ContactLiveState {
    const signals = liveSignals.get(jid) || {};
    const now = Date.now();
    const fresh = (source: LiveSignalSource, maxAgeMs: number) => {
        const signal = signals[source];
        return signal && now - signal.timestamp <= maxAgeMs ? signal : null;
    };

    const rawCall = signals.call;
    const rawPresence = signals.presence;
    const call = rawCall ? fresh('call', liveSignalMaxAge(rawCall)) : null;
    const presence = rawPresence ? fresh('presence', liveSignalMaxAge(rawPresence)) : null;
    const message = fresh('message', 5 * 60_000);
    const rtt = fresh('rtt_probe', 2 * 60_000);

    let selected: LiveSignal | null = null;
    let explanation = 'Sin senales recientes suficientes para clasificar actividad.';

    if (call && isActiveCallStatus(call.value)) {
        selected = call;
        explanation = 'Evento de llamada recibido desde Baileys; esta senal tiene prioridad alta.';
    } else if (presence && ['composing', 'recording', 'available'].includes(presence.value)) {
        selected = presence;
        explanation = 'Presence realtime de WhatsApp indica actividad directa del contacto.';
    } else if (message) {
        selected = message;
        explanation = 'Mensaje reciente observado por Baileys; confirma actividad de mensajeria en la conversacion.';
    } else if (presence && presence.value === 'unavailable') {
        selected = presence;
        explanation = 'Presence reporto unavailable; puede estar limitado por privacidad o caducidad de presencia.';
    } else if (rtt) {
        selected = rtt;
        explanation = rtt.value === 'OFFLINE'
            ? 'El probe RTT no recibio ACK. Esto es no concluyente y no prueba desconexion real.'
            : 'Estado inferido por RTT/probe; menor prioridad que presence, mensajes o llamadas.';
    }

    const lastSignal = Object.values(signals)
        .filter(Boolean)
        .sort((a, b) => b!.timestamp - a!.timestamp)[0] || null;

    return {
        jid,
        state: selected?.value || 'unknown',
        label: selected?.label || 'Sin senal reciente',
        confidence: selected?.confidence || 'none',
        source: selected?.source || 'system',
        lastSignalAt: lastSignal ? new Date(lastSignal.timestamp).toISOString() : null,
        signals,
        recentSignals: (liveSignalHistory.get(jid) || []).slice(0, 50),
        explanation,
    };
}

async function getCaseExportContext(caseId: string, authorizationNote: string): Promise<CaptureAuditContext | null> {
    const [caseRecord, auditEvents, evidenceLinks] = await Promise.all([
        getCase(caseId),
        getAuditEvents(caseId, 1),
        getCaseEvidenceLinks(caseId),
    ]);

    if (!caseRecord && auditEvents.length === 0 && evidenceLinks.length === 0) return null;

    return {
        caseId,
        operatorName: caseRecord?.primaryOperator || auditEvents[0]?.operatorName || 'system',
        authorizationNote: caseRecord?.authorizationNote || auditEvents[0]?.authorizationNote || authorizationNote,
    };
}

async function linkEvidenceToCase(
    context: CaptureAuditContext,
    type: 'contact' | 'network_capture' | 'call_analysis' | 'report' | 'evidence_package' | 'check_in',
    refId: string,
    label: string,
    metadata: Record<string, unknown> = {},
    targetJid?: string | null
) {
    await saveCaseEvidenceLink({
        caseId: context.caseId,
        type,
        refId,
        label,
        targetJid: targetJid || null,
        metadata: {
            operatorName: context.operatorName,
            ...metadata,
        },
    });
}

function getClientIp(req: express.Request): string {
    return String(req.ip || req.socket.remoteAddress || '').trim().replace(/^::ffff:/, '') || 'unknown';
}

interface RateLimitBucket {
    count: number;
    resetAt: number;
}

const publicCheckInSubmitBuckets = new Map<string, RateLimitBucket>();

function consumeRateLimit(key: string, max: number, windowMs: number): { ok: true } | { ok: false; retryAfterSeconds: number } {
    const now = Date.now();
    if (publicCheckInSubmitBuckets.size > 10_000) {
        for (const [bucketKey, bucket] of publicCheckInSubmitBuckets) {
            if (bucket.resetAt <= now) publicCheckInSubmitBuckets.delete(bucketKey);
        }
    }

    const existing = publicCheckInSubmitBuckets.get(key);
    if (!existing || existing.resetAt <= now) {
        publicCheckInSubmitBuckets.set(key, { count: 1, resetAt: now + windowMs });
        return { ok: true };
    }

    if (existing.count >= max) {
        return {
            ok: false,
            retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
        };
    }

    existing.count += 1;
    return { ok: true };
}

function enforcePublicCheckInSubmitRateLimit(req: express.Request, res: express.Response, token: string): boolean {
    const ip = getClientIp(req);
    const ipResult = consumeRateLimit(`checkin-submit:ip:${ip}`, CHECKIN_SUBMIT_RATE_MAX_PER_IP, CHECKIN_SUBMIT_RATE_WINDOW_MS);
    const tokenIpResult = consumeRateLimit(`checkin-submit:token:${token}:ip:${ip}`, CHECKIN_SUBMIT_RATE_MAX_PER_TOKEN_IP, CHECKIN_SUBMIT_RATE_WINDOW_MS);
    const denied = ipResult.ok ? tokenIpResult : ipResult;

    if (!denied.ok) {
        res.setHeader('Retry-After', String(denied.retryAfterSeconds));
        res.status(429).json({ error: 'Too many check-in submit attempts. Try again later.' });
        return false;
    }

    return true;
}

function getPublicBaseUrl(req: express.Request): string {
    const configured = process.env.PUBLIC_BASE_URL?.trim();
    if (configured) return configured.replace(/\/+$/, '');
    return `${req.protocol}://${req.get('host')}`;
}

function parseTtlHours(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 24;
    return Math.max(1, Math.min(168, Math.floor(parsed)));
}

function parseImageDataUrl(value: unknown): { ext: string; buffer: Buffer } | null {
    if (typeof value !== 'string') return null;
    const match = value.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return null;
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length === 0 || buffer.length > 2 * 1024 * 1024) return null;
    return { ext, buffer };
}

function cleanHexColor(value: unknown, fallback: string): string {
    const text = cleanText(value, 16);
    return text && /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

function cleanOptionalUrl(value: unknown): string | null {
    const text = cleanText(value, 1000);
    if (!text) return null;
    try {
        const url = new URL(text);
        return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
    } catch {
        return null;
    }
}

async function emitCheckInsChanged(action: string, token: string, caseId?: string): Promise<void> {
    io.emit('checkins-changed', {
        action,
        token,
        caseId,
        timestamp: new Date().toISOString(),
    });
}

app.post('/api/checkins/assets', async (req, res) => {
    const parsed = parseImageDataUrl(req.body?.dataUrl);
    if (!parsed) {
        validationError(res, ['Image must be PNG, JPEG, WebP, or GIF data URL up to 2MB']);
        return;
    }

    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'checkins');
    await mkdir(uploadDir, { recursive: true });
    const filename = `${createCheckInToken()}.${parsed.ext}`;
    await writeFile(path.join(uploadDir, filename), parsed.buffer);
    res.status(201).json({
        url: `${getPublicBaseUrl(req)}/uploads/checkins/${filename}`,
    });
});

app.post('/api/checkins', async (req, res) => {
    const context = parseCaptureAuditContext(req.body);
    if (!context) {
        validationError(res, ['caseId, operatorName, and authorizationNote are required']);
        return;
    }
    if (!await ensureCaseCanCapture(context, res)) return;

    const label = cleanText(req.body?.label, 160) || `Check-in ${new Date().toISOString()}`;
    const targetName = cleanText(req.body?.targetName, 160) || null;
    const pageTitle = cleanText(req.body?.pageTitle, 120) || 'Check-in autorizado';
    const pageDescription = cleanText(req.body?.pageDescription, 260) || undefined;
    const ogImageUrl = cleanText(req.body?.ogImageUrl, 1000) || null;
    const brandName = cleanText(req.body?.brandName, 80) || 'WP MONITOR';
    const accentColor = cleanHexColor(req.body?.accentColor, '#25d366');
    const backgroundColor = cleanHexColor(req.body?.backgroundColor, '#0b1020');
    const panelColor = cleanHexColor(req.body?.panelColor, '#151b31');
    const textColor = cleanHexColor(req.body?.textColor, '#eef4ff');
    const layout = ['classic', 'hero', 'compact'].includes(req.body?.layout) ? req.body.layout : 'classic';
    const requestGps = req.body?.requestGps !== false;
    const caseLabel = cleanText(req.body?.caseLabel, 60) || 'Caso';
    const operatorLabel = cleanText(req.body?.operatorLabel, 60) || 'Operador';
    const checkInLabel = cleanText(req.body?.checkInLabel, 60) || 'Etiqueta';
    const expiresLabel = cleanText(req.body?.expiresLabel, 60) || 'Vence';
    const consentText = cleanText(req.body?.consentText, 1200) || undefined;
    const submitButtonText = cleanText(req.body?.submitButtonText, 80) || 'Aceptar y enviar check-in';
    const successMessage = cleanText(req.body?.successMessage, 180) || 'Check-in recibido. Hash de evidencia:';
    const redirectUrl = cleanOptionalUrl(req.body?.redirectUrl);
    const targetJidResult = normalizeOptionalJid(req.body?.targetJid, '');
    if (!targetJidResult.ok) {
        validationError(res, targetJidResult.errors || ['Invalid targetJid']);
        return;
    }
    const targetJid = targetJidResult.value || null;
    const ttlHours = parseTtlHours(req.body?.ttlHours);
    const now = new Date();
    const token = createCheckInToken();
    const expiresAt = new Date(now.getTime() + ttlHours * 3600 * 1000);

    const doc: CheckInDoc = {
        token,
        caseId: context.caseId,
        operatorName: context.operatorName,
        authorizationNote: context.authorizationNote,
        label,
        targetName,
        targetJid,
        content: {
            pageTitle,
            pageDescription,
            ogImageUrl,
            brandName,
            accentColor,
            backgroundColor,
            panelColor,
            textColor,
            layout,
            requestGps,
            caseLabel,
            operatorLabel,
            checkInLabel,
            expiresLabel,
            consentText,
            submitButtonText,
            successMessage,
            redirectUrl,
        },
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        expiresAt,
        completedAt: null,
        request: null,
        browser: null,
        consent: {
            accepted: false,
            text: buildConsentText(consentText, requestGps),
            acceptedAt: null,
        },
        location: null,
        ipEnrichment: null,
        hash: '',
    };
    doc.hash = buildCheckInHash(doc);

    const saved = await saveCheckInRequest(doc);
    if (!saved) {
        res.status(503).json({ error: 'Check-in persistence unavailable' });
        return;
    }
    await linkEvidenceToCase(context, 'check_in', token, label, {
        status: 'pending',
        expiresAt: expiresAt.toISOString(),
        targetName,
        pageTitle,
        hasOgImage: !!ogImageUrl,
    }, targetJid);
    await auditEvent(context, 'checkin_link_created', targetJid ? 'contact' : 'system', {
        token,
        label,
        targetName,
        expiresAt: expiresAt.toISOString(),
    }, targetJid);
    await emitCheckInsChanged('created', token, context.caseId);

    res.status(201).json({
        token,
        url: `${getPublicBaseUrl(req)}/checkin/${encodeURIComponent(token)}`,
        status: doc.status,
        expiresAt: expiresAt.toISOString(),
    });
});

app.get('/api/checkins', async (req, res) => {
    const caseIdResult: { ok: boolean; value?: string; errors?: string[] } = typeof req.query.caseId === 'string' && req.query.caseId.trim()
        ? validateCaseId(req.query.caseId)
        : { ok: true, value: undefined };
    if (!caseIdResult.ok) {
        validationError(res, caseIdResult.errors || ['Invalid caseId']);
        return;
    }

    const items = await listCheckIns(caseIdResult.value, parseLimit(req.query.limit, 50, 200));
    res.json(items.map(item => ({
        ...item,
        url: `${getPublicBaseUrl(req)}/checkin/${encodeURIComponent(item.token)}`,
    })));
});

app.patch('/api/checkins/:token', async (req, res) => {
    const token = cleanText(req.params.token, 200);
    const existing = token ? await getCheckInByToken(token) : null;
    if (!existing) {
        res.status(404).json({ error: 'Check-in not found' });
        return;
    }

    const context: CaptureAuditContext = {
        caseId: existing.caseId,
        operatorName: existing.operatorName,
        authorizationNote: existing.authorizationNote,
    };

    if (req.body?.action === 'revoke') {
        if (existing.status === 'completed') {
            res.status(409).json({ error: 'Completed check-ins cannot be revoked' });
            return;
        }
        const revoked = await updateCheckIn(existing.token, { status: 'revoked' });
        if (!revoked) {
            res.status(503).json({ error: 'Check-in could not be revoked' });
            return;
        }
        await linkEvidenceToCase(context, 'check_in', existing.token, existing.label, {
            status: 'revoked',
            revokedAt: new Date().toISOString(),
        }, existing.targetJid);
        await auditEvent(context, 'checkin_revoked', existing.targetJid ? 'contact' : 'system', {
            token: existing.token,
            label: existing.label,
        }, existing.targetJid);
        await emitCheckInsChanged('revoked', existing.token, existing.caseId);
        res.json(revoked);
        return;
    }

    if (existing.status !== 'pending') {
        res.status(409).json({ error: 'Only pending check-ins can be updated' });
        return;
    }

    const patch: Partial<CheckInDoc> = {};
    const label = cleanText(req.body?.label, 160);
    const targetName = cleanText(req.body?.targetName, 160);
    const pageTitle = cleanText(req.body?.pageTitle, 120);
    const pageDescription = cleanText(req.body?.pageDescription, 260);
    const ogImageUrl = cleanText(req.body?.ogImageUrl, 1000);
    const brandName = cleanText(req.body?.brandName, 80);
    const accentColor = cleanHexColor(req.body?.accentColor, existing.content?.accentColor || '#7c3aed');
    const backgroundColor = cleanHexColor(req.body?.backgroundColor, existing.content?.backgroundColor || '#0b1020');
    const panelColor = cleanHexColor(req.body?.panelColor, existing.content?.panelColor || '#151b31');
    const textColor = cleanHexColor(req.body?.textColor, existing.content?.textColor || '#eef4ff');
    const layout = ['classic', 'hero', 'compact'].includes(req.body?.layout) ? req.body.layout : existing.content?.layout;
    const requestGps = typeof req.body?.requestGps === 'boolean' ? req.body.requestGps : existing.content?.requestGps;
    const caseLabel = cleanText(req.body?.caseLabel, 60);
    const operatorLabel = cleanText(req.body?.operatorLabel, 60);
    const checkInLabel = cleanText(req.body?.checkInLabel, 60);
    const expiresLabel = cleanText(req.body?.expiresLabel, 60);
    const consentText = cleanText(req.body?.consentText, 1200);
    const submitButtonText = cleanText(req.body?.submitButtonText, 80);
    const successMessage = cleanText(req.body?.successMessage, 180);
    const redirectUrl = cleanOptionalUrl(req.body?.redirectUrl);
    const ttlHours = req.body?.ttlHours === undefined ? null : parseTtlHours(req.body.ttlHours);

    if (label) patch.label = label;
    if (req.body?.targetName !== undefined) patch.targetName = targetName || null;
    if (req.body?.pageTitle !== undefined || req.body?.pageDescription !== undefined || req.body?.ogImageUrl !== undefined
        || req.body?.brandName !== undefined || req.body?.accentColor !== undefined || req.body?.backgroundColor !== undefined
        || req.body?.panelColor !== undefined || req.body?.textColor !== undefined || req.body?.layout !== undefined || req.body?.requestGps !== undefined
        || req.body?.caseLabel !== undefined || req.body?.operatorLabel !== undefined || req.body?.checkInLabel !== undefined
        || req.body?.expiresLabel !== undefined || req.body?.consentText !== undefined || req.body?.submitButtonText !== undefined
        || req.body?.successMessage !== undefined || req.body?.redirectUrl !== undefined) {
        patch.content = {
            ...existing.content,
            ...(req.body?.pageTitle !== undefined ? { pageTitle: pageTitle || 'Check-in autorizado' } : {}),
            ...(req.body?.pageDescription !== undefined ? { pageDescription: pageDescription || undefined } : {}),
            ...(req.body?.ogImageUrl !== undefined ? { ogImageUrl: ogImageUrl || null } : {}),
            ...(req.body?.brandName !== undefined ? { brandName: brandName || 'WP MONITOR' } : {}),
            ...(req.body?.accentColor !== undefined ? { accentColor } : {}),
            ...(req.body?.backgroundColor !== undefined ? { backgroundColor } : {}),
            ...(req.body?.panelColor !== undefined ? { panelColor } : {}),
            ...(req.body?.textColor !== undefined ? { textColor } : {}),
            ...(req.body?.layout !== undefined ? { layout } : {}),
            ...(req.body?.requestGps !== undefined ? { requestGps } : {}),
            ...(req.body?.caseLabel !== undefined ? { caseLabel: caseLabel || 'Caso' } : {}),
            ...(req.body?.operatorLabel !== undefined ? { operatorLabel: operatorLabel || 'Operador' } : {}),
            ...(req.body?.checkInLabel !== undefined ? { checkInLabel: checkInLabel || 'Etiqueta' } : {}),
            ...(req.body?.expiresLabel !== undefined ? { expiresLabel: expiresLabel || 'Vence' } : {}),
            ...(req.body?.consentText !== undefined ? { consentText: consentText || undefined } : {}),
            ...(req.body?.submitButtonText !== undefined ? { submitButtonText: submitButtonText || 'Aceptar y enviar check-in' } : {}),
            ...(req.body?.successMessage !== undefined ? { successMessage: successMessage || 'Check-in recibido. Hash de evidencia:' } : {}),
            ...(req.body?.redirectUrl !== undefined ? { redirectUrl } : {}),
        };
        const nextContent = patch.content || existing.content;
        patch.consent = {
            ...existing.consent,
            text: buildConsentText(nextContent?.consentText, nextContent?.requestGps !== false),
        };
    }
    if (ttlHours) patch.expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);

    if (Object.keys(patch).length === 0) {
        validationError(res, ['No valid check-in fields provided']);
        return;
    }

    const updated = await updateCheckIn(existing.token, patch);
    if (!updated) {
        res.status(503).json({ error: 'Check-in could not be updated' });
        return;
    }

    await linkEvidenceToCase(context, 'check_in', existing.token, updated.label, {
        status: updated.status,
        expiresAt: updated.expiresAt?.toISOString(),
        targetName: updated.targetName,
        pageTitle: updated.content?.pageTitle,
        hasOgImage: !!updated.content?.ogImageUrl,
    }, updated.targetJid);
    await auditEvent(context, 'checkin_updated', existing.targetJid ? 'contact' : 'system', {
        token: existing.token,
        label: updated.label,
        targetName: updated.targetName,
        expiresAt: updated.expiresAt?.toISOString(),
    }, existing.targetJid);
    await emitCheckInsChanged('updated', existing.token, existing.caseId);
    res.json(updated);
});

app.delete('/api/checkins/:token', async (req, res) => {
    const token = cleanText(req.params.token, 200);
    const existing = token ? await getCheckInByToken(token) : null;
    if (!existing) {
        res.status(404).json({ error: 'Check-in not found' });
        return;
    }
    await auditEvent({
        caseId: existing.caseId,
        operatorName: existing.operatorName,
        authorizationNote: existing.authorizationNote,
    }, 'checkin_deleted', existing.targetJid ? 'contact' : 'system', {
        token: existing.token,
        label: existing.label,
        previousStatus: existing.status,
        completedAt: existing.completedAt?.toISOString(),
        administrativeDelete: true,
    }, existing.targetJid);

    const deleted = await deleteCheckIn(existing.token);
    if (!deleted) {
        res.status(503).json({ error: 'Check-in could not be deleted' });
        return;
    }
    await deleteCaseEvidenceLink(existing.caseId, 'check_in', existing.token);
    await emitCheckInsChanged('deleted', existing.token, existing.caseId);

    res.json({ ok: true, token: existing.token });
});

app.get('/checkin/:token', async (req, res) => {
    const token = cleanText(req.params.token, 200);
    const doc = token ? await getCheckInByToken(token) : null;
    if (!doc) {
        res.status(404).type('html').send('<!doctype html><title>Check-in no encontrado</title><h1>Check-in no encontrado</h1>');
        return;
    }

    const now = new Date();
    if (doc.status === 'completed') {
        res.type('html').send(renderCheckInPage(doc, { status: 'completed' }));
        return;
    }
    if (doc.status === 'revoked') {
        res.status(410).type('html').send(renderCheckInPage(doc, { status: 'revoked' }));
        return;
    }
    if (doc.expiresAt && doc.expiresAt < now) {
        await updateCheckIn(doc.token, { status: 'expired' });
        res.status(410).type('html').send(renderCheckInPage({ ...doc, status: 'expired' }, { status: 'expired' }));
        return;
    }

    res.type('html').send(renderCheckInPage(doc));
});

app.post('/public/checkin/:token/submit', async (req, res) => {
    const token = cleanText(req.params.token, 200);
    if (!enforcePublicCheckInSubmitRateLimit(req, res, token || 'missing')) return;

    const existing = token ? await getCheckInByToken(token) : null;
    if (!existing) {
        res.status(404).json({ error: 'Check-in not found' });
        return;
    }
    if (existing.status === 'completed') {
        res.status(409).json({ error: 'Check-in already completed' });
        return;
    }
    if (existing.status === 'revoked') {
        res.status(410).json({ error: 'Check-in revoked' });
        return;
    }
    if (existing.expiresAt && existing.expiresAt < new Date()) {
        await updateCheckIn(existing.token, { status: 'expired' });
        res.status(410).json({ error: 'Check-in expired' });
        return;
    }

    const submission = normalizeCheckInSubmission(req.body);
    if (!submission.consentAccepted) {
        res.status(400).json({ error: 'Explicit consent is required' });
        return;
    }

    const completedAt = new Date();
    const ip = getClientIp(req);
    const ipEnrichment = ip === 'unknown' ? null : await lookupIpEnrichment(ip);
    const completed: Partial<CheckInDoc> = {
        status: 'completed',
        completedAt,
        updatedAt: completedAt,
        request: {
            ip,
            userAgent: cleanText(req.headers['user-agent'], 500) || '',
            acceptLanguage: cleanText(req.headers['accept-language'], 240) || '',
            referer: cleanText(req.headers.referer, 500) || null,
        },
        browser: {
            timezone: submission.browser?.timezone,
            language: submission.browser?.language,
            languages: submission.browser?.languages,
            platform: submission.browser?.platform,
            userAgentData: submission.browser?.userAgentData,
            device: submission.browser?.device,
            viewport: submission.browser?.viewport?.width && submission.browser.viewport.height
                ? {
                    width: submission.browser.viewport.width,
                    height: submission.browser.viewport.height,
                }
                : undefined,
            screen: submission.browser?.screen?.width && submission.browser.screen.height
                ? {
                    width: submission.browser.screen.width,
                    height: submission.browser.screen.height,
                    pixelRatio: submission.browser.screen.pixelRatio || 1,
                    colorDepth: submission.browser.screen.colorDepth,
                    orientation: submission.browser.screen.orientation,
                }
                : undefined,
            network: submission.browser?.network,
            privacy: submission.browser?.privacy,
        },
        consent: {
            accepted: true,
            text: buildConsentText(existing.content?.consentText, existing.content?.requestGps !== false),
            acceptedAt: completedAt,
        },
        location: {
            permission: submission.location?.permission || 'unavailable',
            lat: submission.location?.lat,
            lon: submission.location?.lon,
            accuracy: submission.location?.accuracy,
            altitude: submission.location?.altitude,
            altitudeAccuracy: submission.location?.altitudeAccuracy,
            heading: submission.location?.heading,
            speed: submission.location?.speed,
            capturedAt: submission.location?.capturedAt ? new Date(submission.location.capturedAt) : null,
        },
        ipEnrichment: ipEnrichment as unknown as Record<string, unknown> | null,
    };

    const fullDoc = { ...existing, ...completed, updatedAt: completedAt } as CheckInDoc;
    completed.consistency = buildCheckInConsistency(fullDoc);
    fullDoc.consistency = completed.consistency;
    completed.hash = buildCheckInHash(fullDoc);
    const updated = await completeCheckIn(existing.token, completed);
    if (!updated) {
        res.status(409).json({ error: 'Check-in could not be completed because it is no longer pending' });
        return;
    }
    const finalHash = updated?.hash || completed.hash;
    const context: CaptureAuditContext = {
        caseId: existing.caseId,
        operatorName: existing.operatorName,
        authorizationNote: existing.authorizationNote,
    };

    await linkEvidenceToCase(context, 'check_in', existing.token, existing.label, {
        status: 'completed',
        completedAt: completedAt.toISOString(),
        ip,
        hasGpsLocation: completed.location?.permission === 'granted',
        consistencyScore: completed.consistency?.score,
        consistencyLevel: completed.consistency?.level,
        hash: finalHash,
    }, existing.targetJid);
    await auditEvent(context, 'checkin_completed', existing.targetJid ? 'contact' : 'system', {
        token: existing.token,
        label: existing.label,
        ip,
        locationPermission: completed.location?.permission,
        hasGpsLocation: completed.location?.permission === 'granted',
        ipEnrichmentStatus: ipEnrichment?.status || 'unavailable',
        consistencyScore: completed.consistency?.score,
        consistencyLevel: completed.consistency?.level,
        evidenceHash: finalHash,
    }, existing.targetJid);
    await emitCheckInsChanged('completed', existing.token, existing.caseId);

    res.json({
        ok: true,
        receipt: {
            token: existing.token,
            caseId: existing.caseId,
            receivedAt: completedAt.toISOString(),
            ip,
            hasLocation: completed.location?.permission === 'granted',
            hash: finalHash,
        },
    });
});

async function rotateWhatsAppAuthState(reason: string) {
    if (isRotatingWhatsAppAuth) return;
    isRotatingWhatsAppAuth = true;
    const backupDir = `${WHATSAPP_AUTH_DIR}.logged-out-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    try {
        console.log(`[WHATSAPP] Auth session invalid (${reason}). Rotating ${WHATSAPP_AUTH_DIR} -> ${backupDir}`);
        await rm(backupDir, { recursive: true, force: true });
        await rename(WHATSAPP_AUTH_DIR, backupDir);
        console.log(`[WHATSAPP] Old auth session backed up at ${backupDir}. A new QR will be generated.`);
    } catch (err: any) {
        if (err?.code === 'ENOENT') {
            console.log(`[WHATSAPP] Auth directory not found. A new QR will be generated.`);
        } else {
            console.log(`[WHATSAPP] Warning: could not backup auth directory (${err?.message || err}). Removing stale auth data.`);
            await rm(WHATSAPP_AUTH_DIR, { recursive: true, force: true });
        }
    } finally {
        isRotatingWhatsAppAuth = false;
    }
}

async function connectToWhatsApp() {
    if (isWhatsAppConnecting) return;
    isWhatsAppConnecting = true;

    let state: any;
    let saveCreds: any;
    try {
        const authState = await useMultiFileAuthState(WHATSAPP_AUTH_DIR);
        state = authState.state;
        saveCreds = authState.saveCreds;
    } catch (err: any) {
        isWhatsAppConnecting = false;
        console.error(`[WHATSAPP] Could not load auth state (${err?.message || err}). Retrying in 3s.`);
        setTimeout(() => connectToWhatsApp(), 3000);
        return;
    }

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        markOnlineOnConnect: true,
        printQRInTerminal: false,
    });
    installRawCallNodeMonitor(sock);

    sock.ev.on('connection.update', async (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('QR Code generated');
            currentWhatsAppQr = qr; // Store the QR code
            io.emit('qr', qr);
        }

        if (connection === 'close') {
            isWhatsAppConnected = false;
            currentWhatsAppQr = null; // Clear QR on close
            stopAllTrackers('whatsapp connection closed');
            const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`connection closed (status: ${statusCode}), reconnecting: ${shouldReconnect}`);
            if (shouldReconnect) {
                // Delay before reconnecting to avoid rapid loop
                isWhatsAppConnecting = false;
                setTimeout(() => connectToWhatsApp(), 3000);
            } else {
                isWhatsAppConnecting = false;
                await rotateWhatsAppAuthState(`status ${statusCode}`);
                setTimeout(() => connectToWhatsApp(), 1000);
            }
        } else if (connection === 'open') {
            isWhatsAppConnected = true;
            currentWhatsAppQr = null; // Clear QR on successful connection
            isWhatsAppConnecting = false;
            console.log('opened connection');
            io.emit('connection-open');

            // Let Baileys finish session sync before probes resume.
            scheduleAutoRestoreContacts();
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messaging-history.set', ({ chats, contacts, messages, isLatest }: any) => {
        console.log(`[SESSION] History sync - Chats: ${chats.length}, Contacts: ${contacts.length}, Messages: ${messages.length}, Latest: ${isLatest}`);
    });

    // ── Listen to contacts.update for real push names and status changes ──
    sock.ev.on('contacts.update', async (updates: any[]) => {
        for (const update of updates) {
            const jid = update.id;
            if (!jid) continue;

            // Only process contacts we are tracking
            if (!trackers.has(jid)) continue;

            const changes: any = {};

            // Push name (the name the contact set in their WhatsApp profile)
            if (update.notify) {
                changes.pushName = update.notify;
                console.log(`[CONTACTS] Push name for ${jid}: "${update.notify}"`);
            }

            // Status/about text
            if (update.status !== undefined) {
                changes.about = update.status || null;
                console.log(`[CONTACTS] About for ${jid}: "${update.status}"`);
            }

            // Profile picture update
            if (update.imgUrl !== undefined) {
                // imgUrl can be 'changed' or 'removed' - fetch fresh pic
                try {
                    const freshPic = await sock.profilePictureUrl(jid, 'image');
                    changes.profilePic = freshPic || null;
                    io.emit('profile-pic', { jid, url: freshPic || null });
                } catch (_e) {
                    changes.profilePic = null;
                }
            }

            if (Object.keys(changes).length > 0) {
                await updateContactProfile(jid, changes);
                // Emit the updated fields to all clients
                io.emit('contact-profile-update', { jid, ...changes });
            }
        }
    });

    // ── Listen to contacts.upsert for initial contact data ──
    sock.ev.on('contacts.upsert', async (newContacts: any[]) => {
        for (const contact of newContacts) {
            const jid = contact.id;
            if (!jid || !trackers.has(jid)) continue;

            const changes: any = {};
            if (contact.notify) changes.pushName = contact.notify;
            if (contact.status) changes.about = contact.status;

            if (Object.keys(changes).length > 0) {
                await updateContactProfile(jid, changes);
                io.emit('contact-profile-update', { jid, ...changes });
                console.log(`[CONTACTS UPSERT] Updated ${jid}:`, changes);
            }
        }
    });

    sock.ev.on('messages.update', (updates: any) => {
        for (const update of updates) {
            const remoteJid = normalizeLiveJid(update?.key?.remoteJid);
            if (!remoteJid || !trackers.has(remoteJid)) continue;
            console.log(`[MSG UPDATE] JID: ${remoteJid}, ID: ${update.key.id}, Status: ${update.update.status}, FromMe: ${update.key.fromMe}`);
        }
    });

    sock.ev.on('messages.upsert', ({ messages, type }: any) => {
        for (const message of messages || []) {
            const remoteJid = normalizeLiveJid(message?.key?.remoteJid);
            if (!remoteJid || !trackers.has(remoteJid)) continue;

            const direction = message?.key?.fromMe ? 'outgoing' : 'incoming';
            const messageType = getMessageType(message);
            if (messageType === 'protocolMessage' || messageType === 'senderKeyDistributionMessage') {
                continue;
            }
            const timestamp = Number(message?.messageTimestamp || 0);
            const signalTimestamp = timestamp > 0 ? timestamp * 1000 : Date.now();
            const payload = {
                jid: remoteJid,
                messageId: message?.key?.id || null,
                direction,
                messageType,
                upsertType: type || null,
                timestamp: new Date(signalTimestamp).toISOString(),
            };

            console.log(`[MSG UPSERT] ${remoteJid} ${direction} ${messageType} (${type || 'unknown'})`);
            updateLiveSignal(remoteJid, {
                source: 'message',
                value: direction,
                label: formatMessageLabel(direction, messageType),
                confidence: 'high',
                timestamp: signalTimestamp,
                details: payload,
            });
            io.emit('message-activity', payload);
        }
    });

    // ── Listen to call events for Call IP Analyzer ──
    sock.ev.on('call', async (calls: any[]) => {
        for (const call of calls) {
            publishCallLiveState(call, 'baileys');

            // Auto-start only when a default case context is configured.
            if (LOCAL_CAPTURE_ENABLED && (call.status === 'offer' || call.status === 'accept')) {
                const defaultContext = getDefaultCaptureAuditContext();
                if (!defaultContext) {
                    console.log('[CALL] Auto-capture skipped: DEFAULT_CASE_ID, DEFAULT_OPERATOR_NAME, and DEFAULT_AUTHORIZATION_NOTE are required');
                    continue;
                }
                const iface = autoDetectInterface();
                if (iface) {
                    const started = startCallCapture(
                        iface,
                        call.from,
                        call.id,
                        call.isVideo || false,
                        (packet) => {
                            io.emit('call-packet', packet);
                        }
                    );
                    if (started) {
                        activeCallAuditContext = { ...defaultContext, targetJid: call.from, callId: call.id };
                        await auditEvent(defaultContext, 'call_capture_start', 'call', {
                            callId: call.id,
                            interfaceAddr: iface,
                            isVideo: call.isVideo || false,
                            trigger: 'auto',
                        }, call.from);
                        console.log(`[CALL] Auto-capture started for call ${call.id}`);
                        io.emit('call-capture-started', { callId: call.id, targetJid: call.from });
                    }
                } else {
                    console.warn('[CALL] No network interface found for auto-capture');
                }
            }

            // Auto-stop capture when call terminates
            if (LOCAL_CAPTURE_ENABLED && (call.status === 'terminate' || call.status === 'reject' || call.status === 'timeout')) {
                if (!activeCallAuditContext || activeCallAuditContext.callId !== call.id) {
                    continue;
                }
                const stoppedCallAuditContext = activeCallAuditContext;
                activeCallAuditContext = null;
                const rawResult = stopCallCapture();
                const result = rawResult ? await enrichCallAnalysis(rawResult) : null;
                if (result) {
                    console.log(`[CALL] Analysis complete: ${result.verdict} | ${result.candidateIps.filter(c => c.isP2P).length} direct-path candidates`);
                    io.emit('call-analysis', result);
                    // Persist to MongoDB
                    await saveCallAnalysis(result);
                    if (stoppedCallAuditContext) {
                        await auditEvent(stoppedCallAuditContext, 'call_capture_stop', 'call', {
                            callId: result.callId,
                            startedCallId: stoppedCallAuditContext.callId,
                            verdict: result.verdict,
                            totalPackets: result.totalPackets,
                            durationSec: result.durationSec,
                            candidateCount: result.candidateIps.filter(c => c.isP2P).length,
                            metaIpCount: result.metaIps.length,
                            trigger: 'auto',
                        }, result.targetJid);
                    }
                }
            }
        }
    });
}

// Initialize DB, Analytics, and WhatsApp
(async () => {
    dbAvailableForStartupAudit = await connectDB();
    await initAnalytics();
    connectToWhatsApp();
    await tryRecordStartupAudit();
})();

/**
 * Wire up standard callbacks for a tracker instance.
 * Centralizes onUpdate, onPresenceChange, onNewDevice logic.
 */
function wireTrackerCallbacks(tracker: WhatsAppTracker, jid: string) {
    tracker.onUpdate = (updateData) => {
        io.emit('tracker-update', { jid, ...updateData });
        const devices = Array.isArray(updateData.devices) ? updateData.devices : [];
        const primary = devices.find((d: any) => d.state?.includes?.('Online')) || devices[0];
        const probeState = primary?.state;
        if (probeState) {
            updateLiveSignal(jid, {
                source: 'rtt_probe',
                value: String(probeState),
                label: probeState === 'OFFLINE' ? 'Sin ACK' : String(probeState),
                confidence: probeState === 'OFFLINE' ? 'low' : 'medium',
                details: {
                    rtt: primary?.rtt,
                    avg: primary?.avg,
                    median: updateData.median,
                    threshold: updateData.threshold,
                    deviceCount: updateData.deviceCount,
                },
            });
        }

        if (updateData.median !== undefined && updateData.devices) {
            saveMeasurement({
                jid,
                rtt: updateData.devices[0]?.rtt ?? 0,
                avg: updateData.devices[0]?.avg ?? 0,
                median: updateData.median,
                threshold: updateData.threshold ?? 0,
                state: updateData.devices.find((d: any) => d.state.includes('Online'))?.state || updateData.devices[0]?.state || 'Unknown',
                devices: updateData.devices,
                deviceCount: updateData.deviceCount ?? 0
            });
        }
    };

    tracker.onPresenceChange = (data) => {
        console.log(`[PRESENCE] ${jid}: ${data.presence}`);
        updateLiveSignal(jid, {
            source: 'presence',
            value: data.presence,
            label: formatPresenceLabel(data.presence),
            confidence: ['composing', 'recording', 'available'].includes(data.presence) ? 'high' : 'medium',
            timestamp: data.timestamp,
        });
        io.emit('presence-change', data);
    };

    tracker.onNewDevice = (data) => {
        console.log(`[NEW DEVICE] ${jid}: new device ${data.deviceJid} (total: ${data.totalDevices})`);
        io.emit('device-alert', data);
    };
}

function stopAllTrackers(reason: string) {
    if (autoRestoreTimer) {
        clearTimeout(autoRestoreTimer);
        autoRestoreTimer = null;
    }

    if (trackers.size === 0) return;

    console.log(`[TRACKERS] Stopping ${trackers.size} active tracker(s): ${reason}`);
    for (const { tracker } of trackers.values()) {
        try {
            tracker.stopTracking();
        } catch (err: any) {
            console.log(`[TRACKERS] Warning: failed to stop tracker (${err?.message || err})`);
        }
    }
    trackers.clear();
}

function scheduleAutoRestoreContacts(delayMs = 8000) {
    if (autoRestoreTimer) clearTimeout(autoRestoreTimer);
    autoRestoreTimer = setTimeout(() => {
        autoRestoreTimer = null;
        if (!isWhatsAppConnected || !sock) return;
        autoRestoreContacts();
    }, delayMs);
}

/**
 * Auto-restore: resume tracking for all active contacts saved in MongoDB.
 * Called when WhatsApp connection is established (or re-established).
 */
async function autoRestoreContacts() {
    try {
        const saved = await getActiveContacts();
        if (saved.length === 0) {
            console.log('[AUTO-RESTORE] No saved contacts to restore');
            return;
        }

        console.log(`[AUTO-RESTORE] Restoring ${saved.length} contact(s)...`);
        let restored = 0;

        for (const contact of saved) {
            if (trackers.has(contact.jid)) {
                console.log(`[AUTO-RESTORE] ${contact.jid} already tracked, skipping`);
                continue;
            }

            try {
                const tracker = new WhatsAppTracker(sock, contact.jid);
                tracker.setProbeMethod(globalProbeMethod);
                trackers.set(contact.jid, { tracker });

                wireTrackerCallbacks(tracker, contact.jid);

                tracker.startTracking();
                restored++;

                // Emit contact info to connected clients
                const displayName = contact.customName || contact.pushName || contact.contactName || contact.number;
                io.emit('contact-added', { jid: contact.jid, number: contact.number, customName: contact.customName || null, pushName: contact.pushName || null });
                if (contact.profilePic) io.emit('profile-pic', { jid: contact.jid, url: contact.profilePic });
                io.emit('contact-name', { jid: contact.jid, name: displayName });

                console.log(`[AUTO-RESTORE] ✓ ${contact.number} (${displayName})`);
            } catch (err) {
                console.error(`[AUTO-RESTORE] ✗ Failed to restore ${contact.jid}:`, err);
            }
        }

        console.log(`[AUTO-RESTORE] Done: ${restored}/${saved.length} contacts restored`);
    } catch (err) {
        console.error('[AUTO-RESTORE] Error:', err);
    }
}

// REST endpoint: get measurement history for a contact
app.get('/api/history/:jid', async (req, res) => {
    const jid = req.params.jid;
    const limit = parseLimit(req.query.limit, 200, 1000);
    const history = await getRecentMeasurements(jid, limit);
    res.json(history);
});

// REST endpoint: get all saved contacts
app.get('/api/contacts', async (_req, res) => {
    const savedContacts = await getSavedContacts();
    res.json(savedContacts);
});

// REST endpoint: get activity history (state transitions)
app.get('/api/activity/:jid', async (req, res) => {
    const jid = req.params.jid;
    const limit = parseLimit(req.query.limit, 50, 1000);
    const history = await getActivityHistory(jid, limit);
    res.json(history);
});

app.get('/api/contact/:jid/live-state', (req, res) => {
    const jidResult = validateJid(req.params.jid);
    if (!jidResult.ok) {
        validationError(res, jidResult.errors || ['Invalid JID']);
        return;
    }
    res.json(buildContactLiveState(jidResult.value!));
});

app.get('/api/contact/:jid/signals', (req, res) => {
    const jidResult = validateJid(req.params.jid);
    if (!jidResult.ok) {
        validationError(res, jidResult.errors || ['Invalid JID']);
        return;
    }
    const limit = parseLimit(req.query.limit, 50, 200);
    res.json((liveSignalHistory.get(jidResult.value!) || []).slice(0, limit));
});

// REST endpoint: get state distribution stats
app.get('/api/stats/:jid', async (req, res) => {
    const jid = req.params.jid;
    const stats = await getStateDistribution(jid);
    res.json(stats);
});

// REST endpoint: get full contact profile from DB + WhatsApp
app.get('/api/profile/:jid', async (req, res) => {
    const jid = req.params.jid;
    try {
        // Get stored profile from MongoDB
        const stored = await getContactProfile(jid);

        // Try to fetch fresh data from WhatsApp if connected
        let freshAbout: string | null = null;
        let freshAboutSetAt: Date | null = null;
        let freshBusiness: any = null;
        let freshPic: string | null = null;

        if (isWhatsAppConnected && sock) {
            // Fetch "about" / status text
            try {
                const status = await sock.fetchStatus(jid);
                if (status) {
                    freshAbout = status.status || null;
                    freshAboutSetAt = status.setAt ? new Date(status.setAt * 1000) : null;
                }
            } catch (e: any) {
                console.log(`[PROFILE] Could not fetch status for ${jid}:`, e.message);
            }

            // Fetch business profile
            try {
                const bp = await sock.getBusinessProfile(jid);
                if (bp) {
                    freshBusiness = {
                        description: bp.description || undefined,
                        category: bp.category || undefined,
                        website: (bp as any).website?.[0] || undefined,
                        email: (bp as any).email || undefined,
                        address: (bp as any).address || undefined,
                    };
                }
            } catch (e: any) {
                // Not a business account — that's fine
            }

            // Fetch profile pic (retry)
            try {
                freshPic = await sock.profilePictureUrl(jid, 'image') || null;
            } catch (e: any) {
                freshPic = null;
            }

            // Update DB with fresh data
            await updateContactProfile(jid, {
                about: freshAbout,
                aboutSetAt: freshAboutSetAt,
                isBusinessAccount: !!freshBusiness,
                businessProfile: freshBusiness,
                profilePic: freshPic,
            });
        }

        // Merge stored + fresh
        const profile = {
            jid,
            number: stored?.number || jid.replace('@s.whatsapp.net', ''),
            contactName: stored?.contactName || null,
            customName: stored?.customName || null,
            profilePic: freshPic || stored?.profilePic || null,
            about: freshAbout || stored?.about || null,
            aboutSetAt: freshAboutSetAt || stored?.aboutSetAt || null,
            isBusinessAccount: freshBusiness ? true : (stored?.isBusinessAccount || false),
            businessProfile: freshBusiness || stored?.businessProfile || null,
            pushName: stored?.pushName || null,
            addedAt: stored?.addedAt || null,
            lastSeen: stored?.lastSeen || null,
            lastProfileUpdate: new Date(),
            verifiedOnWhatsApp: stored?.verifiedOnWhatsApp ?? true,
        };

        res.json(profile);
    } catch (err) {
        console.error('[PROFILE] Error:', err);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

app.get('/api/contact/:jid/profile-picture', async (req, res) => {
    const jidResult = validateJid(req.params.jid);
    if (!jidResult.ok) {
        res.status(400).json({ error: jidResult.errors?.join(', ') || 'Invalid JID' });
        return;
    }

    const jid = jidResult.value!;
    const stored = await getContactProfile(jid);
    let profilePicUrl = stored?.profilePic || null;

    if (isWhatsAppConnected && sock) {
        try {
            const freshPic = await sock.profilePictureUrl(jid, 'image') || null;
            if (freshPic && freshPic !== profilePicUrl) {
                profilePicUrl = freshPic;
                await updateContactProfile(jid, { profilePic: freshPic });
            }
        } catch {
            // Keep stored URL as fallback. Some accounts do not expose a public profile picture.
        }
    }

    if (!profilePicUrl) {
        res.status(404).json({ error: 'Profile picture unavailable' });
        return;
    }

    try {
        const upstream = await fetch(profilePicUrl);
        if (!upstream.ok || !upstream.body) {
            res.status(502).json({ error: 'Failed to fetch profile picture' });
            return;
        }

        const contentType = upstream.headers.get('content-type') || 'image/jpeg';
        const body = Buffer.from(await upstream.arrayBuffer());
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.send(body);
    } catch {
        res.status(502).json({ error: 'Failed to fetch profile picture' });
    }
});

// REST endpoint: get online activity patterns
app.get('/api/patterns/:jid', async (req, res) => {
    const jid = req.params.jid;
    const patterns = await getOnlinePatterns(jid);
    res.json(patterns);
});

// REST endpoint: get all saved contacts (history — includes inactive)
app.get('/api/contacts/history', async (_req, res) => {
    const allContacts = await getSavedContacts();
    // Sort: active first, then by lastSeen descending
    allContacts.sort((a, b) => {
        const aActive = a.isActive !== false;
        const bActive = b.isActive !== false;
        if (aActive !== bActive) return aActive ? -1 : 1;
        return (b.lastSeen?.getTime() || 0) - (a.lastSeen?.getTime() || 0);
    });
    res.json(allContacts);
});

// REST endpoint: generate comprehensive report for a contact
app.get('/api/report/:jid', async (req, res) => {
    const jid = req.params.jid;
    try {
        const report = await generateReport(jid);
        res.json(report);
    } catch (err) {
        console.error('[REPORT] Error generating report:', err);
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

// REST endpoint: download report as formatted JSON file
app.get('/api/report/:jid/download', async (req, res) => {
    const jid = req.params.jid;
    try {
        const report = await generateReport(jid);
        const number = jid.replace('@s.whatsapp.net', '');
        const filename = `report-${number}-${new Date().toISOString().slice(0, 10)}.json`;

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(JSON.stringify(report, null, 2));
    } catch (err) {
        console.error('[REPORT] Error:', err);
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

// ── Behavior Intelligence REST endpoints ─────────────────────

app.get('/api/intel/:jid', async (req, res) => {
    try {
        const days = parseLimit(req.query.days, 14, 365);
        const intel = await getFullIntelligence(req.params.jid, days);
        res.json(intel);
    } catch (err) {
        console.error('[API] Intel error:', err);
        res.status(500).json({ error: 'Failed to generate intelligence report' });
    }
});

app.get('/api/intel/:jid/routine', async (req, res) => {
    const days = parseLimit(req.query.days, 14, 365);
    res.json(await getDailyRoutine(req.params.jid, days));
});

app.get('/api/intel/:jid/availability', async (req, res) => {
    const days = parseLimit(req.query.days, 14, 365);
    res.json(await getAvailabilityProfile(req.params.jid, days));
});

app.get('/api/intel/:jid/sessions', async (req, res) => {
    const days = parseLimit(req.query.days, 14, 365);
    res.json(await getSessionStats(req.params.jid, days));
});

app.get('/api/intel/:jid/heatmap', async (req, res) => {
    const weeks = parseLimit(req.query.weeks, 4, 52);
    res.json(await getWeeklyHeatmap(req.params.jid, weeks));
});

app.get('/api/intel/:jid/habits', async (req, res) => {
    const days = parseLimit(req.query.days, 14, 365);
    res.json(await getHabitProfile(req.params.jid, days));
});

app.get('/api/intel/correlation', async (req, res) => {
    const { jid1, jid2, days } = req.query;
    if (!jid1 || !jid2) return res.status(400).json({ error: 'jid1 and jid2 required' });
    const d = parseLimit(days, 7, 365);
    res.json(await getCorrelation(jid1 as string, jid2 as string, d));
});

// ── Privacy / OPSEC Score ─────────────────────────────────────

app.get('/api/privacy-score/:jid', async (req, res) => {
    const jid = req.params.jid;
    try {
        const [profile, observedActivity] = await Promise.all([
            getContactProfile(jid),
            getObservedActivitySummary(jid, 30),
        ]);
        let score = 100; // Perfect privacy = 100
        const deductions: { reason: string; points: number }[] = [];

        // Profile picture exposed
        let hasPic = !!profile?.profilePic;
        if (!hasPic && isWhatsAppConnected && sock) {
            try { hasPic = !!(await sock.profilePictureUrl(jid, 'image')); } catch {}
        }
        if (hasPic) { score -= 20; deductions.push({ reason: 'Foto de perfil visible', points: 20 }); }

        // About/status exposed
        let hasAbout = !!profile?.about;
        if (!hasAbout && isWhatsAppConnected && sock) {
            try {
                const st = await sock.fetchStatus(jid);
                hasAbout = !!(st?.status);
            } catch {}
        }
        if (hasAbout) { score -= 15; deductions.push({ reason: 'Estado/About visible', points: 15 }); }

        // Business account (exposes lots of data)
        if (profile?.isBusinessAccount) {
            score -= 25;
            deductions.push({ reason: 'Cuenta de negocio (datos expuestos)', points: 25 });
        }

        // Push name set (reveals real name)
        if (profile?.pushName) { score -= 10; deductions.push({ reason: 'Nombre de perfil (Push Name) visible', points: 10 }); }

        // Online activity trackable (we can always detect this — universal deduction)
        score -= 15;
        deductions.push({ reason: 'Actividad online rastreable via RTT', points: 15 });

        // Presence/call/message observability is deducted only when actually observed.
        const typingSignals = observedActivity.byType
            .filter(event => event.source === 'presence' && ['composing', 'recording'].includes(event.type))
            .reduce((sum, event) => sum + event.count, 0);
        const callSignals = observedActivity.bySource.call || 0;
        const messageSignals = observedActivity.bySource.message || 0;
        if (typingSignals > 0) {
            score -= 10;
            deductions.push({ reason: `Indicadores escribiendo/grabando detectables (${typingSignals})`, points: 10 });
        }
        if (callSignals > 0) {
            score -= 10;
            deductions.push({ reason: `Eventos de llamada observables (${callSignals})`, points: 10 });
        }
        if (messageSignals > 0) {
            score -= 5;
            deductions.push({ reason: `Actividad de mensajes observable (${messageSignals})`, points: 5 });
        }

        // Multiple devices detectable
        const entry = trackers.get(jid);
        if (entry) {
            const deviceMetricSize = (entry.tracker as any).knownDeviceJids?.size ?? 0;
            if (deviceMetricSize > 1) {
                score -= 5;
                deductions.push({ reason: `${deviceMetricSize} dispositivos detectados`, points: 5 });
            }
        }

        score = Math.max(0, score);
        const level = score >= 70 ? 'Alto' : score >= 40 ? 'Medio' : 'Bajo';

        res.json({ score, level, deductions });
    } catch (err) {
        console.error('[PRIVACY] Error:', err);
        res.status(500).json({ error: 'Failed to calculate privacy score' });
    }
});

// ── Anomaly Detection ─────────────────────────────────────────

app.get('/api/anomalies/:jid', async (req, res) => {
    const jid = req.params.jid;
    try {
        const days = parseLimit(req.query.days, 14, 365);
        const [habits, sessions, availability] = await Promise.all([
            getHabitProfile(jid, days),
            getSessionStats(jid, days),
            getAvailabilityProfile(jid, days),
        ]);

        const anomalies: { type: string; severity: 'info' | 'warning' | 'critical'; description: string; timestamp: number }[] = [];
        const now = new Date();
        const currentHour = now.getHours();

        // 1. Active during normally inactive hours
        if (availability.inactiveHours.includes(currentHour)) {
            const prob = availability.hourly[currentHour] ?? 0;
            // Check if the tracker shows Online right now
            const entry = trackers.get(jid);
            if (entry) {
                const lastPresence = (entry.tracker as any).lastPresence;
                if (lastPresence === 'available' || lastPresence === 'composing' || lastPresence === 'recording') {
                    anomalies.push({
                        type: 'unusual-hours',
                        severity: 'warning',
                        description: `Activo a las ${currentHour}:00 (probabilidad habitual: ${(prob * 100).toFixed(0)}%)`,
                        timestamp: Date.now()
                    });
                }
            }
        }

        // 2. Session duration anomaly — check if current session is unusually long
        if (sessions.avgDurationSec > 0 && sessions.maxDurationSec > sessions.avgDurationSec * 3) {
            anomalies.push({
                type: 'long-session',
                severity: 'info',
                description: `Sesión máxima (${Math.round(sessions.maxDurationSec / 60)}min) es 3x el promedio (${Math.round(sessions.avgDurationSec / 60)}min)`,
                timestamp: Date.now()
            });
        }

        // 3. Night owl / schedule shift
        if (habits.nightOwlScore > 70) {
            anomalies.push({
                type: 'night-owl',
                severity: 'info',
                description: `Patrón nocturno elevado (score: ${habits.nightOwlScore})`,
                timestamp: Date.now()
            });
        }

        // 4. Low consistency (erratic behavior)
        if (habits.consistencyScore < 30) {
            anomalies.push({
                type: 'erratic-behavior',
                severity: 'warning',
                description: `Comportamiento errático (consistencia: ${habits.consistencyScore}%)`,
                timestamp: Date.now()
            });
        }

        // 5. Weekend vs weekday difference
        if (habits.weekdayVsWeekend) {
            const diff = Math.abs(habits.weekdayVsWeekend.weekdayAvgMin - habits.weekdayVsWeekend.weekendAvgMin);
            if (diff > 120) { // >2h difference
                anomalies.push({
                    type: 'schedule-shift',
                    severity: 'info',
                    description: `Gran diferencia L-V vs fin de semana: ${habits.weekdayVsWeekend.difference}`,
                    timestamp: Date.now()
                });
            }
        }

        res.json({ anomalies, totalAnalyzedDays: availability.daysAnalyzed });
    } catch (err) {
        console.error('[ANOMALY] Error:', err);
        res.status(500).json({ error: 'Failed to detect anomalies' });
    }
});

// ── Network Monitor REST endpoints ────────────────────────────

app.put('/api/contact/:jid/custom-name', async (req, res) => {
    try {
        const jidResult = validateJid(req.params.jid);
        if (!jidResult.ok) {
            validationError(res, jidResult.errors || []);
            return;
        }
        const { customName } = req.body || {};
        if (customName !== null && customName !== undefined && typeof customName !== 'string') {
            validationError(res, ['customName must be a string or null']);
            return;
        }
        const trimmed = cleanText(customName, 120) || null;
        console.log(`[CUSTOM NAME REST] ${jidResult.value!} → "${trimmed}"`);
        await updateCustomName(jidResult.value!, trimmed);
        io.emit('custom-name-updated', { jid: jidResult.value!, customName: trimmed });
        res.json({ ok: true, jid: jidResult.value!, customName: trimmed });
    } catch (err) {
        console.error('[API] Error setting custom name:', err);
        res.status(500).json({ error: 'Failed to set custom name' });
    }
});

registerRuntimeRoutes(app, RUNTIME_CONFIG, {
    mongoConfigured: () => isConfigured(process.env.MONGODB_URI),
    mongoConnected: () => isDBConnected(),
    whatsappConnected: () => isWhatsAppConnected,
});

registerCaseRoutes(app);

app.get('/api/network/interfaces', (_req, res) => {
    if (rejectCaptureUnavailable(res)) return;
    res.json(listInterfaces());
});

app.get('/api/network/status', (_req, res) => {
    if (rejectCaptureUnavailable(res)) return;
    res.json(getCaptureStatus());
});

app.get('/api/network/packets', (req, res) => {
    if (rejectCaptureUnavailable(res)) return;
    const limit = parseLimit(req.query.limit, 100, 5000);
    res.json(getRecentPackets(limit));
});

app.get('/api/network/export/json', (req, res) => {
    if (rejectCaptureUnavailable(res)) return;
    const limit = req.query.limit ? parseLimit(req.query.limit, 1000, 50000) : undefined;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=packets-${Date.now()}.json`);
    res.send(exportJSON(limit));
});

app.get('/api/network/export/csv', (req, res) => {
    if (rejectCaptureUnavailable(res)) return;
    const limit = req.query.limit ? parseLimit(req.query.limit, 1000, 50000) : undefined;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=packets-${Date.now()}.csv`);
    res.send(exportCSV(limit));
});

// ── Call IP Analyzer REST endpoints ───────────────────────────

app.get('/api/call-analysis/:jid', async (req, res) => {
    const jid = req.params.jid;
    try {
        // Try in-memory first, fallback to MongoDB
        const latest = getLatestCallAnalysis(jid);
        if (latest) {
            res.json(await enrichCallAnalysis(latest));
        } else {
            const fromDB = await getCallAnalyses(jid, 1);
            res.json(fromDB[0] ? await enrichCallAnalysis(fromDB[0]) : null);
        }
    } catch (err) {
        console.error('[CALL-API] Error:', err);
        res.status(500).json({ error: 'Failed to get call analysis' });
    }
});

app.get('/api/call-history/:jid', async (req, res) => {
    const jid = req.params.jid;
    const limit = parseLimit(req.query.limit, 20, 100);
    try {
        // Merge in-memory and MongoDB results
        const inMemory = getCallAnalysisHistory(jid);
        const fromDB = await getCallAnalyses(jid, limit);

        // Deduplicate by callId
        const seen = new Set<string>();
        const merged = [];
        for (const r of [...inMemory, ...fromDB]) {
            if (!seen.has(r.callId)) {
                seen.add(r.callId);
                merged.push(await enrichCallAnalysis(r));
            }
        }
        // Sort by startTime descending
        merged.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
        res.json(merged.slice(0, limit));
    } catch (err) {
        console.error('[CALL-API] Error:', err);
        res.status(500).json({ error: 'Failed to get call history' });
    }
});

registerAuditRoutes(app, {
    getCaseExportContext,
    auditEvent,
});

registerReportRoutes(app, {
    getCaseExportContext,
    auditEvent,
});

app.get('/api/call-capture/status', (_req, res) => {
    if (rejectCaptureUnavailable(res)) return;
    res.json(getCallCaptureStatus());
});

app.post('/api/call-capture/start', async (req, res) => {
    if (rejectCaptureUnavailable(res)) return;
    const auditContext = parseCaptureAuditContext(req.body);
    if (!auditContext) {
        res.status(400).json({ error: 'caseId, operatorName, and authorizationNote are required' });
        return;
    }
    if (!await ensureCaseCanCapture(auditContext, res)) return;
    const { interfaceAddr, targetJid, callId, isVideo } = req.body || {};
    const targetResult = normalizeOptionalJid(targetJid, 'manual');
    if (!targetResult.ok) {
        validationError(res, targetResult.errors || []);
        return;
    }
    const iface = cleanText(interfaceAddr, 200) || autoDetectInterface();
    if (!iface) {
        res.status(400).json({ error: 'No network interface available' });
        return;
    }
    const cid = cleanText(callId, 120) || `manual-${Date.now()}`;
    const target = targetResult.value!;
    const ok = startCallCapture(iface, target, cid, isVideo || false, (packet) => {
        io.emit('call-packet', packet);
    });
    if (ok) {
        activeCallAuditContext = { ...auditContext, targetJid: target, callId: cid };
        await linkEvidenceToCase(auditContext, 'call_analysis', cid, `Call capture ${cid}`, {
            interfaceAddr: iface,
            isVideo: isVideo || false,
            trigger: 'manual_rest',
            status: 'started',
        }, target);
        await auditEvent(auditContext, 'call_capture_start', 'call', {
            callId: cid,
            interfaceAddr: iface,
            isVideo: isVideo || false,
            trigger: 'manual_rest',
        }, target);
        io.emit('call-capture-started', { callId: cid, targetJid: target });
        res.json({ ok: true, callId: cid });
    } else {
        res.status(500).json({ error: 'Failed to start capture. Already capturing or run as administrator.' });
    }
});

app.post('/api/call-capture/stop', async (_req, res) => {
    if (rejectCaptureUnavailable(res)) return;
    const stoppedCallAuditContext = activeCallAuditContext;
    activeCallAuditContext = null;
    const rawResult = stopCallCapture();
    const result = rawResult ? await enrichCallAnalysis(rawResult) : null;
    if (result) {
        io.emit('call-analysis', result);
        await saveCallAnalysis(result);
        if (stoppedCallAuditContext) {
            await linkEvidenceToCase(stoppedCallAuditContext, 'call_analysis', result.callId, `Call analysis ${result.callId}`, {
                verdict: result.verdict,
                totalPackets: result.totalPackets,
                durationSec: result.durationSec,
                candidateCount: result.candidateIps.filter(c => c.isP2P).length,
                metaIpCount: result.metaIps.length,
                status: 'completed',
            }, result.targetJid);
            await auditEvent(stoppedCallAuditContext, 'call_capture_stop', 'call', {
                callId: result.callId,
                startedCallId: stoppedCallAuditContext.callId,
                verdict: result.verdict,
                totalPackets: result.totalPackets,
                durationSec: result.durationSec,
                candidateCount: result.candidateIps.filter(c => c.isP2P).length,
                metaIpCount: result.metaIps.length,
                trigger: 'manual_rest',
            }, result.targetJid);
        }
        res.json(result);
    } else {
        res.json({ ok: false, message: 'No active capture' });
    }
});

io.on('connection', (socket) => {
    console.log('Client connected');

    // Send current WhatsApp QR code if available
    if (currentWhatsAppQr) {
        socket.emit('qr', currentWhatsAppQr);
    }

    if (isWhatsAppConnected) {
        socket.emit('connection-open');
    }

    // Send current probe method to client
    socket.emit('probe-method', globalProbeMethod);

    // Handle request to get tracked contacts (for page refresh)
    socket.on('get-tracked-contacts', () => {
        const trackedContacts = Array.from(trackers.keys());
        socket.emit('tracked-contacts', trackedContacts);
        trackedContacts.forEach(jid => socket.emit('contact-live-state', buildContactLiveState(jid)));
    });

    // Add contact - WhatsApp only
    socket.on('add-contact', async (data: string | { number: string; customName?: string; caseId?: string; operatorName?: string; authorizationNote?: string }) => {
        const number = typeof data === 'string' ? data : data.number;
        const customName = typeof data === 'object' ? cleanText(data.customName, 120) || null : null;
        const auditContext = typeof data === 'object' ? parseCaptureAuditContext(data) : null;
        if (!auditContext) {
            socketValidationError(socket, ['caseId, operatorName, and authorizationNote are required before tracking a contact']);
            return;
        }
        const caseCheck = await checkCaseCanCapture(auditContext);
        if (!caseCheck.ok) {
            socket.emit('error', { status: caseCheck.status, ...caseCheck.payload });
            return;
        }

        console.log(`Request to track: ${number}${customName ? ` (alias: ${customName})` : ''}`);
        const cleanNumber = number.replace(/\D/g, '');
        if (cleanNumber.length < 6 || cleanNumber.length > 20) {
            socketValidationError(socket, ['number must contain 6-20 digits']);
            return;
        }

        const targetJid = cleanNumber + '@s.whatsapp.net';

        if (trackers.has(targetJid)) {
            socket.emit('error', { jid: targetJid, message: 'Already tracking this contact' });
            return;
        }

        try {
            const results = await sock.onWhatsApp(targetJid);
            const result = results?.[0];

            if (result?.exists) {
                const tracker = new WhatsAppTracker(sock, result.jid);
                tracker.setProbeMethod(globalProbeMethod);
                trackers.set(result.jid, { tracker });

                wireTrackerCallbacks(tracker, result.jid);

                tracker.startTracking();

                const ppUrl = await tracker.getProfilePicture();

                let contactName = cleanNumber;
                let pushNameFromWA: string | null = null;
                try {
                    const contactInfo = await sock.onWhatsApp(result.jid);
                    if (contactInfo && contactInfo[0]?.notify) {
                        pushNameFromWA = contactInfo[0].notify;
                        contactName = contactInfo[0].notify;
                    }
                } catch (err) {
                    console.log('[NAME] Could not fetch contact name, using number');
                }

                // Display name priority: customName > pushName > number
                const displayName = customName || pushNameFromWA || cleanNumber;

                socket.emit('contact-added', {
                    jid: result.jid,
                    number: cleanNumber,
                    customName: customName,
                    pushName: pushNameFromWA,
                    caseId: auditContext.caseId,
                });

                io.emit('profile-pic', { jid: result.jid, url: ppUrl });
                io.emit('contact-name', { jid: result.jid, name: displayName });

                // Persist contact to MongoDB (with custom name)
                saveContact(result.jid, cleanNumber, contactName, ppUrl, customName);
                await linkEvidenceToCase(auditContext, 'contact', result.jid, `Contact ${displayName}`, {
                    number: cleanNumber,
                    displayName,
                    customName,
                    pushName: pushNameFromWA,
                    status: 'tracking_started',
                }, result.jid);
                await auditEvent(auditContext, 'contact_tracking_start', 'contact', {
                    number: cleanNumber,
                    displayName,
                    customName,
                    pushName: pushNameFromWA,
                }, result.jid);

                // Fetch and persist enriched profile (about, business, etc.)
                (async () => {
                    try {
                        let about: string | null = null;
                        let aboutSetAt: Date | null = null;
                        let businessProfile: any = null;
                        let pushName: string | null = null;

                        // Fetch about/status
                        try {
                            const status = await sock.fetchStatus(result.jid);
                            if (status) {
                                about = status.status || null;
                                aboutSetAt = status.setAt ? new Date(status.setAt * 1000) : null;
                            }
                        } catch (_e) { /* privacy settings may block */ }

                        // Fetch business profile
                        try {
                            const bp = await sock.getBusinessProfile(result.jid);
                            if (bp) {
                                businessProfile = {
                                    description: bp.description || undefined,
                                    category: bp.category || undefined,
                                    website: (bp as any).website?.[0] || undefined,
                                    email: (bp as any).email || undefined,
                                    address: (bp as any).address || undefined,
                                };
                            }
                        } catch (_e) { /* not a business account */ }

                        // Get push name from WhatsApp (use the one we already got, or try again)
                        pushName = pushNameFromWA;
                        if (!pushName) {
                            try {
                                const waInfo = await sock.onWhatsApp(result.jid);
                                pushName = waInfo?.[0]?.notify || null;
                            } catch (_e) {}
                        }

                        // Also try to get pushName from the store/cache
                        try {
                            const storeContacts = sock.store?.contacts || {};
                            if (storeContacts[result.jid]?.notify) {
                                pushName = storeContacts[result.jid].notify;
                            }
                        } catch (_e) {}

                        await updateContactProfile(result.jid, {
                            about,
                            aboutSetAt,
                            isBusinessAccount: !!businessProfile,
                            businessProfile,
                            pushName,
                            profilePic: ppUrl,
                        });

                        // Emit enriched profile to all clients
                        io.emit('contact-profile', {
                            jid: result.jid,
                            about,
                            aboutSetAt,
                            isBusinessAccount: !!businessProfile,
                            businessProfile,
                            pushName,
                            customName,
                        });

                        console.log(`[PROFILE] Enriched profile saved for ${result.jid}`);
                    } catch (err) {
                        console.log('[PROFILE] Could not enrich profile:', err);
                    }
                })();
            } else {
                socket.emit('error', { jid: targetJid, message: 'Number not on WhatsApp' });
            }
        } catch (err) {
            console.error(err);
            socket.emit('error', { jid: targetJid, message: 'Verification failed' });
        }
    });

    socket.on('remove-contact', (jid: string) => {
        const jidResult = validateJid(jid);
        if (!jidResult.ok) {
            socketValidationError(socket, jidResult.errors || []);
            return;
        }
        jid = jidResult.value!;
        console.log(`Request to stop tracking: ${jid}`);
        const entry = trackers.get(jid);
        if (entry) {
            entry.tracker.stopTracking();
            trackers.delete(jid);
            socket.emit('contact-removed', jid);
            removeContact(jid);
        }
    });

    // Set/update custom name (alias) for a contact
    socket.on('set-custom-name', async (data: { jid: string; customName: string | null }) => {
        const { jid, customName } = data;
        const jidResult = validateJid(jid);
        if (!jidResult.ok) {
            socketValidationError(socket, jidResult.errors || []);
            return;
        }
        const trimmed = cleanText(customName, 120) || null;
        console.log(`[CUSTOM NAME] ${jid} → "${trimmed}"`);
        await updateCustomName(jidResult.value!, trimmed);
        // Broadcast to all clients so the name updates everywhere
        io.emit('custom-name-updated', { jid: jidResult.value!, customName: trimmed });
    });

    // Re-activate a previously tracked contact from history
    socket.on('reactivate-contact', async (jid: string) => {
        const jidResult = validateJid(jid);
        if (!jidResult.ok) {
            socketValidationError(socket, jidResult.errors || []);
            return;
        }
        jid = jidResult.value!;
        console.log(`Request to reactivate: ${jid}`);

        if (trackers.has(jid)) {
            socket.emit('error', { jid, message: 'Already tracking this contact' });
            return;
        }

        if (!isWhatsAppConnected || !sock) {
            socket.emit('error', { jid, message: 'WhatsApp not connected' });
            return;
        }

        try {
            const tracker = new WhatsAppTracker(sock, jid);
            tracker.setProbeMethod(globalProbeMethod);
            trackers.set(jid, { tracker });

            wireTrackerCallbacks(tracker, jid);

            tracker.startTracking();

            // Mark as active again in DB
            await reactivateContact(jid);

            const number = jid.replace('@s.whatsapp.net', '');
            socket.emit('contact-added', { jid, number });

            // Fetch profile pic
            try {
                const ppUrl = await sock.profilePictureUrl(jid, 'image');
                io.emit('profile-pic', { jid, url: ppUrl || null });
            } catch (_e) {}

            console.log(`[REACTIVATE] ✓ ${jid}`);
        } catch (err) {
            console.error(`[REACTIVATE] Error:`, err);
            socket.emit('error', { jid, message: 'Failed to reactivate contact' });
        }
    });

    // ── Network Monitor Socket events ──────────────────────────

    socket.on('network-start', async (data: { interfaceAddr: string; filter?: CaptureFilter; caseId?: string; operatorName?: string; authorizationNote?: string }) => {
        if (!LOCAL_CAPTURE_ENABLED) {
            socket.emit('error', { message: 'Local packet capture is disabled in this deployment', mode: DEPLOYMENT_MODE });
            return;
        }
        const auditContext = parseCaptureAuditContext(data);
        if (!auditContext) {
            socketValidationError(socket, ['caseId, operatorName, and authorizationNote are required before capture']);
            return;
        }
        const caseCheck = await checkCaseCanCapture(auditContext);
        if (!caseCheck.ok) {
            socket.emit('error', { status: caseCheck.status, ...caseCheck.payload });
            return;
        }
        const captureSessionId = `network-${Date.now()}`;
        const interfaceAddr = cleanText(data.interfaceAddr, 200);
        if (!interfaceAddr) {
            socketValidationError(socket, ['interfaceAddr is required']);
            return;
        }
        console.log(`[NETWORK] Start capture on ${interfaceAddr}`);
        const ok = startCapture(interfaceAddr, data.filter || {}, (packet: PacketMeta) => {
            io.emit('network-packet', packet);
        });
        socket.emit('network-status', getCaptureStatus());
        if (ok) {
            activeNetworkAuditContext = { ...auditContext, captureSessionId };
            await linkEvidenceToCase(auditContext, 'network_capture', captureSessionId, `Network capture ${captureSessionId}`, {
                interfaceAddr,
                filter: data.filter || {},
                trigger: 'socket',
                status: 'started',
            });
            await auditEvent(auditContext, 'capture_start', 'network', {
                captureSessionId,
                interfaceAddr,
                filter: data.filter || {},
                trigger: 'socket',
            });
        }
        if (!ok) {
            socket.emit('error', { message: 'Failed to start capture. Run as administrator.' });
        }
    });

    socket.on('network-stop', async () => {
        if (!LOCAL_CAPTURE_ENABLED) {
            socket.emit('network-status', { isCapturing: false, stats: null });
            return;
        }
        stopCapture();
        const status = getCaptureStatus();
        socket.emit('network-status', status);
        if (activeNetworkAuditContext) {
            await linkEvidenceToCase(activeNetworkAuditContext, 'network_capture', activeNetworkAuditContext.captureSessionId, `Network capture ${activeNetworkAuditContext.captureSessionId}`, {
                stats: status.stats,
                trigger: 'socket',
                status: 'completed',
            });
            await auditEvent(activeNetworkAuditContext, 'capture_stop', 'network', {
                captureSessionId: activeNetworkAuditContext.captureSessionId,
                stats: status.stats,
                trigger: 'socket',
            });
            activeNetworkAuditContext = null;
        }
        console.log('[NETWORK] Capture stopped by client');
    });

    socket.on('network-filter', (filter: CaptureFilter) => {
        if (!LOCAL_CAPTURE_ENABLED) return;
        updateFilter(filter);
    });

    socket.on('network-get-status', () => {
        if (!LOCAL_CAPTURE_ENABLED) {
            socket.emit('network-status', { isCapturing: false, stats: null });
            return;
        }
        socket.emit('network-status', getCaptureStatus());
    });

    socket.on('set-probe-method', (method: ProbeMethod) => {
        console.log(`Request to change probe method to: ${method}`);
        if (method !== 'delete' && method !== 'reaction') {
            socket.emit('error', { message: 'Invalid probe method' });
            return;
        }

        globalProbeMethod = method;

        for (const entry of trackers.values()) {
            entry.tracker.setProbeMethod(method);
        }

        io.emit('probe-method', method);
        console.log(`Probe method changed to: ${method}`);
    });

    // ── Call IP Analyzer Socket events ──────────────────────────

    socket.on('start-call-capture', async (data: { interfaceAddr?: string; targetJid?: string; callId?: string; isVideo?: boolean; caseId?: string; operatorName?: string; authorizationNote?: string }) => {
        if (!LOCAL_CAPTURE_ENABLED) {
            socket.emit('error', { message: 'Local call traffic analysis is disabled in this deployment', mode: DEPLOYMENT_MODE });
            return;
        }
        const auditContext = parseCaptureAuditContext(data);
        if (!auditContext) {
            socketValidationError(socket, ['caseId, operatorName, and authorizationNote are required before call capture']);
            return;
        }
        const caseCheck = await checkCaseCanCapture(auditContext);
        if (!caseCheck.ok) {
            socket.emit('error', { status: caseCheck.status, ...caseCheck.payload });
            return;
        }
        const targetResult = normalizeOptionalJid(data.targetJid, 'manual');
        if (!targetResult.ok) {
            socketValidationError(socket, targetResult.errors || []);
            return;
        }
        const iface = cleanText(data.interfaceAddr, 200) || autoDetectInterface();
        if (!iface) {
            socket.emit('error', { message: 'No network interface available for capture' });
            return;
        }
        const cid = cleanText(data.callId, 120) || `manual-${Date.now()}`;
        const jid = targetResult.value!;
        const ok = startCallCapture(iface, jid, cid, data.isVideo || false, (packet) => {
            io.emit('call-packet', packet);
        });
        if (ok) {
            activeCallAuditContext = { ...auditContext, targetJid: jid, callId: cid };
            await linkEvidenceToCase(auditContext, 'call_analysis', cid, `Call capture ${cid}`, {
                interfaceAddr: iface,
                isVideo: data.isVideo || false,
                trigger: 'socket',
                status: 'started',
            }, jid);
            await auditEvent(auditContext, 'call_capture_start', 'call', {
                callId: cid,
                interfaceAddr: iface,
                isVideo: data.isVideo || false,
                trigger: 'socket',
            }, jid);
            io.emit('call-capture-started', { callId: cid, targetJid: jid });
            console.log(`[CALL] Manual capture started: ${cid} for ${jid}`);
        } else {
            socket.emit('error', { message: 'Failed to start call capture. Already capturing or run as administrator.' });
        }
    });

    socket.on('stop-call-capture', async () => {
        if (!LOCAL_CAPTURE_ENABLED) {
            socket.emit('error', { message: 'No local call capture is running in this deployment' });
            return;
        }
        const stoppedCallAuditContext = activeCallAuditContext;
        activeCallAuditContext = null;
        const rawResult = stopCallCapture();
        const result = rawResult ? await enrichCallAnalysis(rawResult) : null;
        if (result) {
            io.emit('call-analysis', result);
            await saveCallAnalysis(result);
            if (stoppedCallAuditContext) {
                await linkEvidenceToCase(stoppedCallAuditContext, 'call_analysis', result.callId, `Call analysis ${result.callId}`, {
                    verdict: result.verdict,
                    totalPackets: result.totalPackets,
                    durationSec: result.durationSec,
                    candidateCount: result.candidateIps.filter(c => c.isP2P).length,
                    metaIpCount: result.metaIps.length,
                    status: 'completed',
                }, result.targetJid);
                await auditEvent(stoppedCallAuditContext, 'call_capture_stop', 'call', {
                    callId: result.callId,
                    startedCallId: stoppedCallAuditContext.callId,
                    verdict: result.verdict,
                    totalPackets: result.totalPackets,
                    durationSec: result.durationSec,
                    candidateCount: result.candidateIps.filter(c => c.isP2P).length,
                    metaIpCount: result.metaIps.length,
                    trigger: 'socket',
                }, result.targetJid);
            }
            console.log(`[CALL] Manual capture stopped. Verdict: ${result.verdict}`);
        } else {
            socket.emit('error', { message: 'No active call capture to stop' });
        }
    });

    socket.on('get-call-capture-status', () => {
        if (!LOCAL_CAPTURE_ENABLED) {
            socket.emit('call-capture-status', {
                isCapturing: false,
                targetJid: null,
                callId: null,
                startTime: null,
                packetsCollected: 0,
                elapsed: 0,
            });
            return;
        }
        socket.emit('call-capture-status', getCallCaptureStatus());
    });
});

httpServer.listen(PORT, () => {
    serverListeningForStartupAudit = true;
    logStartupConfiguration();
    bootLog('ok', 'Backend operational');
    tryRecordStartupAudit();
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    for (const entry of trackers.values()) {
        entry.tracker.stopTracking();
    }
    await disconnectDB();
    process.exit(0);
});

import { createHash, randomBytes } from 'node:crypto';
import { WebRtcCheckpoints } from './webrtc-checkpoints.js';
import {
    normalizeBrowserWebRtcEvidence,
    type BrowserWebRtcEvidence,
} from './call-observation-evidence.js';

export interface CdpTarget {
    type?: unknown;
    url?: unknown;
    webSocketDebuggerUrl?: unknown;
}

interface CdpResponse {
    id?: number;
    method?: string;
    params?: Record<string, unknown>;
    result?: Record<string, unknown>;
    error?: { code?: number };
}

interface RawWebRtcSnapshot {
    connectionCount?: unknown;
    selectedPairs?: unknown;
    stateTransitions?: unknown;
    statsFailures?: unknown;
    truncated?: unknown;
}

const CDP_COMMAND_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 256 * 1_024;
const WEBRTC_PROBE_RUNTIME_VERSION = 3;
const WEBRTC_PROBE_IMPLEMENTATION = 'bounded-document-stats-v3';
const EXPIRED_EVIDENCE_TTL_MS = 60 * 60_000;
const EXPIRED_EVIDENCE_LIMIT = 32;

function buildProbeReadyExpression(): string {
    return `Boolean(
        globalThis.__wpMonitorWebRtcProbe?.version === ${WEBRTC_PROBE_RUNTIME_VERSION}
        && globalThis.__wpMonitorWebRtcProbe?.implementation === '${WEBRTC_PROBE_IMPLEMENTATION}'
    )`;
}

export interface WebRtcObservationAdapter {
    ready(): Promise<boolean>;
    start(callId: string, targetJid: string, ttlMs: number): Promise<void>;
    status(): {
        active: boolean; callId: string | null; targetJid: string | null; startedAt: Date | null;
        instrumentationActive?: boolean; cdpConnected?: boolean; probeInstalled?: boolean;
        probeArmed?: boolean; documentGeneration?: number;
    };
    stop(callId: string): Promise<BrowserWebRtcEvidence>;
    shutdown(): Promise<void>;
}

class CdpClient {
    private socket: WebSocket | null = null;
    private nextId = 1;
    private readonly pending = new Map<number, {
        resolve: (value: Record<string, unknown>) => void;
        reject: (error: Error) => void;
        timer: NodeJS.Timeout;
    }>();

    constructor(private readonly url: string, private readonly onEvent: (method: string, params: Record<string, unknown>) => void) {}

    targetHash(): string { return createHash('sha256').update(this.url).digest('hex').slice(0, 16); }

    isOpen(): boolean {
        return this.socket?.readyState === WebSocket.OPEN;
    }

    matches(url: string): boolean {
        return this.url === url;
    }

    async connect(): Promise<void> {
        const socket = new WebSocket(this.url);
        this.socket = socket;
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('cdp_connect_timeout')), CDP_COMMAND_TIMEOUT_MS);
            socket.addEventListener('open', () => {
                clearTimeout(timer);
                resolve();
            }, { once: true });
            socket.addEventListener('error', () => {
                clearTimeout(timer);
                reject(new Error('cdp_connect_failed'));
            }, { once: true });
        });
        socket.addEventListener('message', event => {
            const text = String(event.data);
            if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) return;
            let message: CdpResponse;
            try {
                message = JSON.parse(text) as CdpResponse;
            } catch {
                return;
            }
            if (!Number.isSafeInteger(message.id)) {
                if (typeof message.method === 'string') this.onEvent(message.method, message.params ?? {});
                return;
            }
            const pending = this.pending.get(message.id!);
            if (!pending) return;
            this.pending.delete(message.id!);
            clearTimeout(pending.timer);
            if (message.error) pending.reject(new Error(`cdp_command_failed:${message.error.code ?? 'unknown'}`));
            else pending.resolve(message.result ?? {});
        });
        socket.addEventListener('close', () => {
            this.rejectPending('cdp_closed');
            this.onEvent('connection.closed', {});
        });
    }

    send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return Promise.reject(new Error('cdp_not_connected'));
        }
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`cdp_timeout:${method}`));
            }, CDP_COMMAND_TIMEOUT_MS);
            this.pending.set(id, { resolve, reject, timer });
            try {
                this.socket!.send(JSON.stringify({ id, method, params }));
            } catch {
                clearTimeout(timer);
                this.pending.delete(id);
                reject(new Error('cdp_send_failed'));
            }
        });
    }

    close(): void {
        if (this.socket && this.socket.readyState < WebSocket.CLOSING) this.socket.close();
        this.rejectPending('cdp_closed');
        this.socket = null;
    }

    private rejectPending(code: string): void {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error(code));
        }
        this.pending.clear();
    }
}

export function buildProductionObserverInjection(): string {
    return `(() => {
        const existingProbe = globalThis.__wpMonitorWebRtcProbe;
        if (
            existingProbe?.version === ${WEBRTC_PROBE_RUNTIME_VERSION}
            && existingProbe?.implementation === '${WEBRTC_PROBE_IMPLEMENTATION}'
        ) return;
        let Native = globalThis.RTCPeerConnection;
        if (existingProbe && typeof Native === 'function') {
            existingProbe.disarm?.();
            if (existingProbe.version === 1 || existingProbe.version === 2) {
                const inheritedConstructor = Object.getPrototypeOf(Native);
                if (typeof inheritedConstructor === 'function' && inheritedConstructor !== Function.prototype) {
                    Native = inheritedConstructor;
                }
            }
        }
        if (typeof Native !== 'function') return;
        let armed = false;
        const documentToken = Math.random().toString(36).slice(2) + Date.now().toString(36);
        let scopeToken = null;
        let expiresAt = Infinity;
        let deadlineTimer = null;
        let connections = [];
        let transitions = [];
        let selectedPairs = new Map();
        let statsFailureIds = new Set();
        let samplingTimer = null;
        let samplingInFlight = null;
        let sequence = 0;
        let generation = 0;
        let connectionLimitReached = false;
        let transitionLimitReached = false;
        let pairLimitReached = false;
        function stopSamplingTimer() {
            if (samplingTimer !== null) clearInterval(samplingTimer);
            samplingTimer = null;
        }
        function clearConnections() {
            for (const item of connections) {
                item.connection.removeEventListener('iceconnectionstatechange', item.observe);
            }
            connections = [];
        }
        async function collectSelectedPairs(item, connectionGeneration) {
            let report;
            try {
                report = await item.connection.getStats();
            } catch {
                if (armed && connectionGeneration === generation) statsFailureIds.add(item.id);
                return;
            }
            if (!armed || Date.now() >= expiresAt || connectionGeneration !== generation) return;
            const stats = new Map();
            report.forEach((value, key) => stats.set(key, value));
            const selectedIds = new Set();
            for (const value of stats.values()) {
                if (value.type === 'transport' && typeof value.selectedCandidatePairId === 'string') {
                    selectedIds.add(value.selectedCandidatePairId);
                }
            }
            if (selectedIds.size === 0) {
                for (const value of stats.values()) {
                    if (value.type === 'candidate-pair' && value.state === 'succeeded' && value.nominated === true) {
                        selectedIds.add(value.id);
                    }
                }
            }
            const observedAt = new Date().toISOString();
            for (const id of selectedIds) {
                const pair = stats.get(id);
                if (!pair || pair.type !== 'candidate-pair') continue;
                const key = item.id + ':' + id;
                const previous = selectedPairs.get(key);
                if (!previous && selectedPairs.size >= 16) {
                    pairLimitReached = true;
                    continue;
                }
                const local = stats.get(pair.localCandidateId) || {};
                const remote = stats.get(pair.remoteCandidateId) || {};
                selectedPairs.set(key, {
                    peerConnectionId: item.id,
                    state: pair.state,
                    nominated: pair.nominated === true,
                    selected: true,
                    firstObservedAt: previous?.firstObservedAt || observedAt,
                    lastObservedAt: observedAt,
                    local: {
                        candidateType: local.candidateType,
                        protocol: local.protocol,
                        relayProtocol: local.relayProtocol,
                        address: local.address || local.ip,
                        port: local.port,
                    },
                    remote: {
                        candidateType: remote.candidateType,
                        protocol: remote.protocol,
                        relayProtocol: remote.relayProtocol,
                        address: remote.address || remote.ip,
                        port: remote.port,
                    },
                    packetsSent: pair.packetsSent,
                    packetsReceived: pair.packetsReceived,
                    bytesSent: pair.bytesSent,
                    bytesReceived: pair.bytesReceived,
                    currentRoundTripTime: pair.currentRoundTripTime,
                });
            }
        }
        async function sampleAll() {
            if (Date.now() >= expiresAt) return;
            if (!armed) return;
            if (samplingInFlight) return samplingInFlight;
            const connectionGeneration = generation;
            const work = (async () => {
                for (const item of connections.slice()) {
                    await collectSelectedPairs(item, connectionGeneration);
                }
            })();
            samplingInFlight = work;
            try {
                await work;
            } finally {
                if (samplingInFlight === work) samplingInFlight = null;
            }
        }
        function record(connection) {
            if (Date.now() >= expiresAt) return;
            if (!armed) return;
            if (connections.length >= 32) {
                connectionLimitReached = true;
                return;
            }
            const id = 'pc-' + (++sequence);
            const connectionGeneration = generation;
            let item;
            const observe = () => {
                if (!armed || Date.now() >= expiresAt || connectionGeneration !== generation) return;
                if (transitions.length >= 64) {
                    transitionLimitReached = true;
                } else {
                    transitions.push({
                        peerConnectionId: id,
                        state: connection.iceConnectionState || connection.connectionState || 'unknown',
                        observedAt: new Date().toISOString(),
                    });
                }
                void sampleAll();
            };
            item = { id, connection, observe };
            connections.push(item);
            observe();
            connection.addEventListener('iceconnectionstatechange', observe);
        }
        function ObservedPeerConnection(...args) {
            const connection = new Native(...args);
            record(connection);
            return connection;
        }
        ObservedPeerConnection.prototype = Native.prototype;
        Object.setPrototypeOf(ObservedPeerConnection, Native);
        Object.defineProperty(globalThis, 'RTCPeerConnection', {
            configurable: true,
            writable: true,
            value: ObservedPeerConnection,
        });
        globalThis.__wpMonitorWebRtcProbe = Object.freeze({
            version: ${WEBRTC_PROBE_RUNTIME_VERSION},
            implementation: '${WEBRTC_PROBE_IMPLEMENTATION}',
            status() {
                return { documentToken, scopeToken, armed: armed && Date.now() < expiresAt };
            },
            arm(token = null, deadline = Infinity) {
                if (deadline <= Date.now()) return false;
                if (armed && scopeToken === token) return true;
                if (deadlineTimer !== null) clearTimeout(deadlineTimer);
                scopeToken = token;
                expiresAt = deadline;
                stopSamplingTimer();
                clearConnections();
                generation += 1;
                sequence = 0;
                transitions = [];
                selectedPairs = new Map();
                statsFailureIds = new Set();
                samplingInFlight = null;
                connectionLimitReached = false;
                transitionLimitReached = false;
                pairLimitReached = false;
                armed = true;
                if (Number.isFinite(deadline)) deadlineTimer = setTimeout(() => {
                    armed = false;
                    stopSamplingTimer();
                    for (const item of connections) item.connection.removeEventListener('iceconnectionstatechange', item.observe);
                }, Math.max(0, deadline - Date.now()));
                samplingTimer = setInterval(() => { void sampleAll(); }, 1000);
                return true;
            },
            disarm() {
                if (deadlineTimer !== null) clearTimeout(deadlineTimer);
                deadlineTimer = null;
                scopeToken = null;
                armed = false;
                generation += 1;
                stopSamplingTimer();
                clearConnections();
                transitions = [];
                selectedPairs = new Map();
                statsFailureIds = new Set();
                samplingInFlight = null;
                return true;
            },
            async snapshot() {
                await sampleAll();
                return {
                    connectionCount: connections.length,
                    selectedPairs: Array.from(selectedPairs.values()),
                    stateTransitions: transitions.slice(),
                    statsFailures: statsFailureIds.size,
                    truncated: connectionLimitReached || pairLimitReached || transitionLimitReached,
                };
            },
        });
    })();`;
}

export function buildSnapshotAndDisarmExpression(): string {
    return `(async () => {
        const probe = globalThis.__wpMonitorWebRtcProbe;
        if (!probe) return null;
        try {
            return await probe.snapshot();
        } finally {
            probe.disarm();
        }
    })()`;
}

export function buildDisarmExpression(): string {
    return 'globalThis.__wpMonitorWebRtcProbe?.disarm?.() === true';
}

export function buildProbeStatusExpression(): string {
    return `({ origin: globalThis.location?.origin, probe: globalThis.__wpMonitorWebRtcProbe?.status?.() })`;
}

export function buildCheckpointExpression(): string {
    return `(async () => {
        const probe = globalThis.__wpMonitorWebRtcProbe;
        if (!probe) return null;
        const state = probe.status();
        const snapshot = await probe.snapshot();
        return { state, snapshot };
    })()`;
}

export function selectWhatsappCdpTarget(targets: readonly CdpTarget[]): CdpTarget | undefined {
    const validPages = targets.filter(item => (
        item.type === 'page'
        && typeof item.webSocketDebuggerUrl === 'string'
        && typeof item.url === 'string'
    ));
    return validPages.find(item => (item.url as string).startsWith('https://web.whatsapp.com/'))
        ?? validPages.find(item => item.url === 'about:blank');
}

function finite(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function sanitizeSnapshot(raw: RawWebRtcSnapshot, startedAt: Date, endedAt: Date): BrowserWebRtcEvidence {
    const pairs = Array.isArray(raw.selectedPairs) ? raw.selectedPairs : [];
    const connectionCount = Number.isSafeInteger(raw.connectionCount) ? Number(raw.connectionCount) : 0;
    const limitations = new Set<string>();
    if (connectionCount === 0) limitations.add('browser_peer_connection_not_observed');
    else if (pairs.length === 0) limitations.add('browser_selected_pair_not_observed');
    if (typeof raw.statsFailures === 'number' && raw.statsFailures > 0) {
        limitations.add('browser_get_stats_partial_failure');
    }
    if (raw.truncated === true) limitations.add('browser_webrtc_evidence_truncated');
    if (pairs.some(entry => {
        const pair = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
        const remote = pair.remote && typeof pair.remote === 'object' ? pair.remote as Record<string, unknown> : {};
        return typeof remote.address !== 'string';
    })) limitations.add('browser_candidate_address_not_exposed');
    const value = {
        version: 1,
        status: 'available',
        startedAt,
        endedAt,
        connectionCount,
        selectedPairs: pairs.slice(0, 16).map((entry, index) => {
            const pair = entry && typeof entry === 'object' && !Array.isArray(entry)
                ? entry as Record<string, unknown>
                : {};
            const local = pair.local && typeof pair.local === 'object' ? pair.local as Record<string, unknown> : {};
            const remote = pair.remote && typeof pair.remote === 'object' ? pair.remote as Record<string, unknown> : {};
            const candidate = (source: Record<string, unknown>) => ({
                candidateType: source.candidateType,
                protocol: source.protocol,
                relayProtocol: source.relayProtocol,
                address: source.address,
                port: source.port,
            });
            return {
                peerConnectionId: typeof pair.peerConnectionId === 'string' ? pair.peerConnectionId : `pc-${index + 1}`,
                state: pair.state,
                nominated: pair.nominated === true,
                selected: pair.selected === true,
                firstObservedAt: pair.firstObservedAt,
                lastObservedAt: pair.lastObservedAt,
                local: candidate(local),
                remote: candidate(remote),
                packetsSent: finite(pair.packetsSent),
                packetsReceived: finite(pair.packetsReceived),
                bytesSent: finite(pair.bytesSent),
                bytesReceived: finite(pair.bytesReceived),
                currentRoundTripTimeMs: finite(pair.currentRoundTripTime) === null
                    ? null
                    : finite(pair.currentRoundTripTime)! * 1_000,
            };
        }),
        stateTransitions: Array.isArray(raw.stateTransitions) ? raw.stateTransitions.slice(0, 64) : [],
        truncated: raw.truncated === true,
        limitations: [...limitations],
    };
    return normalizeBrowserWebRtcEvidence(value) ?? {
        version: 1,
        status: 'unavailable',
        startedAt,
        endedAt,
        connectionCount: 0,
        selectedPairs: [],
        stateTransitions: [],
        truncated: false,
        limitations: ['browser_webrtc_snapshot_invalid'],
    };
}

export class WebRtcCdpObserver implements WebRtcObservationAdapter {
    private client: CdpClient | null = null;
    private registeredClient: CdpClient | null = null;
    private active: {
        callId: string; targetJid: string; startedAt: Date; expiresAt: number;
        token: string; closing: boolean; checkpoints: WebRtcCheckpoints;
    } | null = null;
    private checkpointTimer: NodeJS.Timeout | null = null;
    private refreshPending = false;
    private contextEpoch = 0;
    private mainFrameId: string | null = null;
    private mainContextId: number | null = null;
    private documentToken: string | null = null;
    private documentGeneration = 0;
    private probeInstalled = false;
    private probeArmed = false;
    private checkedAt = 0;
    private lastLogKey = '';
    private lastLogAt = 0;
    private expiryTimer: NodeJS.Timeout | null = null;
    private lifecycleTail: Promise<void> = Promise.resolve();
    private readonly expiredEvidence = new Map<string, {
        evidence: BrowserWebRtcEvidence;
        completedAt: number;
    }>();
    private generation = 0;
    private initialized = false;

    constructor(
        private readonly cdpOrigin: string,
        private readonly fetchImpl: typeof fetch = fetch,
        private readonly now: () => number = Date.now,
        private readonly checkpointIntervalMs = 1_000,
    ) {
        if (!Number.isSafeInteger(checkpointIntervalMs) || checkpointIntervalMs < 10 || checkpointIntervalMs > 5_000) {
            throw new Error('Invalid WebRTC checkpoint interval');
        }
        const parsed = new URL(cdpOrigin);
        if (
            parsed.protocol !== 'http:'
            || parsed.hostname !== '127.0.0.1'
            || parsed.pathname !== '/'
            || parsed.username
            || parsed.password
            || parsed.search
            || parsed.hash
        ) {
            throw new Error('WEBRTC_CDP_URL must be an HTTP loopback origin');
        }
    }

    async ready(): Promise<boolean> {
        return this.withLifecycleLock(async () => {
            if (this.active) {
                await this.refreshActive();
                return this.status().instrumentationActive;
            }
            try {
                const client = await this.getWhatsappClient();
                await this.installProbe(client);
                if (!this.initialized) {
                    const disarmed = await this.disarmProbe(client);
                    if (!disarmed) throw new Error('webrtc_probe_disarm_failed');
                }
                this.initialized = true;
                return true;
            } catch {
                this.releaseClient();
                return false;
            }
        });
    }

    async start(callId: string, targetJid: string, ttlMs: number): Promise<void> {
        return this.withLifecycleLock(async () => {
            this.pruneExpiredEvidence();
            if (this.active) throw new Error('observer_already_active');
            if (this.expiredEvidence.has(callId)) throw new Error('observer_call_id_reused');
            const client = await this.getWhatsappClient();
            const startedAt = new Date(this.now());
            const expiresAt = this.now() + ttlMs;
            const token = randomBytes(16).toString('hex');
            const epoch = this.contextEpoch;
            try {
                await this.installProbe(client);
                await this.armProbe(client, token, expiresAt);
                const state = await this.inspectProbe(client);
                if (!state.armed || state.scopeToken !== token || epoch !== this.contextEpoch) throw new Error('webrtc_probe_arm_failed');
                this.documentToken = state.documentToken;
            } catch (error) {
                await this.disarmProbe(client);
                this.releaseClient(client);
                throw error;
            }
            const generation = ++this.generation;
            this.initialized = true;
            this.documentGeneration = 1;
            this.probeInstalled = true;
            this.probeArmed = true;
            this.checkedAt = this.now();
            this.active = { callId, targetJid, startedAt, expiresAt, token, closing: false, checkpoints: new WebRtcCheckpoints() };
            this.lastLogKey = '';
            this.logLifecycle('probe_armed');
            this.checkpointTimer = setInterval(() => this.requestRefresh(), this.checkpointIntervalMs);
            this.checkpointTimer.unref();
            this.expiryTimer = setTimeout(() => { void this.expireActiveScope(generation); }, Math.max(0, expiresAt - this.now()));
            this.expiryTimer.unref();
        });
    }

    status() {
        return {
            active: this.active !== null,
            callId: this.active?.callId ?? null,
            targetJid: this.active?.targetJid ?? null,
            startedAt: this.active?.startedAt ?? null,
            instrumentationActive: Boolean(this.active && !this.active.closing && this.now() < this.active.expiresAt
                && this.client?.isOpen() && this.probeArmed && this.probeInstalled
                && this.now() - this.checkedAt <= this.checkpointIntervalMs * 2),
            cdpConnected: this.client?.isOpen() === true,
            probeInstalled: this.probeInstalled,
            probeArmed: Boolean(this.probeArmed && this.active && this.now() < this.active.expiresAt),
            documentGeneration: this.documentGeneration,
        };
    }

    async stop(callId: string): Promise<BrowserWebRtcEvidence> {
        if (this.active?.callId === callId) this.active.closing = true;
        return this.withLifecycleLock(async () => {
            this.pruneExpiredEvidence();
            const expired = this.expiredEvidence.get(callId);
            if (expired) return expired.evidence;
            const active = this.active;
            const client = this.client;
            if (!active || active.callId !== callId) throw new Error('observer_scope_mismatch');
            if (this.checkpointTimer) clearInterval(this.checkpointTimer);
            this.checkpointTimer = null;
            await this.captureFinalCheckpoint();
            const disarmed = client ? await this.disarmProbe(client) : false;
            if (!disarmed) {
                active.checkpoints.note('browser_probe_disarm_unverified');
                this.logLifecycle('probe_disarm_unverified');
                // Keep scope ownership and the original TTL. A retry may verify
                // disarm; until then do not report an inactive logical scope.
                throw new Error('webrtc_probe_disarm_unverified');
            }
            this.clearExpiryTimer();
            this.probeArmed = false;
            if (this.active === active) this.active = null;
            const evidence = active.checkpoints.finish(active.startedAt, new Date(this.now()));
            this.expiredEvidence.set(callId, { evidence, completedAt: this.now() });
            this.pruneExpiredEvidence();
            return evidence;
        });
    }

    async shutdown(): Promise<void> {
        if (this.active) this.active.closing = true;
        return this.withLifecycleLock(async () => {
            this.clearExpiryTimer();
            const client = this.client;
            this.active = null;
            this.expiredEvidence.clear();
            if (client) await this.disarmProbe(client);
            this.releaseClient(client ?? undefined);
        });
    }

    private async readTargets(): Promise<CdpTarget[]> {
        const response = await this.fetchImpl(new URL('/json/list', this.cdpOrigin), {
            signal: AbortSignal.timeout(CDP_COMMAND_TIMEOUT_MS),
            redirect: 'error',
        });
        const declaredLength = Number(response.headers.get('content-length') ?? 0);
        if (!response.ok || declaredLength > MAX_RESPONSE_BYTES) throw new Error('cdp_targets_unavailable');
        const text = await response.text();
        if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('cdp_targets_too_large');
        const parsed = JSON.parse(text) as unknown;
        if (!Array.isArray(parsed) || parsed.length > 64) throw new Error('cdp_targets_invalid');
        return parsed as CdpTarget[];
    }

    private async getWhatsappClient(): Promise<CdpClient> {
        const targets = await this.readTargets();
        const target = selectWhatsappCdpTarget(targets);
        if (!target || typeof target.webSocketDebuggerUrl !== 'string') throw new Error('whatsapp_cdp_target_unavailable');
        const debuggerUrl = new URL(target.webSocketDebuggerUrl);
        const cdpOrigin = new URL(this.cdpOrigin);
        if (
            debuggerUrl.protocol !== 'ws:'
            || debuggerUrl.hostname !== '127.0.0.1'
            || debuggerUrl.port !== cdpOrigin.port
            || debuggerUrl.username
            || debuggerUrl.password
            || !debuggerUrl.pathname.startsWith('/devtools/page/')
            || debuggerUrl.search
            || debuggerUrl.hash
        ) throw new Error('whatsapp_cdp_debugger_url_invalid');
        const debuggerEndpoint = debuggerUrl.toString();
        if (this.client?.isOpen() && this.client.matches(debuggerEndpoint)) return this.client;
        this.releaseClient();
        const client = new CdpClient(debuggerEndpoint, (method, params) => {
            if (this.client !== client) return;
            const frame = params.frame as Record<string, unknown> | undefined;
            const context = params.context as Record<string, unknown> | undefined;
            const auxiliary = context?.auxData as Record<string, unknown> | undefined;
            if (method === 'Runtime.executionContextCreated' && auxiliary?.isDefault === true
                && auxiliary.frameId === this.mainFrameId && typeof context?.id === 'number') this.mainContextId = context.id;
            if (method === 'Page.frameNavigated' && frame && !frame.parentId && typeof frame.id === 'string') this.mainFrameId = frame.id;
            if (method === 'Runtime.executionContextsCleared' || method === 'connection.closed'
                || (method === 'Runtime.executionContextDestroyed' && this.mainContextId !== null && params.executionContextId === this.mainContextId)
                || (method === 'Page.frameNavigated' && frame && !frame.parentId)) {
                this.mainContextId = null;
                this.contextEpoch += 1;
                this.probeInstalled = false;
                this.probeArmed = false;
                if (this.active && !this.active.closing) {
                    this.active.checkpoints.note(method === 'connection.closed' ? 'browser_cdp_disconnected' : 'browser_context_replaced');
                    this.logLifecycle(method === 'connection.closed' ? 'cdp_disconnected' : 'context_replaced');
                }
                this.requestRefresh();
            } else if (method === 'Runtime.executionContextCreated') this.requestRefresh();
        });
        try {
            await client.connect();
            this.client = client;
            return client;
        } catch (error) {
            client.close();
            throw error;
        }
    }

    private async installProbe(client: CdpClient): Promise<void> {
        await client.send('Page.enable');
        const tree = await client.send('Page.getFrameTree');
        const frame = (tree.frameTree as Record<string, unknown> | undefined)?.frame as Record<string, unknown> | undefined;
        if (typeof frame?.id === 'string') this.mainFrameId = frame.id;
        await client.send('Runtime.enable');
        const source = buildProductionObserverInjection();
        if (this.registeredClient !== client) {
            await client.send('Page.addScriptToEvaluateOnNewDocument', { source });
            this.registeredClient = client;
        }
        await client.send('Runtime.evaluate', { expression: source, returnByValue: true });
        const probe = await client.send('Runtime.evaluate', {
            expression: buildProbeReadyExpression(),
            returnByValue: true,
        });
        const result = probe.result as Record<string, unknown> | undefined;
        if (result?.value !== true) throw new Error('webrtc_probe_injection_failed');
    }

    private async armProbe(client: CdpClient, token: string, expiresAt: number): Promise<void> {
        const state = await this.inspectProbe(client);
        if (state.armed && state.scopeToken !== token) throw new Error('webrtc_foreign_probe_scope');
        const response = await client.send('Runtime.evaluate', {
            expression: `globalThis.__wpMonitorWebRtcProbe?.arm?.(${JSON.stringify(token)}, ${expiresAt}) === true`,
            returnByValue: true,
        });
        if ((response.result as Record<string, unknown> | undefined)?.value !== true) throw new Error('webrtc_probe_arm_failed');
    }

    private async inspectProbe(client: CdpClient): Promise<{ documentToken: string; scopeToken: unknown; armed: boolean }> {
        const response = await client.send('Runtime.evaluate', { expression: buildProbeStatusExpression(), returnByValue: true });
        const value = (response.result as Record<string, unknown> | undefined)?.value as Record<string, unknown> | undefined;
        if (value?.origin !== 'https://web.whatsapp.com') throw new Error('webrtc_document_origin_invalid');
        const probe = value.probe as Record<string, unknown> | undefined;
        if (!probe || typeof probe.documentToken !== 'string' || probe.documentToken.length > 64 || typeof probe.armed !== 'boolean') {
            throw new Error('webrtc_probe_status_invalid');
        }
        return { documentToken: probe.documentToken, scopeToken: probe.scopeToken, armed: probe.armed };
    }

    private requestRefresh(): void {
        const active = this.active;
        if (!active || active.closing || this.refreshPending || this.now() >= active.expiresAt) return;
        this.refreshPending = true;
        void this.withLifecycleLock(async () => {
            if (this.active === active && !active.closing) await this.refreshActive();
        }).finally(() => { this.refreshPending = false; });
    }

    private async refreshActive(): Promise<void> {
        const active = this.active;
        if (!active || active.closing || this.now() >= active.expiresAt) return;
        try {
            const client = this.client?.isOpen() ? this.client : await this.getWhatsappClient();
            const epoch = this.contextEpoch;
            // Install is idempotent; verify the current origin before executing any rearm.
            await this.installProbe(client);
            let state = await this.inspectProbe(client);
            if (active.closing || this.now() >= active.expiresAt) return;
            if (state.documentToken !== this.documentToken || !state.armed) {
                active.checkpoints.note('browser_context_replaced');
                if (this.documentGeneration >= 16) {
                    active.checkpoints.note('browser_checkpoint_limit_reached');
                    throw new Error('webrtc_document_limit_reached');
                }
                await this.armProbe(client, active.token, active.expiresAt);
                state = await this.inspectProbe(client);
                if (active.closing) {
                    await this.disarmProbe(client);
                    return;
                }
                if (epoch !== this.contextEpoch || !state.armed || state.scopeToken !== active.token) throw new Error('webrtc_probe_continuity_failed');
                this.documentGeneration += 1;
                this.documentToken = state.documentToken;
                this.logLifecycle('probe_rearmed');
            }
            if (epoch !== this.contextEpoch || !state.armed || state.scopeToken !== active.token) throw new Error('webrtc_probe_continuity_failed');
            await this.captureCheckpoint(client);
            if (epoch !== this.contextEpoch) throw new Error('webrtc_probe_continuity_failed');
            this.probeInstalled = true;
            this.probeArmed = true;
            this.checkedAt = this.now();
        } catch (error) {
            this.probeArmed = false;
            active.checkpoints.note('browser_observation_interrupted');
            this.logLifecycle(error instanceof Error && error.message.startsWith('cdp_timeout:') ? 'cdp_timeout' : 'probe_refresh_failed');
        }
    }

    private async captureCheckpoint(client: CdpClient): Promise<void> {
        const active = this.active;
        if (!active) return;
        const epoch = this.contextEpoch;
        const response = await client.send('Runtime.evaluate', {
            expression: buildCheckpointExpression(), awaitPromise: true, returnByValue: true,
        });
        const value = (response.result as Record<string, unknown> | undefined)?.value as Record<string, unknown> | undefined;
        const state = value?.state as Record<string, unknown> | undefined;
        if (epoch !== this.contextEpoch || state?.documentToken !== this.documentToken || state?.scopeToken !== active.token
            || !value?.snapshot || typeof value.snapshot !== 'object') throw new Error('webrtc_checkpoint_scope_invalid');
        const evidence = sanitizeSnapshot(value.snapshot as RawWebRtcSnapshot, active.startedAt, new Date(this.now()));
        active.checkpoints.save(this.documentGeneration, evidence);
        if (evidence.status !== 'available') throw new Error('webrtc_checkpoint_invalid');
    }

    private async captureFinalCheckpoint(): Promise<void> {
        const active = this.active;
        if (!active) return;
        try {
            if (!this.client?.isOpen()) throw new Error('cdp_closed');
            // Never rearm at stop: the last surviving document must match the scope.
            await this.captureCheckpoint(this.client);
        } catch {
            active.checkpoints.note('browser_final_checkpoint_unavailable');
            this.logLifecycle('final_checkpoint_failed');
        }
    }

    private logLifecycle(cause: string): void {
        const key = `${cause}:${this.documentGeneration}`;
        if (key === this.lastLogKey && this.now() - this.lastLogAt < 5_000) return;
        this.lastLogKey = key;
        this.lastLogAt = this.now();
        const callId = this.active?.callId;
        const hash = callId ? createHash('sha256').update(callId).digest('hex').slice(0, 16) : 'none';
        console.info(`[WEBRTC-OBSERVER] cause=${cause} callIdHash=${hash} targetHash=${this.client?.targetHash() ?? 'none'} generation=${this.documentGeneration}`);
    }

    private async expireActiveScope(generation: number): Promise<void> {
        if (this.active && generation === this.generation) this.active.closing = true;
        await this.withLifecycleLock(async () => {
            const active = this.active;
            if (!active || generation !== this.generation) return;
            const client = this.client;
            this.clearExpiryTimer();
            active.checkpoints.note('browser_webrtc_observer_ttl_expired');
            try {
                await this.captureFinalCheckpoint();
            } finally {
                if (client) {
                    const reusable = await this.disarmProbe(client);
                    if (!reusable) {
                        active.checkpoints.note('browser_probe_disarm_unverified');
                        this.releaseClient(client);
                    }
                } else active.checkpoints.note('browser_probe_disarm_unverified');
                this.probeArmed = false;
                if (this.active === active) this.active = null;
            }
            const evidence = active.checkpoints.finish(active.startedAt, new Date(this.now()));
            this.expiredEvidence.delete(active.callId);
            this.expiredEvidence.set(active.callId, { evidence, completedAt: this.now() });
            this.pruneExpiredEvidence();
        });
    }

    private pruneExpiredEvidence(): void {
        const expiresBefore = this.now() - EXPIRED_EVIDENCE_TTL_MS;
        for (const [callId, value] of this.expiredEvidence) {
            if (value.completedAt < expiresBefore) this.expiredEvidence.delete(callId);
        }
        while (this.expiredEvidence.size > EXPIRED_EVIDENCE_LIMIT) {
            const oldest = this.expiredEvidence.keys().next().value as string | undefined;
            if (!oldest) break;
            this.expiredEvidence.delete(oldest);
        }
    }

    private releaseClient(expected?: CdpClient): void {
        const client = this.client;
        if (!client || (expected && client !== expected)) return;
        client.close();
        this.client = null;
        if (this.registeredClient === client) this.registeredClient = null;
        this.initialized = false;
        this.mainFrameId = null;
        this.mainContextId = null;
        this.probeInstalled = false;
        this.probeArmed = false;
    }

    private clearExpiryTimer(): void {
        if (this.checkpointTimer) clearInterval(this.checkpointTimer);
        this.checkpointTimer = null;
        if (this.expiryTimer) clearTimeout(this.expiryTimer);
        this.expiryTimer = null;
    }

    private async disarmProbe(client: CdpClient): Promise<boolean> {
        try {
            const evaluation = await client.send('Runtime.evaluate', {
                expression: buildDisarmExpression(),
                returnByValue: true,
            });
            const result = evaluation.result as Record<string, unknown> | undefined;
            return result?.value === true;
        } catch {
            // A lost CDP socket does not prove that the page probe stopped.
            return false;
        }
    }

    private async withLifecycleLock<T>(operation: () => Promise<T>): Promise<T> {
        const previous = this.lifecycleTail;
        let release!: () => void;
        this.lifecycleTail = new Promise<void>(resolve => { release = resolve; });
        await previous;
        try {
            return await operation();
        } finally {
            release();
        }
    }
}

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
const WEBRTC_PROBE_RUNTIME_VERSION = 2;
const WEBRTC_PROBE_IMPLEMENTATION = 'bounded-periodic-stats-v2';

function buildProbeReadyExpression(): string {
    return `Boolean(
        globalThis.__wpMonitorWebRtcProbe?.version === ${WEBRTC_PROBE_RUNTIME_VERSION}
        && globalThis.__wpMonitorWebRtcProbe?.implementation === '${WEBRTC_PROBE_IMPLEMENTATION}'
    )`;
}

export interface WebRtcObservationAdapter {
    ready(): Promise<boolean>;
    start(callId: string, targetJid: string, ttlMs: number): Promise<void>;
    status(): { active: boolean; callId: string | null; targetJid: string | null; startedAt: Date | null };
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

    constructor(private readonly url: string) {}

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
            if (!Number.isSafeInteger(message.id)) return;
            const pending = this.pending.get(message.id!);
            if (!pending) return;
            this.pending.delete(message.id!);
            clearTimeout(pending.timer);
            if (message.error) pending.reject(new Error(`cdp_command_failed:${message.error.code ?? 'unknown'}`));
            else pending.resolve(message.result ?? {});
        });
        socket.addEventListener('close', () => this.rejectPending('cdp_closed'));
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
            if (existingProbe.version === 1) {
                const inheritedConstructor = Object.getPrototypeOf(Native);
                if (typeof inheritedConstructor === 'function' && inheritedConstructor !== Function.prototype) {
                    Native = inheritedConstructor;
                }
            }
        }
        if (typeof Native !== 'function') return;
        let armed = false;
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
            if (!armed || connectionGeneration !== generation) return;
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
            if (!armed) return;
            if (connections.length >= 32) {
                connectionLimitReached = true;
                return;
            }
            const id = 'pc-' + (++sequence);
            const connectionGeneration = generation;
            let item;
            const observe = () => {
                if (!armed || connectionGeneration !== generation) return;
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
            arm() {
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
                samplingTimer = setInterval(() => { void sampleAll(); }, 1000);
                return true;
            },
            disarm() {
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
    private active: { callId: string; targetJid: string; startedAt: Date; expiresAt: number } | null = null;
    private expiryTimer: NodeJS.Timeout | null = null;
    private lifecycleTail: Promise<void> = Promise.resolve();
    private generation = 0;
    private initialized = false;

    constructor(
        private readonly cdpOrigin: string,
        private readonly fetchImpl: typeof fetch = fetch,
        private readonly now: () => number = Date.now,
    ) {
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
            if (this.active) return this.client?.isOpen() === true;
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
            if (this.active) throw new Error('observer_already_active');
            const client = await this.getWhatsappClient();
            try {
                await this.installProbe(client);
                const armed = await client.send('Runtime.evaluate', {
                    expression: 'globalThis.__wpMonitorWebRtcProbe?.arm?.() === true',
                    returnByValue: true,
                });
                const result = armed.result as Record<string, unknown> | undefined;
                if (result?.value !== true) throw new Error('webrtc_probe_arm_failed');
            } catch (error) {
                this.releaseClient(client);
                throw error;
            }
            const startedAt = new Date(this.now());
            const generation = ++this.generation;
            this.initialized = true;
            this.active = { callId, targetJid, startedAt, expiresAt: this.now() + ttlMs };
            this.expiryTimer = setTimeout(() => { void this.expireActiveScope(generation); }, ttlMs);
            this.expiryTimer.unref();
        });
    }

    status() {
        return {
            active: this.active !== null,
            callId: this.active?.callId ?? null,
            targetJid: this.active?.targetJid ?? null,
            startedAt: this.active?.startedAt ?? null,
        };
    }

    async stop(callId: string): Promise<BrowserWebRtcEvidence> {
        return this.withLifecycleLock(async () => {
            const active = this.active;
            const client = this.client;
            if (!active || active.callId !== callId || !client) throw new Error('observer_scope_mismatch');
            this.clearExpiryTimer();
            try {
                const evaluation = await client.send('Runtime.evaluate', {
                    expression: buildSnapshotAndDisarmExpression(),
                    awaitPromise: true,
                    returnByValue: true,
                });
                const result = evaluation.result as Record<string, unknown> | undefined;
                const raw = result?.value && typeof result.value === 'object'
                    ? result.value as RawWebRtcSnapshot
                    : {};
                return sanitizeSnapshot(raw, active.startedAt, new Date(this.now()));
            } finally {
                const reusable = await this.disarmProbe(client);
                if (!reusable) this.releaseClient(client);
                if (this.active === active) this.active = null;
            }
        });
    }

    async shutdown(): Promise<void> {
        return this.withLifecycleLock(async () => {
            this.clearExpiryTimer();
            const client = this.client;
            this.active = null;
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
        const client = new CdpClient(debuggerEndpoint);
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

    private async expireActiveScope(generation: number): Promise<void> {
        await this.withLifecycleLock(async () => {
            if (!this.active || generation !== this.generation) return;
            const client = this.client;
            this.clearExpiryTimer();
            this.active = null;
            if (!client) return;
            const reusable = await this.disarmProbe(client);
            if (!reusable) this.releaseClient(client);
        });
    }

    private releaseClient(expected?: CdpClient): void {
        const client = this.client;
        if (!client || (expected && client !== expected)) return;
        client.close();
        this.client = null;
        if (this.registeredClient === client) this.registeredClient = null;
        this.initialized = false;
    }

    private clearExpiryTimer(): void {
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
            // A closed browser cannot retain the page probe; local state still closes.
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

import {
    normalizeBrowserWebRtcEvidence,
    type BrowserWebRtcEvidence,
} from './call-observation-evidence.js';

interface CdpTarget {
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

export interface WebRtcObservationAdapter {
    ready(): Promise<boolean>;
    start(callId: string, targetJid: string, ttlMs: number): Promise<void>;
    status(): { active: boolean; callId: string | null; targetJid: string | null; startedAt: Date | null };
    stop(callId: string): Promise<BrowserWebRtcEvidence>;
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
            this.socket!.send(JSON.stringify({ id, method, params }));
        });
    }

    close(): void {
        if (this.socket && this.socket.readyState < WebSocket.CLOSING) this.socket.close();
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error('cdp_closed'));
        }
        this.pending.clear();
        this.socket = null;
    }
}

export function buildProductionObserverInjection(): string {
    return `(() => {
        if (globalThis.__wpMonitorWebRtcProbe) return;
        const Native = globalThis.RTCPeerConnection;
        if (typeof Native !== 'function') return;
        let armed = false;
        let connections = [];
        let transitions = [];
        let sequence = 0;
        let generation = 0;
        function record(connection) {
            if (!armed) return;
            if (connections.length >= 32) return;
            const id = 'pc-' + (++sequence);
            const connectionGeneration = generation;
            connections.push({ id, connection });
            const observe = () => {
                if (!armed || connectionGeneration !== generation) return;
                if (transitions.length >= 64) return;
                transitions.push({
                    peerConnectionId: id,
                    state: connection.iceConnectionState || connection.connectionState || 'unknown',
                    observedAt: new Date().toISOString(),
                });
            };
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
            version: 1,
            arm() {
                generation += 1;
                sequence = 0;
                connections = [];
                transitions = [];
                armed = true;
                return true;
            },
            disarm() {
                armed = false;
                generation += 1;
                connections = [];
                transitions = [];
                return true;
            },
            async snapshot() {
                const selectedPairs = [];
                let statsFailures = 0;
                for (const item of connections) {
                    let report;
                    try {
                        report = await item.connection.getStats();
                    } catch {
                        statsFailures += 1;
                        continue;
                    }
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
                    for (const id of selectedIds) {
                        if (selectedPairs.length >= 16) break;
                        const pair = stats.get(id);
                        if (!pair || pair.type !== 'candidate-pair') continue;
                        const local = stats.get(pair.localCandidateId) || {};
                        const remote = stats.get(pair.remoteCandidateId) || {};
                        selectedPairs.push({
                            peerConnectionId: item.id,
                            state: pair.state,
                            nominated: pair.nominated === true,
                            selected: true,
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
                return {
                    connectionCount: connections.length,
                    selectedPairs,
                    stateTransitions: transitions.slice(),
                    statsFailures,
                    truncated: connections.length >= 32 || selectedPairs.length >= 16 || transitions.length >= 64,
                };
            },
        });
    })();`;
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
                firstObservedAt: startedAt,
                lastObservedAt: endedAt,
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
    private active: { callId: string; targetJid: string; startedAt: Date; expiresAt: number } | null = null;
    private expiryTimer: NodeJS.Timeout | null = null;

    constructor(
        private readonly cdpOrigin: string,
        private readonly fetchImpl: typeof fetch = fetch,
        private readonly now: () => number = Date.now,
    ) {
        const parsed = new URL(cdpOrigin);
        if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/') {
            throw new Error('WEBRTC_CDP_URL must be an HTTP loopback origin');
        }
    }

    async ready(): Promise<boolean> {
        try {
            const client = await this.connectToWhatsappTarget();
            try {
                await this.installProbe(client);
                return true;
            } finally {
                client.close();
            }
        } catch {
            return false;
        }
    }

    async start(callId: string, targetJid: string, ttlMs: number): Promise<void> {
        if (this.active) throw new Error('observer_already_active');
        const client = await this.connectToWhatsappTarget();
        try {
            await this.installProbe(client);
            const armed = await client.send('Runtime.evaluate', {
                expression: 'globalThis.__wpMonitorWebRtcProbe?.arm?.() === true',
                returnByValue: true,
            });
            const result = armed.result as Record<string, unknown> | undefined;
            if (result?.value !== true) throw new Error('webrtc_probe_arm_failed');
        } catch (error) {
            client.close();
            throw error;
        }
        const startedAt = new Date(this.now());
        this.client = client;
        this.active = { callId, targetJid, startedAt, expiresAt: this.now() + ttlMs };
        this.expiryTimer = setTimeout(() => { void this.expireActiveScope(); }, ttlMs);
        this.expiryTimer.unref();
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
        const active = this.active;
        if (!active || active.callId !== callId || !this.client) throw new Error('observer_scope_mismatch');
        try {
            const evaluation = await this.client.send('Runtime.evaluate', {
                expression: `(async () => {
                    const probe = globalThis.__wpMonitorWebRtcProbe;
                    if (!probe) return null;
                    const snapshot = await probe.snapshot();
                    probe.disarm();
                    return snapshot;
                })()`,
                awaitPromise: true,
                returnByValue: true,
            });
            const result = evaluation.result as Record<string, unknown> | undefined;
            const raw = result?.value && typeof result.value === 'object'
                ? result.value as RawWebRtcSnapshot
                : {};
            return sanitizeSnapshot(raw, active.startedAt, new Date(this.now()));
        } finally {
            if (this.expiryTimer) clearTimeout(this.expiryTimer);
            this.expiryTimer = null;
            this.client.close();
            this.client = null;
            this.active = null;
        }
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

    private async connectToWhatsappTarget(): Promise<CdpClient> {
        const targets = await this.readTargets();
        const target = targets.find(item => (
            item.type === 'page'
            && typeof item.webSocketDebuggerUrl === 'string'
            && typeof item.url === 'string'
            && (item.url.startsWith('https://web.whatsapp.com/') || item.url === 'about:blank')
        ));
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
        ) throw new Error('whatsapp_cdp_debugger_url_invalid');
        const client = new CdpClient(debuggerUrl.toString());
        try {
            await client.connect();
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
        await client.send('Page.addScriptToEvaluateOnNewDocument', { source });
        await client.send('Runtime.evaluate', { expression: source, returnByValue: true });
        const probe = await client.send('Runtime.evaluate', {
            expression: 'Boolean(globalThis.__wpMonitorWebRtcProbe?.version === 1)',
            returnByValue: true,
        });
        const result = probe.result as Record<string, unknown> | undefined;
        if (result?.value !== true) throw new Error('webrtc_probe_injection_failed');
    }

    private async expireActiveScope(): Promise<void> {
        const client = this.client;
        try {
            await client?.send('Runtime.evaluate', {
                expression: 'globalThis.__wpMonitorWebRtcProbe?.disarm?.()',
                returnByValue: true,
            });
        } catch {
            // The browser or target may already be gone; local state still expires.
        } finally {
            client?.close();
            this.client = null;
            this.active = null;
            this.expiryTimer = null;
        }
    }
}

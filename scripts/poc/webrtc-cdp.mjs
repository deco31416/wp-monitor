import { spawn } from 'node:child_process';
import { accessSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_SELECTED_PAIRS = 8;
const CDP_TIMEOUT_MS = 10_000;
const SYNTHETIC_TIMEOUT_MS = 15_000;

function boundedEnum(value, allowed, fallback = 'unknown') {
    return typeof value === 'string' && allowed.has(value) ? value : fallback;
}

function addressScope(address) {
    const family = isIP(address);
    if (family === 4) {
        const [a, b] = address.split('.').map(Number);
        if (a === 127) return { family: 'ipv4', scope: 'loopback' };
        if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
            return { family: 'ipv4', scope: 'private' };
        }
        if (a === 169 && b === 254) return { family: 'ipv4', scope: 'link_local' };
        if (a === 100 && b >= 64 && b <= 127) return { family: 'ipv4', scope: 'carrier_nat' };
        if (
            (a === 192 && b === 0 && address.startsWith('192.0.2.'))
            || (a === 198 && b === 51 && address.startsWith('198.51.100.'))
            || (a === 203 && b === 0 && address.startsWith('203.0.113.'))
        ) {
            return { family: 'ipv4', scope: 'documentation' };
        }
        return { family: 'ipv4', scope: 'public' };
    }
    if (family === 6) {
        const normalized = address.toLowerCase();
        if (normalized === '::1') return { family: 'ipv6', scope: 'loopback' };
        if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
            return { family: 'ipv6', scope: 'link_local' };
        }
        if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
            return { family: 'ipv6', scope: 'private' };
        }
        if (normalized.startsWith('2001:db8')) return { family: 'ipv6', scope: 'documentation' };
        return { family: 'ipv6', scope: 'public' };
    }
    return { family: 'unknown', scope: 'unknown' };
}

function sanitizeCandidate(candidate) {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    const address = typeof source.address === 'string' ? source.address : '';
    const classified = addressScope(address);
    return {
        candidateType: boundedEnum(
            source.candidateType,
            new Set(['host', 'srflx', 'prflx', 'relay']),
        ),
        protocol: boundedEnum(source.protocol, new Set(['udp', 'tcp'])),
        relayProtocol: boundedEnum(source.relayProtocol, new Set(['udp', 'tcp', 'tls']), 'unavailable'),
        addressExposed: classified.family !== 'unknown',
        addressFamily: classified.family,
        addressScope: classified.scope,
        portExposed: Number.isInteger(source.port) && source.port > 0 && source.port <= 65_535,
    };
}

export function sanitizeWebRtcSnapshot(snapshot) {
    const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const pairs = Array.isArray(source.selectedPairs) ? source.selectedPairs : [];
    return {
        version: 1,
        connectionCount: Number.isInteger(source.connectionCount) && source.connectionCount >= 0
            ? Math.min(source.connectionCount, 32)
            : 0,
        selectedPairCount: Math.min(pairs.length, MAX_SELECTED_PAIRS),
        selectedPairs: pairs.slice(0, MAX_SELECTED_PAIRS).map((pair) => {
            const value = pair && typeof pair === 'object' ? pair : {};
            return {
                state: boundedEnum(value.state, new Set(['frozen', 'waiting', 'in-progress', 'failed', 'succeeded'])),
                nominated: value.nominated === true,
                selected: value.selected === true,
                local: sanitizeCandidate(value.local),
                remote: sanitizeCandidate(value.remote),
                metrics: {
                    packetsSentObserved: Number.isFinite(value.packetsSent),
                    packetsReceivedObserved: Number.isFinite(value.packetsReceived),
                    bytesSentObserved: Number.isFinite(value.bytesSent),
                    bytesReceivedObserved: Number.isFinite(value.bytesReceived),
                    currentRttObserved: Number.isFinite(value.currentRoundTripTime),
                },
            };
        }),
        rawAddressesRetained: false,
        sdpRetained: false,
        contentRetained: false,
    };
}

export function buildObserverInjection() {
    return `(() => {
        const NativePeerConnection = globalThis.RTCPeerConnection;
        if (typeof NativePeerConnection !== 'function' || globalThis.__wpMonitorWebRtcProbe) return;
        const connections = [];
        function ObservedPeerConnection(...args) {
            const connection = new NativePeerConnection(...args);
            if (connections.length < 32) connections.push(connection);
            return connection;
        }
        ObservedPeerConnection.prototype = NativePeerConnection.prototype;
        Object.setPrototypeOf(ObservedPeerConnection, NativePeerConnection);
        Object.defineProperty(globalThis, 'RTCPeerConnection', {
            configurable: true,
            writable: true,
            value: ObservedPeerConnection,
        });
        globalThis.__wpMonitorWebRtcProbe = Object.freeze({
            version: 1,
            async snapshot() {
                const selectedPairs = [];
                for (const connection of connections) {
                    const report = await connection.getStats();
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
                        const pair = stats.get(id);
                        if (!pair || pair.type !== 'candidate-pair') continue;
                        const local = stats.get(pair.localCandidateId) || {};
                        const remote = stats.get(pair.remoteCandidateId) || {};
                        selectedPairs.push({
                            state: pair.state,
                            nominated: pair.nominated === true,
                            selected: true,
                            packetsSent: pair.packetsSent,
                            packetsReceived: pair.packetsReceived,
                            bytesSent: pair.bytesSent,
                            bytesReceived: pair.bytesReceived,
                            currentRoundTripTime: pair.currentRoundTripTime,
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
                        });
                    }
                }
                return { version: 1, connectionCount: connections.length, selectedPairs };
            },
        });
    })();`;
}

const SYNTHETIC_FIXTURE = `<!doctype html>
<meta charset="utf-8">
<title>WP Monitor synthetic WebRTC fixture</title>
<script>
globalThis.__wpMonitorSyntheticReady = false;
globalThis.__wpMonitorSyntheticError = null;
(async () => {
    const caller = new RTCPeerConnection({ iceServers: [] });
    const receiver = new RTCPeerConnection({ iceServers: [] });
    caller.addEventListener('icecandidate', event => {
        if (event.candidate) receiver.addIceCandidate(event.candidate).catch(() => {});
    });
    receiver.addEventListener('icecandidate', event => {
        if (event.candidate) caller.addIceCandidate(event.candidate).catch(() => {});
    });
    const received = new Promise(resolve => {
        receiver.addEventListener('datachannel', event => {
            event.channel.addEventListener('message', resolve, { once: true });
        }, { once: true });
    });
    const channel = caller.createDataChannel('synthetic-observation');
    const opened = new Promise(resolve => channel.addEventListener('open', resolve, { once: true }));
    const offer = await caller.createOffer();
    await caller.setLocalDescription(offer);
    await receiver.setRemoteDescription(offer);
    const answer = await receiver.createAnswer();
    await receiver.setLocalDescription(answer);
    await caller.setRemoteDescription(answer);
    await opened;
    channel.send('synthetic-payload');
    await received;
    globalThis.__wpMonitorSyntheticReady = true;
})().catch(error => {
    globalThis.__wpMonitorSyntheticError = String(error && error.message ? error.message : error).slice(0, 200);
});
</script>`;

class CdpClient {
    constructor(url) {
        this.url = url;
        this.socket = null;
        this.nextId = 1;
        this.pending = new Map();
    }

    async connect() {
        this.socket = new WebSocket(this.url);
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('cdp_connect_timeout')), CDP_TIMEOUT_MS);
            this.socket.addEventListener('open', () => {
                clearTimeout(timer);
                resolve();
            }, { once: true });
            this.socket.addEventListener('error', () => {
                clearTimeout(timer);
                reject(new Error('cdp_connect_failed'));
            }, { once: true });
        });
        this.socket.addEventListener('message', event => {
            let message;
            try {
                message = JSON.parse(String(event.data));
            } catch {
                return;
            }
            if (!Number.isInteger(message.id)) return;
            const pending = this.pending.get(message.id);
            if (!pending) return;
            this.pending.delete(message.id);
            clearTimeout(pending.timer);
            if (message.error) pending.reject(new Error(`cdp_command_failed:${message.error.code}`));
            else pending.resolve(message.result || {});
        });
    }

    send(method, params = {}, sessionId) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return Promise.reject(new Error('cdp_not_connected'));
        }
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`cdp_timeout:${method}`));
            }, CDP_TIMEOUT_MS);
            this.pending.set(id, { resolve, reject, timer });
            this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        });
    }

    close() {
        if (this.socket && this.socket.readyState < WebSocket.CLOSING) this.socket.close();
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error('cdp_closed'));
        }
        this.pending.clear();
    }
}

function findChromeExecutable() {
    const names = ['google-chrome', 'chromium', 'chromium-browser'];
    const directories = (process.env.PATH || '').split(delimiter).filter(Boolean);
    for (const directory of directories) {
        for (const name of names) {
            const candidate = join(directory, name);
            try {
                accessSync(candidate);
                return candidate;
            } catch {
                // Continue with the next candidate.
            }
        }
    }
    throw new Error('chrome_executable_not_found');
}

async function waitForDevTools(profileDirectory, chromeState) {
    const activePortPath = join(profileDirectory, 'DevToolsActivePort');
    const deadline = Date.now() + CDP_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (chromeState.spawnFailed || chromeState.process.exitCode !== null) {
            throw new Error('chrome_exited_before_devtools');
        }
        try {
            const [portLine, pathLine] = (await readFile(activePortPath, 'utf8')).trim().split('\n');
            const port = Number(portLine);
            if (Number.isInteger(port) && port > 0 && pathLine?.startsWith('/')) {
                return { port, browserUrl: `ws://127.0.0.1:${port}${pathLine}` };
            }
        } catch {
            // Chrome creates the file asynchronously.
        }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('devtools_active_port_timeout');
}

async function waitForSyntheticConnection(cdp, sessionId) {
    const deadline = Date.now() + SYNTHETIC_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const evaluation = await cdp.send('Runtime.evaluate', {
            expression: `({ ready: globalThis.__wpMonitorSyntheticReady === true,
                error: globalThis.__wpMonitorSyntheticError || null })`,
            returnByValue: true,
        }, sessionId);
        const value = evaluation.result?.value;
        if (value?.error) throw new Error('synthetic_webrtc_failed');
        if (value?.ready) return;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('synthetic_webrtc_timeout');
}

export async function runWebRtcCdpPoc() {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'wp-monitor-webrtc-poc-'));
    const profileDirectory = join(temporaryDirectory, 'profile');
    const fixturePath = join(temporaryDirectory, 'fixture.html');
    await writeFile(fixturePath, SYNTHETIC_FIXTURE, { encoding: 'utf8', mode: 0o600 });
    let chrome;
    let cdp;
    try {
        chrome = spawn(findChromeExecutable(), [
            '--headless=new',
            '--remote-debugging-address=127.0.0.1',
            '--remote-debugging-port=0',
            `--user-data-dir=${profileDirectory}`,
            '--disable-background-networking',
            '--disable-component-update',
            '--disable-default-apps',
            '--disable-extensions',
            '--disable-gpu',
            '--disable-sync',
            '--metrics-recording-only',
            '--no-first-run',
            'about:blank',
        ], { stdio: ['ignore', 'ignore', 'ignore'] });
        const chromeState = { process: chrome, spawnFailed: false };
        chrome.once('error', () => {
            chromeState.spawnFailed = true;
        });
        const { browserUrl } = await waitForDevTools(profileDirectory, chromeState);
        cdp = new CdpClient(browserUrl);
        await cdp.connect();
        const version = await cdp.send('Browser.getVersion');
        const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
        const attached = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
        const sessionId = attached.sessionId;
        if (typeof sessionId !== 'string') throw new Error('cdp_session_missing');
        await cdp.send('Page.enable', {}, sessionId);
        await cdp.send('Runtime.enable', {}, sessionId);
        const injection = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
            source: buildObserverInjection(),
        }, sessionId);
        if (typeof injection.identifier !== 'string') throw new Error('cdp_injection_not_registered');
        await cdp.send('Page.navigate', { url: pathToFileURL(fixturePath).href }, sessionId);
        await waitForSyntheticConnection(cdp, sessionId);
        const evaluation = await cdp.send('Runtime.evaluate', {
            expression: 'globalThis.__wpMonitorWebRtcProbe.snapshot()',
            awaitPromise: true,
            returnByValue: true,
        }, sessionId);
        const evidence = sanitizeWebRtcSnapshot(evaluation.result?.value);
        if (evidence.connectionCount < 2 || evidence.selectedPairCount < 1) {
            throw new Error('selected_candidate_pair_not_observed');
        }
        return {
            status: 'PASS',
            evidenceLevel: 'E3_LOCAL_SYNTHETIC',
            browserProduct: typeof version.product === 'string' ? version.product.slice(0, 80) : 'unknown',
            protocolVersion: typeof version.protocolVersion === 'string' ? version.protocolVersion.slice(0, 20) : 'unknown',
            cdpBinding: 'loopback_ephemeral',
            profile: 'temporary_isolated',
            evidence,
            limitations: [
                'synthetic_webrtc_only',
                'whatsapp_web_not_yet_validated',
                'raw_candidate_addresses_not_retained',
            ],
        };
    } finally {
        cdp?.close();
        if (chrome?.exitCode === null) {
            chrome.kill('SIGTERM');
            await Promise.race([
                new Promise(resolve => chrome.once('exit', resolve)),
                new Promise(resolve => setTimeout(resolve, 1_000)),
            ]);
            if (chrome.exitCode === null) chrome.kill('SIGKILL');
        }
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    runWebRtcCdpPoc()
        .then(result => console.log(JSON.stringify(result, null, 2)))
        .catch(error => {
            console.error(JSON.stringify({
                status: 'FAIL',
                reason: error instanceof Error ? error.message : 'unknown_failure',
            }));
            process.exitCode = 1;
        });
}

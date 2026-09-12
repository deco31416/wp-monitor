import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
    buildDisarmExpression,
    buildProductionObserverInjection,
    buildSnapshotAndDisarmExpression,
    selectWhatsappCdpTarget,
    WebRtcCdpObserver,
} from '../src/webrtc-observer-cdp.js';

test('probe disarm reports success only when a real probe was cleared', () => {
    assert.equal(vm.runInNewContext(buildDisarmExpression(), {}), false);
    assert.equal(vm.runInNewContext(buildDisarmExpression(), {
        __wpMonitorWebRtcProbe: { disarm: () => true },
    }), true);
});

test('production WebRTC probe is dormant by default and retains no SDP or content APIs', () => {
    const source = buildProductionObserverInjection();

    assert.match(source, /let armed = false/);
    assert.match(source, /if \(!armed\) return/);
    assert.match(source, /connectionGeneration !== generation/);
    assert.match(source, /arm\(\)/);
    assert.match(source, /disarm\(\)/);
    assert.match(source, /getStats\(\)/);
    assert.match(source, /setInterval/);
    assert.match(source, /version: 2/);
    assert.match(source, /bounded-periodic-stats-v2/);
    assert.match(source, /firstObservedAt/);
    assert.match(source, /lastObservedAt/);
    assert.doesNotMatch(source, /createOffer/);
    assert.doesNotMatch(source, /createAnswer/);
    assert.doesNotMatch(source, /localDescription/);
    assert.doesNotMatch(source, /remoteDescription/);
    assert.doesNotMatch(source, /sessionDescription/);
    assert.doesNotMatch(source, /message|audio|mediaStream/i);
});

test('production WebRTC probe upgrades the legacy wrapper once without stacking constructors', () => {
    let legacyDisarms = 0;
    class FakeNativePeerConnection {
        addEventListener() {}
        removeEventListener() {}
        async getStats() { return new Map(); }
    }
    function LegacyObservedPeerConnection() {
        return new FakeNativePeerConnection();
    }
    LegacyObservedPeerConnection.prototype = FakeNativePeerConnection.prototype;
    Object.setPrototypeOf(LegacyObservedPeerConnection, FakeNativePeerConnection);
    const context = vm.createContext({
        RTCPeerConnection: LegacyObservedPeerConnection,
        __wpMonitorWebRtcProbe: {
            version: 1,
            disarm: () => { legacyDisarms += 1; },
        },
        setInterval: () => 1,
        clearInterval: () => undefined,
    });

    vm.runInContext(buildProductionObserverInjection(), context);
    const upgradedConstructor = context.RTCPeerConnection;
    assert.equal(legacyDisarms, 1);
    assert.equal(context.__wpMonitorWebRtcProbe.version, 2);
    assert.equal(context.__wpMonitorWebRtcProbe.implementation, 'bounded-periodic-stats-v2');
    assert.equal(Object.getPrototypeOf(upgradedConstructor), FakeNativePeerConnection);

    vm.runInContext(buildProductionObserverInjection(), context);
    assert.equal(context.RTCPeerConnection, upgradedConstructor);
    assert.equal(legacyDisarms, 1);
});

test('production WebRTC probe removes per-connection listeners when disarmed', () => {
    let attached = 0;
    let removed = 0;
    let timerCleared = 0;
    class FakePeerConnection {
        iceConnectionState = 'new';
        addEventListener() { attached += 1; }
        removeEventListener() { removed += 1; }
        async getStats() { return new Map(); }
    }
    const context = vm.createContext({
        RTCPeerConnection: FakePeerConnection,
        setInterval: () => 1,
        clearInterval: () => { timerCleared += 1; },
    });
    vm.runInContext(buildProductionObserverInjection(), context);
    vm.runInContext('globalThis.__wpMonitorWebRtcProbe.arm()', context);
    vm.runInContext('new globalThis.RTCPeerConnection()', context);
    assert.equal(attached, 1);
    vm.runInContext('globalThis.__wpMonitorWebRtcProbe.disarm()', context);
    assert.equal(removed, 1);
    assert.equal(timerCleared, 1);
});

test('production WebRTC probe preserves a selected pair after the connection closes', async () => {
    let activeConnection: FakePeerConnection | null = null;
    class FakePeerConnection {
        iceConnectionState = 'connected';
        closed = false;
        private readonly listeners = new Set<() => void>();

        constructor() { activeConnection = this; }
        addEventListener(_event: string, listener: () => void) { this.listeners.add(listener); }
        removeEventListener(_event: string, listener: () => void) { this.listeners.delete(listener); }
        async getStats() {
            if (this.closed) throw new Error('peer_connection_closed');
            return new Map<string, Record<string, unknown>>([
                ['transport-1', { type: 'transport', selectedCandidatePairId: 'pair-1' }],
                ['pair-1', {
                    id: 'pair-1',
                    type: 'candidate-pair',
                    state: 'succeeded',
                    nominated: true,
                    localCandidateId: 'local-1',
                    remoteCandidateId: 'remote-1',
                    packetsSent: 12,
                    packetsReceived: 14,
                }],
                ['local-1', {
                    type: 'local-candidate',
                    candidateType: 'host',
                    protocol: 'udp',
                    address: '192.0.2.10',
                    port: 50_000,
                }],
                ['remote-1', {
                    type: 'remote-candidate',
                    candidateType: 'relay',
                    protocol: 'udp',
                    address: '198.51.100.20',
                    port: 3_478,
                }],
            ]);
        }
    }
    const context = vm.createContext({
        RTCPeerConnection: FakePeerConnection,
        setInterval: () => 1,
        clearInterval: () => undefined,
    });
    vm.runInContext(buildProductionObserverInjection(), context);
    vm.runInContext('globalThis.__wpMonitorWebRtcProbe.arm()', context);
    vm.runInContext('new globalThis.RTCPeerConnection()', context);
    await new Promise(resolve => setImmediate(resolve));

    assert.ok(activeConnection);
    (activeConnection as unknown as FakePeerConnection).closed = true;
    const snapshot = await vm.runInContext(
        'globalThis.__wpMonitorWebRtcProbe.snapshot()',
        context,
    ) as {
        selectedPairs: Array<Record<string, unknown>>;
        statsFailures: number;
    };

    assert.equal(snapshot.selectedPairs.length, 1);
    assert.equal(snapshot.selectedPairs[0]?.peerConnectionId, 'pc-1');
    assert.equal(snapshot.selectedPairs[0]?.state, 'succeeded');
    assert.equal(snapshot.selectedPairs[0]?.firstObservedAt, snapshot.selectedPairs[0]?.lastObservedAt);
    assert.equal(Number.isNaN(Date.parse(String(snapshot.selectedPairs[0]?.firstObservedAt))), false);
    assert.equal(snapshot.statsFailures, 1);
    vm.runInContext('globalThis.__wpMonitorWebRtcProbe.disarm()', context);
});

test('production WebRTC probe preserves route changes and bounds selected-pair evidence', async () => {
    let selectedPair = 1;
    let intervalCallback: (() => void) | null = null;
    let observedTime = Date.parse('2026-09-12T12:00:00.000Z');
    class FakeDate extends Date {
        constructor() {
            super(observedTime);
            observedTime += 1_000;
        }
    }
    class FakePeerConnection {
        iceConnectionState = 'connected';
        addEventListener() {}
        removeEventListener() {}
        async getStats() {
            const pairId = `pair-${selectedPair}`;
            const remoteId = `remote-${selectedPair}`;
            return new Map<string, Record<string, unknown>>([
                ['transport-1', { type: 'transport', selectedCandidatePairId: pairId }],
                [pairId, {
                    id: pairId,
                    type: 'candidate-pair',
                    state: 'succeeded',
                    nominated: true,
                    localCandidateId: 'local-1',
                    remoteCandidateId: remoteId,
                }],
                ['local-1', {
                    type: 'local-candidate',
                    candidateType: 'host',
                    protocol: 'udp',
                    address: '192.0.2.10',
                    port: 50_000,
                }],
                [remoteId, {
                    type: 'remote-candidate',
                    candidateType: 'relay',
                    protocol: 'udp',
                    address: `198.51.100.${selectedPair}`,
                    port: 3_478,
                }],
            ]);
        }
    }
    const context = vm.createContext({
        RTCPeerConnection: FakePeerConnection,
        Date: FakeDate,
        setInterval: (callback: () => void) => { intervalCallback = callback; return 1; },
        clearInterval: () => { intervalCallback = null; },
    });
    vm.runInContext(buildProductionObserverInjection(), context);
    vm.runInContext('globalThis.__wpMonitorWebRtcProbe.arm()', context);
    vm.runInContext('new globalThis.RTCPeerConnection()', context);
    await new Promise(resolve => setImmediate(resolve));

    assert.ok(intervalCallback);
    (intervalCallback as unknown as () => void)();
    await new Promise(resolve => setImmediate(resolve));
    for (selectedPair = 2; selectedPair <= 17; selectedPair += 1) {
        assert.ok(intervalCallback);
        (intervalCallback as unknown as () => void)();
        await new Promise(resolve => setImmediate(resolve));
    }
    const snapshot = await vm.runInContext(
        'globalThis.__wpMonitorWebRtcProbe.snapshot()',
        context,
    ) as {
        selectedPairs: Array<{
            firstObservedAt: string;
            lastObservedAt: string;
            remote: { address: string };
        }>;
        truncated: boolean;
    };

    assert.equal(snapshot.selectedPairs.length, 16);
    assert.equal(snapshot.truncated, true);
    assert.equal(snapshot.selectedPairs[0]?.remote.address, '198.51.100.1');
    assert.equal(snapshot.selectedPairs[15]?.remote.address, '198.51.100.16');
    assert.notEqual(snapshot.selectedPairs[0]?.firstObservedAt, snapshot.selectedPairs[0]?.lastObservedAt);
    vm.runInContext('globalThis.__wpMonitorWebRtcProbe.disarm()', context);
});

test('production observer accepts CDP only through an HTTP loopback origin', async () => {
    assert.doesNotThrow(() => new WebRtcCdpObserver('http://127.0.0.1:9222'));
    assert.throws(() => new WebRtcCdpObserver('http://0.0.0.0:9222'), /loopback/);
    assert.throws(() => new WebRtcCdpObserver('https://127.0.0.1:9222'), /loopback/);
    assert.throws(() => new WebRtcCdpObserver('http://127.0.0.1:9222/json'), /loopback/);
    assert.throws(() => new WebRtcCdpObserver('http://user:pass@127.0.0.1:9222'), /loopback/);
    assert.throws(() => new WebRtcCdpObserver('http://127.0.0.1:9222/?debug=true'), /loopback/);
    assert.throws(() => new WebRtcCdpObserver('http://127.0.0.1:9222/#debug'), /loopback/);
});

test('readiness keeps one early-document registration per active CDP target', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
    const commands: Array<{ method: string; params: Record<string, unknown> | undefined }> = [];
    let probeInstalled = false;
    let registrationCount = 0;
    let socketCount = 0;
    let targetId = 'whatsapp';

    class FakeWebSocket extends EventTarget {
        static readonly OPEN = 1;
        static readonly CLOSING = 2;
        readyState = 0;

        constructor(_url: string) {
            super();
            socketCount += 1;
            queueMicrotask(() => {
                this.readyState = FakeWebSocket.OPEN;
                this.dispatchEvent(new Event('open'));
            });
        }

        send(data: string) {
            const command = JSON.parse(data) as {
                id: number;
                method: string;
                params?: Record<string, unknown>;
            };
            commands.push({ method: command.method, params: command.params });
            let result: Record<string, unknown> = {};
            if (command.method === 'Page.addScriptToEvaluateOnNewDocument') {
                registrationCount += 1;
                result = { identifier: 'script-1' };
            } else if (command.method === 'Runtime.evaluate') {
                const expression = String(command.params?.expression ?? '');
                if (expression.startsWith('(() => {') && expression.includes('bounded-periodic-stats-v2')) {
                    probeInstalled = true;
                }
                if (expression.startsWith('Boolean(')) {
                    result = { result: { type: 'boolean', value: probeInstalled } };
                } else if (expression === buildDisarmExpression()) {
                    result = { result: { type: 'boolean', value: true } };
                }
            }
            queueMicrotask(() => {
                this.dispatchEvent(new MessageEvent('message', {
                    data: JSON.stringify({ id: command.id, result }),
                }));
            });
        }

        close() {
            this.readyState = 3;
            this.dispatchEvent(new Event('close'));
        }
    }

    const fetchImpl = (async () => {
        const targets = JSON.stringify([{
            type: 'page',
            url: 'https://web.whatsapp.com/',
            webSocketDebuggerUrl: `ws://127.0.0.1:9222/devtools/page/${targetId}`,
        }]);
        return new Response(targets, {
            status: 200,
            headers: { 'content-length': String(Buffer.byteLength(targets, 'utf8')) },
        });
    }) as typeof fetch;

    Object.defineProperty(globalThis, 'WebSocket', {
        configurable: true,
        writable: true,
        value: FakeWebSocket,
    });
    try {
        const observer = new WebRtcCdpObserver('http://127.0.0.1:9222', fetchImpl);
        assert.equal(await observer.ready(), true);
        assert.equal(await observer.ready(), true);
        assert.equal(socketCount, 1);
        assert.equal(registrationCount, 1);
        assert.equal(
            commands.filter(command => command.method === 'Page.addScriptToEvaluateOnNewDocument').length,
            1,
        );

        targetId = 'whatsapp-reloaded';
        assert.equal(await observer.ready(), true);
        assert.equal(await observer.ready(), true);
        assert.equal(socketCount, 2);
        assert.equal(registrationCount, 2);
        await observer.shutdown();
    } finally {
        if (originalDescriptor) Object.defineProperty(globalThis, 'WebSocket', originalDescriptor);
        else Reflect.deleteProperty(globalThis, 'WebSocket');
    }
});

test('production observer prioritizes the WhatsApp page over an unrelated blank page', () => {
    const selected = selectWhatsappCdpTarget([
        { type: 'page', url: 'about:blank', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/blank' },
        { type: 'page', url: 'https://example.test/', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/other' },
        { type: 'page', url: 'https://web.whatsapp.com/', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/whatsapp' },
    ]);
    assert.equal(selected?.url, 'https://web.whatsapp.com/');
});

test('snapshot failure still disarms the browser probe', async () => {
    let disarmCalls = 0;
    const context = {
        __wpMonitorWebRtcProbe: {
            snapshot: async () => { throw new Error('synthetic_snapshot_failure'); },
            disarm: () => { disarmCalls += 1; },
        },
    };
    await assert.rejects(
        vm.runInNewContext(buildSnapshotAndDisarmExpression(), context) as Promise<unknown>,
        /synthetic_snapshot_failure/,
    );
    assert.equal(disarmCalls, 1);
});

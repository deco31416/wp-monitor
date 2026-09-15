import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { buildCheckpointExpression, buildDisarmExpression, buildProductionObserverInjection, WebRtcCdpObserver } from '../src/webrtc-observer-cdp.js';
import { normalizeBrowserWebRtcEvidence } from '../src/call-observation-evidence.js';
import { WebRtcCheckpoints } from '../src/webrtc-checkpoints.js';

const JID = '15555550123@s.whatsapp.net';

async function until(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
        if (Date.now() >= deadline) assert.fail('Synthetic observer condition timed out');
        await new Promise(resolve => setTimeout(resolve, 5));
    }
}

function harness() {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
    const contexts: vm.Context[] = [];
    const deadlines: number[] = [];
    let context: vm.Context;
    let socket: FakeSocket;
    let rearmFails = false;
    let checkpointFails = false;
    let disarmFails = false;
    let checkpointWait: Promise<void> | null = null;
    let checkpointEntered = false;

    function newDocument() {
        class PeerConnection extends EventTarget {
            iceConnectionState = 'connected';
            async getStats() {
                return new Map([
                    ['transport', { type: 'transport', selectedCandidatePairId: 'pair-1' }],
                    ['pair-1', { type: 'candidate-pair', state: 'succeeded', nominated: true,
                        localCandidateId: 'local', remoteCandidateId: 'remote', packetsSent: 25, packetsReceived: 25 }],
                    ['local', { candidateType: 'host', protocol: 'udp', address: '192.0.2.10', port: 50000 }],
                    ['remote', { candidateType: 'srflx', protocol: 'udp', address: '198.51.100.30', port: 40000 }],
                ]);
            }
        }
        context = vm.createContext({ RTCPeerConnection: PeerConnection,
            location: { origin: 'https://web.whatsapp.com' },
            setInterval: () => 1, clearInterval: () => undefined, setTimeout, clearTimeout,
        });
        contexts.push(context);
        vm.runInContext(buildProductionObserverInjection(), context);
    }

    class FakeSocket extends EventTarget {
        static OPEN = 1;
        static CLOSING = 2;
        readyState = 0;
        constructor(_url: string) {
            super(); socket = this;
            queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); });
        }
        send(raw: string) {
            const { id, method, params } = JSON.parse(raw);
            void (async () => {
                try {
                    let result = {};
                    if (method === 'Runtime.evaluate') {
                        const expression = String(params.expression);
                        if (expression === buildDisarmExpression() && disarmFails) throw new Error('synthetic disarm failure');
                        if (expression.includes('?.arm?.(')) {
                            if (rearmFails) throw new Error('synthetic rearm failure');
                            deadlines.push(Number(expression.slice(expression.indexOf(',') + 1, expression.indexOf(')'))));
                        }
                        if (expression === buildCheckpointExpression()) {
                            checkpointEntered = true;
                            if (checkpointWait) await checkpointWait;
                            if (checkpointFails) throw new Error('synthetic checkpoint failure');
                        }
                        const value = await vm.runInContext(expression, context);
                        result = { result: { value } };
                    }
                    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id, result }) }));
                } catch {
                    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id, error: { code: -32000 } }) }));
                }
            })();
        }
        event(method: string, params = {}) {
            this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ method, params }) }));
        }
        close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
    }
    newDocument();
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: FakeSocket });
    const fetchImpl = (async () => new Response(JSON.stringify([{
        type: 'page', url: 'https://web.whatsapp.com/', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/synthetic',
    }]))) as typeof fetch;
    const observer = new WebRtcCdpObserver('http://127.0.0.1:9222', fetchImpl, Date.now, 20);
    return {
        observer, deadlines,
        createPeer: () => vm.runInContext('new RTCPeerConnection()', context),
        navigate: () => {
            vm.runInContext('__wpMonitorWebRtcProbe.disarm()', context);
            socket.event('Runtime.executionContextsCleared');
            newDocument();
            socket.event('Page.frameNavigated', { frame: { id: 'main' } });
            socket.event('Runtime.executionContextCreated');
        },
        setRearmFailure: () => { rearmFails = true; },
        setCheckpointFailure: () => { checkpointFails = true; },
        setDisarmFailure: (value: boolean) => { disarmFails = value; },
        blockCheckpoint: () => {
            checkpointEntered = false;
            let release!: () => void;
            checkpointWait = new Promise<void>(resolve => { release = resolve; });
            return release;
        },
        checkpointEntered: () => checkpointEntered,
        disconnect: () => socket.close(),
        setForeignOrigin: () => { context.location.origin = 'https://unrelated.example'; },
        async cleanup() {
            await observer.shutdown();
            for (const item of contexts) vm.runInContext('__wpMonitorWebRtcProbe.disarm()', item);
            if (original) Object.defineProperty(globalThis, 'WebSocket', original);
        },
    };
}

test('checkpoints survive navigation, preserve pairs from both generations and do not double-count polling', async () => {
    const h = harness();
    try {
        await h.observer.start('CALL-NAV-001', JID, 10000);
        h.createPeer();
        assert.equal(await h.observer.ready(), true);
        assert.equal(await h.observer.ready(), true);
        h.navigate();
        assert.equal(h.observer.status().instrumentationActive, false);
        await until(() => h.observer.status().instrumentationActive);
        h.createPeer();
        assert.equal(await h.observer.ready(), true);
        const evidence = await h.observer.stop('CALL-NAV-001');
        assert.equal(evidence.connectionCount, 2);
        assert.equal(evidence.selectedPairs.length, 2);
        assert.deepEqual(evidence.selectedPairs.map(pair => pair.peerConnectionId), ['g1-pc-1', 'g2-pc-1']);
        assert.ok(evidence.limitations.includes('browser_context_replaced'));
        assert.deepEqual(normalizeBrowserWebRtcEvidence(evidence), evidence);
        assert.deepEqual(await h.observer.stop('CALL-NAV-001'), evidence);
        assert.equal(new Set(h.deadlines).size, 1);
        assert.equal(h.observer.status().active, false);
        for (const id of ['CALL-NAV-002', 'CALL-NAV-003']) {
            await h.observer.start(id, JID, 10000);
            const next = await h.observer.stop(id);
            assert.equal(next.connectionCount, 0);
            assert.equal(next.selectedPairs.length, 0);
        }
    } finally { await h.cleanup(); }
});

test('failed rearm exposes interrupted instrumentation and preserves earlier checkpoints', async () => {
    const h = harness();
    try {
        await h.observer.start('CALL-REARM-001', JID, 10000);
        h.createPeer(); await h.observer.ready();
        h.setRearmFailure(); h.navigate();
        assert.equal(await h.observer.ready(), false);
        assert.equal(h.observer.status().active, true);
        assert.equal(h.observer.status().instrumentationActive, false);
        const evidence = await h.observer.stop('CALL-REARM-001');
        assert.equal(evidence.connectionCount, 1);
        assert.ok(evidence.limitations.includes('browser_observation_interrupted'));
    } finally { await h.cleanup(); }
});

test('final checkpoint failure retains data instead of returning an empty available window', async () => {
    const h = harness();
    try {
        await h.observer.start('CALL-CHECKPOINT-001', JID, 10000);
        h.createPeer(); await h.observer.ready(); h.setCheckpointFailure();
        const evidence = await h.observer.stop('CALL-CHECKPOINT-001');
        assert.equal(evidence.connectionCount, 1);
        assert.ok(evidence.limitations.includes('browser_final_checkpoint_unavailable'));
    } finally { await h.cleanup(); }
});

test('navigation racing with stop cannot rearm after closure', async () => {
    const h = harness();
    try {
        await h.observer.start('CALL-RACE-001', JID, 10000);
        h.createPeer(); await h.observer.ready();
        const release = h.blockCheckpoint();
        const reading = h.observer.ready();
        await until(h.checkpointEntered);
        h.navigate();
        const stopping = h.observer.stop('CALL-RACE-001');
        release();
        await reading; await stopping;
        await new Promise(resolve => setTimeout(resolve, 40));
        assert.equal(h.deadlines.length, 1);
        assert.equal(h.observer.status().active, false);
    } finally { await h.cleanup(); }
});

test('disconnect marks instrumentation unavailable and subsequent recovery retains scope deadline', async () => {
    const h = harness();
    try {
        await h.observer.start('CALL-CDP-001', JID, 10000);
        h.createPeer(); await h.observer.ready(); h.disconnect();
        assert.equal(h.observer.status().instrumentationActive, false);
        assert.equal(await h.observer.ready(), true);
        const evidence = await h.observer.stop('CALL-CDP-001');
        assert.equal(evidence.connectionCount, 1);
        assert.ok(evidence.limitations.includes('browser_cdp_disconnected'));
        assert.equal(new Set(h.deadlines).size, 1);
    } finally { await h.cleanup(); }
});

test('foreign document is not rearmed within the authorized scope', async () => {
    const h = harness();
    try {
        await h.observer.start('CALL-ORIGIN-001', JID, 10000);
        h.navigate(); h.setForeignOrigin();
        assert.equal(await h.observer.ready(), false);
        assert.equal(h.deadlines.length, 1);
        await h.observer.stop('CALL-ORIGIN-001');
    } finally { await h.cleanup(); }
});

test('checkpoint book bounds generations and aggregate evidence with explicit truncation', () => {
    const book = new WebRtcCheckpoints();
    for (let generation = 1; generation <= 20; generation++) book.save(generation, {
        version: 1, status: 'available', startedAt: new Date(0), endedAt: new Date(1),
        connectionCount: 3, selectedPairs: [], stateTransitions: [], truncated: false, limitations: [],
    });
    const evidence = book.finish(new Date(0), new Date(2));
    assert.equal(evidence.connectionCount, 32);
    assert.equal(evidence.truncated, true);
    assert.ok(evidence.limitations.includes('browser_checkpoint_limit_reached'));
    assert.ok(normalizeBrowserWebRtcEvidence(evidence));
});

test('TTL after navigation closes the scope and never renews its deadline', async () => {
    const h = harness();
    try {
        await h.observer.start('CALL-NAV-TTL', JID, 750);
        h.createPeer(); await h.observer.ready(); h.navigate();
        await until(() => h.observer.status().instrumentationActive);
        await until(() => !h.observer.status().active);
        const evidence = await h.observer.stop('CALL-NAV-TTL');
        assert.equal(evidence.connectionCount, 1);
        assert.ok(evidence.limitations.includes('browser_webrtc_observer_ttl_expired'));
        const arms = h.deadlines.length;
        h.navigate(); await new Promise(resolve => setTimeout(resolve, 40));
        assert.equal(h.deadlines.length, arms);
        assert.equal(new Set(h.deadlines).size, 1);
    } finally { await h.cleanup(); }
});

test('unverified disarm retains scope ownership until retry succeeds, without rearming', async () => {
    const h = harness();
    try {
        await h.observer.start('CALL-DISARM-001', JID, 10000);
        h.createPeer(); await h.observer.ready(); h.setDisarmFailure(true);
        await assert.rejects(h.observer.stop('CALL-DISARM-001'), /webrtc_probe_disarm_unverified/);
        assert.equal(h.observer.status().active, true);
        assert.equal(h.observer.status().instrumentationActive, false);
        await assert.rejects(h.observer.start('CALL-DISARM-002', JID, 10000), /observer_already_active/);
        assert.equal(await h.observer.ready(), false);
        h.setDisarmFailure(false);
        const evidence = await h.observer.stop('CALL-DISARM-001');
        assert.equal(evidence.connectionCount, 1);
        assert.ok(evidence.limitations.includes('browser_probe_disarm_unverified'));
        assert.equal(h.observer.status().active, false);
        assert.equal(h.deadlines.length, 1);
        assert.deepEqual(await h.observer.stop('CALL-DISARM-001'), evidence);
    } finally { h.setDisarmFailure(false); await h.cleanup(); }
});

test('checkpoint timeout degrades instrumentation and a later stop retains prior evidence', async () => {
    const h = harness();
    let release: () => void = () => undefined;
    try {
        await h.observer.start('CALL-TIMEOUT-001', JID, 20000);
        h.createPeer(); await h.observer.ready();
        release = h.blockCheckpoint();
        assert.equal(await h.observer.ready(), false);
        assert.equal(h.observer.status().instrumentationActive, false);
        const stopping = h.observer.stop('CALL-TIMEOUT-001');
        release();
        const evidence = await stopping;
        assert.equal(evidence.connectionCount, 1);
        assert.ok(evidence.limitations.includes('browser_observation_interrupted'));
        assert.equal(h.observer.status().active, false);
    } finally { release(); await h.cleanup(); }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
    buildDisarmExpression,
    buildProductionObserverInjection,
    buildSnapshotAndDisarmExpression,
    selectWhatsappCdpTarget,
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
    assert.doesNotMatch(source, /createOffer/);
    assert.doesNotMatch(source, /createAnswer/);
    assert.doesNotMatch(source, /localDescription/);
    assert.doesNotMatch(source, /remoteDescription/);
    assert.doesNotMatch(source, /sessionDescription/);
    assert.doesNotMatch(source, /message|audio|mediaStream/i);
});

test('production WebRTC probe removes per-connection listeners when disarmed', () => {
    let attached = 0;
    let removed = 0;
    class FakePeerConnection {
        iceConnectionState = 'new';
        addEventListener() { attached += 1; }
        removeEventListener() { removed += 1; }
    }
    const context = vm.createContext({ RTCPeerConnection: FakePeerConnection });
    vm.runInContext(buildProductionObserverInjection(), context);
    vm.runInContext('globalThis.__wpMonitorWebRtcProbe.arm()', context);
    vm.runInContext('new globalThis.RTCPeerConnection()', context);
    assert.equal(attached, 1);
    vm.runInContext('globalThis.__wpMonitorWebRtcProbe.disarm()', context);
    assert.equal(removed, 1);
});

test('production observer accepts CDP only through an HTTP loopback origin', async () => {
    const { WebRtcCdpObserver } = await import('../src/webrtc-observer-cdp.js');
    assert.doesNotThrow(() => new WebRtcCdpObserver('http://127.0.0.1:9222'));
    assert.throws(() => new WebRtcCdpObserver('http://0.0.0.0:9222'), /loopback/);
    assert.throws(() => new WebRtcCdpObserver('https://127.0.0.1:9222'), /loopback/);
    assert.throws(() => new WebRtcCdpObserver('http://127.0.0.1:9222/json'), /loopback/);
    assert.throws(() => new WebRtcCdpObserver('http://user:pass@127.0.0.1:9222'), /loopback/);
    assert.throws(() => new WebRtcCdpObserver('http://127.0.0.1:9222/?debug=true'), /loopback/);
    assert.throws(() => new WebRtcCdpObserver('http://127.0.0.1:9222/#debug'), /loopback/);
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

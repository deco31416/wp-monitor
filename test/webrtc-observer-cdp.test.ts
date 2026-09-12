import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProductionObserverInjection } from '../src/webrtc-observer-cdp.js';

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

test('production observer accepts CDP only through an HTTP loopback origin', async () => {
    const { WebRtcCdpObserver } = await import('../src/webrtc-observer-cdp.js');
    assert.doesNotThrow(() => new WebRtcCdpObserver('http://127.0.0.1:9222'));
    assert.throws(() => new WebRtcCdpObserver('http://0.0.0.0:9222'), /loopback/);
    assert.throws(() => new WebRtcCdpObserver('https://127.0.0.1:9222'), /loopback/);
    assert.throws(() => new WebRtcCdpObserver('http://127.0.0.1:9222/json'), /loopback/);
});

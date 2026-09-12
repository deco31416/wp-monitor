import test from 'node:test';
import assert from 'node:assert/strict';
import { buildObserverInjection, processExited, sanitizeWebRtcSnapshot } from '../scripts/poc/webrtc-cdp.mjs';

test('sanitizes selected WebRTC candidate pairs without retaining raw addresses or extra fields', () => {
    const result = sanitizeWebRtcSnapshot({
        connectionCount: 2,
        selectedPairs: [{
            state: 'succeeded',
            nominated: true,
            selected: true,
            packetsSent: 5,
            packetsReceived: 4,
            bytesSent: 100,
            bytesReceived: 80,
            currentRoundTripTime: 0.01,
            local: {
                candidateType: 'host',
                protocol: 'udp',
                address: '192.0.2.10',
                port: 50_000,
                sdp: 'must-not-survive',
            },
            remote: {
                candidateType: 'srflx',
                protocol: 'udp',
                address: '198.51.100.20',
                port: 50_001,
                url: 'turn:secret.invalid',
            },
        }],
        sessionDescription: 'must-not-survive',
    });

    assert.equal(result.connectionCount, 2);
    assert.equal(result.selectedPairCount, 1);
    assert.deepEqual(result.selectedPairs[0].local, {
        candidateType: 'host',
        protocol: 'udp',
        relayProtocol: 'unavailable',
        addressExposed: true,
        addressFamily: 'ipv4',
        addressScope: 'documentation',
        portExposed: true,
    });
    assert.equal(result.selectedPairs[0].remote.candidateType, 'srflx');
    assert.equal(result.rawAddressesRetained, false);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('192.0.2.10'), false);
    assert.equal(serialized.includes('198.51.100.20'), false);
    assert.equal(serialized.includes('must-not-survive'), false);
    assert.equal(serialized.includes('turn:secret.invalid'), false);
});

test('bounds collections and fails closed for unknown candidate metadata', () => {
    const selectedPairs = Array.from({ length: 20 }, () => ({
        state: 'invented',
        local: { candidateType: 'invented', protocol: 'sctp', address: 'not-an-ip', port: 100_000 },
        remote: null,
    }));
    const result = sanitizeWebRtcSnapshot({ connectionCount: 100, selectedPairs });

    assert.equal(result.connectionCount, 32);
    assert.equal(result.selectedPairCount, 8);
    assert.equal(result.selectedPairs.length, 8);
    assert.equal(result.selectedPairs[0].state, 'unknown');
    assert.deepEqual(result.selectedPairs[0].local, {
        candidateType: 'unknown',
        protocol: 'unknown',
        relayProtocol: 'unavailable',
        addressExposed: false,
        addressFamily: 'unknown',
        addressScope: 'unknown',
        portExposed: false,
    });
});

test('builds an early injection that observes peer connections through getStats only', () => {
    const source = buildObserverInjection();
    assert.match(source, /RTCPeerConnection/);
    assert.match(source, /getStats/);
    assert.match(source, /selectedCandidatePairId/);
    assert.doesNotMatch(source, /localDescription/);
    assert.doesNotMatch(source, /remoteDescription/);
    assert.doesNotMatch(source, /getUserMedia/);
});

test('treats signal termination as a completed Chrome exit', () => {
    assert.equal(processExited({ exitCode: null, signalCode: 'SIGTERM' }), true);
    assert.equal(processExited({ exitCode: 0, signalCode: null }), true);
    assert.equal(processExited({ exitCode: null, signalCode: null }), false);
});

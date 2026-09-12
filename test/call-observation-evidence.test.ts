import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildCallFlowEvidence,
    buildStunTurnEvidence,
    normalizeBrowserWebRtcEvidence,
    normalizeCallFlowEvidence,
    type ObservedCallPacketMetadata,
} from '../src/call-observation-evidence.js';
import type { ParsedStunMessage } from '../src/stun-parser.js';

const localIp = '192.168.1.10';
const remoteIp = '203.0.113.20';

function packet(overrides: Partial<ObservedCallPacketMetadata> = {}): ObservedCallPacketMetadata {
    return {
        timestamp: new Date('2026-09-11T12:00:00.000Z'),
        srcIp: localIp,
        dstIp: remoteIp,
        srcPort: 50_000,
        dstPort: 34_78,
        protocol: 17,
        addressFamily: 4,
        length: 120,
        protocolEvidence: ['transport_flow'],
        stun: null,
        turnChannelData: null,
        ...overrides,
    };
}

test('five-tuple book reconciles bidirectional packets and declares bounds', () => {
    const evidence = buildCallFlowEvidence([
        packet(),
        packet({
            timestamp: new Date('2026-09-11T12:00:01.000Z'),
            srcIp: remoteIp,
            dstIp: localIp,
            srcPort: 34_78,
            dstPort: 50_000,
            length: 180,
        }),
        packet({ dstIp: '198.51.100.9', dstPort: 4_000 }),
    ], ip => ip === localIp, undefined, 1);
    assert.equal(evidence.storedFlows, 1);
    assert.equal(evidence.droppedPackets, 1);
    assert.equal(evidence.truncated, true);
    assert.equal(evidence.flows[0]?.direction, 'bidirectional');
    assert.equal(evidence.flows[0]?.packets, 2);
    assert.equal(evidence.flows[0]?.bytesTotal, 300);
    assert.deepEqual(normalizeCallFlowEvidence(JSON.parse(JSON.stringify(evidence))), evidence);
});

test('STUN transactions pair by opaque fingerprint and TURN data requires observed channel bind', () => {
    const stun = (messageClass: ParsedStunMessage['messageClass']): ParsedStunMessage => ({
        messageClass,
        method: 'channel_bind',
        methodCode: 9,
        messageType: 9,
        transactionFingerprint: 'a'.repeat(64),
        endpoints: [{
            ip: remoteIp,
            port: 34_78,
            addressFamily: 4,
            role: 'peer_candidate',
            attribute: 'xor_peer_address',
        }],
        attributeCount: 3,
        ignoredAttributeCount: 0,
        unknownAttributeCount: 0,
        protocolEvidence: 'stun_other',
        useCandidate: true,
        iceRole: 'controlling',
        channelNumber: 0x4001,
        limitations: [],
    });
    const evidence = buildStunTurnEvidence([
        packet({ stun: stun('request') }),
        packet({
            timestamp: new Date('2026-09-11T12:00:00.050Z'),
            srcIp: remoteIp,
            dstIp: localIp,
            srcPort: 34_78,
            dstPort: 50_000,
            stun: { ...stun('success_response'), iceRole: 'unknown', channelNumber: null },
        }),
        packet({
            timestamp: new Date('2026-09-11T12:00:00.100Z'),
            turnChannelData: { channelNumber: 0x4001, payloadLength: 96 },
        }),
    ], ip => ip === localIp);
    assert.equal(evidence.transactions.length, 1);
    assert.equal(evidence.transactions[0]?.requestObserved, true);
    assert.equal(evidence.transactions[0]?.successResponseObserved, true);
    assert.equal(evidence.transactions[0]?.iceRole, 'controlling');
    assert.equal(evidence.transactions[0]?.channelNumber, 0x4001);
    assert.equal(evidence.channels[0]?.packets, 1);
    assert.equal(evidence.channels[0]?.bytesTotal, 96);
});

test('STUN request and response correlation is stable when observations arrive out of timestamp order', () => {
    const base: ParsedStunMessage = {
        messageClass: 'success_response',
        method: 'binding',
        methodCode: 1,
        messageType: 0x0101,
        transactionFingerprint: 'b'.repeat(64),
        endpoints: [],
        attributeCount: 0,
        ignoredAttributeCount: 0,
        unknownAttributeCount: 0,
        protocolEvidence: 'stun_binding_response',
        useCandidate: false,
        iceRole: 'unknown',
        channelNumber: null,
        limitations: [],
    };
    const evidence = buildStunTurnEvidence([
        packet({
            timestamp: new Date('2026-09-11T12:00:02.000Z'),
            srcIp: remoteIp,
            dstIp: localIp,
            stun: base,
        }),
        packet({
            timestamp: new Date('2026-09-11T12:00:01.000Z'),
            stun: { ...base, messageClass: 'request', protocolEvidence: 'stun_binding_request', iceRole: 'controlled' },
        }),
    ], ip => ip === localIp);

    assert.equal(evidence.transactions[0]?.requestObserved, true);
    assert.equal(evidence.transactions[0]?.successResponseObserved, true);
    assert.equal(evidence.transactions[0]?.iceRole, 'controlled');
    assert.equal(evidence.transactions[0]?.firstObservedAt.toISOString(), '2026-09-11T12:00:01.000Z');
    assert.equal(evidence.transactions[0]?.lastObservedAt.toISOString(), '2026-09-11T12:00:02.000Z');
});

test('stored browser evidence fails closed without retaining SDP or arbitrary fields', () => {
    const evidence = normalizeBrowserWebRtcEvidence({
        version: 1,
        status: 'available',
        startedAt: '2026-09-11T12:00:00.000Z',
        endedAt: '2026-09-11T12:01:00.000Z',
        connectionCount: 1,
        selectedPairs: [{
            peerConnectionId: 'pc-1',
            state: 'succeeded',
            nominated: true,
            selected: true,
            firstObservedAt: '2026-09-11T12:00:10.000Z',
            lastObservedAt: '2026-09-11T12:00:50.000Z',
            local: { candidateType: 'host', protocol: 'udp', address: localIp, port: 50_000, sdp: 'secret' },
            remote: { candidateType: 'srflx', protocol: 'udp', address: remoteIp, port: 34_78, url: 'turn:secret' },
            packetsSent: 10,
            packetsReceived: 12,
            bytesSent: 1_000,
            bytesReceived: 1_200,
            currentRoundTripTimeMs: 20,
        }],
        stateTransitions: [],
        truncated: false,
        limitations: [],
        sdp: 'must-not-survive',
    });
    assert.ok(evidence);
    assert.equal(JSON.stringify(evidence).includes('secret'), false);
    assert.equal(evidence.selectedPairs[0]?.remote.address, remoteIp);
    assert.equal(normalizeCallFlowEvidence({ version: 1, flowLimit: 1, storedFlows: 1, droppedPackets: 0, flows: [{}] }), undefined);
});

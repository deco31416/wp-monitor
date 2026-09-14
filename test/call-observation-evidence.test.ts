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

test('TURN channel numbers stay isolated between allocation transport tuples', () => {
    const channelBind = (
        transactionFingerprint: string,
        peerIp: string,
        peerPort: number,
    ): ParsedStunMessage => ({
        messageClass: 'request',
        method: 'channel_bind',
        methodCode: 9,
        messageType: 9,
        transactionFingerprint,
        endpoints: [{
            ip: peerIp,
            port: peerPort,
            addressFamily: 4,
            role: 'peer_candidate',
            attribute: 'xor_peer_address',
        }],
        attributeCount: 2,
        ignoredAttributeCount: 0,
        unknownAttributeCount: 0,
        protocolEvidence: 'stun_other',
        useCandidate: false,
        iceRole: 'unknown',
        channelNumber: 0x4001,
        limitations: [],
    });
    const alternateTurnServer = '203.0.113.21';
    const evidence = buildStunTurnEvidence([
        packet({
            stun: channelBind('1'.repeat(64), '198.51.100.10', 40_000),
        }),
        packet({
            timestamp: new Date('2026-09-11T12:00:00.100Z'),
            turnChannelData: { channelNumber: 0x4001, payloadLength: 80 },
        }),
        packet({
            timestamp: new Date('2026-09-11T12:00:01.000Z'),
            srcPort: 50_001,
            dstIp: alternateTurnServer,
            stun: channelBind('2'.repeat(64), '198.51.100.11', 40_001),
        }),
        packet({
            timestamp: new Date('2026-09-11T12:00:01.100Z'),
            srcIp: alternateTurnServer,
            dstIp: localIp,
            srcPort: 34_78,
            dstPort: 50_001,
            turnChannelData: { channelNumber: 0x4001, payloadLength: 120 },
        }),
    ], ip => ip === localIp);

    assert.equal(evidence.channels.length, 2);
    assert.deepEqual(evidence.channels.map(channel => ({
        peerEndpointKey: channel.peerEndpointKey,
        packets: channel.packets,
        bytesTotal: channel.bytesTotal,
    })), [
        { peerEndpointKey: '198.51.100.10:40000', packets: 1, bytesTotal: 80 },
        { peerEndpointKey: '198.51.100.11:40001', packets: 1, bytesTotal: 120 },
    ]);
});

test('TURN ChannelData cannot inherit a channel binding from another allocation', () => {
    const bind: ParsedStunMessage = {
        messageClass: 'request',
        method: 'channel_bind',
        methodCode: 9,
        messageType: 9,
        transactionFingerprint: '3'.repeat(64),
        endpoints: [{
            ip: '198.51.100.12',
            port: 40_002,
            addressFamily: 4,
            role: 'peer_candidate',
            attribute: 'xor_peer_address',
        }],
        attributeCount: 2,
        ignoredAttributeCount: 0,
        unknownAttributeCount: 0,
        protocolEvidence: 'stun_other',
        useCandidate: false,
        iceRole: 'unknown',
        channelNumber: 0x4002,
        limitations: [],
    };
    const evidence = buildStunTurnEvidence([
        packet({ stun: bind }),
        packet({
            timestamp: new Date('2026-09-11T12:00:00.100Z'),
            turnChannelData: { channelNumber: 0x4002, payloadLength: 64 },
        }),
        packet({
            timestamp: new Date('2026-09-11T12:00:00.200Z'),
            srcPort: 50_001,
            dstIp: '203.0.113.21',
            turnChannelData: { channelNumber: 0x4002, payloadLength: 256 },
        }),
    ], ip => ip === localIp);

    assert.equal(evidence.channels.length, 1);
    assert.equal(evidence.channels[0]?.packets, 1);
    assert.equal(evidence.channels[0]?.bytesTotal, 64);
    assert.ok(evidence.limitations.includes('turn_channel_data_without_observed_channel_bind'));
});

test('TURN channel correlation separates transport protocols and IPv6 allocations', () => {
    const bind = (
        transactionFingerprint: string,
        peerIp: string,
        addressFamily: 4 | 6,
    ): ParsedStunMessage => ({
        messageClass: 'request',
        method: 'channel_bind',
        methodCode: 9,
        messageType: 9,
        transactionFingerprint,
        endpoints: [{
            ip: peerIp,
            port: 40_003,
            addressFamily,
            role: 'peer_candidate',
            attribute: 'xor_peer_address',
        }],
        attributeCount: 2,
        ignoredAttributeCount: 0,
        unknownAttributeCount: 0,
        protocolEvidence: 'stun_other',
        useCandidate: false,
        iceRole: 'unknown',
        channelNumber: 0x4003,
        limitations: [],
    });
    const localIpv6 = '2001:db8::10';
    const turnIpv6 = '2001:db8::20';
    const peerIpv6 = '2001:db8::30';
    const evidence = buildStunTurnEvidence([
        packet({ stun: bind('4'.repeat(64), '198.51.100.13', 4) }),
        packet({
            timestamp: new Date('2026-09-11T12:00:00.100Z'),
            turnChannelData: { channelNumber: 0x4003, payloadLength: 40 },
        }),
        packet({
            timestamp: new Date('2026-09-11T12:00:00.200Z'),
            protocol: 6,
            stun: bind('5'.repeat(64), '198.51.100.14', 4),
        }),
        packet({
            timestamp: new Date('2026-09-11T12:00:00.300Z'),
            protocol: 6,
            turnChannelData: { channelNumber: 0x4003, payloadLength: 50 },
        }),
        packet({
            timestamp: new Date('2026-09-11T12:00:00.400Z'),
            srcIp: localIpv6,
            dstIp: turnIpv6,
            addressFamily: 6,
            stun: bind('6'.repeat(64), peerIpv6, 6),
        }),
        packet({
            timestamp: new Date('2026-09-11T12:00:00.500Z'),
            srcIp: turnIpv6,
            dstIp: localIpv6,
            srcPort: 34_78,
            dstPort: 50_000,
            addressFamily: 6,
            turnChannelData: { channelNumber: 0x4003, payloadLength: 60 },
        }),
    ], ip => ip === localIp || ip === localIpv6);

    assert.deepEqual(evidence.channels.map(channel => ({
        peerEndpointKey: channel.peerEndpointKey,
        packets: channel.packets,
        bytesTotal: channel.bytesTotal,
    })), [
        { peerEndpointKey: '198.51.100.13:40003', packets: 1, bytesTotal: 40 },
        { peerEndpointKey: '198.51.100.14:40003', packets: 1, bytesTotal: 50 },
        { peerEndpointKey: '2001:db8::30:40003', packets: 1, bytesTotal: 60 },
    ]);
});

test('TURN channel reuse for a different peer creates separate bounded evidence', () => {
    const bind = (fingerprint: string, peerIp: string): ParsedStunMessage => ({
        messageClass: 'request',
        method: 'channel_bind',
        methodCode: 9,
        messageType: 9,
        transactionFingerprint: fingerprint,
        endpoints: [{
            ip: peerIp,
            port: 40_004,
            addressFamily: 4,
            role: 'peer_candidate',
            attribute: 'xor_peer_address',
        }],
        attributeCount: 2,
        ignoredAttributeCount: 0,
        unknownAttributeCount: 0,
        protocolEvidence: 'stun_other',
        useCandidate: false,
        iceRole: 'unknown',
        channelNumber: 0x4004,
        limitations: [],
    });
    const evidence = buildStunTurnEvidence([
        packet({ stun: bind('7'.repeat(64), '198.51.100.15') }),
        packet({
            timestamp: new Date('2026-09-11T12:00:00.100Z'),
            turnChannelData: { channelNumber: 0x4004, payloadLength: 70 },
        }),
        packet({
            timestamp: new Date('2026-09-11T12:15:00.000Z'),
            stun: bind('8'.repeat(64), '198.51.100.16'),
        }),
        packet({
            timestamp: new Date('2026-09-11T12:15:00.100Z'),
            turnChannelData: { channelNumber: 0x4004, payloadLength: 90 },
        }),
    ], ip => ip === localIp);

    assert.deepEqual(evidence.channels.map(channel => ({
        peerEndpointKey: channel.peerEndpointKey,
        packets: channel.packets,
        bytesTotal: channel.bytesTotal,
    })), [
        { peerEndpointKey: '198.51.100.15:40004', packets: 1, bytesTotal: 70 },
        { peerEndpointKey: '198.51.100.16:40004', packets: 1, bytesTotal: 90 },
    ]);
});

test('TURN channel bindings expire after ten minutes and ChannelData does not refresh them', () => {
    const bind: ParsedStunMessage = {
        messageClass: 'request',
        method: 'channel_bind',
        methodCode: 9,
        messageType: 9,
        transactionFingerprint: '9'.repeat(64),
        endpoints: [{
            ip: '198.51.100.17',
            port: 40_005,
            addressFamily: 4,
            role: 'peer_candidate',
            attribute: 'xor_peer_address',
        }],
        attributeCount: 2,
        ignoredAttributeCount: 0,
        unknownAttributeCount: 0,
        protocolEvidence: 'stun_other',
        useCandidate: false,
        iceRole: 'unknown',
        channelNumber: 0x4005,
        limitations: [],
    };
    const evidence = buildStunTurnEvidence([
        packet({ stun: bind }),
        packet({
            timestamp: new Date('2026-09-11T12:09:00.000Z'),
            turnChannelData: { channelNumber: 0x4005, payloadLength: 100 },
        }),
        packet({
            timestamp: new Date('2026-09-11T12:10:00.001Z'),
            turnChannelData: { channelNumber: 0x4005, payloadLength: 200 },
        }),
    ], ip => ip === localIp);

    assert.equal(evidence.channels.length, 1);
    assert.equal(evidence.channels[0]?.packets, 1);
    assert.equal(evidence.channels[0]?.bytesTotal, 100);
    assert.ok(evidence.limitations.includes('turn_channel_data_without_observed_channel_bind'));
});

test('TURN channel evidence declares its bounded-memory limit', () => {
    const packets: ObservedCallPacketMetadata[] = [];
    for (let index = 0; index < 65; index += 1) {
        const channelNumber = 0x4000 + index;
        packets.push(packet({
            timestamp: new Date(index * 2),
            stun: {
                messageClass: 'request',
                method: 'channel_bind',
                methodCode: 9,
                messageType: 9,
                transactionFingerprint: index.toString(16).padStart(64, '0'),
                endpoints: [{
                    ip: `198.51.100.${index + 1}`,
                    port: 40_000 + index,
                    addressFamily: 4,
                    role: 'peer_candidate',
                    attribute: 'xor_peer_address',
                }],
                attributeCount: 2,
                ignoredAttributeCount: 0,
                unknownAttributeCount: 0,
                protocolEvidence: 'stun_other',
                useCandidate: false,
                iceRole: 'unknown',
                channelNumber,
                limitations: [],
            },
        }));
        packets.push(packet({
            timestamp: new Date((index * 2) + 1),
            turnChannelData: { channelNumber, payloadLength: 100 },
        }));
    }
    const evidence = buildStunTurnEvidence(packets, ip => ip === localIp);

    assert.equal(evidence.channels.length, 64);
    assert.ok(evidence.limitations.includes('turn_channel_limit_reached'));
});

test('TURN channel bindings are bounded even before ChannelData is observed', () => {
    const packets: ObservedCallPacketMetadata[] = [];
    for (let index = 0; index < 65; index += 1) {
        const channelNumber = 0x4000 + index;
        packets.push(packet({
            timestamp: new Date(index),
            stun: {
                messageClass: 'request',
                method: 'channel_bind',
                methodCode: 9,
                messageType: 9,
                transactionFingerprint: index.toString(16).padStart(64, '0'),
                endpoints: [{
                    ip: `198.51.100.${index + 1}`,
                    port: 41_000 + index,
                    addressFamily: 4,
                    role: 'peer_candidate',
                    attribute: 'xor_peer_address',
                }],
                attributeCount: 2,
                ignoredAttributeCount: 0,
                unknownAttributeCount: 0,
                protocolEvidence: 'stun_other',
                useCandidate: false,
                iceRole: 'unknown',
                channelNumber,
                limitations: [],
            },
        }));
    }
    packets.push(packet({
        timestamp: new Date(100),
        turnChannelData: { channelNumber: 0x4040, payloadLength: 100 },
    }));

    const evidence = buildStunTurnEvidence(packets, ip => ip === localIp);

    assert.equal(evidence.channels.length, 0);
    assert.ok(evidence.limitations.includes('turn_channel_limit_reached'));
    assert.ok(evidence.limitations.includes('turn_channel_data_without_observed_channel_bind'));
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
            srcPort: 34_78,
            dstPort: 50_000,
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

test('STUN transactions with the same fingerprint stay isolated by transport tuple', () => {
    const alternateLocalIp = '192.168.1.11';
    const base: ParsedStunMessage = {
        messageClass: 'request',
        method: 'binding',
        methodCode: 1,
        messageType: 0x0001,
        transactionFingerprint: 'c'.repeat(64),
        endpoints: [],
        attributeCount: 0,
        ignoredAttributeCount: 0,
        unknownAttributeCount: 0,
        protocolEvidence: 'stun_binding_request',
        useCandidate: false,
        iceRole: 'unknown',
        channelNumber: null,
        limitations: [],
    };
    const evidence = buildStunTurnEvidence([
        packet({ stun: base }),
        packet({
            timestamp: new Date('2026-09-11T12:00:00.050Z'),
            srcIp: '198.51.100.40',
            dstIp: localIp,
            srcPort: 4_500,
            dstPort: 50_000,
            stun: { ...base, messageClass: 'success_response', messageType: 0x0101 },
        }),
        packet({
            timestamp: new Date('2026-09-11T12:00:00.100Z'),
            srcIp: remoteIp,
            dstIp: alternateLocalIp,
            srcPort: 34_78,
            dstPort: 50_000,
            stun: { ...base, messageClass: 'success_response', messageType: 0x0101 },
        }),
    ], ip => ip === localIp || ip === alternateLocalIp);

    assert.equal(evidence.transactions.length, 3);
    assert.equal(evidence.transactions.some(item => item.requestObserved && item.successResponseObserved), false);
});

test('STUN fingerprint reuse on the same tuple starts a new transaction after 39.5 seconds', () => {
    const base: ParsedStunMessage = {
        messageClass: 'request',
        method: 'binding',
        methodCode: 1,
        messageType: 0x0001,
        transactionFingerprint: 'd'.repeat(64),
        endpoints: [],
        attributeCount: 0,
        ignoredAttributeCount: 0,
        unknownAttributeCount: 0,
        protocolEvidence: 'stun_binding_request',
        useCandidate: false,
        iceRole: 'unknown',
        channelNumber: null,
        limitations: [],
    };
    const evidence = buildStunTurnEvidence([
        packet({
            timestamp: new Date('2026-09-11T12:00:39.500Z'),
            srcIp: remoteIp,
            dstIp: localIp,
            srcPort: 34_78,
            dstPort: 50_000,
            stun: { ...base, messageClass: 'success_response', messageType: 0x0101 },
        }),
        packet({
            timestamp: new Date('2026-09-11T12:00:39.501Z'),
            stun: base,
        }),
        packet({ stun: base }),
    ], ip => ip === localIp);

    assert.equal(evidence.transactions.length, 2);
    assert.equal(evidence.transactions[0]?.requestObserved, true);
    assert.equal(evidence.transactions[0]?.successResponseObserved, true);
    assert.equal(evidence.transactions[1]?.requestObserved, true);
    assert.equal(evidence.transactions[1]?.successResponseObserved, false);
});

test('STUN transaction limits count dropped windows without fixed-bucket duplication', () => {
    const base: ParsedStunMessage = {
        messageClass: 'request',
        method: 'binding',
        methodCode: 1,
        messageType: 0x0001,
        transactionFingerprint: 'e'.repeat(64),
        endpoints: [],
        attributeCount: 0,
        ignoredAttributeCount: 0,
        unknownAttributeCount: 0,
        protocolEvidence: 'stun_binding_request',
        useCandidate: false,
        iceRole: 'unknown',
        channelNumber: null,
        limitations: [],
    };
    const dropped = { ...base, transactionFingerprint: 'f'.repeat(64) };
    const evidence = buildStunTurnEvidence([
        packet({ timestamp: new Date(0), stun: base }),
        packet({ timestamp: new Date(39_499), stun: dropped }),
        packet({ timestamp: new Date(39_501), stun: dropped }),
        packet({ timestamp: new Date(79_001), stun: dropped }),
    ], ip => ip === localIp, 1);

    assert.equal(evidence.storedTransactions, 1);
    assert.equal(evidence.droppedTransactions, 2);
    assert.equal(evidence.truncated, true);
    assert.deepEqual(evidence.limitations, ['stun_transaction_limit_reached']);
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

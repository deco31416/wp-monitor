import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCallPacketFrame } from '../src/call-packet-decoder.js';

const SRC_V4 = Buffer.from([192, 0, 2, 10]);
const DST_V4 = Buffer.from([198, 51, 100, 20]);
const SRC_V6 = Buffer.from('20010db8000000000000000000000001', 'hex');
const DST_V6 = Buffer.from('20010db8000000000000000000000002', 'hex');

function ethernet(etherType: number, payload: Buffer, vlan = false): Buffer {
    const header = Buffer.alloc(vlan ? 18 : 14);
    header.fill(0xaa, 0, 12);
    if (vlan) {
        header.writeUInt16BE(0x8100, 12);
        header.writeUInt16BE(7, 14);
        header.writeUInt16BE(etherType, 16);
    } else {
        header.writeUInt16BE(etherType, 12);
    }
    return Buffer.concat([header, payload]);
}

function udp(payload: Buffer, srcPort = 50_000, dstPort = 3478): Buffer {
    const header = Buffer.alloc(8);
    header.writeUInt16BE(srcPort, 0);
    header.writeUInt16BE(dstPort, 2);
    header.writeUInt16BE(8 + payload.length, 4);
    return Buffer.concat([header, payload]);
}

function tcp(payload: Buffer, srcPort = 443, dstPort = 50_001): Buffer {
    const header = Buffer.alloc(20);
    header.writeUInt16BE(srcPort, 0);
    header.writeUInt16BE(dstPort, 2);
    header[12] = 5 << 4;
    return Buffer.concat([header, payload]);
}

function ipv4(protocol: 6 | 17, payload: Buffer, fragmented = false): Buffer {
    const header = Buffer.alloc(20);
    header[0] = 0x45;
    header.writeUInt16BE(20 + payload.length, 2);
    if (fragmented) header.writeUInt16BE(0x2000, 6);
    header[8] = 64;
    header[9] = protocol;
    SRC_V4.copy(header, 12);
    DST_V4.copy(header, 16);
    return Buffer.concat([header, payload]);
}

function ipv6(nextHeader: number, payload: Buffer): Buffer {
    const header = Buffer.alloc(40);
    header[0] = 0x60;
    header.writeUInt16BE(payload.length, 4);
    header[6] = nextHeader;
    header[7] = 64;
    SRC_V6.copy(header, 8);
    DST_V6.copy(header, 24);
    return Buffer.concat([header, payload]);
}

function stunBindingRequest(): Buffer {
    const message = Buffer.alloc(20);
    message.writeUInt16BE(0x0001, 0);
    message.writeUInt16BE(0, 2);
    message.writeUInt32BE(0x2112a442, 4);
    Buffer.from('00112233445566778899aabb', 'hex').copy(message, 8);
    return message;
}

test('decodes Ethernet IPv4 UDP and integrates structural STUN evidence', () => {
    const result = decodeCallPacketFrame(ethernet(0x0800, ipv4(17, udp(stunBindingRequest()))), 'ETHERNET');
    assert.equal(result.status, 'decoded');
    if (result.status !== 'decoded') return;
    assert.equal(result.packet.addressFamily, 4);
    assert.equal(result.packet.protocol, 17);
    assert.equal(result.packet.srcPort, 50_000);
    assert.equal(result.packet.dstPort, 3478);
    assert.deepEqual(result.packet.protocolEvidence, ['transport_flow', 'stun_binding_request']);
    assert.equal(result.packet.stun?.method, 'binding');
    assert.equal(JSON.stringify(result).includes('00112233445566778899aabb'), false);
});

test('decodes the real IPv4 TCP branch through a VLAN header', () => {
    const result = decodeCallPacketFrame(ethernet(0x0800, ipv4(6, tcp(Buffer.from([1, 2, 3]))), true), 'ETHERNET');
    assert.equal(result.status, 'decoded');
    if (result.status !== 'decoded') return;
    assert.equal(result.packet.addressFamily, 4);
    assert.equal(result.packet.protocol, 6);
    assert.equal(result.packet.payloadLength, 3);
    assert.deepEqual(result.packet.protocolEvidence, ['transport_flow']);
});

test('treats 86 bytes as captured frame length rather than IP packet length', () => {
    const exactFrame = ethernet(0x0800, ipv4(17, udp(Buffer.alloc(44))));
    assert.equal(exactFrame.length, 86);
    const exactResult = decodeCallPacketFrame(exactFrame, 'ETHERNET');
    assert.equal(exactResult.status, 'decoded');
    if (exactResult.status !== 'decoded') return;
    assert.equal(exactResult.packet.length, 72);
    assert.equal(exactResult.packet.frameLength, 86);
    assert.ok(exactResult.packet.protocolEvidence.includes('frame_length_86'));

    const ipLengthOnly = ethernet(0x0800, ipv4(17, udp(Buffer.alloc(58))));
    const ipLengthResult = decodeCallPacketFrame(ipLengthOnly, 'ETHERNET');
    assert.equal(ipLengthResult.status, 'decoded');
    if (ipLengthResult.status !== 'decoded') return;
    assert.equal(ipLengthResult.packet.length, 86);
    assert.equal(ipLengthResult.packet.frameLength, 100);
    assert.equal(ipLengthResult.packet.protocolEvidence.includes('frame_length_86'), false);
});

test('decodes Ethernet IPv6 UDP instead of discarding it', () => {
    const result = decodeCallPacketFrame(ethernet(0x86dd, ipv6(17, udp(Buffer.from([7, 8])))), 'ETHERNET');
    assert.equal(result.status, 'decoded');
    if (result.status !== 'decoded') return;
    assert.equal(result.packet.addressFamily, 6);
    assert.equal(result.packet.protocol, 17);
    assert.equal(result.packet.srcIp, '2001:db8:0:0:0:0:0:1');
    assert.equal(result.packet.dstIp, '2001:db8:0:0:0:0:0:2');
    assert.equal(result.packet.payloadLength, 2);
});

test('decodes RAW IPv6 TCP after a hop-by-hop extension', () => {
    const extension = Buffer.alloc(8);
    extension[0] = 6;
    extension[1] = 0;
    const result = decodeCallPacketFrame(ipv6(0, Buffer.concat([extension, tcp(Buffer.alloc(0))])), 'RAW');
    assert.equal(result.status, 'decoded');
    if (result.status !== 'decoded') return;
    assert.equal(result.packet.addressFamily, 6);
    assert.equal(result.packet.protocol, 6);
    assert.equal(result.packet.srcPort, 443);
});

test('omits unsupported and fragmented frames without throwing', () => {
    assert.deepEqual(decodeCallPacketFrame(ethernet(0x0806, Buffer.alloc(28)), 'ETHERNET'), {
        status: 'unsupported',
        reason: 'ether_type',
    });
    assert.deepEqual(decodeCallPacketFrame(ethernet(0x0800, ipv4(17, udp(Buffer.alloc(0)), true)), 'ETHERNET'), {
        status: 'unsupported',
        reason: 'fragmented_packet',
    });
    assert.deepEqual(decodeCallPacketFrame(Buffer.from([0x45]), 'RAW'), {
        status: 'malformed',
        reason: 'truncated_ipv4',
    });
});

test('never throws or retains arbitrary raw frames', () => {
    let state = 0x20_06_20_06;
    const nextByte = () => {
        state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
        return state & 0xff;
    };
    for (let sample = 0; sample < 1_000; sample += 1) {
        const bytes = Buffer.alloc(nextByte());
        for (let index = 0; index < bytes.length; index += 1) bytes[index] = nextByte();
        const result = decodeCallPacketFrame(bytes, sample % 2 === 0 ? 'ETHERNET' : 'RAW');
        assert.equal(Object.prototype.hasOwnProperty.call(result, 'raw'), false);
        if (result.status === 'decoded') {
            assert.ok(result.packet.payloadLength <= 65_535);
            assert.ok(result.packet.protocolEvidence.length <= 3);
        }
    }
});

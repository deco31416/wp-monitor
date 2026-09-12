import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStunMessage, parseTurnChannelData } from '../src/stun-parser.js';

const COOKIE = Buffer.from([0x21, 0x12, 0xa4, 0x42]);
const TRANSACTION = Buffer.from('00112233445566778899aabb', 'hex');

function attribute(type: number, value: Buffer): Buffer {
    const padding = Buffer.alloc((4 - (value.length % 4)) % 4);
    const header = Buffer.alloc(4);
    header.writeUInt16BE(type, 0);
    header.writeUInt16BE(value.length, 2);
    return Buffer.concat([header, value, padding]);
}

function message(type: number, attributes: Buffer[] = [], transaction = TRANSACTION): Buffer {
    const body = Buffer.concat(attributes);
    const header = Buffer.alloc(20);
    header.writeUInt16BE(type, 0);
    header.writeUInt16BE(body.length, 2);
    COOKIE.copy(header, 4);
    transaction.copy(header, 8);
    return Buffer.concat([header, body]);
}

function addressValue(
    family: 4 | 6,
    port: number,
    address: Buffer,
    xor: boolean,
    transaction = TRANSACTION,
): Buffer {
    const expectedBytes = family === 4 ? 4 : 16;
    assert.equal(address.length, expectedBytes);
    const result = Buffer.alloc(4 + expectedBytes);
    result[1] = family === 4 ? 0x01 : 0x02;
    result.writeUInt16BE(xor ? port ^ 0x2112 : port, 2);
    const mask = Buffer.concat([COOKIE, transaction]);
    for (let index = 0; index < address.length; index += 1) {
        result[4 + index] = xor ? address[index]! ^ mask[index]! : address[index]!;
    }
    return result;
}

test('distinguishes non-STUN data and parses a binding request with an opaque transaction', () => {
    assert.deepEqual(parseStunMessage(Buffer.from('ordinary udp payload')), { status: 'not_stun' });

    const first = parseStunMessage(message(0x0001));
    const second = parseStunMessage(message(0x0001));
    assert.equal(first.status, 'parsed');
    assert.equal(second.status, 'parsed');
    if (first.status !== 'parsed' || second.status !== 'parsed') return;
    assert.equal(first.message.method, 'binding');
    assert.equal(first.message.messageClass, 'request');
    assert.equal(first.message.protocolEvidence, 'stun_binding_request');
    assert.match(first.message.transactionFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(first.message.transactionFingerprint, second.message.transactionFingerprint);
    assert.equal(JSON.stringify(first).includes(TRANSACTION.toString('hex')), false);
});

test('decodes XOR-MAPPED-ADDRESS without retaining integrity or credential attributes', () => {
    const mapped = addressValue(4, 54_321, Buffer.from([203, 0, 113, 7]), true);
    const result = parseStunMessage(message(0x0101, [
        attribute(0x0020, mapped),
        attribute(0x0008, Buffer.from('synthetic-message-integrity-secret')),
        attribute(0x0014, Buffer.from('synthetic-realm')),
    ]));

    assert.equal(result.status, 'parsed');
    if (result.status !== 'parsed') return;
    assert.equal(result.message.messageClass, 'success_response');
    assert.equal(result.message.protocolEvidence, 'stun_binding_response');
    assert.deepEqual(result.message.endpoints, [{
        ip: '203.0.113.7',
        port: 54_321,
        addressFamily: 4,
        role: 'own_public_endpoint',
        attribute: 'xor_mapped_address',
    }]);
    assert.equal(result.message.attributeCount, 3);
    assert.equal(result.message.ignoredAttributeCount, 2);
    assert.equal(result.message.unknownAttributeCount, 0);
    assert.deepEqual(result.message.limitations, []);
    assert.equal(JSON.stringify(result).includes('synthetic-message-integrity-secret'), false);
    assert.equal(JSON.stringify(result).includes('synthetic-realm'), false);
});

test('separates relayed, peer and STUN server endpoints across IPv4 and IPv6', () => {
    const relayIPv6 = Buffer.from('20010db8000000000000000000000001', 'hex');
    const result = parseStunMessage(message(0x0103, [
        attribute(0x0016, addressValue(6, 50_000, relayIPv6, true)),
        attribute(0x0012, addressValue(4, 0, Buffer.from([198, 51, 100, 20]), true)),
        attribute(0x802b, addressValue(4, 3478, Buffer.from([192, 0, 2, 10]), false)),
    ]));

    assert.equal(result.status, 'parsed');
    if (result.status !== 'parsed') return;
    assert.equal(result.message.method, 'allocate');
    assert.equal(result.message.protocolEvidence, 'stun_other');
    assert.deepEqual(result.message.endpoints.map(endpoint => ({
        ip: endpoint.ip,
        port: endpoint.port,
        family: endpoint.addressFamily,
        role: endpoint.role,
    })), [
        { ip: '2001:db8:0:0:0:0:0:1', port: 50_000, family: 6, role: 'relay' },
        { ip: '198.51.100.20', port: 0, family: 4, role: 'peer_candidate' },
        { ip: '192.0.2.10', port: 3478, family: 4, role: 'stun_turn' },
    ]);
});

test('accepts unknown methods and attributes only as bounded metadata', () => {
    const result = parseStunMessage(message(0x000f, [
        attribute(0x0002, Buffer.from([1, 2, 3, 4])),
        attribute(0x8fff, Buffer.from('optional-value')),
    ]));

    assert.equal(result.status, 'parsed');
    if (result.status !== 'parsed') return;
    assert.equal(result.message.method, 'unknown');
    assert.equal(result.message.methodCode, 15);
    assert.equal(result.message.ignoredAttributeCount, 0);
    assert.equal(result.message.unknownAttributeCount, 2);
    assert.deepEqual(result.message.limitations.sort(), [
        'unknown_required_attribute_skipped',
        'unknown_stun_method',
    ]);
    assert.equal(JSON.stringify(result).includes('optional-value'), false);
});

test('fails closed for truncated, inconsistent and malformed STUN messages', () => {
    const shortHeader = Buffer.concat([Buffer.alloc(4), COOKIE]);
    assert.deepEqual(parseStunMessage(shortHeader), { status: 'malformed', reason: 'truncated_header' });

    const invalidType = message(0xc001);
    assert.deepEqual(parseStunMessage(invalidType), { status: 'malformed', reason: 'invalid_message_type' });

    const invalidLength = message(0x0001);
    invalidLength.writeUInt16BE(2, 2);
    assert.deepEqual(parseStunMessage(invalidLength), { status: 'malformed', reason: 'invalid_message_length' });

    const truncated = message(0x0001, [attribute(0x8001, Buffer.from([1, 2, 3, 4]))]).subarray(0, 22);
    assert.deepEqual(parseStunMessage(truncated), { status: 'malformed', reason: 'truncated_message' });

    const trailing = Buffer.concat([message(0x0001), Buffer.from([0])]);
    assert.deepEqual(parseStunMessage(trailing), { status: 'malformed', reason: 'trailing_bytes' });

    const badAddress = message(0x0101, [attribute(0x0020, Buffer.from([0, 3, 0, 80, 1, 2, 3, 4]))]);
    assert.deepEqual(parseStunMessage(badAddress), { status: 'malformed', reason: 'invalid_address_attribute' });
});

test('enforces the structural attribute count bound', () => {
    const attributes = Array.from({ length: 129 }, () => attribute(0x8001, Buffer.alloc(0)));
    assert.deepEqual(parseStunMessage(message(0x0001, attributes)), {
        status: 'malformed',
        reason: 'too_many_attributes',
    });
});

test('extracts only permitted ICE and TURN channel metadata', () => {
    const channel = Buffer.alloc(4);
    channel.writeUInt16BE(0x4001, 0);
    const result = parseStunMessage(message(0x0009, [
        attribute(0x0025, Buffer.alloc(0)),
        attribute(0x802a, Buffer.alloc(8, 7)),
        attribute(0x000c, channel),
        attribute(0x0012, addressValue(4, 49_152, Buffer.from([198, 51, 100, 44]), true)),
    ]));

    assert.equal(result.status, 'parsed');
    if (result.status !== 'parsed') return;
    assert.equal(result.message.method, 'channel_bind');
    assert.equal(result.message.useCandidate, true);
    assert.equal(result.message.iceRole, 'controlling');
    assert.equal(result.message.channelNumber, 0x4001);
    assert.equal(JSON.stringify(result).includes(Buffer.alloc(8, 7).toString('hex')), false);
});

test('recognizes bounded TURN ChannelData envelopes without retaining payload', () => {
    const payload = Buffer.from('synthetic-media-must-not-be-retained');
    const frame = Buffer.alloc(4 + payload.length);
    frame.writeUInt16BE(0x4001, 0);
    frame.writeUInt16BE(payload.length, 2);
    payload.copy(frame, 4);

    assert.deepEqual(parseTurnChannelData(frame), {
        status: 'parsed',
        channelData: { channelNumber: 0x4001, payloadLength: payload.length },
    });
    assert.equal(JSON.stringify(parseTurnChannelData(frame)).includes('synthetic-media'), false);
    assert.deepEqual(parseTurnChannelData(frame.subarray(0, 3)), {
        status: 'malformed',
        reason: 'truncated_channel_data',
    });
    const invalidLength = Buffer.from(frame);
    invalidLength.writeUInt16BE(payload.length + 1, 2);
    assert.deepEqual(parseTurnChannelData(invalidLength), {
        status: 'malformed',
        reason: 'invalid_channel_length',
    });
});

test('never throws or returns unbounded structures for arbitrary packet bytes', () => {
    let state = 0x5eed1234;
    const nextByte = () => {
        state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
        return state & 0xff;
    };

    for (let sample = 0; sample < 1_000; sample += 1) {
        const bytes = Buffer.alloc(nextByte());
        for (let index = 0; index < bytes.length; index += 1) bytes[index] = nextByte();
        const result = parseStunMessage(bytes);
        if (result.status !== 'parsed') continue;
        assert.ok(result.message.attributeCount <= 128);
        assert.ok(result.message.endpoints.length <= 128);
        assert.match(result.message.transactionFingerprint, /^[a-f0-9]{64}$/);
    }
});

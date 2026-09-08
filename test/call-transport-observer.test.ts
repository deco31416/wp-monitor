import test from 'node:test';
import assert from 'node:assert/strict';
import { observeCallTransportNode } from '../src/call-transport-observer.js';

const NOW = new Date('2026-09-07T20:00:00.000Z');

function callNode(action: Record<string, unknown>, timestamp = '1788811200') {
    return {
        tag: 'call',
        attrs: { from: '573001112233@s.whatsapp.net', t: timestamp },
        content: [action],
    };
}

test('observes a relay transport endpoint without retaining token material', () => {
    const result = observeCallTransportNode(callNode({
        tag: 'transport',
        attrs: {
            'call-id': 'CALL-TRANSPORT-001',
            'transport-message-type': '1',
            'p2p-cand-round': '2',
        },
        content: [{
            tag: 'relay',
            attrs: {},
            content: [
                { tag: 'token', attrs: { id: '0' }, content: Buffer.from('secret-token') },
                {
                    tag: 'te2',
                    attrs: { relay_name: 'meta-relay-1', c2r_rtt: '42' },
                    content: Buffer.from([57, 144, 85, 57, 0x0d, 0x96]),
                },
            ],
        }],
    }), { now: () => NOW });

    assert.ok(result);
    assert.equal(result.relayNegotiationObserved, true);
    assert.equal(result.peerNegotiationObserved, false);
    assert.equal(result.candidateRound, 2);
    assert.deepEqual(result.endpoints, [{
        ip: '57.144.85.57',
        port: 3478,
        addressFamily: 4,
        role: 'relay',
        source: 'baileys_transport',
        relayName: 'meta-relay-1',
        rttMs: 42,
    }]);
    assert.ok(result.limitations.includes('sensitive_fields_excluded'));
    assert.equal(JSON.stringify(result).includes('secret-token'), false);
});

test('records peer negotiation without decoding its opaque candidate payload', () => {
    const result = observeCallTransportNode(callNode({
        tag: 'transport',
        attrs: {
            'call-id': 'CALL-TRANSPORT-002',
            'transport-message-type': '3',
            'p2p-cand-round': '1',
        },
        content: [{ tag: 'te', attrs: { priority: '1' }, content: Buffer.from('opaque') }],
    }));

    assert.ok(result);
    assert.equal(result.peerNegotiationObserved, true);
    assert.equal(result.relayNegotiationObserved, false);
    assert.deepEqual(result.endpoints, []);
    assert.deepEqual(result.limitations, ['peer_candidate_payload_not_decoded']);
});

test('recognizes keepalive and packed IPv6 relay endpoints', () => {
    const keepalive = observeCallTransportNode(callNode({
        tag: 'transport',
        attrs: { 'call-id': 'CALL-TRANSPORT-003', 'transport-message-type': '9' },
        content: [],
    }));
    assert.equal(keepalive?.keepaliveObserved, true);

    const ipv6 = Buffer.from([
        0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        0x0d, 0x96,
    ]);
    const latency = observeCallTransportNode(callNode({
        tag: 'relaylatency',
        attrs: { 'call-id': 'CALL-TRANSPORT-004' },
        content: [{ tag: 'te', attrs: {}, content: ipv6 }],
    }));
    assert.equal(latency?.relayNegotiationObserved, true);
    assert.equal(latency?.endpoints[0]?.addressFamily, 6);
    assert.equal(latency?.endpoints[0]?.port, 3478);
});

test('fails closed for unrelated, malformed and unbounded input', () => {
    assert.equal(observeCallTransportNode(null), null);
    assert.equal(observeCallTransportNode({ tag: 'message', attrs: {}, content: [] }), null);
    assert.equal(observeCallTransportNode(callNode({ tag: 'transport', attrs: {}, content: [] })), null);
    assert.equal(observeCallTransportNode(callNode({
        tag: 'transport',
        attrs: { 'call-id': '../unsafe', 'transport-message-type': '3' },
        content: [],
    })), null);

    const malformed = observeCallTransportNode(callNode({
        tag: 'transport',
        attrs: { 'call-id': 'CALL-TRANSPORT-005', 'transport-message-type': '1' },
        content: [{ tag: 'te2', attrs: {}, content: Buffer.from([1, 2, 3]) }],
    }));
    assert.deepEqual(malformed?.endpoints, []);
    assert.ok(malformed?.limitations.includes('malformed_endpoint_skipped'));

    const truncated = observeCallTransportNode(callNode({
        tag: 'transport',
        attrs: { 'call-id': 'CALL-TRANSPORT-006', 'transport-message-type': '1' },
        content: [{ tag: 'wrapper', attrs: {}, content: [{ tag: 'deeper', attrs: {}, content: [] }] }],
    }), { maxDepth: 1 });
    assert.ok(truncated?.limitations.includes('node_traversal_truncated'));
});

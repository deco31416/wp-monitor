import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupNetworkIntelligence, scoreCandidate } from '../src/call-scoring.js';

test('scores unknown public bidirectional traffic as a technical candidate', () => {
    const networkIntelligence = lookupNetworkIntelligence('203.0.113.10', 'unknown');
    const score = scoreCandidate({
        provider: 'unknown',
        networkIntelligence,
        packets: 120,
        bytesTotal: 12000,
        direction: 'bidirectional',
        ports: [443],
        durationSec: 30,
    });

    assert.equal(score.isP2P, true);
    assert.equal(score.networkCategory, 'consumer_isp_or_unknown');
    assert.equal(score.confidence, 'high');
    assert.ok(score.confidenceScore >= 75);
    assert.ok(score.reasonCodes.some(reason => reason.code === 'UNKNOWN_PUBLIC_PROVIDER'));
});

test('penalizes cloud/datacenter ranges and does not mark them as P2P', () => {
    const networkIntelligence = {
        asn: 64500,
        org: 'Synthetic cloud provider',
        category: 'cloud_hosting' as const,
        source: 'local_rules' as const,
        isDatacenterLikely: true,
        caution: 'Synthetic unit-test fixture',
    };
    const score = scoreCandidate({
        provider: 'unknown',
        networkIntelligence,
        packets: 300,
        bytesTotal: 45000,
        direction: 'bidirectional',
        ports: [443],
        durationSec: 60,
    });

    assert.equal(networkIntelligence.category, 'cloud_hosting');
    assert.equal(score.isP2P, false);
    assert.equal(score.networkCategory, 'cloud_hosting');
    assert.ok(score.confidenceScore <= 30);
    assert.ok(score.reasonCodes.some(reason => reason.code === 'DATACENTER_OR_RELAY_LIKELY'));
});

test('classifies synthetic consumer ISP intelligence without marking it as datacenter relay', () => {
    const networkIntelligence = {
        asn: 64501,
        org: 'Proveedor residencial de prueba (Mexico)',
        category: 'consumer_isp_or_unknown' as const,
        source: 'enrichment' as const,
        isDatacenterLikely: false,
        caution: 'Synthetic unit-test fixture',
    };
    const score = scoreCandidate({
        provider: 'unknown',
        networkIntelligence,
        packets: 296,
        bytesTotal: 36000,
        direction: 'outgoing',
        ports: [55453, 57419],
        durationSec: 129,
    });

    assert.equal(networkIntelligence.asn, 64501);
    assert.equal(networkIntelligence.category, 'consumer_isp_or_unknown');
    assert.equal(networkIntelligence.isDatacenterLikely, false);
    assert.equal(score.isP2P, true);
    assert.ok(score.confidenceScore >= 45);
});

test('caps known Meta and Google infrastructure even with bidirectional volume', () => {
    for (const [ip, provider] of [
        ['192.0.2.20', 'meta'],
        ['192.0.2.21', 'google'],
    ] as const) {
        const networkIntelligence = lookupNetworkIntelligence(ip, provider);
        const score = scoreCandidate({
            provider,
            networkIntelligence,
            packets: 250,
            bytesTotal: 30000,
            direction: 'bidirectional',
            ports: [3478],
            durationSec: 129,
        });

        assert.equal(score.isP2P, false);
        assert.ok(score.confidenceScore <= 30);
        assert.ok(score.reasonCodes.some(reason => reason.code === 'KNOWN_INFRASTRUCTURE'));
    }
});

test('penalizes STUN/TURN ports even when traffic volume is useful', () => {
    const networkIntelligence = lookupNetworkIntelligence('203.0.113.20', 'unknown');
    const withoutTurn = scoreCandidate({
        provider: 'unknown',
        networkIntelligence,
        packets: 80,
        bytesTotal: 9600,
        direction: 'bidirectional',
        ports: [443],
        durationSec: 30,
    });
    const withTurn = scoreCandidate({
        provider: 'unknown',
        networkIntelligence,
        packets: 80,
        bytesTotal: 9600,
        direction: 'bidirectional',
        ports: [3478],
        durationSec: 30,
    });

    assert.ok(withTurn.confidenceScore < withoutTurn.confidenceScore);
    assert.ok(withTurn.reasonCodes.some(reason => reason.code === 'STUN_TURN_PORT'));
});

test('caps tiny samples and country mismatch as non-conclusive observations', () => {
    const networkIntelligence = lookupNetworkIntelligence('198.51.100.44', 'unknown');
    const score = scoreCandidate({
        provider: 'unknown',
        networkIntelligence,
        packets: 2,
        bytesTotal: 280,
        direction: 'bidirectional',
        ports: [56000, 58000],
        durationSec: 38,
        targetJid: '52-SYNTHETIC@s.whatsapp.net',
        observedCountryCode: 'US',
    });

    assert.equal(score.isP2P, false);
    assert.equal(score.confidence, 'low');
    assert.ok(score.confidenceScore <= 15);
    assert.equal(score.correlation.classification, 'insufficient');
    assert.equal(score.correlation.phoneCountryCode, 'MX');
    assert.equal(score.correlation.observedCountryCode, 'US');
    assert.ok(score.reasonCodes.some(reason => reason.code === 'HARD_CAP_TINY_SAMPLE'));
    assert.ok(score.reasonCodes.some(reason => reason.code === 'PHONE_GEO_COUNTRY_MISMATCH'));
});

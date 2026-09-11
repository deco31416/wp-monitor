import test from 'node:test';
import assert from 'node:assert/strict';
import { inferPhoneCountryFromJid, lookupNetworkIntelligence, scoreCandidate } from '../src/call-scoring.js';

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

test('separates hard exclusions from contextual infrastructure and eligible endpoints', () => {
    const meta = lookupNetworkIntelligence('57.144.115.57', 'meta', { now: new Date('2026-09-10T12:00:00.000Z') });
    const dns = lookupNetworkIntelligence('8.8.8.8', 'google', { now: new Date('2026-09-10T12:00:00.000Z') });
    const own = lookupNetworkIntelligence('181.50.10.20', 'unknown', {
        now: new Date('2026-09-10T12:00:00.000Z'),
        ownPublicEndpoints: new Set(['181.50.10.20']),
    });
    const googleContext = lookupNetworkIntelligence('172.217.118.4', 'google', { now: new Date('2026-09-10T12:00:00.000Z') });
    const unknown = lookupNetworkIntelligence('9.9.9.9', 'unknown', { now: new Date('2026-09-10T12:00:00.000Z') });

    assert.deepEqual(meta.exclusionDecision, {
        version: 1,
        classification: 'hard_excluded',
        basis: 'registry',
        reasonCodes: ['META_INFRASTRUCTURE'],
    });
    assert.equal(dns.exclusionDecision?.classification, 'hard_excluded');
    assert.deepEqual(dns.exclusionDecision?.reasonCodes, ['EXACT_PUBLIC_DNS']);
    assert.equal(own.exclusionDecision?.classification, 'hard_excluded');
    assert.deepEqual(own.exclusionDecision?.reasonCodes, ['OWN_PUBLIC_ENDPOINT']);
    assert.equal(googleContext.exclusionDecision?.classification, 'contextual');
    assert.deepEqual(googleContext.exclusionDecision?.reasonCodes, ['CLOUD_HOSTING_CONTEXT']);
    assert.equal(unknown.exclusionDecision?.classification, 'eligible');

    const contextualScore = scoreCandidate({
        provider: 'google',
        networkIntelligence: googleContext,
        packets: 500,
        bytesTotal: 500_000,
        direction: 'bidirectional',
        ports: [443],
        durationSec: 60,
    });
    assert.equal(contextualScore.isP2P, false);
    assert.ok(contextualScore.reasonCodes.some(reason => (
        reason.code === 'CONTEXTUAL_INFRASTRUCTURE_CLASSIFICATION'
    )));
    assert.match(contextualScore.technicalNote, /permanece visible para revisión/i);
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

test('caps tiny samples while keeping phone and GeoIP mismatch outside route scoring', () => {
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
    assert.equal(score.networkContext.relationship, 'mismatch');
    assert.equal(score.networkContext.affectsRouteScore, false);
    assert.deepEqual(score.networkContext.reasonCodes, ['PHONE_GEO_CONTEXT_MISMATCH']);
    assert.ok(!score.reasonCodes.some(reason => reason.code.includes('PHONE_GEO')));
});

test('keeps IPv6 visible but non-conclusive until its infrastructure registry is versioned', () => {
    const networkIntelligence = lookupNetworkIntelligence('2001:db8::20', 'unknown');
    const score = scoreCandidate({
        provider: 'unknown',
        networkIntelligence,
        packets: 500,
        bytesTotal: 500_000,
        direction: 'bidirectional',
        ports: [443],
        durationSec: 60,
        addressFamily: 6,
    });

    assert.equal(score.isP2P, false);
    assert.equal(score.confidence, 'low');
    assert.ok(score.confidenceScore <= 30);
    assert.equal(score.correlation.classification, 'insufficient');
    assert.ok(score.reasonCodes.some(reason => reason.code === 'IPV6_REGISTRY_PENDING'));
});

test('classifies registered Meta IPv6 as infrastructure without the pending-registry cap', () => {
    const networkIntelligence = lookupNetworkIntelligence('2a03:2880:f001::1', 'meta');
    const score = scoreCandidate({
        provider: 'meta',
        networkIntelligence,
        packets: 500,
        bytesTotal: 500_000,
        direction: 'bidirectional',
        ports: [443],
        durationSec: 60,
        addressFamily: 6,
    });

    assert.equal(networkIntelligence.registryEvidence?.status, 'fresh');
    assert.equal(networkIntelligence.registryEvidence?.endpointRole, 'relay');
    assert.equal(score.isP2P, false);
    assert.ok(!score.reasonCodes.some(reason => reason.code === 'IPV6_REGISTRY_PENDING'));
});

test('never promotes the local STUN mapped address as a contact candidate', () => {
    const ip = '181.50.10.20';
    const networkIntelligence = lookupNetworkIntelligence(ip, 'unknown', {
        ownPublicEndpoints: new Set([ip]),
    });
    const score = scoreCandidate({
        provider: 'unknown',
        networkIntelligence,
        packets: 500,
        bytesTotal: 500_000,
        direction: 'bidirectional',
        ports: [443],
        durationSec: 60,
    });

    assert.equal(networkIntelligence.registryEvidence?.endpointRole, 'own_public_endpoint');
    assert.equal(score.isP2P, false);
    assert.equal(score.confidenceScore, 0);
    assert.ok(score.reasonCodes.some(reason => reason.code === 'OWN_PUBLIC_ENDPOINT'));
});

test('scores baseline delta, temporal onset, protocol, and capture flow with a reconstructable v3 ledger', () => {
    const score = scoreCandidate({
        provider: 'unknown',
        networkIntelligence: lookupNetworkIntelligence('9.9.9.9', 'unknown'),
        packets: 120,
        bytesTotal: 24_000,
        direction: 'bidirectional',
        ports: [40_000],
        durationSec: 30,
        baselinePackets: 2,
        baselineDurationSec: 5,
        onsetDelayMs: 1_000,
        protocolEvidence: ['transport_flow', 'stun_binding_request'],
        targetJid: '573001112233@s.whatsapp.net',
        observedCountryCode: 'CO',
    });

    assert.equal(score.scoreBreakdown.version, 3);
    assert.equal(
        score.scoreBreakdown.rawScore,
        score.scoreBreakdown.components.reduce((total, component) => total + component.delta, 0),
    );
    assert.equal(score.scoreBreakdown.finalScore, score.confidenceScore);
    assert.ok(score.reasonCodes.some(reason => reason.code === 'STRONG_BASELINE_DELTA'));
    assert.ok(score.reasonCodes.some(reason => reason.code === 'IMMEDIATE_CALL_ONSET'));
    assert.ok(score.reasonCodes.some(reason => reason.code === 'TRANSPORT_FLOW_OBSERVED'));
    assert.ok(score.reasonCodes.some(reason => reason.code === 'STRUCTURAL_STUN_CONTEXT'));
});

test('does not let phone or GeoIP context change an otherwise identical route score', () => {
    const common = {
        provider: 'unknown' as const,
        networkIntelligence: lookupNetworkIntelligence('9.9.9.9', 'unknown'),
        packets: 80,
        bytesTotal: 12_000,
        direction: 'bidirectional' as const,
        ports: [40_000],
        durationSec: 30,
    };
    const matching = scoreCandidate({
        ...common,
        targetJid: '573001112233@s.whatsapp.net',
        observedCountryCode: 'CO',
    });
    const mismatching = scoreCandidate({
        ...common,
        targetJid: '573001112233@s.whatsapp.net',
        observedCountryCode: 'JP',
    });

    assert.equal(matching.confidenceScore, mismatching.confidenceScore);
    assert.equal(matching.networkContext.relationship, 'match');
    assert.equal(mismatching.networkContext.relationship, 'mismatch');
    assert.ok(!matching.scoreBreakdown.components.some(component => component.code.includes('PHONE_GEO')));
    assert.ok(!mismatching.scoreBreakdown.components.some(component => component.code.includes('PHONE_GEO')));
});

test('does not manufacture a baseline delta when the active duration is zero', () => {
    const score = scoreCandidate({
        provider: 'unknown',
        networkIntelligence: lookupNetworkIntelligence('9.9.9.9', 'unknown'),
        packets: 40,
        bytesTotal: 4_000,
        direction: 'bidirectional',
        ports: [40_000],
        durationSec: 0,
        baselinePackets: 0,
        baselineDurationSec: 5,
    });

    assert.ok(score.reasonCodes.some(reason => reason.code === 'BASELINE_UNAVAILABLE'));
    assert.ok(!score.reasonCodes.some(reason => reason.code === 'STRONG_BASELINE_DELTA'));
});

test('resolves global E.164 context and keeps shared numbering zones non-specific', () => {
    assert.deepEqual(inferPhoneCountryFromJid('81312345678@s.whatsapp.net'), {
        version: 1,
        callingCode: '81',
        countryCode: 'JP',
        label: 'Japon',
        precision: 'country',
    });
    assert.deepEqual(inferPhoneCountryFromJid('14155550100@s.whatsapp.net'), {
        version: 1,
        callingCode: '1',
        countryCode: null,
        label: 'NANP (Estados Unidos, Canada y Caribe)',
        precision: 'shared_zone',
    });
});

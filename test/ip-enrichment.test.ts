import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEnrichmentClassification, normalizeDbIpResponse, normalizeIpApiResponse } from '../src/ip-enrichment.js';
import type { CandidateIP } from '../src/call-analyzer.js';

test('normalizes ip-api geolocation and ASN data', () => {
    const enrichment = normalizeIpApiResponse({
        status: 'success',
        query: '192.0.2.10',
        continent: 'Norteamerica',
        country: 'Mexico',
        countryCode: 'MX',
        region: 'CMX',
        regionName: 'Ciudad de Mexico',
        city: 'Ciudad de Mexico',
        zip: '06000',
        lat: 19.4326,
        lon: -99.1332,
        timezone: 'America/Mexico_City',
        isp: 'Proveedor residencial de prueba',
        org: 'Red sintetica de documentacion',
        as: 'AS64501 Proveedor residencial de prueba',
        asname: 'TEST-NET-MX',
        mobile: false,
        proxy: false,
        hosting: false,
    }, 'https://geo.example.test/json/192.0.2.10');

    assert.equal(enrichment.status, 'success');
    assert.equal(enrichment.ip, '192.0.2.10');
    assert.equal(enrichment.city, 'Ciudad de Mexico');
    assert.equal(enrichment.regionName, 'Ciudad de Mexico');
    assert.equal(enrichment.postalCode, '06000');
    assert.equal(enrichment.asn, 64501);
    assert.equal(enrichment.isp, 'Proveedor residencial de prueba');
    assert.equal(enrichment.mapsUrl, 'https://www.google.com/maps?q=19.4326,-99.1332');
    assert.match(enrichment.accuracyNote, /estimada de red/);
});

test('normalizes DB-IP free geolocation data as primary city source', () => {
    const enrichment = normalizeDbIpResponse({
        ipAddress: '192.0.2.11',
        continentCode: 'NA',
        continentName: 'North America',
        countryCode: 'MX',
        countryName: 'Mexico',
        stateProv: 'Ciudad de Mexico',
        city: 'Ciudad de Mexico',
    }, 'https://geo.example.test/db-ip/192.0.2.11');

    assert.equal(enrichment.provider, 'db-ip');
    assert.equal(enrichment.status, 'success');
    assert.equal(enrichment.ip, '192.0.2.11');
    assert.equal(enrichment.country, 'Mexico');
    assert.equal(enrichment.regionName, 'Ciudad de Mexico');
    assert.equal(enrichment.city, 'Ciudad de Mexico');
    assert.equal(enrichment.mapsUrl, undefined);
    assert.match(enrichment.accuracyNote, /DB-IP/);
});

test('demotes enriched CDN/cloud IPs even when initial traffic score is high', () => {
    const candidate = buildCandidate({
        ip: '198.51.100.20',
        confidenceScore: 87,
        confidence: 'high',
        packets: 227,
    });
    const enrichment = normalizeIpApiResponse({
        status: 'success',
        query: '198.51.100.20',
        country: 'Mexico',
        countryCode: 'MX',
        regionName: 'Queretaro',
        city: 'Queretaro',
        lat: 20.5888,
        lon: -100.3899,
        timezone: 'America/Mexico_City',
        isp: 'Proveedor cloud de prueba',
        org: 'Synthetic Cloud CDN',
        as: 'AS64502 Synthetic Cloud CDN',
        asname: 'TEST-CDN',
        hosting: false,
        proxy: false,
    }, 'https://geo.example.test/json/198.51.100.20');

    const adjusted = applyEnrichmentClassification({ ...candidate, ipEnrichment: enrichment }, enrichment);

    assert.equal(adjusted.isP2P, false);
    assert.equal(adjusted.networkCategory, 'cdn');
    assert.equal(adjusted.networkIntelligence.isDatacenterLikely, true);
    assert.equal(adjusted.confidence, 'low');
    assert.ok(adjusted.confidenceScore <= 30);
    assert.ok(adjusted.reasonCodes.some(reason => reason.code === 'ENRICHED_CDN_PROVIDER'));
});

test('keeps enriched consumer ISP candidates eligible for corroboration', () => {
    const candidate = buildCandidate({
        ip: '203.0.113.30',
        confidenceScore: 87,
        confidence: 'high',
        packets: 92,
    });
    const enrichment = normalizeIpApiResponse({
        status: 'success',
        query: '203.0.113.30',
        country: 'Mexico',
        countryCode: 'MX',
        regionName: 'Nuevo Leon',
        city: 'Monterrey',
        lat: 25.6866,
        lon: -100.3161,
        timezone: 'America/Monterrey',
        isp: 'Proveedor residencial de prueba',
        org: 'Red residencial sintetica',
        as: 'AS64503 Proveedor residencial de prueba',
        asname: 'TEST-RESIDENTIAL',
        hosting: false,
        proxy: false,
    }, 'https://geo.example.test/json/203.0.113.30');

    const adjusted = applyEnrichmentClassification({ ...candidate, ipEnrichment: enrichment }, enrichment);

    assert.equal(adjusted.isP2P, true);
    assert.equal(adjusted.networkCategory, 'consumer_isp_or_unknown');
    assert.equal(adjusted.confidenceScore, 87);
    assert.equal(adjusted.networkIntelligence.asn, 64503);
    assert.match(adjusted.networkIntelligence.org, /residencial/i);
});

function buildCandidate(overrides: Partial<CandidateIP>): CandidateIP {
    return {
        ip: '203.0.113.40',
        packets: 100,
        bytesTotal: 12000,
        firstSeen: new Date('2026-06-23T00:00:00.000Z'),
        lastSeen: new Date('2026-06-23T00:01:00.000Z'),
        avgSize: 120,
        ports: [443],
        direction: 'bidirectional',
        provider: 'unknown',
        networkCategory: 'consumer_isp_or_unknown',
        networkIntelligence: {
            asn: null,
            org: 'Unknown public network',
            category: 'consumer_isp_or_unknown',
            source: 'local_rules',
            isDatacenterLikely: false,
            caution: 'unit test',
        },
        geo: null,
        confidence: 'high',
        confidenceScore: 87,
        reasonCodes: [{ code: 'UNIT_INITIAL', label: 'Initial score from traffic', delta: 87 }],
        technicalNote: 'unit test',
        isP2P: true,
        ...overrides,
    };
}

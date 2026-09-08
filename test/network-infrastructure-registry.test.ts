import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createInfrastructureRegistry,
    lookupInfrastructure,
    type InfrastructureRegistryDocument,
} from '../src/network-infrastructure-registry.js';

const NOW = new Date('2026-09-08T12:00:00.000Z');

test('resolves versioned IPv4 and IPv6 infrastructure with exact endpoint roles', () => {
    const metaV4 = lookupInfrastructure('57.144.115.57', { now: NOW });
    assert.equal(metaV4.provider, 'meta');
    assert.equal(metaV4.endpointRole, 'relay');
    assert.equal(metaV4.status, 'fresh');
    assert.equal(metaV4.degraded, false);

    const metaV6 = lookupInfrastructure('2a03:2880:f001::1', { now: NOW });
    assert.equal(metaV6.provider, 'meta');
    assert.equal(metaV6.endpointRole, 'relay');
    assert.equal(metaV6.matchedCidr, '2a03:2880::/32');

    const googleDns = lookupInfrastructure('8.8.8.8', { now: NOW });
    assert.equal(googleDns.category, 'dns');
    assert.equal(googleDns.endpointRole, 'dns');
    assert.equal(googleDns.matchedCidr, '8.8.8.8/32');

    const cloudflareDnsV6 = lookupInfrastructure('2606:4700:4700::1111', { now: NOW });
    assert.equal(cloudflareDnsV6.category, 'dns');
    assert.equal(cloudflareDnsV6.matchedCidr, '2606:4700:4700::1111/128');
    assert.ok(cloudflareDnsV6.competingEntryIds.includes('cloudflare-network'));
});

test('marks an observed local STUN mapped address as own endpoint, never as contact evidence', () => {
    const evidence = lookupInfrastructure('181.50.10.20', {
        now: NOW,
        ownPublicEndpoints: new Set(['181.50.10.20']),
    });
    assert.equal(evidence.endpointRole, 'own_public_endpoint');
    assert.equal(evidence.degraded, false);
    assert.match(evidence.caution, /no representa al contacto remoto/i);
});

test('keeps unknown, invalid, stale, and missing-source results explicitly bounded', () => {
    const unknown = lookupInfrastructure('9.9.9.9', { now: NOW });
    assert.equal(unknown.status, 'unknown');
    assert.equal(unknown.entryId, null);

    const invalid = lookupInfrastructure('not-an-ip', { now: NOW });
    assert.equal(invalid.status, 'invalid');
    assert.equal(invalid.degraded, true);

    const stale = lookupInfrastructure('57.144.115.57', { now: new Date('2027-01-01T00:00:00.000Z') });
    assert.equal(stale.status, 'stale');
    assert.equal(stale.degraded, true);
    assert.equal(stale.endpointRole, 'relay');

    const registry = createInfrastructureRegistry(documentWithEntries([
        entry('missing-source', ['198.20.0.0/16'], 'absent'),
    ]));
    const missing = registry.lookup('198.20.1.1', { now: NOW });
    assert.equal(missing.status, 'source_unavailable');
    assert.equal(missing.degraded, true);
    assert.match(missing.caution, /no atribuir al contacto/i);
});

test('resolves overlaps by longest prefix and reports deterministic equal-rank conflicts', () => {
    const registry = createInfrastructureRegistry(documentWithEntries([
        entry('broad', ['198.20.0.0/16']),
        entry('specific-z', ['198.20.10.0/24'], 'source', 20),
        entry('specific-a', ['198.20.10.0/24'], 'source', 20),
    ]));
    const evidence = registry.lookup('198.20.10.5', { now: NOW });
    assert.equal(evidence.entryId, 'specific-a');
    assert.equal(evidence.matchedCidr, '198.20.10.0/24');
    assert.equal(evidence.degraded, true);
    assert.deepEqual(evidence.competingEntryIds.sort(), ['broad', 'specific-z']);
});

test('rejects malformed registries before serving classifications', () => {
    assert.throws(() => createInfrastructureRegistry(documentWithEntries([
        entry('bad-cidr', ['198.20.0.0/99']),
    ])), /Invalid infrastructure CIDR/);
    assert.throws(() => createInfrastructureRegistry(documentWithEntries([
        entry('duplicate', ['198.20.0.0/16']),
        entry('duplicate', ['198.21.0.0/16']),
    ])), /duplicated infrastructure registry entry/);
});

test('keeps its compiled snapshot isolated from later document mutations', () => {
    const document = documentWithEntries([entry('stable', ['198.20.0.0/16'])]);
    const registry = createInfrastructureRegistry(document);
    document.entries[0]!.cidrs[0] = '198.21.0.0/16';
    document.sources[0]!.validUntil = '2020-01-01T00:00:00.000Z';

    const evidence = registry.lookup('198.20.1.1', { now: NOW });
    assert.equal(evidence.entryId, 'stable');
    assert.equal(evidence.status, 'fresh');
});

function documentWithEntries(entries: InfrastructureRegistryDocument['entries']): InfrastructureRegistryDocument {
    return {
        schemaVersion: 1,
        version: 'test.1',
        publishedAt: '2026-09-01T00:00:00.000Z',
        sources: [{
            id: 'source',
            label: 'Synthetic source',
            uri: null,
            kind: 'observed_heuristic',
            retrievedAt: '2026-09-01T00:00:00.000Z',
            validUntil: '2026-10-01T00:00:00.000Z',
        }],
        entries,
    };
}

function entry(
    id: string,
    cidrs: string[],
    sourceId = 'source',
    priority = 10,
): InfrastructureRegistryDocument['entries'][number] {
    return {
        id,
        cidrs,
        provider: 'unknown',
        category: 'cloud_hosting',
        endpointRole: 'cloud_hosting',
        asn: null,
        org: `Synthetic ${id}`,
        sourceId,
        priority,
    };
}

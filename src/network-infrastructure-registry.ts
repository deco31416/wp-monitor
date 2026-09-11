import { BlockList, isIP } from 'node:net';

export type InfrastructureProvider = 'meta' | 'google' | 'cloudflare' | 'unknown';
export type InfrastructureCategory = 'meta' | 'stun_turn' | 'dns' | 'cdn' | 'cloud_hosting';
export type InfrastructureEndpointRole =
    | 'relay'
    | 'stun_turn'
    | 'dns'
    | 'cdn'
    | 'cloud_hosting'
    | 'own_public_endpoint';
export type InfrastructureRegistryStatus = 'fresh' | 'stale' | 'source_unavailable' | 'unknown' | 'invalid';

export interface InfrastructureRegistrySource {
    id: string;
    label: string;
    uri: string | null;
    kind: 'authoritative' | 'community_snapshot' | 'observed_heuristic' | 'runtime_observation';
    retrievedAt: string;
    validUntil: string;
}

export interface InfrastructureRegistryEntry {
    id: string;
    cidrs: string[];
    provider: InfrastructureProvider;
    category: InfrastructureCategory;
    endpointRole: Exclude<InfrastructureEndpointRole, 'own_public_endpoint'>;
    asn: number | null;
    org: string;
    sourceId: string;
    priority?: number;
}

export interface InfrastructureRegistryDocument {
    schemaVersion: 1;
    version: string;
    publishedAt: string;
    sources: InfrastructureRegistrySource[];
    entries: InfrastructureRegistryEntry[];
}

export interface InfrastructureRegistryEvidence {
    schemaVersion: 1;
    registryVersion: string;
    registryPublishedAt: string;
    status: InfrastructureRegistryStatus;
    entryId: string | null;
    matchedCidr: string | null;
    provider: InfrastructureProvider;
    category: InfrastructureCategory | null;
    endpointRole: InfrastructureEndpointRole | 'unknown';
    asn: number | null;
    org: string;
    source: InfrastructureRegistrySource | null;
    competingEntryIds: string[];
    degraded: boolean;
    caution: string;
}

interface CompiledRange {
    entry: InfrastructureRegistryEntry;
    cidr: string;
    prefix: number;
    family: 'ipv4' | 'ipv6';
    matcher: BlockList;
}

export interface InfrastructureRegistry {
    metadata(): Pick<InfrastructureRegistryDocument, 'schemaVersion' | 'version' | 'publishedAt'>;
    lookup(ip: string, options?: { now?: Date; ownPublicEndpoints?: ReadonlySet<string> }): InfrastructureRegistryEvidence;
}

const SNAPSHOT_PUBLISHED_AT = '2026-09-10T00:00:00.000Z';
const SOURCE_RETRIEVED_AT = '2026-09-08T00:00:00.000Z';
const SNAPSHOT_VALID_UNTIL = '2026-12-07T00:00:00.000Z';

export const DEFAULT_INFRASTRUCTURE_REGISTRY: InfrastructureRegistryDocument = {
    schemaVersion: 1,
    version: '2026.09.10.1',
    publishedAt: SNAPSHOT_PUBLISHED_AT,
    sources: [
        {
            id: 'meta-community-routing',
            label: 'Meta AS32934/AS63293 routing snapshot',
            uri: 'https://www.facebook.com/peering/',
            kind: 'community_snapshot',
            retrievedAt: SOURCE_RETRIEVED_AT,
            validUntil: SNAPSHOT_VALID_UNTIL,
        },
        {
            id: 'google-observed-services',
            label: 'Google service routing ranges; contextual, not STUN proof',
            uri: 'https://www.gstatic.com/ipranges/goog.json',
            kind: 'observed_heuristic',
            retrievedAt: SOURCE_RETRIEVED_AT,
            validUntil: SNAPSHOT_VALID_UNTIL,
        },
        {
            id: 'cloudflare-authoritative',
            label: 'Cloudflare published network ranges',
            uri: 'https://www.cloudflare.com/ips/',
            kind: 'authoritative',
            retrievedAt: SOURCE_RETRIEVED_AT,
            validUntil: SNAPSHOT_VALID_UNTIL,
        },
        {
            id: 'google-public-dns',
            label: 'Google Public DNS endpoints',
            uri: 'https://developers.google.com/speed/public-dns/docs/using',
            kind: 'authoritative',
            retrievedAt: SOURCE_RETRIEVED_AT,
            validUntil: SNAPSHOT_VALID_UNTIL,
        },
        {
            id: 'cloudflare-public-dns',
            label: 'Cloudflare 1.1.1.1 endpoints',
            uri: 'https://developers.cloudflare.com/1.1.1.1/ip-addresses/',
            kind: 'authoritative',
            retrievedAt: SOURCE_RETRIEVED_AT,
            validUntil: SNAPSHOT_VALID_UNTIL,
        },
        {
            id: 'curated-cloud-heuristics',
            label: 'Curated CDN and cloud routing heuristics',
            uri: null,
            kind: 'observed_heuristic',
            retrievedAt: SOURCE_RETRIEVED_AT,
            validUntil: SNAPSHOT_VALID_UNTIL,
        },
    ],
    entries: [
        {
            id: 'meta-routing',
            cidrs: [
                '31.13.24.0/21', '31.13.64.0/18', '45.64.40.0/22', '57.141.0.0/16',
                '57.142.0.0/15', '57.144.0.0/14', '57.148.0.0/15', '66.220.144.0/20',
                '69.63.176.0/20', '69.171.224.0/19', '74.119.76.0/22', '102.132.96.0/20',
                '103.4.96.0/22', '129.134.0.0/17', '157.240.0.0/16', '163.70.128.0/17',
                '173.252.64.0/18', '179.60.192.0/22', '185.60.216.0/22', '185.89.218.0/23',
                '204.15.20.0/22', '2a03:2880::/32', '2a03:2886::/32',
                '2a03:2887::/32', '2620:0:1c00::/40',
            ],
            provider: 'meta',
            category: 'meta',
            endpointRole: 'relay',
            asn: null,
            org: 'Meta Platforms / Facebook',
            sourceId: 'meta-community-routing',
            priority: 80,
        },
        {
            id: 'google-service-stun-turn',
            cidrs: [
                '64.233.160.0/19', '74.125.0.0/16', '108.177.0.0/17', '142.250.0.0/15',
                '172.217.0.0/16', '216.58.192.0/19', '216.239.32.0/19', '2001:4860::/32',
            ],
            provider: 'google',
            category: 'cloud_hosting',
            endpointRole: 'cloud_hosting',
            asn: 15169,
            org: 'Google service network',
            sourceId: 'google-observed-services',
            priority: 50,
        },
        {
            id: 'cloudflare-network',
            cidrs: [
                '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
                '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
                '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
                '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
                '2400:cb00::/32', '2606:4700::/32',
                '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29',
                '2c0f:f248::/32',
            ],
            provider: 'cloudflare',
            category: 'cdn',
            endpointRole: 'cdn',
            asn: 13335,
            org: 'Cloudflare',
            sourceId: 'cloudflare-authoritative',
            priority: 70,
        },
        {
            id: 'google-public-dns',
            cidrs: [
                '8.8.8.8/32', '8.8.4.4/32',
                '2001:4860:4860::8888/128', '2001:4860:4860::8844/128',
            ],
            provider: 'google',
            category: 'dns',
            endpointRole: 'dns',
            asn: 15169,
            org: 'Google Public DNS',
            sourceId: 'google-public-dns',
            priority: 100,
        },
        {
            id: 'cloudflare-public-dns',
            cidrs: [
                '1.1.1.1/32', '1.0.0.1/32', '1.1.1.2/32', '1.0.0.2/32',
                '1.1.1.3/32', '1.0.0.3/32', '2606:4700:4700::1111/128',
                '2606:4700:4700::1001/128', '2606:4700:4700::1112/128',
                '2606:4700:4700::1002/128', '2606:4700:4700::1113/128',
                '2606:4700:4700::1003/128',
            ],
            provider: 'cloudflare',
            category: 'dns',
            endpointRole: 'dns',
            asn: 13335,
            org: 'Cloudflare Public DNS',
            sourceId: 'cloudflare-public-dns',
            priority: 100,
        },
        {
            id: 'github-network',
            cidrs: ['140.82.112.0/20', '185.199.108.0/22', '2606:50c0::/32'],
            provider: 'unknown',
            category: 'cloud_hosting',
            endpointRole: 'cloud_hosting',
            asn: 36459,
            org: 'GitHub',
            sourceId: 'curated-cloud-heuristics',
        },
        {
            id: 'akamai-network',
            cidrs: ['2.16.0.0/13', '23.0.0.0/12', '23.32.0.0/11', '23.64.0.0/14'],
            provider: 'unknown',
            category: 'cdn',
            endpointRole: 'cdn',
            asn: 20940,
            org: 'Akamai CDN',
            sourceId: 'curated-cloud-heuristics',
        },
        {
            id: 'digitalocean-network',
            cidrs: ['104.131.0.0/16', '138.68.0.0/16', '143.198.0.0/16', '159.65.0.0/16', '167.71.0.0/16'],
            provider: 'unknown',
            category: 'cloud_hosting',
            endpointRole: 'cloud_hosting',
            asn: 14061,
            org: 'DigitalOcean',
            sourceId: 'curated-cloud-heuristics',
        },
    ],
};

function compileRange(entry: InfrastructureRegistryEntry, cidr: string): CompiledRange {
    const separator = cidr.lastIndexOf('/');
    const address = separator > 0 ? cidr.slice(0, separator) : '';
    const prefix = Number(cidr.slice(separator + 1));
    const addressFamily = isIP(address);
    const maximumPrefix = addressFamily === 4 ? 32 : addressFamily === 6 ? 128 : -1;
    if (!Number.isSafeInteger(prefix) || prefix < 0 || prefix > maximumPrefix) {
        throw new Error(`Invalid infrastructure CIDR in ${entry.id}`);
    }
    const family = addressFamily === 4 ? 'ipv4' : 'ipv6';
    const matcher = new BlockList();
    try {
        matcher.addSubnet(address, prefix, family);
    } catch {
        throw new Error(`Invalid infrastructure CIDR in ${entry.id}`);
    }
    return { entry, cidr, prefix, family, matcher };
}

function validDate(value: string): number | null {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : null;
}

export function createInfrastructureRegistry(document: InfrastructureRegistryDocument): InfrastructureRegistry {
    if (document.schemaVersion !== 1 || !document.version.trim() || validDate(document.publishedAt) === null) {
        throw new Error('Invalid infrastructure registry metadata');
    }
    const sources = new Map<string, InfrastructureRegistrySource>();
    for (const original of document.sources) {
        if (!original.id.trim() || sources.has(original.id)) {
            throw new Error('Invalid or duplicated infrastructure registry source');
        }
        sources.set(original.id, { ...original });
    }
    const entryIds = new Set<string>();
    const entries = document.entries.map(original => {
        if (!original.id.trim() || entryIds.has(original.id) || original.cidrs.length === 0) {
            throw new Error('Invalid or duplicated infrastructure registry entry');
        }
        entryIds.add(original.id);
        return { ...original, cidrs: [...original.cidrs] };
    });
    const compiled = entries.flatMap(entry => entry.cidrs.map(cidr => compileRange(entry, cidr)));

    return {
        metadata: () => ({
            schemaVersion: document.schemaVersion,
            version: document.version,
            publishedAt: document.publishedAt,
        }),
        lookup: (ip, options = {}) => {
            const addressFamily = isIP(ip);
            const base = {
                schemaVersion: document.schemaVersion,
                registryVersion: document.version,
                registryPublishedAt: document.publishedAt,
            } as const;
            if (addressFamily === 0) {
                return {
                    ...base,
                    status: 'invalid',
                    entryId: null,
                    matchedCidr: null,
                    provider: 'unknown',
                    category: null,
                    endpointRole: 'unknown',
                    asn: null,
                    org: 'Invalid network address',
                    source: null,
                    competingEntryIds: [],
                    degraded: true,
                    caution: 'Direccion IP invalida; no se realizo clasificacion de infraestructura.',
                };
            }
            if (options.ownPublicEndpoints?.has(ip)) {
                const observedAt = (options.now ?? new Date()).toISOString();
                return {
                    ...base,
                    status: 'fresh',
                    entryId: 'runtime-own-public-endpoint',
                    matchedCidr: addressFamily === 4 ? `${ip}/32` : `${ip}/128`,
                    provider: 'unknown',
                    category: null,
                    endpointRole: 'own_public_endpoint',
                    asn: null,
                    org: 'Own public endpoint',
                    source: {
                        id: 'runtime-stun-observation',
                        label: 'STUN mapped-address observed in the active capture',
                        uri: null,
                        kind: 'runtime_observation',
                        retrievedAt: observedAt,
                        validUntil: observedAt,
                    },
                    competingEntryIds: [],
                    degraded: false,
                    caution: 'Endpoint publico propio observado por STUN; no representa al contacto remoto.',
                };
            }

            const family = addressFamily === 4 ? 'ipv4' : 'ipv6';
            const matches = compiled
                .filter(range => range.family === family && range.matcher.check(ip, family))
                .sort((left, right) => (
                    right.prefix - left.prefix
                    || (right.entry.priority ?? 0) - (left.entry.priority ?? 0)
                    || left.entry.id.localeCompare(right.entry.id)
                ));
            const selected = matches[0];
            if (!selected) {
                return {
                    ...base,
                    status: 'unknown',
                    entryId: null,
                    matchedCidr: null,
                    provider: 'unknown',
                    category: null,
                    endpointRole: 'unknown',
                    asn: null,
                    org: 'Unknown public network',
                    source: null,
                    competingEntryIds: [],
                    degraded: false,
                    caution: 'Sin coincidencia en el registro local; puede ser ISP, CGNAT, VPN, proxy o infraestructura no catalogada.',
                };
            }

            const source = sources.get(selected.entry.sourceId) ?? null;
            const now = (options.now ?? new Date()).getTime();
            const retrievedAt = source ? validDate(source.retrievedAt) : null;
            const validUntil = source ? validDate(source.validUntil) : null;
            const sourceAvailable = Boolean(
                source
                && retrievedAt !== null
                && validUntil !== null
                && validUntil >= retrievedAt,
            );
            const stale = sourceAvailable && now > validUntil!;
            const sameRankConflicts = matches.filter(range => (
                range.entry.id !== selected.entry.id
                && range.prefix === selected.prefix
                && (range.entry.priority ?? 0) === (selected.entry.priority ?? 0)
            ));
            const degraded = !sourceAvailable || stale || sameRankConflicts.length > 0;
            const status: InfrastructureRegistryStatus = !sourceAvailable
                ? 'source_unavailable'
                : stale ? 'stale' : 'fresh';
            const caution = !sourceAvailable
                ? 'Coincidencia conservadora con fuente ausente o invalida; no atribuir al contacto.'
                : stale
                    ? 'Coincidencia con el ultimo snapshot disponible, actualmente vencido; requiere actualizacion antes de una conclusion formal.'
                    : sameRankConflicts.length > 0
                        ? 'Solapamiento de igual prioridad resuelto de forma determinista; requiere revision del registro.'
                        : 'Coincidencia de infraestructura vigente; describe la ruta y no identifica al contacto.';

            return {
                ...base,
                status,
                entryId: selected.entry.id,
                matchedCidr: selected.cidr,
                provider: selected.entry.provider,
                category: selected.entry.category,
                endpointRole: selected.entry.endpointRole,
                asn: selected.entry.asn,
                org: selected.entry.org,
                source: source ? { ...source } : null,
                competingEntryIds: [...new Set(matches
                    .filter(range => range.entry.id !== selected.entry.id)
                    .map(range => range.entry.id))],
                degraded,
                caution,
            };
        },
    };
}

export const infrastructureRegistry = createInfrastructureRegistry(DEFAULT_INFRASTRUCTURE_REGISTRY);

export function lookupInfrastructure(
    ip: string,
    options?: { now?: Date; ownPublicEndpoints?: ReadonlySet<string> },
): InfrastructureRegistryEvidence {
    return infrastructureRegistry.lookup(ip, options);
}

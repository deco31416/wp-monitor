import { isPrivateIP } from './meta-ip-ranges.js';
import type { CallAnalysisResult, CandidateIP } from './call-analyzer.js';
import { scoreCandidate } from './call-scoring.js';
import type { CandidateConfidence, NetworkIntelligenceCategory } from './call-scoring.js';

export interface IpEnrichment {
    ip: string;
    provider: 'db-ip' | 'db-ip+ip-api' | 'ip-api';
    sourceUrl: string;
    sources?: Array<{
        provider: 'db-ip' | 'ip-api';
        sourceUrl: string;
        status: 'success' | 'fail' | 'skipped';
        message?: string;
        fetchedAt: string;
    }>;
    status: 'success' | 'fail' | 'skipped';
    message?: string;
    continent?: string;
    country?: string;
    countryCode?: string;
    region?: string;
    regionName?: string;
    city?: string;
    postalCode?: string;
    lat?: number;
    lon?: number;
    timezone?: string;
    isp?: string;
    org?: string;
    asn?: number | null;
    asName?: string;
    mobile?: boolean;
    proxy?: boolean;
    hosting?: boolean;
    mapsUrl?: string;
    fetchedAt: string;
    cacheTtlSec: number;
    accuracyNote: string;
}

interface IpApiResponse {
    status?: string;
    message?: string;
    query?: string;
    continent?: string;
    country?: string;
    countryCode?: string;
    region?: string;
    regionName?: string;
    city?: string;
    zip?: string;
    lat?: number;
    lon?: number;
    timezone?: string;
    isp?: string;
    org?: string;
    as?: string;
    asname?: string;
    mobile?: boolean;
    proxy?: boolean;
    hosting?: boolean;
}

interface DbIpResponse {
    ipAddress?: string;
    ip?: string;
    continentCode?: string;
    continentName?: string;
    countryCode?: string;
    countryName?: string;
    stateProv?: string;
    stateProvCode?: string;
    city?: string;
    latitude?: number;
    longitude?: number;
    timeZone?: string;
    zipCode?: string;
    organization?: string;
    isp?: string;
    asNumber?: number | string;
    asName?: string;
    error?: string;
    message?: string;
}

const IP_API_FIELDS = [
    'status',
    'message',
    'query',
    'continent',
    'country',
    'countryCode',
    'region',
    'regionName',
    'city',
    'zip',
    'lat',
    'lon',
    'timezone',
    'isp',
    'org',
    'as',
    'asname',
    'mobile',
    'proxy',
    'hosting',
].join(',');

const CACHE_TTL_SEC = parsePositiveInt(process.env.IP_ENRICHMENT_CACHE_TTL_SEC, 7 * 24 * 3600);
const TIMEOUT_MS = parsePositiveInt(process.env.IP_ENRICHMENT_TIMEOUT_MS, 3500);
const ENABLED = process.env.ENABLE_IP_ENRICHMENT !== 'false';
const PRIMARY_PROVIDER = (process.env.IP_ENRICHMENT_PRIMARY_PROVIDER || 'db-ip').toLowerCase();
const DB_IP_API_KEY = process.env.DB_IP_API_KEY || 'free';
const cache = new Map<string, { value: IpEnrichment; expiresAt: number }>();

export async function enrichCallAnalysis(result: CallAnalysisResult): Promise<CallAnalysisResult> {
    if (!ENABLED || !Array.isArray(result.candidateIps) || result.candidateIps.length === 0) {
        return result;
    }

    const enrichedCandidates: CandidateIP[] = [];
    for (const candidate of result.candidateIps) {
        enrichedCandidates.push(await enrichCandidate(candidate, result.targetJid, result.durationSec));
    }

    enrichedCandidates.sort((a, b) => {
        if (a.isP2P !== b.isP2P) return a.isP2P ? -1 : 1;
        return b.confidenceScore - a.confidenceScore || b.packets - a.packets;
    });

    const p2pCandidates = enrichedCandidates.filter(candidate => candidate.isP2P && candidate.confidence !== 'low');
    const verdict = result.totalPackets < 10
        ? 'insufficient_data'
        : p2pCandidates.length > 0 && result.metaIps.length > 0
            ? 'mixed'
            : p2pCandidates.length > 0
                ? 'p2p'
                : 'relay';

    return {
        ...result,
        candidateIps: enrichedCandidates,
        verdict,
    };
}

async function enrichCandidate(candidate: CandidateIP, targetJid: string, durationSec: number): Promise<CandidateIP> {
    const enrichment = await lookupIpEnrichment(candidate.ip);
    if (!enrichment || enrichment.status !== 'success') {
        return enrichment ? { ...candidate, ipEnrichment: enrichment } : candidate;
    }

    const geo = typeof enrichment.lat === 'number' && typeof enrichment.lon === 'number'
        ? {
            country: enrichment.countryCode || enrichment.country || candidate.geo?.country || '',
            region: enrichment.regionName || enrichment.region || candidate.geo?.region || '',
            city: enrichment.city || candidate.geo?.city || '',
            lat: enrichment.lat,
            lon: enrichment.lon,
            timezone: enrichment.timezone || candidate.geo?.timezone || '',
        }
        : candidate.geo;

    const enriched = applyEnrichmentClassification({
        ...candidate,
        geo,
        ipEnrichment: enrichment,
    }, enrichment);
    return reScoreEnrichedCandidate(enriched, targetJid, durationSec);
}

export function applyEnrichmentClassification(candidate: CandidateIP, enrichment: IpEnrichment): CandidateIP {
    if (enrichment.status !== 'success') {
        return candidate;
    }

    const infrastructure = detectInfrastructureEnrichment(enrichment);
    if (infrastructure) {
        const confidenceScore = Math.min(candidate.confidenceScore, infrastructure.cap);
        const reasonExists = candidate.reasonCodes.some(reason => reason.code === infrastructure.reasonCode);

        return {
            ...candidate,
            networkCategory: infrastructure.category === 'cdn' ? 'cdn' : 'cloud_hosting',
            networkIntelligence: {
                ...candidate.networkIntelligence,
                asn: enrichment.asn ?? candidate.networkIntelligence.asn,
                org: infrastructure.org,
                category: infrastructure.category,
                isDatacenterLikely: true,
                caution: 'Clasificacion ajustada por enriquecimiento ASN/ISP/ORG. Red cloud/CDN/hosting/proxy observada; no identifica usuario final.',
            },
            confidenceScore,
            confidence: confidenceFromScore(confidenceScore),
            isP2P: false,
            reasonCodes: reasonExists
                ? candidate.reasonCodes
                : [
                    ...candidate.reasonCodes,
                    {
                        code: infrastructure.reasonCode,
                        label: infrastructure.reasonLabel,
                        delta: infrastructure.delta,
                    },
                ],
            technicalNote: 'Infraestructura cloud/CDN/hosting/proxy detectada por enriquecimiento IP. No debe tratarse como IP candidata de usuario; sirve como evidencia de ruta/relay.',
        };
    }

    const enrichedOrg = buildEnrichmentOrg(enrichment);
    if (enrichedOrg && candidate.networkIntelligence.org === 'Unknown public network') {
        return {
            ...candidate,
            networkIntelligence: {
                ...candidate.networkIntelligence,
                asn: enrichment.asn ?? candidate.networkIntelligence.asn,
                org: enrichedOrg,
                category: 'consumer_isp_or_unknown',
                isDatacenterLikely: false,
                caution: 'ASN/ORG enriquecido desde proveedor externo. Puede ser ISP, CGNAT o infraestructura no catalogada; requiere corroboracion externa.',
            },
        };
    }

    return candidate;
}

function reScoreEnrichedCandidate(candidate: CandidateIP, targetJid: string, durationSec: number): CandidateIP {
    const observedCountryCode = candidate.ipEnrichment?.countryCode
        || candidate.ipEnrichment?.country
        || candidate.geo?.country;
    const score = scoreCandidate({
        provider: candidate.provider,
        networkIntelligence: candidate.networkIntelligence,
        packets: candidate.packets,
        bytesTotal: candidate.bytesTotal,
        direction: candidate.direction,
        ports: candidate.ports,
        durationSec,
        targetJid,
        observedCountryCode,
    });

    return {
        ...candidate,
        networkCategory: score.networkCategory,
        confidence: score.confidence,
        confidenceScore: score.confidenceScore,
        reasonCodes: score.reasonCodes,
        technicalNote: score.technicalNote,
        isP2P: score.isP2P,
        correlation: score.correlation,
    };
}

function detectInfrastructureEnrichment(enrichment: IpEnrichment): {
    category: Extract<NetworkIntelligenceCategory, 'cdn' | 'cloud_hosting'>;
    org: string;
    cap: number;
    delta: number;
    reasonCode: string;
    reasonLabel: string;
} | null {
    const org = buildEnrichmentOrg(enrichment) || 'Proveedor cloud/CDN/hosting';
    const haystack = [
        enrichment.isp,
        enrichment.org,
        enrichment.asName,
        enrichment.asn ? `AS${enrichment.asn}` : '',
    ].filter(Boolean).join(' ').toLowerCase();

    const cdnAsns = new Set([13335, 16625, 54113, 20940, 35994]);
    const cloudAsns = new Set([8075, 14618, 15169, 16509, 396982, 14061, 16276, 24940, 31898, 45102, 63949]);
    const cdnTerms = ['cloudflare', 'akamai', 'fastly', 'cloudfront', 'cdn'];
    const cloudTerms = ['amazon', 'aws', 'google cloud', 'google llc', 'microsoft', 'azure', 'digitalocean', 'ovh', 'hetzner', 'oracle cloud', 'alibaba', 'tencent', 'hosting', 'datacenter', 'data center'];

    if (enrichment.proxy || enrichment.hosting) {
        return {
            category: 'cloud_hosting',
            org,
            cap: 25,
            delta: -45,
            reasonCode: enrichment.proxy ? 'ENRICHED_PROXY_NETWORK' : 'ENRICHED_HOSTING_NETWORK',
            reasonLabel: enrichment.proxy
                ? 'Proveedor externo marco la IP como proxy/VPN'
                : 'Proveedor externo marco la IP como hosting/datacenter',
        };
    }

    if ((enrichment.asn && cdnAsns.has(enrichment.asn)) || cdnTerms.some(term => haystack.includes(term))) {
        return {
            category: 'cdn',
            org,
            cap: 30,
            delta: -40,
            reasonCode: 'ENRICHED_CDN_PROVIDER',
            reasonLabel: 'ASN/ISP/ORG enriquecido corresponde a CDN o edge cache',
        };
    }

    if ((enrichment.asn && cloudAsns.has(enrichment.asn)) || cloudTerms.some(term => haystack.includes(term))) {
        return {
            category: 'cloud_hosting',
            org,
            cap: 35,
            delta: -35,
            reasonCode: 'ENRICHED_CLOUD_PROVIDER',
            reasonLabel: 'ASN/ISP/ORG enriquecido corresponde a cloud/hosting',
        };
    }

    return null;
}

function buildEnrichmentOrg(enrichment: IpEnrichment): string {
    const asn = enrichment.asn ? `AS${enrichment.asn}` : '';
    const label = enrichment.org || enrichment.isp || enrichment.asName || '';
    return [asn, label].filter(Boolean).join(' · ');
}

export async function lookupIpEnrichment(ip: string): Promise<IpEnrichment | null> {
    if (!ip || isPrivateIP(ip)) {
        return buildSkippedEnrichment(ip, 'private_or_reserved_ip');
    }

    const now = Date.now();
    const cached = cache.get(ip);
    if (cached && cached.expiresAt > now) {
        return cached.value;
    }

    const dbIpUrl = buildDbIpUrl(ip);
    const ipApiUrl = buildIpApiUrl(ip);
    try {
        const normalized = PRIMARY_PROVIDER === 'ip-api'
            ? await lookupIpApiOnly(ip, ipApiUrl)
            : await lookupDbIpPrimary(ip, dbIpUrl, ipApiUrl);
        cacheResult(ip, normalized, CACHE_TTL_SEC);
        return normalized;
    } catch (error) {
        const failed = buildFailedEnrichment(ip, `${dbIpUrl} | ${ipApiUrl}`, error instanceof Error ? error.message : 'request_failed');
        cacheResult(ip, failed, Math.min(CACHE_TTL_SEC, 1800));
        return failed;
    }
}

async function lookupDbIpPrimary(ip: string, dbIpUrl: string, ipApiUrl: string): Promise<IpEnrichment> {
    const dbIp = await fetchDbIpEnrichment(ip, dbIpUrl);
    const ipApi = await fetchIpApiEnrichment(ip, ipApiUrl);

    if (dbIp.status === 'success') {
        return mergeDbIpWithIpApi(dbIp, ipApi);
    }

    if (ipApi.status === 'success') {
        return {
            ...ipApi,
            sources: [sourceSummary(dbIp), sourceSummary(ipApi)],
            message: dbIp.message ? `DB-IP unavailable: ${dbIp.message}` : ipApi.message,
        };
    }

    return {
        ...dbIp,
        provider: 'db-ip',
        sources: [sourceSummary(dbIp), sourceSummary(ipApi)],
        message: dbIp.message || ipApi.message || 'all_providers_failed',
    };
}

async function lookupIpApiOnly(ip: string, ipApiUrl: string): Promise<IpEnrichment> {
    return fetchIpApiEnrichment(ip, ipApiUrl);
}

async function fetchDbIpEnrichment(ip: string, sourceUrl: string): Promise<IpEnrichment> {
    try {
        const response = await fetchWithTimeout(sourceUrl);
        if (!response.ok) {
            return buildFailedEnrichment(ip, sourceUrl, `db-ip_http_${response.status}`, 'db-ip');
        }

        const payload = await response.json() as DbIpResponse;
        return normalizeDbIpResponse(payload, sourceUrl);
    } catch (error) {
        return buildFailedEnrichment(ip, sourceUrl, error instanceof Error ? `db-ip_${error.message}` : 'db-ip_request_failed', 'db-ip');
    }
}

async function fetchIpApiEnrichment(ip: string, sourceUrl: string): Promise<IpEnrichment> {
    try {
        const response = await fetchWithTimeout(sourceUrl);
        if (!response.ok) {
            return buildFailedEnrichment(ip, sourceUrl, `ip-api_http_${response.status}`, 'ip-api');
        }

        const payload = await response.json() as IpApiResponse;
        return normalizeIpApiResponse(payload, sourceUrl);
    } catch (error) {
        return buildFailedEnrichment(ip, sourceUrl, error instanceof Error ? `ip-api_${error.message}` : 'ip-api_request_failed', 'ip-api');
    }
}

async function fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        return await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'WP-MONITOR/2.9.1 ip-enrichment',
            },
        });
    } finally {
        clearTimeout(timeout);
    }
}

function mergeDbIpWithIpApi(dbIp: IpEnrichment, ipApi: IpEnrichment): IpEnrichment {
    const useFallbackCoords = shouldUseFallbackCoordinates(dbIp, ipApi);
    const mergedLat = dbIp.lat ?? (useFallbackCoords ? ipApi.lat : undefined);
    const mergedLon = dbIp.lon ?? (useFallbackCoords ? ipApi.lon : undefined);
    const provider = ipApi.status === 'success' ? 'db-ip+ip-api' : 'db-ip';
    const coordNote = useFallbackCoords || typeof dbIp.lat === 'number'
        ? ''
        : ' DB-IP free no entrego coordenadas y se omitieron coordenadas de fallback por discrepancia de ciudad/proveedor.';

    return {
        ...ipApi,
        ...dbIp,
        provider,
        sourceUrl: dbIp.sourceUrl,
        sources: [sourceSummary(dbIp), sourceSummary(ipApi)],
        status: 'success',
        message: dbIp.message || ipApi.message,
        lat: mergedLat,
        lon: mergedLon,
        timezone: dbIp.timezone || ipApi.timezone,
        postalCode: dbIp.postalCode || ipApi.postalCode,
        isp: dbIp.isp || ipApi.isp,
        org: dbIp.org || ipApi.org,
        asn: dbIp.asn ?? ipApi.asn,
        asName: dbIp.asName || ipApi.asName,
        mobile: ipApi.mobile,
        proxy: ipApi.proxy,
        hosting: ipApi.hosting,
        mapsUrl: typeof mergedLat === 'number' && typeof mergedLon === 'number'
            ? `https://www.google.com/maps?q=${mergedLat},${mergedLon}`
            : undefined,
        accuracyNote: ipApi.status === 'success'
            ? `GeoIP principal DB-IP para pais/region/ciudad, complementado con ip-api para ASN/ISP/flags y coordenadas solo cuando no contradicen la ciudad principal.${coordNote} Ubicacion estimada de red/ISP; no confirma ubicacion fisica exacta, identidad ni titularidad.`
            : 'GeoIP principal DB-IP. Ubicacion estimada de red/ISP; no confirma ubicacion fisica exacta, identidad ni titularidad.',
    };
}

function shouldUseFallbackCoordinates(dbIp: IpEnrichment, ipApi: IpEnrichment): boolean {
    if (typeof ipApi.lat !== 'number' || typeof ipApi.lon !== 'number') return false;
    if (!dbIp.city && !dbIp.regionName) return true;

    const dbCountry = normalizeGeoLabel(dbIp.countryCode || dbIp.country);
    const apiCountry = normalizeGeoLabel(ipApi.countryCode || ipApi.country);
    if (dbCountry && apiCountry && dbCountry !== apiCountry) return false;

    const dbCity = normalizeGeoLabel(dbIp.city);
    const apiCity = normalizeGeoLabel(ipApi.city);
    if (dbCity && apiCity) {
        return dbCity.includes(apiCity) || apiCity.includes(dbCity);
    }

    const dbRegion = normalizeGeoLabel(dbIp.regionName || dbIp.region);
    const apiRegion = normalizeGeoLabel(ipApi.regionName || ipApi.region);
    return Boolean(dbRegion && apiRegion && (dbRegion.includes(apiRegion) || apiRegion.includes(dbRegion)));
}

function normalizeGeoLabel(value?: string): string {
    return (value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\([^)]*\)/g, '')
        .replace(/[^a-z0-9]+/gi, ' ')
        .trim()
        .toLowerCase();
}

export function normalizeIpApiResponse(payload: IpApiResponse, sourceUrl: string): IpEnrichment {
    const ip = payload.query || '';
    const asn = parseAsn(payload.as);
    const lat = toFiniteNumber(payload.lat);
    const lon = toFiniteNumber(payload.lon);

    return {
        ip,
        provider: 'ip-api',
        sourceUrl,
        status: payload.status === 'success' ? 'success' : 'fail',
        message: payload.message,
        continent: payload.continent,
        country: payload.country,
        countryCode: payload.countryCode,
        region: payload.region,
        regionName: payload.regionName,
        city: payload.city,
        postalCode: payload.zip,
        lat,
        lon,
        timezone: payload.timezone,
        isp: payload.isp,
        org: payload.org,
        asn,
        asName: payload.asname || parseAsName(payload.as),
        mobile: payload.mobile,
        proxy: payload.proxy,
        hosting: payload.hosting,
        mapsUrl: typeof lat === 'number' && typeof lon === 'number'
            ? `https://www.google.com/maps?q=${lat},${lon}`
            : undefined,
        fetchedAt: new Date().toISOString(),
        cacheTtlSec: CACHE_TTL_SEC,
        accuracyNote: 'Ubicacion estimada de red/ISP. No confirma ubicacion fisica exacta, identidad ni titularidad del usuario.',
    };
}

export function normalizeDbIpResponse(payload: DbIpResponse, sourceUrl: string): IpEnrichment {
    const ip = payload.ipAddress || payload.ip || '';
    const lat = toFiniteNumber(payload.latitude);
    const lon = toFiniteNumber(payload.longitude);
    const asn = typeof payload.asNumber === 'number'
        ? payload.asNumber
        : parseAsn(payload.asNumber ? `AS${payload.asNumber}` : undefined);
    const status = payload.error ? 'fail' : 'success';

    return {
        ip,
        provider: 'db-ip',
        sourceUrl,
        status,
        message: payload.error || payload.message,
        continent: payload.continentName || payload.continentCode,
        country: payload.countryName,
        countryCode: payload.countryCode,
        region: payload.stateProvCode,
        regionName: payload.stateProv,
        city: payload.city,
        postalCode: payload.zipCode,
        lat,
        lon,
        timezone: payload.timeZone,
        isp: payload.isp,
        org: payload.organization,
        asn,
        asName: payload.asName,
        mapsUrl: typeof lat === 'number' && typeof lon === 'number'
            ? `https://www.google.com/maps?q=${lat},${lon}`
            : undefined,
        fetchedAt: new Date().toISOString(),
        cacheTtlSec: CACHE_TTL_SEC,
        accuracyNote: 'GeoIP principal DB-IP. Ubicacion estimada de red/ISP; no confirma ubicacion fisica exacta, identidad ni titularidad.',
    };
}

function buildDbIpUrl(ip: string): string {
    return `https://api.db-ip.com/v2/${encodeURIComponent(DB_IP_API_KEY)}/${encodeURIComponent(ip)}`;
}

function buildIpApiUrl(ip: string): string {
    return `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=${encodeURIComponent(IP_API_FIELDS)}&lang=es`;
}

function buildSkippedEnrichment(ip: string, message: string): IpEnrichment {
    return {
        ip,
        provider: PRIMARY_PROVIDER === 'ip-api' ? 'ip-api' : 'db-ip',
        sourceUrl: '',
        status: 'skipped',
        message,
        fetchedAt: new Date().toISOString(),
        cacheTtlSec: CACHE_TTL_SEC,
        accuracyNote: 'IP privada, local o reservada; no aplica geolocalizacion publica.',
    };
}

function buildFailedEnrichment(ip: string, sourceUrl: string, message: string, provider: IpEnrichment['provider'] = PRIMARY_PROVIDER === 'ip-api' ? 'ip-api' : 'db-ip'): IpEnrichment {
    return {
        ip,
        provider,
        sourceUrl,
        status: 'fail',
        message,
        fetchedAt: new Date().toISOString(),
        cacheTtlSec: CACHE_TTL_SEC,
        accuracyNote: 'No se pudo consultar el proveedor externo. Se conserva la clasificacion local disponible.',
    };
}

function sourceSummary(enrichment: IpEnrichment): NonNullable<IpEnrichment['sources']>[number] {
    return {
        provider: enrichment.provider === 'ip-api' ? 'ip-api' : 'db-ip',
        sourceUrl: enrichment.sourceUrl,
        status: enrichment.status,
        message: enrichment.message,
        fetchedAt: enrichment.fetchedAt,
    };
}

function cacheResult(ip: string, value: IpEnrichment, ttlSec: number): void {
    cache.set(ip, {
        value,
        expiresAt: Date.now() + ttlSec * 1000,
    });
}

function parseAsn(value?: string): number | null {
    const match = value?.match(/\bAS(\d+)\b/i);
    return match ? Number(match[1]) : null;
}

function parseAsName(value?: string): string | undefined {
    return value?.replace(/\bAS\d+\b\s*/i, '').trim() || undefined;
}

function toFiniteNumber(value?: number): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function confidenceFromScore(score: number): CandidateConfidence {
    if (score >= 75) return 'high';
    if (score >= 45) return 'medium';
    return 'low';
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

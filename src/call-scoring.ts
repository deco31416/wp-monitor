export type CandidateProvider = 'meta' | 'google' | 'cloudflare' | 'unknown';
export type CandidateDirection = 'incoming' | 'outgoing' | 'bidirectional';
export type NetworkCategory = 'meta' | 'stun_turn' | 'cdn' | 'cloud_hosting' | 'consumer_isp_or_unknown' | 'unknown_public';
export type NetworkIntelligenceCategory = 'meta' | 'stun_turn' | 'cdn' | 'cloud_hosting' | 'consumer_isp_or_unknown' | 'unknown';
export type CandidateConfidence = 'high' | 'medium' | 'low';

export interface NetworkIntelligence {
    asn: number | null;
    org: string;
    category: NetworkIntelligenceCategory;
    source: 'local_rules';
    isDatacenterLikely: boolean;
    caution: string;
}

export interface CandidateReasonCode {
    code: string;
    label: string;
    delta: number;
}

export interface CandidateCorrelation {
    classification: 'candidate' | 'weak' | 'insufficient' | 'context_mismatch' | 'infrastructure';
    label: string;
    summary: string;
    phoneCountryCode?: string | null;
    observedCountryCode?: string | null;
    caps: string[];
}

export interface CandidateScoreInput {
    provider: CandidateProvider;
    networkIntelligence: NetworkIntelligence;
    packets: number;
    bytesTotal: number;
    direction: CandidateDirection;
    ports: number[];
    durationSec: number;
    targetJid?: string | null;
    observedCountryCode?: string | null;
}

export interface CandidateScoreResult {
    confidence: CandidateConfidence;
    confidenceScore: number;
    reasonCodes: CandidateReasonCode[];
    technicalNote: string;
    networkCategory: NetworkCategory;
    isP2P: boolean;
    correlation: CandidateCorrelation;
}

interface LocalNetworkRule {
    cidrs: string[];
    asn: number | null;
    org: string;
    category: NetworkIntelligenceCategory;
    isDatacenterLikely: boolean;
}

const LOCAL_NETWORK_RULES: LocalNetworkRule[] = [
    {
        cidrs: ['31.13.24.0/21', '31.13.64.0/18', '45.64.40.0/22', '57.141.0.0/16', '57.142.0.0/15', '57.144.0.0/14', '57.148.0.0/15', '66.220.144.0/20', '69.63.176.0/20', '69.171.224.0/19', '74.119.76.0/22', '102.132.96.0/20', '129.134.0.0/17', '147.75.208.0/20', '157.240.0.0/17', '163.70.128.0/17', '173.252.64.0/18', '179.60.192.0/22', '185.60.216.0/22', '204.15.20.0/22'],
        asn: 32934,
        org: 'Meta Platforms / Facebook',
        category: 'meta',
        isDatacenterLikely: true,
    },
    {
        cidrs: ['142.250.0.0/15', '172.217.0.0/16', '216.58.192.0/19', '216.239.32.0/19', '74.125.0.0/16', '64.233.160.0/19', '108.177.0.0/17', '34.0.0.0/8', '35.0.0.0/8'],
        asn: 15169,
        org: 'Google / Google Cloud',
        category: 'stun_turn',
        isDatacenterLikely: true,
    },
    {
        cidrs: ['104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22', '141.101.64.0/18', '162.158.0.0/15', '188.114.96.0/20', '190.93.240.0/20', '197.234.240.0/22', '198.41.128.0/17'],
        asn: 13335,
        org: 'Cloudflare',
        category: 'cdn',
        isDatacenterLikely: true,
    },
    {
        cidrs: ['140.82.112.0/20', '185.199.108.0/22'],
        asn: 36459,
        org: 'GitHub',
        category: 'cloud_hosting',
        isDatacenterLikely: true,
    },
    {
        cidrs: ['2.16.0.0/13', '2.22.0.0/15', '23.0.0.0/12', '23.32.0.0/11', '23.64.0.0/14'],
        asn: 20940,
        org: 'Akamai CDN',
        category: 'cdn',
        isDatacenterLikely: true,
    },
    {
        cidrs: ['3.0.0.0/8', '13.32.0.0/15', '18.0.0.0/8', '52.0.0.0/8', '54.0.0.0/8'],
        asn: null,
        org: 'Amazon/AWS range heuristic',
        category: 'cloud_hosting',
        isDatacenterLikely: true,
    },
    {
        cidrs: ['20.0.0.0/8', '40.0.0.0/8', '51.104.0.0/15'],
        asn: null,
        org: 'Microsoft/Azure range heuristic',
        category: 'cloud_hosting',
        isDatacenterLikely: true,
    },
    {
        cidrs: ['104.131.0.0/16', '138.68.0.0/16', '143.198.0.0/16', '159.65.0.0/16', '167.71.0.0/16'],
        asn: 14061,
        org: 'DigitalOcean',
        category: 'cloud_hosting',
        isDatacenterLikely: true,
    },
];

export function classifyNetworkCategory(provider: CandidateProvider): NetworkCategory {
    if (provider === 'meta') return 'meta';
    if (provider === 'google') return 'stun_turn';
    if (provider === 'cloudflare') return 'cdn';
    return 'unknown_public';
}

export function lookupNetworkIntelligence(ip: string, provider: CandidateProvider): NetworkIntelligence {
    const matched = LOCAL_NETWORK_RULES.find(rule => rule.cidrs.some(cidr => matchesCidr(ip, cidr)));
    if (matched) {
        return {
            asn: matched.asn,
            org: matched.org,
            category: matched.category,
            source: 'local_rules',
            isDatacenterLikely: matched.isDatacenterLikely,
            caution: 'Clasificacion local heuristica. Requiere corroboracion con fuente ASN/WHOIS actualizada si se usa en informe formal.',
        };
    }

    if (provider !== 'unknown') {
        const category = classifyNetworkCategory(provider);
        return {
            asn: null,
            org: provider,
            category: category === 'unknown_public' ? 'unknown' : category,
            source: 'local_rules',
            isDatacenterLikely: true,
            caution: 'Proveedor clasificado por reglas locales. No identifica usuario final.',
        };
    }

    return {
        asn: null,
        org: 'Unknown public network',
        category: 'consumer_isp_or_unknown',
        source: 'local_rules',
        isDatacenterLikely: false,
        caution: 'Sin ASN/ORG verificado localmente. Puede ser ISP, CGNAT, VPN, proxy, relay o infraestructura no catalogada.',
    };
}

export function scoreCandidate(input: CandidateScoreInput): CandidateScoreResult {
    const networkCategory = networkCategoryFromIntelligence(input.networkIntelligence.category, input.provider);
    const reasonCodes: CandidateReasonCode[] = [];
    let score = input.provider === 'unknown' ? 35 : 5;

    if (input.provider === 'unknown' && !input.networkIntelligence.isDatacenterLikely) {
        reasonCodes.push({ code: 'UNKNOWN_PUBLIC_PROVIDER', label: 'IP publica fuera de proveedores relay conocidos', delta: 35 });
    } else {
        reasonCodes.push({ code: 'KNOWN_INFRASTRUCTURE', label: `Infraestructura probable: ${input.networkIntelligence.org}`, delta: -30 });
    }

    if (input.networkIntelligence.category === 'consumer_isp_or_unknown') {
        score += 10;
        reasonCodes.push({ code: 'NO_LOCAL_ASN_MATCH', label: 'Sin coincidencia local de ASN/ORG cloud o relay', delta: 10 });
    }

    if (input.networkIntelligence.isDatacenterLikely) {
        score -= 25;
        reasonCodes.push({ code: 'DATACENTER_OR_RELAY_LIKELY', label: 'ASN/ORG o rango sugiere datacenter, CDN o relay', delta: -25 });
    }

    if (input.direction === 'bidirectional') {
        score += 25;
        reasonCodes.push({ code: 'BIDIRECTIONAL_TRAFFIC', label: 'Flujo bidireccional observado', delta: 25 });
    } else {
        score -= 10;
        reasonCodes.push({ code: 'ONE_WAY_TRAFFIC', label: 'Solo se observo trafico en una direccion', delta: -10 });
    }

    if (input.packets >= 250) {
        score += 20;
        reasonCodes.push({ code: 'HIGH_PACKET_VOLUME', label: 'Volumen alto de paquetes durante la ventana', delta: 20 });
    } else if (input.packets >= 75) {
        score += 12;
        reasonCodes.push({ code: 'MEDIUM_PACKET_VOLUME', label: 'Volumen medio de paquetes durante la ventana', delta: 12 });
    } else if (input.packets >= 20) {
        score += 6;
        reasonCodes.push({ code: 'LOW_PACKET_VOLUME', label: 'Volumen bajo pero util de paquetes', delta: 6 });
    } else {
        score -= 15;
        reasonCodes.push({ code: 'INSUFFICIENT_PACKET_VOLUME', label: 'Muy pocos paquetes para confianza fuerte', delta: -15 });
    }

    const avgBytes = input.packets > 0 ? input.bytesTotal / input.packets : 0;
    if (avgBytes >= 80 && avgBytes <= 1400) {
        score += 5;
        reasonCodes.push({ code: 'REALISTIC_PACKET_SIZE', label: 'Tamano promedio compatible con trafico multimedia/UDP', delta: 5 });
    }

    const hasStunTurnPort = input.ports.some(port => [3478, 3479, 5349, 19302].includes(port));
    if (hasStunTurnPort) {
        score -= 20;
        reasonCodes.push({ code: 'STUN_TURN_PORT', label: 'Puerto asociado a STUN/TURN/relay observado', delta: -20 });
    }

    if (input.durationSec > 0 && input.packets / input.durationSec >= 2) {
        score += 8;
        reasonCodes.push({ code: 'TEMPORAL_DENSITY', label: 'Densidad temporal consistente durante la captura', delta: 8 });
    }

    if (networkCategory !== 'unknown_public' && networkCategory !== 'consumer_isp_or_unknown') {
        score = Math.min(score, 30);
    }

    const phoneContext = inferPhoneCountryFromJid(input.targetJid);
    const observedCountryCode = normalizeCountryCode(input.observedCountryCode);
    const caps: string[] = [];

    if (input.packets < 10) {
        const before = score;
        score = Math.min(score, 15);
        caps.push('Muestra minima insuficiente');
        reasonCodes.push({
            code: 'HARD_CAP_TINY_SAMPLE',
            label: 'Menos de 10 paquetes: no se acepta como candidata',
            delta: Math.min(0, score - before),
        });
    } else if (input.packets < 20) {
        const before = score;
        score = Math.min(score, 30);
        caps.push('Muestra baja');
        reasonCodes.push({
            code: 'CAP_LOW_SAMPLE',
            label: 'Menos de 20 paquetes: confianza limitada',
            delta: Math.min(0, score - before),
        });
    }

    const hasCountryMismatch = Boolean(
        phoneContext?.countryCode
        && observedCountryCode
        && phoneContext.countryCode !== observedCountryCode
    );

    if (hasCountryMismatch) {
        const before = score;
        score -= 15;
        reasonCodes.push({
            code: 'PHONE_GEO_COUNTRY_MISMATCH',
            label: `Pais GeoIP (${observedCountryCode}) no coincide con prefijo telefonico (${phoneContext?.countryCode})`,
            delta: -15,
        });

        if (input.packets < 50) {
            score = Math.min(score, 20);
            caps.push('Pais no correlaciona con el numero y la muestra es baja');
            reasonCodes.push({
                code: 'CAP_COUNTRY_MISMATCH_LOW_SAMPLE',
                label: 'Muestra baja con pais divergente: observacion no concluyente',
                delta: Math.min(0, score - (before - 15)),
            });
        }
    }

    if (input.direction !== 'bidirectional') {
        const before = score;
        score = Math.min(score, 45);
        if (before > score) {
            caps.push('Flujo de una sola direccion');
            reasonCodes.push({
                code: 'CAP_ONE_WAY_FLOW',
                label: 'Sin flujo bidireccional fuerte: no subir de confianza media',
                delta: score - before,
            });
        }
    }

    const confidenceScore = clampScore(score);
    const confidence = confidenceFromScore(confidenceScore);
    const baseP2P = input.provider === 'unknown' && !input.networkIntelligence.isDatacenterLikely;
    const correlation = buildCorrelation({
        baseP2P,
        confidenceScore,
        packets: input.packets,
        hasCountryMismatch,
        phoneCountryCode: phoneContext?.countryCode || null,
        observedCountryCode,
        networkCategory,
        caps,
    });
    const isP2P = baseP2P && confidenceScore >= 45 && correlation.classification === 'candidate';
    const technicalNote = buildTechnicalNote(baseP2P, correlation);

    return { confidence, confidenceScore, reasonCodes, technicalNote, networkCategory, isP2P, correlation };
}

function networkCategoryFromIntelligence(category: NetworkIntelligenceCategory, provider: CandidateProvider): NetworkCategory {
    if (category === 'meta') return 'meta';
    if (category === 'stun_turn') return 'stun_turn';
    if (category === 'cdn') return 'cdn';
    if (category === 'cloud_hosting') return 'cloud_hosting';
    if (category === 'consumer_isp_or_unknown') return 'consumer_isp_or_unknown';
    return classifyNetworkCategory(provider);
}

export function inferPhoneCountryFromJid(jid?: string | null): { countryCode: string; callingCode: string; label: string } | null {
    const digits = (jid || '').split('@')[0]?.replace(/\D/g, '') || '';
    if (!digits) return null;

    const prefixes: Array<{ callingCode: string; countryCode: string; label: string }> = [
        { callingCode: '593', countryCode: 'EC', label: 'Ecuador' },
        { callingCode: '598', countryCode: 'UY', label: 'Uruguay' },
        { callingCode: '595', countryCode: 'PY', label: 'Paraguay' },
        { callingCode: '591', countryCode: 'BO', label: 'Bolivia' },
        { callingCode: '502', countryCode: 'GT', label: 'Guatemala' },
        { callingCode: '503', countryCode: 'SV', label: 'El Salvador' },
        { callingCode: '504', countryCode: 'HN', label: 'Honduras' },
        { callingCode: '505', countryCode: 'NI', label: 'Nicaragua' },
        { callingCode: '506', countryCode: 'CR', label: 'Costa Rica' },
        { callingCode: '507', countryCode: 'PA', label: 'Panama' },
        { callingCode: '52', countryCode: 'MX', label: 'Mexico' },
        { callingCode: '57', countryCode: 'CO', label: 'Colombia' },
        { callingCode: '58', countryCode: 'VE', label: 'Venezuela' },
        { callingCode: '51', countryCode: 'PE', label: 'Peru' },
        { callingCode: '54', countryCode: 'AR', label: 'Argentina' },
        { callingCode: '55', countryCode: 'BR', label: 'Brasil' },
        { callingCode: '56', countryCode: 'CL', label: 'Chile' },
        { callingCode: '34', countryCode: 'ES', label: 'Espana' },
        { callingCode: '1', countryCode: 'US', label: 'NANP/US-CA-Caribe' },
    ];

    return prefixes
        .sort((a, b) => b.callingCode.length - a.callingCode.length)
        .find(prefix => digits.startsWith(prefix.callingCode)) || null;
}

function buildCorrelation(input: {
    baseP2P: boolean;
    confidenceScore: number;
    packets: number;
    hasCountryMismatch: boolean;
    phoneCountryCode: string | null;
    observedCountryCode: string | null;
    networkCategory: NetworkCategory;
    caps: string[];
}): CandidateCorrelation {
    if (!input.baseP2P) {
        return {
            classification: 'infrastructure',
            label: 'Infraestructura / relay',
            summary: 'La IP coincide con infraestructura, CDN, cloud o relay probable; se conserva como ruta observada, no como candidata de usuario.',
            phoneCountryCode: input.phoneCountryCode,
            observedCountryCode: input.observedCountryCode,
            caps: input.caps,
        };
    }

    if (input.packets < 10) {
        return {
            classification: 'insufficient',
            label: 'No concluyente',
            summary: 'La muestra tiene menos de 10 paquetes. Puede ser ruido, cache, relay residual, DNS/CDN o trafico paralelo de la maquina.',
            phoneCountryCode: input.phoneCountryCode,
            observedCountryCode: input.observedCountryCode,
            caps: input.caps,
        };
    }

    if (input.hasCountryMismatch && input.packets < 50) {
        return {
            classification: 'context_mismatch',
            label: 'Contexto divergente',
            summary: 'El pais GeoIP observado no correlaciona con el prefijo telefonico y la muestra es baja; requiere nueva captura o evidencia externa.',
            phoneCountryCode: input.phoneCountryCode,
            observedCountryCode: input.observedCountryCode,
            caps: input.caps,
        };
    }

    if (input.confidenceScore < 45) {
        return {
            classification: 'weak',
            label: 'Debil / no concluyente',
            summary: 'La senal existe, pero el score queda por debajo del umbral operativo para tratarla como candidata.',
            phoneCountryCode: input.phoneCountryCode,
            observedCountryCode: input.observedCountryCode,
            caps: input.caps,
        };
    }

    return {
        classification: 'candidate',
        label: 'Candidata tecnica',
        summary: 'IP publica observada con volumen/correlacion suficientes para revision tecnica. No confirma identidad, titularidad ni ubicacion exacta.',
        phoneCountryCode: input.phoneCountryCode,
        observedCountryCode: input.observedCountryCode,
        caps: input.caps,
    };
}

function buildTechnicalNote(baseP2P: boolean, correlation: CandidateCorrelation): string {
    if (!baseP2P) {
        return 'Infraestructura o relay conocido/probable. No debe tratarse como IP candidata de usuario.';
    }

    if (correlation.classification === 'candidate') {
        return 'IP publica observada como candidata tecnica. No confirma identidad, ubicacion exacta ni titularidad; requiere corroboracion externa.';
    }

    const countryContext = correlation.phoneCountryCode && correlation.observedCountryCode
        ? ` Contexto: prefijo telefonico ${correlation.phoneCountryCode}, GeoIP observado ${correlation.observedCountryCode}.`
        : '';
    return `${correlation.summary}${countryContext}`;
}

function normalizeCountryCode(value?: string | null): string | null {
    if (!value) return null;
    const normalized = value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase();
    if (/^[A-Z]{2}$/.test(normalized)) return normalized;
    const names: Record<string, string> = {
        COLOMBIA: 'CO',
        MEXICO: 'MX',
        VENEZUELA: 'VE',
        'UNITED STATES': 'US',
        USA: 'US',
        CANADA: 'CA',
        ECUADOR: 'EC',
        PERU: 'PE',
        CHILE: 'CL',
        ARGENTINA: 'AR',
        BRAZIL: 'BR',
        BRASIL: 'BR',
        SPAIN: 'ES',
        ESPANA: 'ES',
    };
    return names[normalized] || null;
}

function ipToInt(ip: string): number {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(part => Number.isNaN(part) || part < 0 || part > 255)) return 0;
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function matchesCidr(ip: string, cidr: string): boolean {
    const [base, prefixStr] = cidr.split('/');
    const prefix = parseInt(prefixStr, 10);
    if (!Number.isFinite(prefix) || prefix < 0 || prefix > 32) return false;
    const mask = prefix === 0 ? 0 : ((0xFFFFFFFF << (32 - prefix)) >>> 0);
    return ((ipToInt(ip) & mask) >>> 0) === ((ipToInt(base) & mask) >>> 0);
}

function clampScore(score: number): number {
    return Math.max(0, Math.min(100, Math.round(score)));
}

function confidenceFromScore(score: number): CandidateConfidence {
    if (score >= 75) return 'high';
    if (score >= 45) return 'medium';
    return 'low';
}

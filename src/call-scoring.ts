import {
    lookupInfrastructure,
    type InfrastructureRegistryEvidence,
} from './network-infrastructure-registry.js';
import { resolveE164CountryContext } from './e164-country-context.js';

export type CandidateProvider = 'meta' | 'google' | 'cloudflare' | 'unknown';
export type CandidateDirection = 'incoming' | 'outgoing' | 'bidirectional';
export type NetworkCategory = 'meta' | 'stun_turn' | 'dns' | 'cdn' | 'cloud_hosting' | 'consumer_isp_or_unknown' | 'unknown_public';
export type NetworkIntelligenceCategory = 'meta' | 'stun_turn' | 'dns' | 'cdn' | 'cloud_hosting' | 'consumer_isp_or_unknown' | 'unknown';
export type CandidateConfidence = 'high' | 'medium' | 'low';
export const ENDPOINT_EXCLUSION_DECISION_VERSION = 1 as const;

export interface EndpointExclusionDecision {
    version: typeof ENDPOINT_EXCLUSION_DECISION_VERSION;
    classification: 'hard_excluded' | 'contextual' | 'eligible';
    basis: 'runtime' | 'registry' | 'provider_fallback' | 'enrichment' | 'none';
    reasonCodes: string[];
}

export interface NetworkIntelligence {
    asn: number | null;
    org: string;
    category: NetworkIntelligenceCategory;
    source: 'local_rules' | 'enrichment';
    isDatacenterLikely: boolean;
    caution: string;
    registryEvidence?: InfrastructureRegistryEvidence;
    exclusionDecision?: EndpointExclusionDecision;
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

export interface CandidateNetworkContext {
    version: 1;
    targetCallingCode: string | null;
    targetCountryCode: string | null;
    observedCountryCode: string | null;
    relationship: 'match' | 'mismatch' | 'unavailable';
    affectsRouteScore: false;
    reasonCodes: string[];
    limitations: string[];
}

export interface CandidateScoreCap {
    code: string;
    maximum: number;
    before: number;
    after: number;
}

export interface CandidateScoreBreakdown {
    version: 3;
    rawScore: number;
    finalScore: number;
    inputs: {
        packets: number;
        bytesTotal: number;
        durationSec: number;
        direction: CandidateDirection;
        ports: number[];
        baselinePackets: number;
        baselineDurationSec: number;
        onsetDelayMs: number | null;
        protocolEvidence: NonNullable<CandidateScoreInput['protocolEvidence']>;
    };
    components: CandidateReasonCode[];
    caps: CandidateScoreCap[];
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
    addressFamily?: 4 | 6;
    baselinePackets?: number;
    baselineDurationSec?: number;
    onsetDelayMs?: number | null;
    protocolEvidence?: Array<'stun_binding_request' | 'stun_binding_response' | 'stun_other' | 'transport_flow' | 'frame_length_86'>;
}

export interface CandidateScoreResult {
    confidence: CandidateConfidence;
    confidenceScore: number;
    reasonCodes: CandidateReasonCode[];
    technicalNote: string;
    networkCategory: NetworkCategory;
    isP2P: boolean;
    correlation: CandidateCorrelation;
    networkContext: CandidateNetworkContext;
    scoreBreakdown: CandidateScoreBreakdown;
}

export function classifyNetworkCategory(provider: CandidateProvider): NetworkCategory {
    if (provider === 'meta') return 'meta';
    if (provider === 'google') return 'cloud_hosting';
    if (provider === 'cloudflare') return 'cdn';
    return 'unknown_public';
}

export function lookupNetworkIntelligence(
    ip: string,
    provider: CandidateProvider,
    options?: { now?: Date; ownPublicEndpoints?: ReadonlySet<string> },
): NetworkIntelligence {
    const registryEvidence = lookupInfrastructure(ip, options);
    if (registryEvidence.entryId) {
        const intelligence: NetworkIntelligence = {
            asn: registryEvidence.asn,
            org: registryEvidence.org,
            category: registryEvidence.category ?? 'unknown',
            source: 'local_rules',
            isDatacenterLikely: registryEvidence.endpointRole !== 'own_public_endpoint',
            caution: registryEvidence.caution,
            registryEvidence,
        };
        return {
            ...intelligence,
            exclusionDecision: classifyEndpointExclusion(registryEvidence.provider, intelligence),
        };
    }

    if (provider !== 'unknown') {
        const category = classifyNetworkCategory(provider);
        const intelligence: NetworkIntelligence = {
            asn: null,
            org: provider,
            category: category === 'unknown_public' ? 'unknown' : category,
            source: 'local_rules',
            isDatacenterLikely: true,
            caution: 'Proveedor indicado sin una coincidencia vigente del registro. Se conserva como infraestructura y no identifica usuario final.',
            registryEvidence,
        };
        return {
            ...intelligence,
            exclusionDecision: classifyEndpointExclusion(provider, intelligence),
        };
    }

    const intelligence: NetworkIntelligence = {
        asn: null,
        org: 'Unknown public network',
        category: 'consumer_isp_or_unknown',
        source: 'local_rules',
        isDatacenterLikely: false,
        caution: registryEvidence.caution,
        registryEvidence,
    };
    return {
        ...intelligence,
        exclusionDecision: classifyEndpointExclusion(provider, intelligence),
    };
}

export function classifyEndpointExclusion(
    provider: CandidateProvider,
    intelligence: NetworkIntelligence,
): EndpointExclusionDecision {
    const evidence = intelligence.registryEvidence;
    const role = evidence?.endpointRole;

    if (role === 'own_public_endpoint') {
        return decision('hard_excluded', 'runtime', 'OWN_PUBLIC_ENDPOINT');
    }
    if (provider === 'meta' || evidence?.provider === 'meta' || intelligence.category === 'meta') {
        return decision('hard_excluded', evidence?.entryId ? 'registry' : 'provider_fallback', 'META_INFRASTRUCTURE');
    }
    if (role === 'dns' && isExactHostMatch(evidence?.matchedCidr)) {
        return decision('hard_excluded', 'registry', 'EXACT_PUBLIC_DNS');
    }
    if (role === 'dns') {
        return decision('contextual', 'registry', 'BROAD_DNS_CLASSIFICATION');
    }
    if (role === 'stun_turn' || intelligence.category === 'stun_turn') {
        return decision('contextual', evidence?.entryId ? 'registry' : 'provider_fallback', 'STUN_TURN_CONTEXT');
    }
    if (role === 'cdn' || intelligence.category === 'cdn') {
        return decision('contextual', evidence?.entryId ? 'registry' : 'provider_fallback', 'CDN_CONTEXT');
    }
    if (role === 'cloud_hosting' || intelligence.category === 'cloud_hosting') {
        return decision('contextual', evidence?.entryId ? 'registry' : 'provider_fallback', 'CLOUD_HOSTING_CONTEXT');
    }
    if (provider !== 'unknown' || intelligence.isDatacenterLikely) {
        return decision('contextual', evidence?.entryId ? 'registry' : 'provider_fallback', 'INFRASTRUCTURE_CONTEXT');
    }
    return decision('eligible', 'none', 'NO_STRONG_EXCLUSION');
}

function decision(
    classification: EndpointExclusionDecision['classification'],
    basis: EndpointExclusionDecision['basis'],
    reasonCode: string,
): EndpointExclusionDecision {
    return { version: 1, classification, basis, reasonCodes: [reasonCode] };
}

function isExactHostMatch(cidr?: string | null): boolean {
    return Boolean(cidr && (cidr.endsWith('/32') || cidr.endsWith('/128')));
}

export function scoreCandidate(input: CandidateScoreInput): CandidateScoreResult {
    const networkCategory = networkCategoryFromIntelligence(input.networkIntelligence.category, input.provider);
    const reasonCodes: CandidateReasonCode[] = [];
    const caps: CandidateScoreCap[] = [];
    const exclusionDecision = input.networkIntelligence.exclusionDecision
        ?? classifyEndpointExclusion(input.provider, input.networkIntelligence);
    let score = 0;

    const add = (code: string, label: string, delta: number): void => {
        score += delta;
        reasonCodes.push({ code, label, delta });
    };
    const cap = (code: string, maximum: number): void => {
        if (!reasonCodes.some(reason => reason.code === code)) {
            reasonCodes.push({ code, label: capLabel(code), delta: 0 });
        }
        const before = score;
        const after = Math.min(before, maximum);
        if (after < before) caps.push({ code, maximum, before, after });
        score = after;
    };

    if (exclusionDecision.classification === 'eligible') {
        add('ELIGIBLE_PUBLIC_ENDPOINT', 'Endpoint publico sin exclusion fuerte de infraestructura', 20);
        add('UNKNOWN_PUBLIC_PROVIDER', 'IP publica fuera de exclusiones fuertes conocidas', 0);
    } else if (exclusionDecision.classification === 'contextual') {
        add('CONTEXTUAL_INFRASTRUCTURE_CLASSIFICATION', 'Infraestructura contextual conservada para revision', 0);
        add('KNOWN_INFRASTRUCTURE', `Infraestructura contextual probable: ${input.networkIntelligence.org}`, 0);
    } else {
        add('HARD_INFRASTRUCTURE_EXCLUSION', 'Exclusion fuerte sustentada por infraestructura', 0);
        add('KNOWN_INFRASTRUCTURE', `Infraestructura excluida: ${input.networkIntelligence.org}`, 0);
    }

    if (input.networkIntelligence.category === 'consumer_isp_or_unknown') {
        add('CONSUMER_OR_UNKNOWN_NETWORK', 'Red de acceso, ISP o red publica aun no catalogada', 10);
    } else if (input.networkIntelligence.isDatacenterLikely) {
        add('DATACENTER_OR_RELAY_LIKELY', 'ASN/ORG o rango sugiere datacenter, CDN o relay', -10);
    }

    const baselineDurationSec = input.baselineDurationSec ?? 0;
    const baselinePackets = input.baselinePackets ?? 0;
    if (baselineDurationSec > 0 && input.durationSec > 0) {
        const activeRate = input.durationSec > 0 ? input.packets / input.durationSec : 0;
        const baselineRate = baselinePackets / baselineDurationSec;
        const rateDelta = activeRate - baselineRate;
        if (
            (baselinePackets === 0 && input.packets >= 20)
            || (baselineRate > 0 && activeRate >= baselineRate * 3 && rateDelta >= 1)
        ) {
            add('STRONG_BASELINE_DELTA', 'Incremento fuerte frente a la linea base previa', 20);
        } else if (baselineRate > 0 && activeRate >= baselineRate * 1.5 && rateDelta >= 0.5) {
            add('MODERATE_BASELINE_DELTA', 'Incremento moderado frente a la linea base previa', 10);
        } else if (activeRate <= baselineRate) {
            add('NO_BASELINE_INCREASE', 'La actividad no supera la tasa de la linea base', -15);
        } else {
            add('WEAK_BASELINE_DELTA', 'El incremento frente a la linea base es debil', 0);
        }
    } else {
        add('BASELINE_UNAVAILABLE', 'No existe una linea base comparable para este endpoint', 0);
    }

    if (input.direction === 'bidirectional') {
        add('BIDIRECTIONAL_TRAFFIC', 'Flujo bidireccional observado', 20);
    } else {
        add('ONE_WAY_TRAFFIC', 'Solo se observo trafico en una direccion', -10);
    }

    if (input.packets >= 250) {
        add('HIGH_PACKET_VOLUME', 'Volumen alto de paquetes durante la ventana', 15);
    } else if (input.packets >= 75) {
        add('MEDIUM_PACKET_VOLUME', 'Volumen medio de paquetes durante la ventana', 10);
    } else if (input.packets >= 20) {
        add('LOW_PACKET_VOLUME', 'Volumen bajo pero util de paquetes', 5);
    } else {
        add('INSUFFICIENT_PACKET_VOLUME', 'Muy pocos paquetes para confianza fuerte', -15);
    }

    const avgBytes = input.packets > 0 ? input.bytesTotal / input.packets : 0;
    if (avgBytes >= 80 && avgBytes <= 1400) {
        add('REALISTIC_PACKET_SIZE', 'Tamano promedio compatible con trafico multimedia/UDP', 5);
    }

    const hasStunTurnPort = input.ports.some(port => [3478, 3479, 5349, 19302].includes(port));
    if (hasStunTurnPort) {
        add('STUN_TURN_PORT', 'Puerto asociado a STUN/TURN/relay observado', -10);
    }

    if (input.durationSec > 0 && input.packets / input.durationSec >= 2) {
        add('HIGH_TEMPORAL_DENSITY', 'Densidad temporal consistente durante la ventana', 10);
    } else if (input.durationSec > 0 && input.packets / input.durationSec >= 0.5) {
        add('MODERATE_TEMPORAL_DENSITY', 'Densidad temporal moderada durante la ventana', 5);
    }

    if (
        input.onsetDelayMs !== undefined
        && input.onsetDelayMs !== null
        && Number.isFinite(input.onsetDelayMs)
        && input.onsetDelayMs >= 0
    ) {
        if (input.onsetDelayMs <= 3_000) {
            add('IMMEDIATE_CALL_ONSET', 'El flujo aparece dentro de los primeros 3 segundos de la fase de llamada', 10);
        } else if (input.onsetDelayMs <= 10_000) {
            add('NEAR_CALL_ONSET', 'El flujo aparece cerca del inicio de la fase de llamada', 5);
        } else if (input.onsetDelayMs > 30_000) {
            add('LATE_CALL_ONSET', 'El flujo aparece tarde respecto al inicio de la fase de llamada', -10);
        } else {
            add('DELAYED_CALL_ONSET', 'El flujo aparece despues del inicio sin correlacion temporal fuerte', 0);
        }
    } else {
        add('CALL_ONSET_UNAVAILABLE', 'No hay un limite de fase suficiente para medir el inicio del flujo', 0);
    }

    const protocolEvidence = new Set(input.protocolEvidence ?? []);
    if (protocolEvidence.has('transport_flow')) {
        add('TRANSPORT_FLOW_OBSERVED', 'Flujo de transporte decodificado durante la captura', 5);
    }
    if (protocolEvidence.has('stun_binding_request') || protocolEvidence.has('stun_binding_response')) {
        add('STRUCTURAL_STUN_CONTEXT', 'Negociacion STUN estructural observada como contexto', 3);
    }

    const phoneContext = inferPhoneCountryFromJid(input.targetJid);
    const observedCountryCode = normalizeCountryCode(input.observedCountryCode);
    const networkContext = buildNetworkContext(phoneContext, observedCountryCode);
    const correlationCaps: string[] = [];

    if (input.packets < 10) {
        cap('HARD_CAP_TINY_SAMPLE', 15);
        correlationCaps.push('Muestra minima insuficiente');
    } else if (input.packets < 20) {
        cap('CAP_LOW_SAMPLE', 30);
        correlationCaps.push('Muestra baja');
    }

    if (input.direction !== 'bidirectional') {
        cap('CAP_ONE_WAY_FLOW', 45);
        correlationCaps.push('Flujo de una sola direccion');
    }

    if (input.networkIntelligence.registryEvidence?.degraded) {
        cap('INFRASTRUCTURE_REGISTRY_DEGRADED', 30);
        correlationCaps.push('Registro de infraestructura degradado');
    }

    if (
        input.addressFamily === 6
        && ['unknown', 'invalid'].includes(input.networkIntelligence.registryEvidence?.status ?? 'unknown')
    ) {
        cap('IPV6_REGISTRY_PENDING', 30);
        correlationCaps.push('Registro IPv6 pendiente');
    }

    const isOwnPublicEndpoint = input.networkIntelligence.registryEvidence?.endpointRole === 'own_public_endpoint';
    if (exclusionDecision.classification === 'hard_excluded') {
        cap(isOwnPublicEndpoint ? 'OWN_PUBLIC_ENDPOINT' : 'HARD_INFRASTRUCTURE_EXCLUSION', 0);
        correlationCaps.push(isOwnPublicEndpoint ? 'Endpoint publico propio' : 'Exclusion fuerte de infraestructura');
    } else if (exclusionDecision.classification === 'contextual') {
        cap('CONTEXTUAL_INFRASTRUCTURE_REVIEW', 30);
        correlationCaps.push('Infraestructura contextual sin promocion automatica');
    }

    const confidenceScore = clampScore(score);
    const confidence = confidenceFromScore(confidenceScore);
    const baseP2P = exclusionDecision.classification === 'eligible' && !isOwnPublicEndpoint;
    const scoredCorrelation = buildCorrelation({
        baseP2P,
        exclusionClassification: exclusionDecision.classification,
        confidenceScore,
        packets: input.packets,
        phoneCountryCode: phoneContext?.countryCode || null,
        observedCountryCode,
        networkCategory,
        caps: correlationCaps,
    });
    const unresolvedIpv6 = input.addressFamily === 6
        && ['unknown', 'invalid'].includes(input.networkIntelligence.registryEvidence?.status ?? 'unknown');
    const correlation: CandidateCorrelation = unresolvedIpv6
        ? {
            ...scoredCorrelation,
            classification: 'insufficient',
            label: 'IPv6 pendiente de clasificacion',
            summary: 'La ruta IPv6 fue observada, pero el registro de infraestructura vigente aun no permite atribuirla de forma responsable.',
        }
        : scoredCorrelation;
    const isP2P = baseP2P && confidenceScore >= 45 && correlation.classification === 'candidate';
    const technicalNote = buildTechnicalNote(baseP2P, correlation, exclusionDecision);

    return {
        confidence,
        confidenceScore,
        reasonCodes,
        technicalNote,
        networkCategory,
        isP2P,
        correlation,
        networkContext,
        scoreBreakdown: {
            version: 3,
            rawScore: reasonCodes.reduce((total, reason) => total + reason.delta, 0),
            finalScore: confidenceScore,
            inputs: {
                packets: input.packets,
                bytesTotal: input.bytesTotal,
                durationSec: input.durationSec,
                direction: input.direction,
                ports: [...input.ports],
                baselinePackets,
                baselineDurationSec,
                onsetDelayMs: input.onsetDelayMs ?? null,
                protocolEvidence: [...(input.protocolEvidence ?? [])],
            },
            components: reasonCodes.map(reason => ({ ...reason })),
            caps: caps.map(item => ({ ...item })),
        },
    };
}

function capLabel(code: string): string {
    const labels: Record<string, string> = {
        HARD_CAP_TINY_SAMPLE: 'Menos de 10 paquetes: no se acepta como candidata',
        CAP_LOW_SAMPLE: 'Menos de 20 paquetes: confianza limitada',
        CAP_ONE_WAY_FLOW: 'Sin flujo bidireccional fuerte: confianza limitada',
        INFRASTRUCTURE_REGISTRY_DEGRADED: 'Registro de infraestructura vencido, ambiguo o sin fuente valida',
        IPV6_REGISTRY_PENDING: 'IPv6 observado con clasificacion de infraestructura pendiente',
        OWN_PUBLIC_ENDPOINT: 'La salida publica propia no pertenece al contacto',
        HARD_INFRASTRUCTURE_EXCLUSION: 'Exclusion fuerte de infraestructura aplicada',
        CONTEXTUAL_INFRASTRUCTURE_REVIEW: 'Infraestructura contextual visible sin promocion automatica',
    };
    return labels[code] ?? code;
}

function networkCategoryFromIntelligence(category: NetworkIntelligenceCategory, provider: CandidateProvider): NetworkCategory {
    if (category === 'meta') return 'meta';
    if (category === 'stun_turn') return 'stun_turn';
    if (category === 'dns') return 'dns';
    if (category === 'cdn') return 'cdn';
    if (category === 'cloud_hosting') return 'cloud_hosting';
    if (category === 'consumer_isp_or_unknown') return 'consumer_isp_or_unknown';
    return classifyNetworkCategory(provider);
}

export function inferPhoneCountryFromJid(jid?: string | null): ReturnType<typeof resolveE164CountryContext> {
    return resolveE164CountryContext(jid);
}

function buildCorrelation(input: {
    baseP2P: boolean;
    exclusionClassification: EndpointExclusionDecision['classification'];
    confidenceScore: number;
    packets: number;
    phoneCountryCode: string | null;
    observedCountryCode: string | null;
    networkCategory: NetworkCategory;
    caps: string[];
}): CandidateCorrelation {
    if (!input.baseP2P) {
        const contextual = input.exclusionClassification === 'contextual';
        return {
            classification: 'infrastructure',
            label: contextual ? 'Infraestructura contextual' : 'Exclusión fuerte de infraestructura',
            summary: contextual
                ? 'La IP tiene señales contextuales de infraestructura, CDN, cloud o relay. Se conserva para revisión y no se promueve automáticamente como candidata.'
                : 'La IP coincide con una exclusión fuerte: Meta, DNS público exacto o la salida pública propia. Se conserva como ruta observada, no como candidata.',
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

function buildTechnicalNote(
    baseP2P: boolean,
    correlation: CandidateCorrelation,
    exclusionDecision: EndpointExclusionDecision,
): string {
    if (!baseP2P) {
        return exclusionDecision.classification === 'contextual'
            ? 'Clasificación contextual de infraestructura. La observación permanece visible para revisión, pero no se promueve automáticamente como IP candidata.'
            : 'Exclusión técnica fuerte por Meta, DNS público exacto o salida pública propia. No debe tratarse como IP candidata de usuario.';
    }

    if (correlation.classification === 'candidate') {
        return 'IP publica observada como candidata tecnica. No confirma identidad, ubicacion exacta ni titularidad; requiere corroboracion externa.';
    }

    const countryContext = correlation.phoneCountryCode && correlation.observedCountryCode
        ? ` Contexto: prefijo telefonico ${correlation.phoneCountryCode}, GeoIP observado ${correlation.observedCountryCode}.`
        : '';
    return `${correlation.summary}${countryContext}`;
}

function buildNetworkContext(
    phoneContext: ReturnType<typeof inferPhoneCountryFromJid>,
    observedCountryCode: string | null,
): CandidateNetworkContext {
    const targetCountryCode = phoneContext?.countryCode ?? null;
    const relationship = targetCountryCode && observedCountryCode
        ? targetCountryCode === observedCountryCode ? 'match' : 'mismatch'
        : 'unavailable';
    const reasonCodes = relationship === 'match'
        ? ['PHONE_GEO_CONTEXT_MATCH']
        : relationship === 'mismatch'
            ? ['PHONE_GEO_CONTEXT_MISMATCH']
            : ['PHONE_GEO_CONTEXT_UNAVAILABLE'];

    return {
        version: 1,
        targetCallingCode: phoneContext?.callingCode ?? null,
        targetCountryCode,
        observedCountryCode,
        relationship,
        affectsRouteScore: false,
        reasonCodes,
        limitations: [
            'phone_prefix_is_context_not_location',
            'geoip_is_network_estimate_not_device_location',
        ],
    };
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

function clampScore(score: number): number {
    return Math.max(0, Math.min(100, Math.round(score)));
}

function confidenceFromScore(score: number): CandidateConfidence {
    if (score >= 75) return 'high';
    if (score >= 45) return 'medium';
    return 'low';
}

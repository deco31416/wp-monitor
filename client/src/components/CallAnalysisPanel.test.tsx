import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { expect, test, vi } from 'vitest';
import { CallAnalysisPanel } from './CallAnalysisPanel';
import type { CallAnalysisResult, CallRouteAssessment, CandidateIP } from '../types';

function analysis(capturePhases?: CallAnalysisResult['capturePhases']): CallAnalysisResult {
    return {
        callId: 'CALL-001',
        targetJid: '573001112233@s.whatsapp.net',
        startTime: '2026-09-08T12:00:00.000Z',
        endTime: '2026-09-08T12:00:10.000Z',
        durationSec: 10,
        isVideo: false,
        totalPackets: 0,
        candidateIps: [],
        metaIps: [],
        verdict: 'insufficient_data',
        captureInterface: '192.0.2.10',
        ...(capturePhases ? { capturePhases } : {}),
    };
}

function panel(callAnalysis: CallAnalysisResult | null, overrides: Partial<ComponentProps<typeof CallAnalysisPanel>> = {}) {
    return (
        <CallAnalysisPanel
            callAnalysis={callAnalysis}
            callHistory={[]}
            callCapturing={false}
            callEvent={null}
            callPacketCount={0}
            callStopping={false}
            callOperatorMarker={null}
            callMarkerPending={false}
            operatorMarkerAvailable={true}
            callCaseId="CASE-001"
            callOperatorName="operator"
            callAuthorizationNote="Authorized synthetic test"
            availableCases={[]}
            casesLoading={false}
            callCaptureError={null}
            onCaseIdChange={vi.fn()}
            onStartManualCapture={vi.fn()}
            onStopManualCapture={vi.fn()}
            onOperatorCallMarker={vi.fn()}
            onSelectAnalysis={vi.fn()}
            {...overrides}
        />
    );
}

function routeAssessment(
    classification: CallRouteAssessment['classification'],
    overrides: Partial<CallRouteAssessment> = {},
): CallRouteAssessment {
    return {
        assessmentVersion: 2,
        classification,
        confidenceScore: classification === 'direct_confirmed' ? 88 : 52,
        evidenceSources: ['packet_flow', 'baileys_transport'],
        independentDirectEvidenceCount: classification === 'direct_confirmed' ? 2 : 1,
        primaryCandidateIp: classification === 'relay_confirmed' || classification === 'unresolved' ? null : '203.0.113.10',
        reasonCodes: ['STRONG_DIRECT_PACKET_PATTERN'],
        limitations: [],
        ...overrides,
    };
}

function endpoint(ip: string, overrides: Partial<CandidateIP> = {}): CandidateIP {
    return {
        ip,
        packets: 20,
        bytesTotal: 2400,
        firstSeen: '2026-09-08T12:00:01.000Z',
        lastSeen: '2026-09-08T12:00:09.000Z',
        avgSize: 120,
        ports: [40_000],
        direction: 'bidirectional',
        provider: 'unknown',
        networkCategory: 'consumer_isp_or_unknown',
        networkIntelligence: {
            asn: null,
            org: 'Synthetic public network',
            category: 'consumer_isp_or_unknown',
            source: 'local_rules',
            isDatacenterLikely: false,
            caution: 'Synthetic fixture.',
            exclusionDecision: {
                version: 1,
                classification: 'eligible',
                basis: 'none',
                reasonCodes: ['NO_STRONG_EXCLUSION'],
            },
        },
        geo: null,
        confidence: 'low',
        confidenceScore: 20,
        reasonCodes: [],
        technicalNote: 'Synthetic endpoint.',
        isP2P: false,
        addressFamily: 4,
        endpointRole: 'unknown',
        protocolEvidence: ['transport_flow'],
        ...overrides,
    };
}

test('explains when a result has no prior baseline', () => {
    render(panel(analysis({
        baselineAvailable: false,
        baselineStartedAt: null,
        baselineEndedAt: null,
        negotiationStartedAt: '2026-09-08T12:00:00.000Z',
        activeCallStartedAt: null,
    })));

    expect(screen.getByText('Resultado sin línea base previa')).toBeInTheDocument();
    expect(screen.getByText(/El tráfico de fondo puede influir/)).toBeInTheDocument();
});

test('shows the measured baseline duration when it exists', () => {
    render(panel(analysis({
        baselineAvailable: true,
        baselineStartedAt: '2026-09-08T12:00:00.000Z',
        baselineEndedAt: '2026-09-08T12:00:03.000Z',
        negotiationStartedAt: '2026-09-08T12:00:03.000Z',
        activeCallStartedAt: '2026-09-08T12:00:05.000Z',
    })));

    expect(screen.getByText('Comparación con línea base disponible')).toBeInTheDocument();
    expect(screen.getByText(/Se separaron 3s de actividad previa/)).toBeInTheDocument();
});

test('keeps legacy results free from an invented phase statement', () => {
    render(panel(analysis()));

    expect(screen.queryByText('Resultado sin línea base previa')).not.toBeInTheDocument();
    expect(screen.queryByText('Comparación con línea base disponible')).not.toBeInTheDocument();
});

test('offers the authorized operator marker sequence only during an active capture', async () => {
    const user = userEvent.setup();
    const onMarker = vi.fn();
    const { rerender } = render(panel(null, {
        callCapturing: true,
        callOperatorMarker: null,
        onOperatorCallMarker: onMarker,
    }));

    await user.click(screen.getByRole('button', { name: 'Marcar inicio de llamada' }));
    expect(onMarker).toHaveBeenLastCalledWith('call_started');

    rerender(panel(null, {
        callCapturing: true,
        callOperatorMarker: 'call_started',
        onOperatorCallMarker: onMarker,
    }));
    await user.click(screen.getByRole('button', { name: 'Marcar llamada conectada' }));
    expect(onMarker).toHaveBeenLastCalledWith('call_connected');

    rerender(panel(null, {
        callCapturing: true,
        callOperatorMarker: 'call_connected',
        onOperatorCallMarker: onMarker,
    }));
    await user.click(screen.getByRole('button', { name: 'Marcar fin de llamada' }));
    expect(onMarker).toHaveBeenLastCalledWith('call_ended');

    rerender(panel(null, {
        callCapturing: true,
        callOperatorMarker: 'call_ended',
        onOperatorCallMarker: onMarker,
    }));
    expect(screen.getByText('Fin de llamada marcado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Marcar .*llamada/ })).not.toBeInTheDocument();

    rerender(panel(null, {
        callCapturing: true,
        operatorMarkerAvailable: false,
    }));
    expect(screen.queryByRole('button', { name: /Marcar .*llamada/ })).not.toBeInTheDocument();
});

test('distinguishes a standalone baseline from a correlated call', () => {
    render(panel(analysis({
        baselineAvailable: true,
        baselineStartedAt: '2026-09-08T12:00:00.000Z',
        baselineEndedAt: '2026-09-08T12:00:04.000Z',
        negotiationStartedAt: null,
        activeCallStartedAt: null,
    })));

    expect(screen.getByText('Solo se registró la línea base')).toBeInTheDocument();
    expect(screen.getByText(/no se observó el inicio de una llamada correlacionada/)).toBeInTheDocument();
});

test('shows the registry version and freshness that support an infrastructure classification', () => {
    const result = analysis();
    result.totalPackets = 20;
    result.candidateIps = [{
        ip: '8.8.8.8',
        packets: 20,
        bytesTotal: 2_400,
        firstSeen: '2026-09-08T12:00:00.000Z',
        lastSeen: '2026-09-08T12:00:09.000Z',
        avgSize: 120,
        ports: [53],
        direction: 'bidirectional',
        provider: 'google',
        networkCategory: 'dns',
        networkIntelligence: {
            asn: 15169,
            org: 'Google Public DNS',
            category: 'dns',
            source: 'local_rules',
            isDatacenterLikely: true,
            caution: 'Infrastructure only.',
            registryEvidence: {
                schemaVersion: 1,
                registryVersion: '2026.09.08.1',
                registryPublishedAt: '2026-09-08T00:00:00.000Z',
                status: 'fresh',
                entryId: 'google-public-dns',
                matchedCidr: '8.8.8.8/32',
                provider: 'google',
                category: 'dns',
                endpointRole: 'dns',
                asn: 15169,
                org: 'Google Public DNS',
                source: {
                    id: 'google-public-dns',
                    label: 'Google Public DNS endpoints',
                    uri: 'https://developers.google.com/speed/public-dns/docs/using',
                    kind: 'authoritative',
                    retrievedAt: '2026-09-08T00:00:00.000Z',
                    validUntil: '2026-12-07T00:00:00.000Z',
                },
                competingEntryIds: [],
                degraded: false,
                caution: 'Infrastructure only.',
            },
        },
        geo: null,
        confidence: 'low',
        confidenceScore: 0,
        reasonCodes: [],
        technicalNote: 'Infrastructure only.',
        isP2P: false,
    }];

    render(panel(result));

    expect(screen.getByText(/Registro 2026\.09\.08\.1 · vigente · Google Public DNS endpoints/)).toBeInTheDocument();
});

test('renders every public endpoint in one exhaustive commercial group', () => {
    const result = analysis();
    result.totalPackets = 80;
    result.candidateIps = [
        endpoint('198.51.100.10', { isP2P: true, confidence: 'medium', confidenceScore: 55 }),
        endpoint('192.0.2.20', {
            endpointRole: 'relay',
            networkCategory: 'meta',
            provider: 'meta',
            networkIntelligence: {
                asn: 32_934,
                org: 'Synthetic Meta infrastructure',
                category: 'meta',
                source: 'local_rules',
                isDatacenterLikely: true,
                caution: 'Synthetic fixture.',
                exclusionDecision: {
                    version: 1,
                    classification: 'hard_excluded',
                    basis: 'registry',
                    reasonCodes: ['META_INFRASTRUCTURE'],
                },
            },
        }),
        endpoint('203.0.113.30', {
            phaseCounts: {
                version: 1,
                baseline: { packets: 2, bytes: 240 },
                negotiation: { packets: 3, bytes: 360 },
                active: { packets: 10, bytes: 1200 },
                postCall: { packets: 4, bytes: 480 },
                unclassified: { packets: 1, bytes: 120 },
            },
        }),
        endpoint('192.0.2.40', {
            endpointRole: 'background',
            networkCategory: 'cloud_hosting',
            networkIntelligence: {
                asn: 64_500,
                org: 'Synthetic cloud network',
                category: 'cloud_hosting',
                source: 'enrichment',
                isDatacenterLikely: true,
                caution: 'Synthetic contextual fixture.',
                exclusionDecision: {
                    version: 1,
                    classification: 'contextual',
                    basis: 'enrichment',
                    reasonCodes: ['ENRICHED_CLOUD_PROVIDER'],
                },
            },
        }),
    ];
    result.metaIps = ['192.0.2.20'];

    render(panel(result));

    expect(screen.getByText('Endpoints publicos')).toBeInTheDocument();
    expect(screen.getByText('IPs observadas candidatas')).toBeInTheDocument();
    expect(screen.getByText('Observaciones no concluyentes (1)')).toBeInTheDocument();
    expect(screen.getByText('IPs Infraestructura (2)')).toBeInTheDocument();
    expect(screen.getByText('198.51.100.10')).toBeInTheDocument();
    expect(screen.getByText('192.0.2.20')).toBeInTheDocument();
    expect(screen.getByText('203.0.113.30')).toBeInTheDocument();
    expect(screen.getByText('192.0.2.40')).toBeInTheDocument();
    expect(screen.queryByText(/IPs Meta sin detalle historico/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Evidencia tecnica del endpoint')).toHaveLength(4);
    expect(screen.getByText('10 pkts · 1200 B')).toBeInTheDocument();
    expect(screen.getByText(/Exclusión técnica fuerte · registro versionado/)).toBeInTheDocument();
    expect(screen.getAllByText(/Sin exclusión fuerte · sin coincidencia de infraestructura/)).toHaveLength(2);
    expect(screen.getByText(/Clasificación contextual; requiere revisión · enriquecimiento externo/)).toBeInTheDocument();
});

test.each([
    ['direct_confirmed', 'Ruta directa confirmada'],
    ['direct_probable', 'Ruta directa probable'],
    ['relay_confirmed', 'Conexión mediante infraestructura de WhatsApp'],
    ['mixed', 'Ruta mixta observada'],
    ['unresolved', 'Ruta no determinada'],
] as const)('presents the %s route state with commercial copy', (classification, label) => {
    const result = analysis();
    result.routeAssessment = routeAssessment(classification);

    render(panel(result));

    expect(screen.getByRole('heading', { name: label })).toBeInTheDocument();
    expect(screen.getByText(/Flujo de red observado · Señalización de llamada/)).toBeInTheDocument();
    expect(screen.getByText(/no prueban identidad, ubicación exacta ni titularidad/i)).toBeInTheDocument();
    expect(screen.queryByText('STRONG_DIRECT_PACKET_PATTERN')).not.toBeInTheDocument();
});

test('marks a bounded result as partial and explains its limitations', () => {
    const result = analysis();
    result.routeAssessment = routeAssessment('direct_probable', {
        limitations: ['packet_capture_truncated', 'stun_peer_is_not_independent_confirmation'],
    });

    render(panel(result));

    expect(screen.getByRole('status')).toHaveTextContent('La captura alcanzó su límite');
    expect(screen.getByText('Resultado parcial')).toBeInTheDocument();
    expect(screen.getByText(/no constituye una segunda confirmación independiente/)).toBeInTheDocument();
});

test('shows WebRTC, five-tuple, and STUN/TURN evidence inside the existing call result', () => {
    const result = analysis();
    result.browserWebRtcEvidence = {
        version: 1,
        status: 'available',
        startedAt: '2026-09-08T12:00:00.000Z',
        endedAt: '2026-09-08T12:00:10.000Z',
        connectionCount: 1,
        selectedPairs: [{
            peerConnectionId: 'pc-1',
            state: 'succeeded',
            nominated: true,
            selected: true,
            firstObservedAt: '2026-09-08T12:00:01.000Z',
            lastObservedAt: '2026-09-08T12:00:09.000Z',
            local: {
                candidateType: 'host', protocol: 'udp', relayProtocol: 'unknown',
                address: null, addressFamily: null, port: 50_000,
            },
            remote: {
                candidateType: 'srflx', protocol: 'udp', relayProtocol: 'unknown',
                address: '198.51.100.40', addressFamily: 4, port: 40_000,
            },
            packetsSent: 20,
            packetsReceived: 20,
            bytesSent: 4_000,
            bytesReceived: 4_000,
            currentRoundTripTimeMs: 30,
        }],
        stateTransitions: [],
        truncated: false,
        limitations: [],
    };
    result.flowEvidence = {
        version: 1,
        flowLimit: 1_024,
        storedFlows: 3,
        droppedPackets: 0,
        truncated: false,
        flows: [],
    };
    result.stunTurnEvidence = {
        version: 1,
        transactionLimit: 256,
        storedTransactions: 4,
        droppedTransactions: 0,
        truncated: false,
        transactions: [],
        channels: [],
        limitations: [],
    };

    render(panel(result));

    expect(screen.getByRole('region', { name: 'Evidencia técnica complementaria' })).toBeInTheDocument();
    expect(screen.getByText('1 par(es) seleccionado(s) · 1 con endpoint expuesto')).toBeInTheDocument();
    expect(screen.getByText('3 cinco-tupla(s)')).toBeInTheDocument();
    expect(screen.getByText('4 transacción(es) · 0 canal(es) correlacionado(s)')).toBeInTheDocument();
    expect(screen.getByText(/No contiene SDP, audio, mensajes/)).toBeInTheDocument();
});

test('separates route scoring from geographic context and declares unquantified uncertainty', () => {
    const result = analysis();
    result.routeAssessment = routeAssessment('direct_probable', { assessmentVersion: 3 });
    result.candidateIps = [endpoint('198.51.100.77', {
        confidence: 'medium',
        confidenceScore: 45,
        isP2P: true,
        geo: { country: 'US', region: 'Synthetic region', city: 'Synthetic city', lat: 0, lon: 0, timezone: 'UTC' },
        scoreVersion: 3,
        networkContext: {
            version: 1,
            targetCallingCode: '57',
            targetCountryCode: 'CO',
            observedCountryCode: 'US',
            relationship: 'mismatch',
            affectsRouteScore: false,
            reasonCodes: ['PHONE_GEO_CONTEXT_MISMATCH'],
            limitations: ['phone_prefix_is_context_not_location'],
        },
        scoreBreakdown: {
            version: 3,
            rawScore: 60,
            finalScore: 45,
            inputs: {
                packets: 20,
                bytesTotal: 2400,
                durationSec: 8,
                direction: 'bidirectional',
                ports: [40_000],
                baselinePackets: 2,
                baselineDurationSec: 4,
                onsetDelayMs: 300,
                protocolEvidence: ['transport_flow'],
            },
            components: [{ code: 'SYNTHETIC_ROUTE_SIGNAL', label: 'Señal de ruta sintética', delta: 60 }],
            caps: [{ code: 'SYNTHETIC_CAP', maximum: 45, before: 60, after: 45 }],
        },
    })];

    render(panel(result));

    expect(screen.getByText('Contradicción contextual de red')).toBeInTheDocument();
    expect(screen.getByText(/no modifica la conclusión de ruta/)).toBeInTheDocument();
    expect(screen.getByText('Contexto geográfico de red · no afecta el score')).toBeInTheDocument();
    expect(screen.getByText('No cuantificado por la fuente')).toBeInTheDocument();
    expect(screen.getByText(/Puntaje bruto 60 · resultado final 45\/100/)).toBeInTheDocument();
    expect(screen.getByText(/Tope 45: 60 → 45/)).toBeInTheDocument();
});

test('announces loading, calibration, capture, processing and errors accessibly', () => {
    const { rerender } = render(panel(null, { casesLoading: true }));
    expect(screen.getByRole('status')).toHaveTextContent('Cargando configuración de captura');

    rerender(panel(null, { callCapturing: true, callPacketCount: 4 }));
    expect(screen.getByRole('status')).toHaveTextContent('Calibrando línea base');

    rerender(panel(null, {
        callCapturing: true,
        callPacketCount: 9,
        callEvent: { callId: 'CALL-001', from: '573001112233@s.whatsapp.net', status: 'offer', isVideo: false },
    }));
    expect(screen.getByRole('status')).toHaveTextContent('Captura de llamada en curso');

    rerender(panel(null, { callCapturing: true, callStopping: true, callPacketCount: 12 }));
    expect(screen.getByRole('status')).toHaveTextContent('Analizando captura');

    rerender(panel(null, { callCaptureError: 'Agente no disponible' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Agente no disponible');
});

test('opens a historical analysis with keyboard navigation', async () => {
    const user = userEvent.setup();
    const historical = analysis();
    const onSelectAnalysis = vi.fn();

    render(panel(null, { callHistory: [historical], onSelectAnalysis }));

    const openButton = screen.getByRole('button', { name: /Abrir análisis CALL-001/i });
    expect(openButton).toHaveProperty('tabIndex', 0);
    openButton.focus();
    expect(openButton).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(onSelectAnalysis).toHaveBeenCalledOnce();
    expect(onSelectAnalysis).toHaveBeenCalledWith(historical);
});

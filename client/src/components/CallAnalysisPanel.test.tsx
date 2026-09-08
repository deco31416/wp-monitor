import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { CallAnalysisPanel } from './CallAnalysisPanel';
import type { CallAnalysisResult } from '../types';

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

function panel(callAnalysis: CallAnalysisResult) {
    return (
        <CallAnalysisPanel
            callAnalysis={callAnalysis}
            callHistory={[]}
            callCapturing={false}
            callEvent={null}
            callPacketCount={0}
            callStopping={false}
            callCaseId="CASE-001"
            callOperatorName="operator"
            callAuthorizationNote="Authorized synthetic test"
            availableCases={[]}
            casesLoading={false}
            callCaptureError={null}
            onCaseIdChange={vi.fn()}
            onStartManualCapture={vi.fn()}
            onStopManualCapture={vi.fn()}
            onSelectAnalysis={vi.fn()}
        />
    );
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

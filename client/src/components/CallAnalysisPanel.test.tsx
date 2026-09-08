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

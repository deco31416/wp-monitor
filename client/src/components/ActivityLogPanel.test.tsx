import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { ActivityLogPanel } from './ActivityLogPanel';
import { buildHourlyActivity } from './activity-chart';

test('renders persisted human activity without presenting it as RTT', () => {
    render(
        <ActivityLogPanel
            events={[
                {
                    source: 'message',
                    type: 'outgoing',
                    label: 'Mensaje enviado (text)',
                    confidence: 'high',
                    timestamp: '2026-08-21T17:40:00.000Z',
                    timestampUtc: '2026-08-21T17:40:00.000Z',
                },
                {
                    source: 'receipt',
                    type: 'delivered',
                    label: 'Mensaje entregado',
                    confidence: 'high',
                    timestamp: '2026-08-21T17:40:01.000Z',
                    timestampUtc: '2026-08-21T17:40:01.000Z',
                },
                {
                    source: 'presence',
                    type: 'composing',
                    label: 'Escribiendo',
                    confidence: 'high',
                    timestamp: '2026-08-21T17:39:00.000Z',
                    timestampUtc: '2026-08-21T17:39:00.000Z',
                },
            ]}
            formatDateTime={value => value || '-'}
        />,
    );

    expect(screen.getByText('Mensaje enviado (text)')).toBeInTheDocument();
    expect(screen.getByText('Mensaje entregado')).toBeInTheDocument();
    expect(screen.getByText(/Confirmación · confianza alta/)).toBeInTheDocument();
    expect(screen.getByText('Escribiendo')).toBeInTheDocument();
    expect(screen.getByText('3 actividades observadas')).toBeInTheDocument();
    expect(screen.getByText('Distribución horaria de actividad')).toBeInTheDocument();
    expect(screen.getByLabelText('Gráfica de actividad observada por hora')).toBeInTheDocument();
    expect(screen.getByText(/una misma llamada se muestran como una sola actividad/i)).toBeInTheDocument();
    expect(screen.queryByText(/RTT:/)).not.toBeInTheDocument();
});

test('explains when no attributable activity exists', () => {
    render(<ActivityLogPanel events={[]} formatDateTime={value => value || '-'} />);
    expect(screen.getByText('Sin actividad observada')).toBeInTheDocument();
    expect(screen.queryByText('Distribución horaria de actividad')).not.toBeInTheDocument();
});

test('groups observed signals by local hour and source without mixing RTT', () => {
    const hourly = buildHourlyActivity([
        {
            source: 'message', type: 'outgoing', label: 'Mensaje enviado', confidence: 'high',
            timestamp: '2026-08-21T17:10:00', timestampUtc: '2026-08-21T22:10:00.000Z',
        },
        {
            source: 'receipt', type: 'delivered', label: 'Mensaje entregado', confidence: 'high',
            timestamp: '2026-08-21T17:11:00', timestampUtc: '2026-08-21T22:11:00.000Z',
        },
        {
            source: 'call', type: 'offer', label: 'Llamada entrante', confidence: 'high',
            timestamp: '2026-08-21T18:00:00', timestampUtc: '2026-08-21T23:00:00.000Z',
        },
    ]);

    expect(hourly).toHaveLength(24);
    expect(hourly[17]).toMatchObject({ messages: 1, receipts: 1, presence: 0, calls: 0 });
    expect(hourly[18]).toMatchObject({ messages: 0, receipts: 0, presence: 0, calls: 1 });
});

test('makes a truncated activity page explicit', () => {
    render(
        <ActivityLogPanel
            events={[{
                source: 'message', type: 'outgoing', label: 'Mensaje enviado', confidence: 'high',
                timestamp: '2026-08-21T17:10:00.000Z', timestampUtc: '2026-08-21T17:10:00.000Z',
            }]}
            page={{ returned: 1, total: 250, truncated: true, limit: 200 }}
            formatDateTime={value => value || '-'}
        />,
    );

    expect(screen.getByText('1 de 250 actividades cargadas')).toBeInTheDocument();
    expect(screen.getByText(/muestra las 1 actividades más recientes de 250/i)).toBeInTheDocument();
});

test('explains that one commercial call groups its protocol signals', () => {
    render(
        <ActivityLogPanel
            events={[{
                source: 'call',
                type: 'call_ended_unconfirmed',
                label: 'Llamada finalizada · respuesta no confirmada',
                confidence: 'medium',
                timestamp: '2026-09-01T21:44:05.000Z',
                timestampUtc: '2026-09-01T21:44:05.000Z',
                call: {
                    outcome: 'ended_unconfirmed',
                    direction: 'incoming',
                    evidence: 'protocol_observed',
                    signalCount: 3,
                    technicalSignalCount: 1,
                    startedAt: '2026-09-01T21:44:00.000Z',
                    endedAt: '2026-09-01T21:44:05.000Z',
                    durationSec: null,
                    relayLatencyMs: 84,
                    isVideo: false,
                },
            }]}
            formatDateTime={value => value || '-'}
        />,
    );

    expect(screen.getByText('1 actividad observada')).toBeInTheDocument();
    expect(screen.getByText(/3 señales agrupadas/)).toBeInTheDocument();
    expect(screen.queryByText('relaylatency')).not.toBeInTheDocument();
});

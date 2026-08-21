import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { ActivityLogPanel } from './ActivityLogPanel';

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
    expect(screen.getByText('3 eventos observados')).toBeInTheDocument();
    expect(screen.getByText('Distribución horaria de señales')).toBeInTheDocument();
    expect(screen.getByLabelText('Gráfica de actividad observada por hora')).toBeInTheDocument();
    expect(screen.getByText(/eventos reales de esta sesión, no mediciones RTT/i)).toBeInTheDocument();
    expect(screen.queryByText(/RTT:/)).not.toBeInTheDocument();
});

test('explains when no attributable activity exists', () => {
    render(<ActivityLogPanel events={[]} formatDateTime={value => value || '-'} />);
    expect(screen.getByText('Sin actividad observada')).toBeInTheDocument();
    expect(screen.queryByText('Distribución horaria de señales')).not.toBeInTheDocument();
});

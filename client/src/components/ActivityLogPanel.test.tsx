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
    expect(screen.getByText('Escribiendo')).toBeInTheDocument();
    expect(screen.getByText('2 eventos reales')).toBeInTheDocument();
    expect(screen.queryByText(/RTT:/)).not.toBeInTheDocument();
});

test('explains when no attributable activity exists', () => {
    render(<ActivityLogPanel events={[]} formatDateTime={value => value || '-'} />);
    expect(screen.getByText('Sin actividad real observada')).toBeInTheDocument();
});

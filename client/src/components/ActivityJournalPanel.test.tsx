import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { ActivityJournalPanel } from './ActivityJournalPanel';

test('shows a final empty state instead of an endless loading skeleton', () => {
    render(
        <ActivityJournalPanel
            activity={[]}
            observedEvents={[
                {
                    source: 'receipt',
                    type: 'delivered',
                    label: 'Mensaje entregado',
                    confidence: 'high',
                    timestamp: '2026-08-21T17:51:00.000Z',
                    timestampUtc: '2026-08-21T17:51:00.000Z',
                },
            ]}
            jid="synthetic-contact@s.whatsapp.net"
            displayNumber="synthetic-number"
            privacyMode={false}
            onDownloadFullReport={() => undefined}
        />,
    );

    expect(screen.getByText('Bitácora de sesión')).toBeInTheDocument();
    expect(screen.getByText('1 observados · 0 técnicos')).toBeInTheDocument();
    expect(screen.getByText('Sin mediciones técnicas en esta sesión')).toBeInTheDocument();
    expect(screen.getByText(/incluidos en las exportaciones/i)).toBeInTheDocument();
    expect(screen.queryByText('Esperando cambios de estado...')).not.toBeInTheDocument();
});

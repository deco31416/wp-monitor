import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { ProfilePanel } from './ProfilePanel';

test('separates the active session date from the contact registration date and hides empty RTT patterns', () => {
    render(
        <ProfilePanel
            profile={{
                jid: 'synthetic-contact@s.whatsapp.net',
                number: 'synthetic-number',
                contactName: 'Synthetic',
                customName: 'Prueba',
                profilePic: null,
                about: null,
                aboutSetAt: null,
                isBusinessAccount: false,
                businessProfile: null,
                pushName: null,
                addedAt: '2026-08-21T12:32:00.000Z',
                lastSeen: null,
                lastProfileUpdate: null,
                verifiedOnWhatsApp: true,
            }}
            profileLoading={false}
            patterns={{
                hourly: Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0, conclusive: 0, online: 0, pct: 0 })),
                peakHour: 0,
                avgSessionLength: 0,
                totalOnlineMinutes: 0,
            }}
            trackingStartedAt="2026-08-21T17:50:00.000Z"
            privacyScore={null}
            privacyMode={false}
            blurredNumber="synthetic"
            displayNumber="synthetic-number"
            customName="Prueba"
            editingName={false}
            editNameValue=""
            onEditNameValueChange={() => undefined}
            onSaveCustomName={() => undefined}
            onStartEditName={() => undefined}
            onCancelEditName={() => undefined}
            formatDateTime={value => value || '-'}
        />,
    );

    expect(screen.getByText('Sesión activa desde')).toBeInTheDocument();
    expect(screen.getByText('2026-08-21T17:50:00.000Z')).toBeInTheDocument();
    expect(screen.getByText('Contacto registrado')).toBeInTheDocument();
    expect(screen.getByText('2026-08-21T12:32:00.000Z')).toBeInTheDocument();
    expect(screen.queryByText('Patrones de Actividad')).not.toBeInTheDocument();
});

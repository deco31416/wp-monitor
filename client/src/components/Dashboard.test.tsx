import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Dashboard } from './Dashboard';

const { authFetchMock, socketEmitMock, socketHandlers } = vi.hoisted(() => ({
    authFetchMock: vi.fn(),
    socketEmitMock: vi.fn(),
    socketHandlers: new Map<string, (...args: unknown[]) => void>(),
}));

vi.mock('../auth', () => ({
    API_URL: 'http://localhost:4000',
    authFetch: authFetchMock,
}));

vi.mock('../socket', () => ({
    socket: {
        emit: socketEmitMock,
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => socketHandlers.set(event, handler)),
        off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
            if (socketHandlers.get(event) === handler) socketHandlers.delete(event);
        }),
    },
}));

const cases = [
    {
        caseId: 'CASE-QA-001',
        title: 'Caso sintetico',
        description: null,
        status: 'authorized',
        primaryOperator: 'OPERADOR-QA',
        authorizationNote: 'Prueba funcional autorizada',
        tags: [],
        createdAt: '2026-08-21T17:14:00.000Z',
        updatedAt: '2026-08-21T17:14:00.000Z',
        openedAt: null,
        closedAt: null,
        lastAuditAt: null,
        lastAuditAction: null,
    },
    {
        caseId: 'CASE-QA-002',
        title: 'Segundo caso',
        description: null,
        status: 'active',
        primaryOperator: 'OPERADOR-DOS',
        authorizationNote: 'Segunda prueba autorizada',
        tags: [],
        createdAt: '2026-08-22T17:14:00.000Z',
        updatedAt: '2026-08-22T17:14:00.000Z',
        openedAt: '2026-08-22T17:14:00.000Z',
        closedAt: null,
        lastAuditAt: null,
        lastAuditAction: null,
    },
    {
        caseId: 'SYSTEM-AUTH',
        title: 'SYSTEM-AUTH',
        description: null,
        status: 'authorized',
        primaryOperator: 'system',
        authorizationNote: 'Internal event',
        tags: [],
        createdAt: '2026-08-21T17:08:00.000Z',
        updatedAt: '2026-08-21T17:08:00.000Z',
        openedAt: null,
        closedAt: null,
        lastAuditAt: null,
        lastAuditAction: null,
    },
    {
        caseId: 'CLOSED-001',
        title: 'Closed case',
        description: null,
        status: 'closed',
        primaryOperator: 'OPERADOR-QA',
        authorizationNote: 'Closed',
        tags: [],
        createdAt: '2026-08-20T17:00:00.000Z',
        updatedAt: '2026-08-20T18:00:00.000Z',
        openedAt: '2026-08-20T17:00:00.000Z',
        closedAt: '2026-08-20T18:00:00.000Z',
        lastAuditAt: null,
        lastAuditAction: null,
    },
];

beforeEach(() => {
    vi.clearAllMocks();
    socketHandlers.clear();
    authFetchMock.mockImplementation(async (input: string) => ({
        ok: true,
        status: 200,
        json: async () => input.includes('/api/cases') ? cases : [],
    }));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

test('loads selectable cases and derives the audit context from the selected case', async () => {
    render(<Dashboard connectionState={{ whatsapp: true, whatsappQr: null }} />);

    const caseSelector = await screen.findByRole('combobox', { name: 'Caso activo' });
    await waitFor(() => expect(caseSelector).toHaveValue('CASE-QA-001'));

    expect(screen.getByRole('option', { name: 'CASE-QA-001 - Caso sintetico (authorized)' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /SYSTEM-AUTH/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /CLOSED-001/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Operador del caso')).toHaveValue('OPERADOR-QA');
    expect(screen.getByLabelText('Autorización del caso')).toHaveValue('Prueba funcional autorizada');
    expect(screen.getByLabelText('Operador del caso')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Autorización del caso')).toHaveAttribute('readonly');
});

test('starts contact tracking with the context of the selected case', async () => {
    const user = userEvent.setup();
    render(<Dashboard connectionState={{ whatsapp: true, whatsappQr: null }} />);

    await screen.findByRole('option', { name: 'CASE-QA-001 - Caso sintetico (authorized)' });
    await user.type(screen.getByPlaceholderText('Número con código de país'), '15555550123');
    await user.type(screen.getByPlaceholderText('Alias (opcional)'), 'Contacto autorizado');
    await user.click(screen.getByRole('button', { name: 'Agregar' }));

    expect(socketEmitMock).toHaveBeenCalledWith('add-contact', {
        number: '15555550123',
        customName: 'Contacto autorizado',
        caseId: 'CASE-QA-001',
        operatorName: 'OPERADOR-QA',
        authorizationNote: 'Prueba funcional autorizada',
    });
});

test('uses protected passive mode by default and hides experimental probes', async () => {
    render(<Dashboard connectionState={{ whatsapp: true, whatsappQr: null }} />);

    expect(await screen.findByText('Observación pasiva')).toBeInTheDocument();
    expect(screen.getByText('Datos protegidos')).toBeInTheDocument();
    expect(screen.queryByText('Opciones experimentales')).not.toBeInTheDocument();
});

test('offers saved cases for call capture and derives their protected audit context', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => ({ callTrafficAnalysis: true }),
    })));
    authFetchMock.mockImplementation(async (input: string) => ({
        ok: true,
        status: 200,
        json: async () => {
            if (input.includes('/api/cases')) return cases;
            if (input.includes('/api/contact/') && input.includes('/activity')) {
                return {
                    active: true,
                    caseId: 'CASE-QA-002',
                    trackingSessionId: 'tracking-qa-002',
                    trackingStartedAt: '2026-08-22T17:14:00.000Z',
                    page: { returned: 0, total: 0, truncated: false, limit: 200 },
                    events: [],
                };
            }
            return [];
        },
    }));

    render(<Dashboard connectionState={{ whatsapp: true, whatsappQr: null }} />);
    await screen.findByRole('option', { name: 'CASE-QA-001 - Caso sintetico (authorized)' });

    await act(async () => {
        socketHandlers.get('contact-added')?.({
            jid: '15555550123@s.whatsapp.net',
            number: '15555550123',
            customName: 'Contacto autorizado',
        });
    });

    await user.click(await screen.findByRole('button', { name: 'Llamada' }));
    const captureCase = await screen.findByRole('combobox', { name: 'Caso de la captura' });

    await waitFor(() => expect(captureCase).toHaveValue('CASE-QA-002'));
    expect(within(captureCase).getByRole('option', { name: 'CASE-QA-001 - Caso sintetico (authorized)' })).toBeInTheDocument();
    expect(within(captureCase).getByRole('option', { name: 'CASE-QA-002 - Segundo caso (active)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Operador de la captura')).toHaveValue('OPERADOR-DOS');
    expect(screen.getByLabelText('Autorización de la captura')).toHaveValue('Segunda prueba autorizada');
    expect(screen.getByLabelText('Operador de la captura')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Autorización de la captura')).toHaveAttribute('readonly');

    await user.selectOptions(captureCase, 'CASE-QA-001');
    expect(screen.getByLabelText('Operador de la captura')).toHaveValue('OPERADOR-QA');
    expect(screen.getByLabelText('Autorización de la captura')).toHaveValue('Prueba funcional autorizada');

    await user.click(screen.getByRole('button', { name: 'Iniciar Captura Manual' }));
    expect(authFetchMock).toHaveBeenCalledWith('http://localhost:4000/api/call-capture/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            targetJid: '15555550123@s.whatsapp.net',
            caseId: 'CASE-QA-001',
            operatorName: 'OPERADOR-QA',
            authorizationNote: 'Prueba funcional autorizada',
        }),
    });
});

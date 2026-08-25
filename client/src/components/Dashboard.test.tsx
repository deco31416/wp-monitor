import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { Dashboard } from './Dashboard';

const { authFetchMock, socketEmitMock } = vi.hoisted(() => ({
    authFetchMock: vi.fn(),
    socketEmitMock: vi.fn(),
}));

vi.mock('../auth', () => ({
    API_URL: 'http://localhost:4000',
    authFetch: authFetchMock,
}));

vi.mock('../socket', () => ({
    socket: {
        emit: socketEmitMock,
        on: vi.fn(),
        off: vi.fn(),
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
    authFetchMock.mockImplementation(async (input: string) => ({
        ok: true,
        status: 200,
        json: async () => input.includes('/api/cases') ? cases : [],
    }));
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

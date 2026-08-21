import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { AccountSettings } from './AccountSettings';

test('blocks a mismatched password confirmation before sending a request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    render(<AccountSettings username="admin" onCredentialsChanged={() => undefined} />);

    fireEvent.change(screen.getByLabelText('Contraseña actual'), { target: { value: 'current password from manager' } });
    fireEvent.change(screen.getByLabelText('Nueva contraseña (opcional)'), { target: { value: 'new password from manager 2026' } });
    fireEvent.change(screen.getByLabelText('Confirmar nueva contraseña'), { target: { value: 'different password from manager' } });
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar credenciales' }));

    expect(screen.getByRole('alert')).toHaveTextContent('no coincide');
    expect(fetchMock).not.toHaveBeenCalled();
});

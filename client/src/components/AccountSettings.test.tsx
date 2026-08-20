import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { AccountSettings } from './AccountSettings';

test('blocks a mismatched password confirmation before sending a request', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    render(<AccountSettings username="admin" onCredentialsChanged={() => undefined} />);

    await user.type(screen.getByLabelText('Contraseña actual'), 'current password from manager');
    await user.type(screen.getByLabelText('Nueva contraseña (opcional)'), 'new password from manager 2026');
    await user.type(screen.getByLabelText('Confirmar nueva contraseña'), 'different password from manager');
    await user.click(screen.getByRole('button', { name: 'Actualizar credenciales' }));

    expect(screen.getByRole('alert')).toHaveTextContent('no coincide');
    expect(fetchMock).not.toHaveBeenCalled();
});

import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { DashboardAccess } from './DashboardAccess';

test('submits username and password without rendering the password back to the page', async () => {
    const onLogin = vi.fn(async () => undefined);
    render(<DashboardAccess error={null} onLogin={onLogin} />);

    fireEvent.change(screen.getByLabelText('Usuario'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'synthetic password from manager' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(onLogin).toHaveBeenCalledWith('admin', 'synthetic password from manager');
    expect(screen.queryByText('synthetic password from manager')).not.toBeInTheDocument();
});

test('renders a generic authentication error without disclosing credentials', () => {
    render(<DashboardAccess error="Usuario o contraseña inválidos" onLogin={async () => undefined} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Usuario o contraseña inválidos');
});

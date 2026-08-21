import { render, screen } from '@testing-library/react';
import { Login } from './components/Login';

test('renders Spanish WhatsApp connection instructions while waiting for a QR', () => {
  render(<Login connectionState={{ whatsapp: false, whatsappQr: null }} />);

  expect(screen.getByRole('heading', { name: /conectar whatsapp/i })).toBeInTheDocument();
  expect(screen.getByText(/esperando el código qr/i)).toBeInTheDocument();
});

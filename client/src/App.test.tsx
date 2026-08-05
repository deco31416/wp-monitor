import React from 'react';
import { render, screen } from '@testing-library/react';
import { Login } from './components/Login';

test('renders WhatsApp connection instructions while waiting for a QR', () => {
  render(<Login connectionState={{ whatsapp: false, whatsappQr: null }} />);

  expect(screen.getByRole('heading', { name: /connect whatsapp/i })).toBeInTheDocument();
  expect(screen.getByText(/waiting for qr code/i)).toBeInTheDocument();
});

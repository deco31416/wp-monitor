import { render, screen } from '@testing-library/react';
import { Login } from './components/Login';
import { resolveCaptureIndicator, type RuntimeCapabilities } from './runtime-capabilities';

test('renders Spanish WhatsApp connection instructions while waiting for a QR', () => {
  render(<Login connectionState={{ whatsapp: false, whatsappQr: null }} />);

  expect(screen.getByRole('heading', { name: /conectar whatsapp/i })).toBeInTheDocument();
  expect(screen.getByText(/esperando el código qr/i)).toBeInTheDocument();
});

function capabilities(overrides: Partial<RuntimeCapabilities>): RuntimeCapabilities {
  return {
    version: '3.1.0',
    mode: 'local-full',
    localCapture: false,
    localCaptureAvailable: false,
    networkMonitor: false,
    callTrafficAnalysis: false,
    callCaptureMode: 'disabled',
    ...overrides,
  };
}

test('describes the actual capture provider instead of labeling agent mode as panel-only', () => {
  expect(resolveCaptureIndicator(capabilities({
    callCaptureMode: 'agent',
    callTrafficAnalysis: true,
  }))).toEqual({ tone: 'success', label: 'Captura de llamada lista' });

  expect(resolveCaptureIndicator(capabilities({
    callCaptureMode: 'agent',
    callTrafficAnalysis: false,
  }))).toEqual({ tone: 'warning', label: 'Agente de llamada no disponible' });

  expect(resolveCaptureIndicator(capabilities({
    localCapture: true,
    localCaptureAvailable: false,
    callCaptureMode: 'local',
  }))).toEqual({ tone: 'warning', label: 'Faltan permisos de captura local' });
});

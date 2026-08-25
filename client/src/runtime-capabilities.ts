export interface RuntimeCapabilities {
    version: string;
    mode: string;
    localCapture: boolean;
    localCaptureAvailable: boolean;
    networkMonitor: boolean;
    callTrafficAnalysis: boolean;
    callCaptureMode: 'disabled' | 'local' | 'agent';
    passiveMessageReceipts?: boolean;
    experimentalProbes?: boolean;
    authRequired?: boolean;
}

export interface CaptureIndicator {
    tone: 'success' | 'warning' | 'neutral';
    label: string;
}

export function resolveCaptureIndicator(capabilities: RuntimeCapabilities | null): CaptureIndicator | null {
    if (!capabilities) return null;
    if (capabilities.localCapture) {
        return capabilities.localCaptureAvailable
            ? { tone: 'success', label: 'Captura local lista' }
            : { tone: 'warning', label: 'Faltan permisos de captura local' };
    }
    if (capabilities.callCaptureMode === 'agent') {
        return capabilities.callTrafficAnalysis
            ? { tone: 'success', label: 'Captura de llamada lista' }
            : { tone: 'warning', label: 'Agente de llamada no disponible' };
    }
    return { tone: 'neutral', label: 'Captura técnica desactivada' };
}

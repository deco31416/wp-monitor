import { createWebRtcObserverApp } from './webrtc-observer-app.js';
import { WebRtcCdpObserver } from './webrtc-observer-cdp.js';
import { validateCaptureAgentSecret } from './capture-agent-auth.js';

function parsePort(value: string | undefined): number {
    const port = Number(value ?? 4200);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error('WEBRTC_OBSERVER_PORT is invalid');
    return port;
}

function parseEnabled(value: string | undefined): boolean {
    const normalized = value?.trim().toLowerCase() ?? 'false';
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    throw new Error('WEBRTC_OBSERVER_ENABLED must be true or false');
}

const enabled = parseEnabled(process.env.WEBRTC_OBSERVER_ENABLED);
const sharedSecret = process.env.WEBRTC_OBSERVER_SHARED_SECRET ?? '';
if (enabled) validateCaptureAgentSecret(sharedSecret);
const port = parsePort(process.env.WEBRTC_OBSERVER_PORT);
const bind = process.env.WEBRTC_OBSERVER_BIND?.trim() || '0.0.0.0';
const cdpOrigin = process.env.WEBRTC_CDP_URL?.trim() || 'http://127.0.0.1:9222';
const adapter = new WebRtcCdpObserver(cdpOrigin);
const app = createWebRtcObserverApp({ enabled, sharedSecret, adapter });
const server = app.listen(port, bind, () => {
    console.log(`[WEBRTC-OBSERVER] Listening on internal port ${port} (${enabled ? 'enabled' : 'disabled'})`);
});

let stopping = false;
function shutdown(): void {
    if (stopping) return;
    stopping = true;
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

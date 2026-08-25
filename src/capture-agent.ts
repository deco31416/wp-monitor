import { createServer } from 'node:http';
import { createCaptureAgentApp } from './capture-agent-app.js';
import {
    getCallCaptureStatus,
    startCallCapture,
    stopCallCapture,
} from './call-analyzer.js';
import { hasDedicatedCapturePrivileges } from './capture-permissions.js';
import { listInterfaces } from './packet-capture.js';

function parseAgentPort(value: string | undefined): number {
    const port = Number(value || 4100);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        throw new Error('CAPTURE_AGENT_PORT must be an integer between 1024 and 65535');
    }
    return port;
}

const sharedSecret = process.env.CAPTURE_AGENT_SHARED_SECRET || '';
const port = parseAgentPort(process.env.CAPTURE_AGENT_PORT);
const bindAddress = process.env.CAPTURE_AGENT_BIND || '0.0.0.0';

const app = createCaptureAgentApp({
    sharedSecret,
    adapter: {
        capturePrivilegesAvailable: hasDedicatedCapturePrivileges,
        listInterfaces,
        getCallCaptureStatus,
        startCallCapture: (interfaceAddr, targetJid, callId, isVideo) => (
            startCallCapture(interfaceAddr, targetJid, callId, isVideo)
        ),
        stopCallCapture,
    },
});
const server = createServer(app);

server.listen(port, bindAddress, () => {
    console.log(`[CAPTURE-AGENT] Listening on ${bindAddress}:${port}`);
    console.log(hasDedicatedCapturePrivileges()
        ? '[CAPTURE-AGENT] Packet capture privileges available'
        : '[CAPTURE-AGENT] Packet capture privileges unavailable');
});

let shutdownStarted = false;
function shutdown(signal: 'SIGINT' | 'SIGTERM'): void {
    if (shutdownStarted) return;
    shutdownStarted = true;
    stopCallCapture();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
    console.log(`[CAPTURE-AGENT] Shutdown requested by ${signal}`);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

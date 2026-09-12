import { spawnSync } from 'node:child_process';
import { validateBrowserContract } from './dokploy-browser-contract.mjs';

const volumeContracts = [
    {
        logicalName: 'baileys_auth',
        envName: 'BAILEYS_AUTH_VOLUME_NAME',
        service: 'backend',
        target: '/app/auth_info_baileys',
    },
    {
        logicalName: 'checkin_uploads',
        envName: 'CHECKIN_UPLOADS_VOLUME_NAME',
        service: 'backend',
        target: '/app/public/uploads',
    },
    {
        logicalName: 'whatsapp_browser_profile',
        envName: 'WHATSAPP_BROWSER_PROFILE_VOLUME_NAME',
        service: 'wa-browser',
        target: '/home/browser/profile',
    },
];
const supportedArguments = new Set(['--', '--require-existing-volumes']);
const unknownArguments = process.argv.slice(2).filter((argument) => !supportedArguments.has(argument));
if (unknownArguments.length) {
    console.error(`[compose:dokploy:check] argumento no soportado: ${unknownArguments[0]}`);
    process.exit(1);
}
const requireExistingVolumes = process.argv.includes('--require-existing-volumes');

function configuredPort(name, fallback) {
    const value = String(process.env[name] || fallback);
    if (!/^\d{1,5}$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
        console.error(`[compose:dokploy:check] ${name} debe ser un puerto valido`);
        process.exit(1);
    }
    return value;
}

function configuredDockerName(name, fallback) {
    const value = String(process.env[name] || fallback).trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/.test(value)) {
        console.error(`[compose:dokploy:check] ${name} debe ser un nombre Docker valido`);
        process.exit(1);
    }
    return value;
}

const browserContract = {
    noVncPort: configuredPort('BROWSER_UI_PORT', '7900'),
    selkiesPort: configuredPort('SELKIES_UI_PORT', '7901'),
    browserTunnelAlias: configuredDockerName('BROWSER_TUNNEL_ALIAS', 'wp-monitor-browser'),
    tunnelNetworkName: configuredDockerName('TUNNEL_NETWORK_NAME', 'dokploy-network'),
};

if (browserContract.noVncPort === browserContract.selkiesPort) {
    console.error('[compose:dokploy:check] BROWSER_UI_PORT y SELKIES_UI_PORT deben ser distintos');
    process.exit(1);
}

const errors = [];
const expectedNames = new Set();

for (const contract of volumeContracts) {
    const value = String(process.env[contract.envName] || '').trim();
    contract.expectedName = value;
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/.test(value)) {
        errors.push(`${contract.envName} debe contener un nombre de volumen Docker explicito y valido`);
    } else if (expectedNames.has(value)) {
        errors.push(`${contract.envName} no puede reutilizar el nombre de otro volumen persistente`);
    }
    expectedNames.add(value);
}

if (errors.length) {
    for (const error of errors) console.error(`[compose:dokploy:check] ${error}`);
    process.exit(1);
}

const docker = process.platform === 'win32' ? 'docker.exe' : 'docker';
const result = spawnSync(docker, [
    'compose',
    '-p',
    'wp-monitor-contract-check',
    '-f',
    'docker-compose.yml',
    '-f',
    'deploy/docker-compose.dokploy.yml',
    'config',
    '--format',
    'json',
], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
});

if (result.error) {
    console.error('[compose:dokploy:check] Docker no esta disponible para validar el contrato Dokploy');
    process.exit(1);
}
if (result.status !== 0) {
    console.error('[compose:dokploy:check] Docker Compose no pudo renderizar el contrato Dokploy');
    process.exit(result.status || 1);
}

let config;
try {
    config = JSON.parse(result.stdout);
} catch {
    console.error('[compose:dokploy:check] Docker Compose no devolvio JSON valido');
    process.exit(1);
}

for (const contract of volumeContracts) {
    const volume = config.volumes?.[contract.logicalName];
    if (!volume || volume.external !== true || volume.name !== contract.expectedName) {
        errors.push(
            `${contract.logicalName} debe ser external y resolver exactamente a ${contract.expectedName}`,
        );
    }

    const mounts = config.services?.[contract.service]?.volumes;
    const mounted = Array.isArray(mounts) && mounts.some((mount) => (
        mount?.type === 'volume'
        && [contract.logicalName, contract.expectedName].includes(mount.source)
        && mount.target === contract.target
    ));
    if (!mounted) {
        errors.push(`${contract.service} no monta ${contract.logicalName} en ${contract.target}`);
    }
}

for (const serviceName of ['backend', 'client', 'capture-agent', 'webrtc-observer']) {
    if ((config.services?.[serviceName]?.ports || []).length > 0) {
        errors.push(`${serviceName} no debe publicar puertos host en Dokploy`);
    }
}

const expectedApplicationServices = ['backend', 'capture-agent', 'client', 'wa-browser', 'webrtc-observer'];
const renderedApplicationServices = Object.keys(config.services || {}).sort();
if (JSON.stringify(renderedApplicationServices) !== JSON.stringify(expectedApplicationServices)) {
    errors.push('Dokploy debe renderizar exactamente backend, client, wa-browser, capture-agent y webrtc-observer');
}

const observer = config.services?.['webrtc-observer'];
if (observer?.network_mode !== 'service:wa-browser') {
    errors.push('webrtc-observer debe compartir exclusivamente el namespace de red de wa-browser');
}
if (observer?.read_only !== true) errors.push('webrtc-observer debe usar rootfs de solo lectura');
if (!Array.isArray(observer?.cap_drop) || !observer.cap_drop.includes('ALL') || (observer.cap_add || []).length > 0) {
    errors.push('webrtc-observer debe ejecutarse sin capabilities');
}
const observerSecurity = observer?.security_opt || [];
if (!Array.isArray(observerSecurity) || !observerSecurity.includes('no-new-privileges:true')) {
    errors.push('webrtc-observer debe impedir nuevos privilegios');
}
if (observer?.environment?.WEBRTC_CDP_URL !== 'http://127.0.0.1:9222') {
    errors.push('webrtc-observer solo puede acceder a CDP por loopback compartido');
}
if (config.services?.backend?.environment?.WEBRTC_OBSERVER_URL !== 'http://wa-browser:4200') {
    errors.push('backend debe controlar webrtc-observer por su origen interno fijo');
}

errors.push(...validateBrowserContract(config, browserContract));

if (config.services?.redis) {
    errors.push('Redis incluido no debe formar parte de la topologia Dokploy renderizada');
}

const stateNetwork = config.networks?.['data-network'];
if (!stateNetwork?.external || stateNetwork.name !== (process.env.STATE_NETWORK_NAME || 'wp-monitor-data')) {
    errors.push('data-network debe reutilizar explicitamente la red externa configurada');
}

if (requireExistingVolumes) {
    for (const contract of volumeContracts) {
        const inspection = spawnSync(docker, ['volume', 'inspect', contract.expectedName], {
            encoding: 'utf8',
            stdio: 'ignore',
        });
        if (inspection.status !== 0) {
            errors.push(`el volumen externo requerido no existe: ${contract.expectedName}`);
        }
    }
}

if (errors.length) {
    for (const error of errors) console.error(`[compose:dokploy:check] ${error}`);
    process.exit(1);
}

console.log(
    `[compose:dokploy:check] PASS: topologia y tres volumenes persistentes son explicitos${requireExistingVolumes ? ' y existen' : ''}`,
);

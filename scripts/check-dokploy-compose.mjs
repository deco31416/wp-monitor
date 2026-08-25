import { spawnSync } from 'node:child_process';

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

for (const serviceName of ['backend', 'client', 'capture-agent']) {
    if ((config.services?.[serviceName]?.ports || []).length > 0) {
        errors.push(`${serviceName} no debe publicar puertos host en Dokploy`);
    }
}

const browserPorts = config.services?.['wa-browser']?.ports || [];
if (browserPorts.length !== 1 || browserPorts[0]?.host_ip !== '127.0.0.1') {
    errors.push('wa-browser debe publicar noVNC una sola vez y solo en 127.0.0.1');
}

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

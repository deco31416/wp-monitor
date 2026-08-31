const LOOPBACK_IPV4 = '127.0.0.1';

function normalizePort(port) {
    return {
        hostIp: String(port?.host_ip || ''),
        published: String(port?.published || ''),
        target: Number(port?.target),
        protocol: String(port?.protocol || ''),
    };
}

function matchesPort(port, expected) {
    const normalized = normalizePort(port);
    return normalized.hostIp === LOOPBACK_IPV4
        && normalized.published === expected.published
        && normalized.target === expected.target
        && normalized.protocol === 'tcp';
}

export function validateBrowserContract(config, options) {
    const errors = [];
    const browser = config.services?.['wa-browser'];
    const ports = Array.isArray(browser?.ports) ? browser.ports : [];
    const expectedPorts = [
        { label: 'noVNC', published: String(options.noVncPort), target: 7900 },
        { label: 'Selkies', published: String(options.selkiesPort), target: 8080 },
    ];

    for (const expected of expectedPorts) {
        if (!ports.some((port) => matchesPort(port, expected))) {
            errors.push(
                `${expected.label} debe publicar ${LOOPBACK_IPV4}:${expected.published} hacia ${expected.target}/tcp`,
            );
        }
    }

    if (ports.length !== expectedPorts.length || ports.some((port) => (
        !expectedPorts.some((expected) => matchesPort(port, expected))
    ))) {
        errors.push('wa-browser no puede publicar puertos distintos de noVNC y Selkies en loopback');
    }

    const browserNetworks = browser?.networks || {};
    if (!Object.hasOwn(browserNetworks, 'app-network')) {
        errors.push('wa-browser debe pertenecer a app-network');
    }
    if (!Object.hasOwn(browserNetworks, 'tunnel-network')) {
        errors.push('wa-browser debe pertenecer a tunnel-network');
    }

    const tunnelNetwork = config.networks?.['tunnel-network'];
    if (!tunnelNetwork?.external || tunnelNetwork.name !== options.tunnelNetworkName) {
        errors.push('tunnel-network debe ser externa y resolver al nombre configurado');
    }

    const aliases = browserNetworks?.['tunnel-network']?.aliases;
    if (!Array.isArray(aliases)
        || aliases.length !== 1
        || aliases[0] !== options.browserTunnelAlias) {
        errors.push('wa-browser debe tener exactamente el alias de tunel configurado');
    }

    return errors;
}

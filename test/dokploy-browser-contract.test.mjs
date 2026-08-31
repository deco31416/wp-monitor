import assert from 'node:assert/strict';
import test from 'node:test';

import { validateBrowserContract } from '../scripts/dokploy-browser-contract.mjs';

const options = {
    noVncPort: '7900',
    selkiesPort: '7901',
    browserTunnelAlias: 'wp-monitor-browser',
    tunnelNetworkName: 'dokploy-network',
};

function validConfig() {
    return {
        services: {
            'wa-browser': {
                ports: [
                    { host_ip: '127.0.0.1', published: '7900', target: 7900, protocol: 'tcp' },
                    { host_ip: '127.0.0.1', published: '7901', target: 8080, protocol: 'tcp' },
                ],
                networks: {
                    'app-network': null,
                    'tunnel-network': { aliases: ['wp-monitor-browser'] },
                },
            },
        },
        networks: {
            'tunnel-network': { external: true, name: 'dokploy-network' },
        },
    };
}

function validate(mutator = () => {}) {
    const config = validConfig();
    mutator(config);
    return validateBrowserContract(config, options);
}

test('accepts the exact public browser topology contract', () => {
    assert.deepEqual(validate(), []);
});

test('rejects a missing Selkies publication', () => {
    assert.notEqual(validate((config) => config.services['wa-browser'].ports.pop()).length, 0);
});

test('rejects Selkies exposed on every interface', () => {
    assert.notEqual(validate((config) => {
        config.services['wa-browser'].ports[1].host_ip = '0.0.0.0';
    }).length, 0);
});

test('rejects a different Selkies target', () => {
    assert.notEqual(validate((config) => {
        config.services['wa-browser'].ports[1].target = 8081;
    }).length, 0);
});

test('rejects an additional browser host port', () => {
    assert.notEqual(validate((config) => config.services['wa-browser'].ports.push({
        host_ip: '127.0.0.1', published: '7999', target: 7999, protocol: 'tcp',
    })).length, 0);
});

test('rejects missing tunnel membership', () => {
    assert.notEqual(validate((config) => {
        delete config.services['wa-browser'].networks['tunnel-network'];
    }).length, 0);
});

test('rejects a non-external tunnel network', () => {
    assert.notEqual(validate((config) => {
        config.networks['tunnel-network'].external = false;
    }).length, 0);
});

test('rejects an incorrect or missing browser tunnel alias', () => {
    assert.notEqual(validate((config) => {
        config.services['wa-browser'].networks['tunnel-network'].aliases = ['wrong'];
    }).length, 0);
    assert.notEqual(validate((config) => {
        delete config.services['wa-browser'].networks['tunnel-network'].aliases;
    }).length, 0);
});

test('continues requiring noVNC on IPv4 loopback', () => {
    assert.notEqual(validate((config) => {
        config.services['wa-browser'].ports[0].host_ip = '';
    }).length, 0);
});

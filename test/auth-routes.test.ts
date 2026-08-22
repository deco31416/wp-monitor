import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiOriginGuard, createApiSessionGuard, registerAuthRoutes, type AuthRouteOptions } from '../src/routes/auth.js';
import { PRIMARY_OPERATOR_ID, type AuthPrincipal, type AuthSession, type OperatorUserDoc } from '../src/operator-auth.js';

const ORIGIN = 'https://dashboard.example.test';
const SESSION_TOKEN = 's'.repeat(43);

function principal(): AuthPrincipal {
    return {
        userId: PRIMARY_OPERATOR_ID,
        username: 'admin',
        credentialVersion: 1,
        sessionFingerprint: 'f'.repeat(64),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    };
}

function session(): AuthSession {
    return {
        token: SESSION_TOKEN,
        fingerprint: 'f'.repeat(64),
        userId: PRIMARY_OPERATOR_ID,
        username: 'admin',
        credentialVersion: 1,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    };
}

function user(): OperatorUserDoc {
    return {
        _id: PRIMARY_OPERATOR_ID,
        username: 'admin',
        normalizedUsername: 'admin',
        passwordHash: 'redacted-hash',
        credentialVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        passwordChangedAt: new Date(),
        lastLoginAt: null,
    };
}

async function withServer(app: express.Express, run: (baseUrl: string) => Promise<void>): Promise<void> {
    const server: Server = app.listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    try {
        await run(`http://127.0.0.1:${address.port}`);
    } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
}

function createOptions(): AuthRouteOptions {
    return {
        allowedOrigins: [ORIGIN],
        secureCookies: true,
        authService: {
            async login(username, password) {
                return username === 'admin' && password === 'valid password from manager'
                    ? { user: user(), session: session() }
                    : null;
            },
            async authenticate(token) {
                return token === SESSION_TOKEN ? principal() : null;
            },
            async logout() {},
            async changeCredentials() {
                return { ok: false, code: 'no_changes' };
            },
        },
    };
}

test('login rejects an untrusted origin before processing credentials', async () => {
    const app = express();
    app.use(express.json());
    registerAuthRoutes(app, createOptions());

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example.test' },
            body: JSON.stringify({ username: 'admin', password: 'valid password from manager' }),
        });
        assert.equal(response.status, 403);
        assert.equal(response.headers.get('set-cookie'), null);
    });
});

test('login returns an opaque production cookie without exposing it in JSON', async () => {
    const app = express();
    app.use(express.json());
    registerAuthRoutes(app, createOptions());

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
            body: JSON.stringify({ username: 'admin', password: 'valid password from manager' }),
        });
        const body = await response.json();
        const cookie = response.headers.get('set-cookie') || '';
        assert.equal(response.status, 200);
        assert.equal(body.authenticated, true);
        assert.equal(JSON.stringify(body).includes(SESSION_TOKEN), false);
        assert.match(cookie, /^__Host-wp_monitor_session=/);
        assert.match(cookie, /HttpOnly/i);
        assert.match(cookie, /Secure/i);
        assert.match(cookie, /SameSite=Strict/i);
        assert.match(cookie, /Max-Age=/i);
    });
});

test('session guard accepts the cookie and unsafe API methods require a trusted origin', async () => {
    const app = express();
    const options = createOptions();
    registerAuthRoutes(app, options);
    app.use('/api', createApiSessionGuard(options));
    app.use('/api', createApiOriginGuard(options.allowedOrigins));
    app.post('/api/protected', (_request, response) => response.json({ ok: true }));

    await withServer(app, async baseUrl => {
        const cookie = `__Host-wp_monitor_session=${SESSION_TOKEN}`;
        const rejected = await fetch(`${baseUrl}/api/protected`, { method: 'POST', headers: { Cookie: cookie } });
        assert.equal(rejected.status, 403);

        const accepted = await fetch(`${baseUrl}/api/protected`, {
            method: 'POST',
            headers: { Cookie: cookie, Origin: ORIGIN },
        });
        assert.equal(accepted.status, 200);
        assert.deepEqual(await accepted.json(), { ok: true });
    });
});

test('credential update rotates the cookie and triggers global socket revocation', async () => {
    const app = express();
    app.use(express.json());
    const options = createOptions();
    let credentialsChanged = 0;
    let oldSessionRevoked = 0;
    options.onCredentialsChanged = () => {
        credentialsChanged += 1;
    };
    options.authService = {
        ...options.authService,
        async logout() {
            oldSessionRevoked += 1;
        },
        async changeCredentials() {
            return {
                ok: true,
                user: { ...user(), username: 'owner', normalizedUsername: 'owner', credentialVersion: 2 },
                session: { ...session(), username: 'owner', credentialVersion: 2, token: 'n'.repeat(43) },
            };
        },
    };
    registerAuthRoutes(app, options);

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/auth/credentials`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Cookie: `__Host-wp_monitor_session=${SESSION_TOKEN}`,
                Origin: ORIGIN,
            },
            body: JSON.stringify({
                username: 'owner',
                currentPassword: 'current password from manager',
                newPassword: 'replacement password from manager',
            }),
        });
        const body = await response.json();
        assert.equal(response.status, 200);
        assert.equal(body.username, 'owner');
        assert.equal(JSON.stringify(body).includes('n'.repeat(43)), false);
        assert.match(response.headers.get('set-cookie') || '', /^__Host-wp_monitor_session=n{43}/);
        assert.equal(credentialsChanged, 1);
        await new Promise<void>(resolve => setImmediate(resolve));
        assert.equal(oldSessionRevoked, 1);
    });
});

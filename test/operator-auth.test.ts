import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword } from '../src/password-security.js';
import {
    AuthServiceUnavailableError,
    LoginRateLimitError,
    OperatorAuthService,
    PRIMARY_OPERATOR_ID,
    RedisAuthSessionStore,
    buildLoginRateLimitRules,
    type OperatorUserDoc,
    type OperatorUserRepository,
} from '../src/operator-auth.js';
import type { FixedWindowRateLimitStore, RateLimitDecision, RateLimitRule, RedisCommandExecutor } from '../src/rate-limit.js';

const IDENTITY_SECRET = 'unit-auth-identity-secret-with-more-than-32-characters';
const VALID_SESSION_TOKEN = 'a'.repeat(43);

class FakeRedis implements RedisCommandExecutor {
    readonly values = new Map<string, string>();
    commands: string[][] = [];
    fail = false;

    async sendCommand(command: string[]): Promise<unknown> {
        this.commands.push(command);
        if (this.fail) throw new Error('synthetic Redis failure with private details');
        if (command[0] === 'SET') {
            const [, key, value] = command;
            if (!key || value === undefined || this.values.has(key)) return null;
            this.values.set(key, value);
            return 'OK';
        }
        if (command[0] === 'GET') return this.values.get(command[1] || '') ?? null;
        if (command[0] === 'DEL') return this.values.delete(command[1] || '') ? 1 : 0;
        throw new Error('Unsupported fake Redis command');
    }
}

class AllowingRateLimitStore implements FixedWindowRateLimitStore {
    rules: RateLimitRule[] = [];

    async consume(rules: RateLimitRule[]): Promise<RateLimitDecision> {
        this.rules = rules;
        return { allowed: true, retryAfterSeconds: 0, counts: rules.map(() => 1) };
    }
}

class FakeOperatorRepository implements OperatorUserRepository {
    user: OperatorUserDoc | null = null;
    loginRecorded = false;

    async getPrimaryOperator(): Promise<OperatorUserDoc | null> {
        return this.user ? { ...this.user } : null;
    }

    async findOperatorByNormalizedUsername(normalizedUsername: string): Promise<OperatorUserDoc | null> {
        return this.user?.normalizedUsername === normalizedUsername ? { ...this.user } : null;
    }

    async createPrimaryOperator(input: Parameters<OperatorUserRepository['createPrimaryOperator']>[0]) {
        if (!this.user) {
            this.user = {
                _id: PRIMARY_OPERATOR_ID,
                username: input.username,
                normalizedUsername: input.normalizedUsername,
                passwordHash: input.passwordHash,
                credentialVersion: 1,
                createdAt: input.now,
                updatedAt: input.now,
                passwordChangedAt: input.now,
                lastLoginAt: null,
            };
            return { user: { ...this.user }, created: true };
        }
        return { user: { ...this.user }, created: false };
    }

    async updatePrimaryOperatorCredentials(input: Parameters<OperatorUserRepository['updatePrimaryOperatorCredentials']>[0]) {
        if (!this.user || this.user.credentialVersion !== input.expectedCredentialVersion) return null;
        this.user = {
            ...this.user,
            username: input.username,
            normalizedUsername: input.normalizedUsername,
            passwordHash: input.passwordHash,
            credentialVersion: this.user.credentialVersion + 1,
            updatedAt: input.now,
            passwordChangedAt: input.passwordChanged ? input.now : this.user.passwordChangedAt,
        };
        return { ...this.user };
    }

    async recordPrimaryOperatorLogin(now: Date): Promise<void> {
        if (!this.user) throw new Error('missing operator');
        this.user.lastLoginAt = now;
        this.loginRecorded = true;
    }
}

function authConfig() {
    return {
        keyPrefix: 'unit',
        identitySecret: IDENTITY_SECRET,
        sessionTtlSeconds: 3600,
        passwordVerifyConcurrency: 1,
        loginRateLimit: {
            windowMs: 900_000,
            maxPerIp: 50,
            maxPerUsername: 50,
            maxPerUsernameIp: 10,
        },
    };
}

test('stores only an opaque session fingerprint in Redis keys and revokes it', async () => {
    const redis = new FakeRedis();
    const store = new RedisAuthSessionStore(
        redis,
        'unit',
        IDENTITY_SECRET,
        3600,
        () => Date.parse('2026-08-20T12:00:00.000Z'),
        () => VALID_SESSION_TOKEN,
    );
    const user: OperatorUserDoc = {
        _id: PRIMARY_OPERATOR_ID,
        username: 'admin',
        normalizedUsername: 'admin',
        passwordHash: 'not-used-by-session-store',
        credentialVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        passwordChangedAt: new Date(),
        lastLoginAt: null,
    };

    const session = await store.create(user);
    const redisKey = redis.commands[0]?.[1] || '';
    assert.equal(session.token, VALID_SESSION_TOKEN);
    assert.match(redisKey, /^unit:auth:session:[a-f0-9]{64}$/);
    assert.equal(redisKey.includes(VALID_SESSION_TOKEN), false);
    assert.equal((await store.get(VALID_SESSION_TOKEN))?.username, 'admin');

    await store.revoke(VALID_SESSION_TOKEN);
    assert.equal(await store.get(VALID_SESSION_TOKEN), null);
});

test('login and credential change invalidate the previous session version', async () => {
    const repository = new FakeOperatorRepository();
    const initialPassword = 'initial password from manager 2026';
    await repository.createPrimaryOperator({
        username: 'admin',
        normalizedUsername: 'admin',
        passwordHash: await hashPassword(initialPassword),
        now: new Date('2026-08-20T12:00:00.000Z'),
    });
    const redis = new FakeRedis();
    const limiter = new AllowingRateLimitStore();
    const service = new OperatorAuthService(repository, redis, limiter, authConfig());

    assert.equal(await service.login('admin', 'incorrect password value', '192.0.2.10'), null);
    const login = await service.login('ADMIN', initialPassword, '192.0.2.10');
    assert.ok(login);
    assert.equal(repository.loginRecorded, true);
    const oldPrincipal = await service.authenticate(login.session.token);
    assert.ok(oldPrincipal);

    const changed = await service.changeCredentials(
        oldPrincipal,
        initialPassword,
        'owner',
        'replacement password from manager 2026',
    );
    assert.equal(changed.ok, true);
    if (!changed.ok) return;

    assert.equal(await service.authenticate(login.session.token), null);
    const newPrincipal = await service.authenticate(changed.session.token);
    assert.equal(newPrincipal?.username, 'owner');
    assert.equal(newPrincipal?.credentialVersion, 2);
});

test('rate-limit keys do not expose the attempted username or IP address', () => {
    const rules = buildLoginRateLimitRules(IDENTITY_SECRET, 'private-user', '192.0.2.10', authConfig().loginRateLimit);
    assert.equal(rules.length, 3);
    for (const rule of rules) {
        assert.equal(rule.key.includes('private-user'), false);
        assert.equal(rule.key.includes('192.0.2.10'), false);
        assert.match(rule.key, /^auth-login:[a-z-]+:[a-f0-9]{64}$/);
    }
});

test('fails closed when Redis cannot create a session', async () => {
    const redis = new FakeRedis();
    redis.fail = true;
    const store = new RedisAuthSessionStore(redis, 'unit', IDENTITY_SECRET, 3600, Date.now, () => VALID_SESSION_TOKEN);
    const user = {
        _id: PRIMARY_OPERATOR_ID,
        username: 'admin',
        normalizedUsername: 'admin',
        passwordHash: 'unused',
        credentialVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        passwordChangedAt: new Date(),
        lastLoginAt: null,
    } satisfies OperatorUserDoc;

    await assert.rejects(store.create(user), AuthServiceUnavailableError);
});

test('exposes a bounded retry interval when the login limiter denies access', async () => {
    const repository = new FakeOperatorRepository();
    const redis = new FakeRedis();
    const deniedStore: FixedWindowRateLimitStore = {
        async consume() {
            return { allowed: false, retryAfterSeconds: 37, counts: [11, 11, 11] };
        },
    };
    const service = new OperatorAuthService(repository, redis, deniedStore, authConfig());

    await assert.rejects(
        service.login('admin', 'any sufficiently long password', '192.0.2.10'),
        (error: unknown) => error instanceof LoginRateLimitError && error.retryAfterSeconds === 37,
    );
});

test('bounds concurrent memory-hard login verification for a single-operator VPS', async () => {
    const repository = new FakeOperatorRepository();
    await repository.createPrimaryOperator({
        username: 'admin',
        normalizedUsername: 'admin',
        passwordHash: await hashPassword('initial password from manager 2026'),
        now: new Date(),
    });
    const service = new OperatorAuthService(
        repository,
        new FakeRedis(),
        new AllowingRateLimitStore(),
        authConfig(),
    );

    const first = service.login('admin', 'incorrect password value one', '192.0.2.10');
    const second = service.login('admin', 'incorrect password value two', '192.0.2.11');
    const results = await Promise.allSettled([first, second]);

    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = results.find(result => result.status === 'rejected');
    assert.ok(rejected && rejected.status === 'rejected');
    assert.ok(rejected.reason instanceof LoginRateLimitError);
    assert.equal(rejected.reason.retryAfterSeconds, 1);
});

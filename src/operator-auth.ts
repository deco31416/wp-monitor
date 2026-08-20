import { createHmac, randomBytes } from 'node:crypto';
import type { FixedWindowRateLimitStore, RateLimitRule, RedisCommandExecutor } from './rate-limit.js';
import { hashRateLimitIdentity } from './rate-limit.js';
import {
    hashPassword,
    validatePassword,
    validateUsername,
    verifyPassword,
} from './password-security.js';

export const PRIMARY_OPERATOR_ID = 'primary-operator';

export interface OperatorUserDoc {
    _id: typeof PRIMARY_OPERATOR_ID;
    username: string;
    normalizedUsername: string;
    passwordHash: string;
    credentialVersion: number;
    createdAt: Date;
    updatedAt: Date;
    passwordChangedAt: Date;
    lastLoginAt: Date | null;
}

export interface OperatorUserRepository {
    getPrimaryOperator(): Promise<OperatorUserDoc | null>;
    findOperatorByNormalizedUsername(normalizedUsername: string): Promise<OperatorUserDoc | null>;
    createPrimaryOperator(input: {
        username: string;
        normalizedUsername: string;
        passwordHash: string;
        now: Date;
    }): Promise<{ user: OperatorUserDoc; created: boolean }>;
    updatePrimaryOperatorCredentials(input: {
        expectedCredentialVersion: number;
        username: string;
        normalizedUsername: string;
        passwordHash: string;
        passwordChanged: boolean;
        now: Date;
    }): Promise<OperatorUserDoc | null>;
    recordPrimaryOperatorLogin(now: Date): Promise<void>;
}

export interface AuthSession {
    token: string;
    fingerprint: string;
    userId: typeof PRIMARY_OPERATOR_ID;
    username: string;
    credentialVersion: number;
    createdAt: string;
    expiresAt: string;
}

interface StoredAuthSession {
    version: 1;
    userId: typeof PRIMARY_OPERATOR_ID;
    username: string;
    credentialVersion: number;
    createdAt: string;
    expiresAt: string;
}

export interface AuthPrincipal {
    userId: typeof PRIMARY_OPERATOR_ID;
    username: string;
    credentialVersion: number;
    sessionFingerprint: string;
    expiresAt: string;
}

export interface LoginRateLimitConfig {
    windowMs: number;
    maxPerIp: number;
    maxPerUsername: number;
    maxPerUsernameIp: number;
}

export interface OperatorAuthConfig {
    keyPrefix: string;
    identitySecret: string;
    sessionTtlSeconds: number;
    passwordVerifyConcurrency: number;
    loginRateLimit: LoginRateLimitConfig;
}

export class AuthServiceUnavailableError extends Error {
    constructor() {
        super('Authentication service unavailable');
        this.name = 'AuthServiceUnavailableError';
    }
}

export class AuthBootstrapError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AuthBootstrapError';
    }
}

export class LoginRateLimitError extends Error {
    constructor(readonly retryAfterSeconds: number) {
        super('Too many login attempts');
        this.name = 'LoginRateLimitError';
    }
}

export type CredentialChangeResult =
    | { ok: true; user: OperatorUserDoc; session: AuthSession }
    | { ok: false; code: 'invalid_current_password' | 'invalid_username' | 'invalid_new_password' | 'no_changes' | 'session_stale' };

const DUMMY_PASSWORD_HASH = [
    'scrypt',
    '1',
    '131072',
    '8',
    '1',
    Buffer.alloc(16).toString('base64url'),
    Buffer.alloc(64).toString('base64url'),
].join('$');

function normalizePrefix(value: string): string {
    return value.replace(/[^a-zA-Z0-9:_-]/g, '-').replace(/-+/g, '-') || 'wp-monitor';
}

function isStoredAuthSession(value: unknown): value is StoredAuthSession {
    if (!value || typeof value !== 'object') return false;
    const session = value as Partial<StoredAuthSession>;
    return session.version === 1
        && session.userId === PRIMARY_OPERATOR_ID
        && typeof session.username === 'string'
        && Number.isSafeInteger(session.credentialVersion)
        && (session.credentialVersion || 0) > 0
        && typeof session.createdAt === 'string'
        && Number.isFinite(Date.parse(session.createdAt))
        && typeof session.expiresAt === 'string'
        && Number.isFinite(Date.parse(session.expiresAt));
}

export class RedisAuthSessionStore {
    private readonly keyPrefix: string;

    constructor(
        private readonly redis: RedisCommandExecutor,
        keyPrefix: string,
        private readonly identitySecret: string,
        private readonly ttlSeconds: number,
        private readonly now: () => number = Date.now,
        private readonly createToken: () => string = () => randomBytes(32).toString('base64url'),
    ) {
        this.keyPrefix = normalizePrefix(keyPrefix);
        if (identitySecret.length < 32) throw new Error('Authentication identity secret must contain at least 32 characters');
        if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 300 || ttlSeconds > 7 * 24 * 3600) {
            throw new Error('Authentication session TTL must be between 300 and 604800 seconds');
        }
    }

    fingerprint(token: string): string {
        return createHmac('sha256', this.identitySecret)
            .update('dashboard-session\0')
            .update(token)
            .digest('hex');
    }

    private key(token: string): string {
        return `${this.keyPrefix}:auth:session:${this.fingerprint(token)}`;
    }

    async create(user: OperatorUserDoc): Promise<AuthSession> {
        const token = this.createToken();
        if (!/^[a-zA-Z0-9_-]{43}$/.test(token)) throw new Error('Session token generator returned invalid output');
        const createdAt = new Date(this.now());
        const expiresAt = new Date(createdAt.getTime() + this.ttlSeconds * 1000);
        const stored: StoredAuthSession = {
            version: 1,
            userId: PRIMARY_OPERATOR_ID,
            username: user.username,
            credentialVersion: user.credentialVersion,
            createdAt: createdAt.toISOString(),
            expiresAt: expiresAt.toISOString(),
        };

        try {
            const result = await this.redis.sendCommand([
                'SET',
                this.key(token),
                JSON.stringify(stored),
                'EX',
                String(this.ttlSeconds),
                'NX',
            ]);
            if (result !== 'OK') throw new Error('Session key collision');
        } catch {
            throw new AuthServiceUnavailableError();
        }

        return {
            token,
            fingerprint: this.fingerprint(token),
            ...stored,
        };
    }

    async get(token: string): Promise<(StoredAuthSession & { fingerprint: string }) | null> {
        if (!/^[a-zA-Z0-9_-]{43}$/.test(token)) return null;
        let response: unknown;
        try {
            response = await this.redis.sendCommand(['GET', this.key(token)]);
        } catch {
            throw new AuthServiceUnavailableError();
        }
        if (response === null) return null;
        if (typeof response !== 'string') {
            await this.revoke(token);
            return null;
        }

        try {
            const stored: unknown = JSON.parse(response);
            if (!isStoredAuthSession(stored) || Date.parse(stored.expiresAt) <= this.now()) {
                await this.revoke(token);
                return null;
            }
            return { ...stored, fingerprint: this.fingerprint(token) };
        } catch (error) {
            if (error instanceof AuthServiceUnavailableError) throw error;
            await this.revoke(token);
            return null;
        }
    }

    async revoke(token: string): Promise<void> {
        if (!/^[a-zA-Z0-9_-]{43}$/.test(token)) return;
        try {
            await this.redis.sendCommand(['DEL', this.key(token)]);
        } catch {
            throw new AuthServiceUnavailableError();
        }
    }
}

export function buildLoginRateLimitRules(
    identitySecret: string,
    normalizedUsername: string,
    ip: string,
    config: LoginRateLimitConfig,
): RateLimitRule[] {
    return [
        {
            key: `auth-login:ip:${hashRateLimitIdentity(identitySecret, 'auth-login-ip', ip)}`,
            limit: config.maxPerIp,
        },
        {
            key: `auth-login:username:${hashRateLimitIdentity(identitySecret, 'auth-login-username', normalizedUsername)}`,
            limit: config.maxPerUsername,
        },
        {
            key: `auth-login:username-ip:${hashRateLimitIdentity(identitySecret, 'auth-login-username-ip', normalizedUsername, ip)}`,
            limit: config.maxPerUsernameIp,
        },
    ];
}

export class OperatorAuthService {
    private readonly sessions: RedisAuthSessionStore;
    private activePasswordVerifications = 0;

    constructor(
        private readonly repository: OperatorUserRepository,
        redis: RedisCommandExecutor,
        private readonly loginRateLimitStore: FixedWindowRateLimitStore,
        private readonly config: OperatorAuthConfig,
        private readonly now: () => number = Date.now,
    ) {
        this.sessions = new RedisAuthSessionStore(
            redis,
            config.keyPrefix,
            config.identitySecret,
            config.sessionTtlSeconds,
            now,
        );
        if (!Number.isSafeInteger(config.passwordVerifyConcurrency)
            || config.passwordVerifyConcurrency < 1
            || config.passwordVerifyConcurrency > 4) {
            throw new Error('Password verification concurrency must be between 1 and 4');
        }
    }

    private async runPasswordWork<T>(operation: () => Promise<T>, busyError: () => Error): Promise<T> {
        if (this.activePasswordVerifications >= this.config.passwordVerifyConcurrency) throw busyError();
        this.activePasswordVerifications += 1;
        try {
            return await operation();
        } finally {
            this.activePasswordVerifications -= 1;
        }
    }

    async ensureBootstrap(usernameValue: unknown, passwordValue: unknown): Promise<{ user: OperatorUserDoc; created: boolean }> {
        const existing = await this.repository.getPrimaryOperator();
        if (existing) return { user: existing, created: false };

        const username = validateUsername(usernameValue);
        if (!username) throw new AuthBootstrapError('INITIAL_ADMIN_USERNAME does not satisfy the username policy');
        if (!validatePassword(passwordValue)) {
            throw new AuthBootstrapError('INITIAL_ADMIN_PASSWORD must contain between 15 and 128 characters');
        }

        const passwordHash = await hashPassword(passwordValue);
        return this.repository.createPrimaryOperator({
            ...username,
            passwordHash,
            now: new Date(this.now()),
        });
    }

    async login(usernameValue: unknown, passwordValue: unknown, ip: string): Promise<{ user: OperatorUserDoc; session: AuthSession } | null> {
        const username = validateUsername(usernameValue);
        const normalizedUsername = username?.normalizedUsername || 'invalid-username';
        const candidatePassword = typeof passwordValue === 'string' && Buffer.byteLength(passwordValue, 'utf8') <= 512
            ? passwordValue
            : 'invalid-password-input';

        let decision;
        try {
            decision = await this.loginRateLimitStore.consume(
                buildLoginRateLimitRules(
                    this.config.identitySecret,
                    normalizedUsername,
                    ip,
                    this.config.loginRateLimit,
                ),
                this.config.loginRateLimit.windowMs,
            );
        } catch {
            throw new AuthServiceUnavailableError();
        }
        if (!decision.allowed) throw new LoginRateLimitError(decision.retryAfterSeconds);

        const user = username
            ? await this.repository.findOperatorByNormalizedUsername(username.normalizedUsername)
            : null;
        const verified = await this.runPasswordWork(
            () => verifyPassword(candidatePassword, user?.passwordHash || DUMMY_PASSWORD_HASH),
            () => new LoginRateLimitError(1),
        );
        if (!user || !verified) return null;

        const session = await this.sessions.create(user);
        try {
            await this.repository.recordPrimaryOperatorLogin(new Date(this.now()));
        } catch {
            try {
                await this.sessions.revoke(session.token);
            } catch {
                // The unusable session retains a bounded TTL if Redis also failed.
            }
            throw new AuthServiceUnavailableError();
        }
        return { user, session };
    }

    async authenticate(token: string): Promise<AuthPrincipal | null> {
        const session = await this.sessions.get(token);
        if (!session) return null;
        const user = await this.repository.getPrimaryOperator();
        if (!user
            || user._id !== session.userId
            || user.credentialVersion !== session.credentialVersion
            || user.username !== session.username) {
            await this.sessions.revoke(token);
            return null;
        }
        return {
            userId: user._id,
            username: user.username,
            credentialVersion: user.credentialVersion,
            sessionFingerprint: session.fingerprint,
            expiresAt: session.expiresAt,
        };
    }

    async logout(token: string): Promise<void> {
        await this.sessions.revoke(token);
    }

    async changeCredentials(
        principal: AuthPrincipal,
        currentPasswordValue: unknown,
        usernameValue: unknown,
        newPasswordValue: unknown,
    ): Promise<CredentialChangeResult> {
        const current = await this.repository.getPrimaryOperator();
        if (!current || current.credentialVersion !== principal.credentialVersion) {
            return { ok: false, code: 'session_stale' };
        }
        if (!await this.runPasswordWork(
            () => verifyPassword(currentPasswordValue, current.passwordHash),
            () => new AuthServiceUnavailableError(),
        )) {
            return { ok: false, code: 'invalid_current_password' };
        }

        const username = validateUsername(usernameValue);
        if (!username) return { ok: false, code: 'invalid_username' };
        const passwordProvided = newPasswordValue !== undefined && newPasswordValue !== null && newPasswordValue !== '';
        if (passwordProvided && !validatePassword(newPasswordValue)) {
            return { ok: false, code: 'invalid_new_password' };
        }

        const passwordChanged = passwordProvided
            ? !await this.runPasswordWork(
                () => verifyPassword(newPasswordValue, current.passwordHash),
                () => new AuthServiceUnavailableError(),
            )
            : false;
        const usernameChanged = username.username !== current.username;
        if (!passwordChanged && !usernameChanged) return { ok: false, code: 'no_changes' };

        const passwordHash = passwordChanged
            ? await this.runPasswordWork(
                () => hashPassword(newPasswordValue as string),
                () => new AuthServiceUnavailableError(),
            )
            : current.passwordHash;
        const proposedUser: OperatorUserDoc = {
            ...current,
            username: username.username,
            normalizedUsername: username.normalizedUsername,
            passwordHash,
            credentialVersion: current.credentialVersion + 1,
            updatedAt: new Date(this.now()),
            passwordChangedAt: passwordChanged ? new Date(this.now()) : current.passwordChangedAt,
        };
        const replacementSession = await this.sessions.create(proposedUser);

        let updated: OperatorUserDoc | null;
        try {
            updated = await this.repository.updatePrimaryOperatorCredentials({
                expectedCredentialVersion: current.credentialVersion,
                username: proposedUser.username,
                normalizedUsername: proposedUser.normalizedUsername,
                passwordHash: proposedUser.passwordHash,
                passwordChanged,
                now: proposedUser.updatedAt,
            });
        } catch {
            try {
                await this.sessions.revoke(replacementSession.token);
            } catch {
                // The pre-created session is invalid against the unchanged credential version.
            }
            throw new AuthServiceUnavailableError();
        }
        if (!updated) {
            await this.sessions.revoke(replacementSession.token);
            return { ok: false, code: 'session_stale' };
        }

        return { ok: true, user: updated, session: replacementSession };
    }
}

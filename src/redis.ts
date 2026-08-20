import { createClient } from '@redis/client';
import type { RedisCommandExecutor } from './rate-limit.js';

export interface RedisRuntimeConfig {
    configured: boolean;
    required: boolean;
    url: string | null;
    keyPrefix: string;
    connectTimeoutMs: number;
    commandTimeoutMs: number;
    pingIntervalMs: number;
}

export interface RedisHealth {
    configured: boolean;
    required: boolean;
    connected: boolean;
}

export interface RedisClientLike {
    isReady: boolean;
    isOpen: boolean;
    on(event: 'error', listener: (error: unknown) => void): unknown;
    connect(): Promise<unknown>;
    sendCommand(command: string[]): Promise<unknown>;
    close(): Promise<unknown>;
    destroy(): unknown;
}

export type RedisClientFactory = (options: Parameters<typeof createClient>[0]) => RedisClientLike;

const createRedisClient: RedisClientFactory = options => createClient(options) as unknown as RedisClientLike;

function positiveInteger(value: unknown, fallback: number, minimum: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(minimum, Math.floor(parsed));
}

export function buildRedisConfig(env: NodeJS.ProcessEnv): RedisRuntimeConfig {
    const url = env.REDIS_URL?.trim() || null;
    const required = true;
    const rawPrefix = env.REDIS_KEY_PREFIX?.trim() || 'wp-monitor';
    const keyPrefix = rawPrefix.replace(/[^a-zA-Z0-9:_-]/g, '-').replace(/-+/g, '-').slice(0, 80) || 'wp-monitor';

    return {
        configured: Boolean(url),
        required,
        url,
        keyPrefix,
        connectTimeoutMs: positiveInteger(env.REDIS_CONNECT_TIMEOUT_MS, 2_000, 250),
        commandTimeoutMs: positiveInteger(env.REDIS_COMMAND_TIMEOUT_MS, 1_500, 100),
        pingIntervalMs: positiveInteger(env.REDIS_PING_INTERVAL_MS, 30_000, 1_000),
    };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
        timer.unref?.();
        promise.then(
            value => {
                clearTimeout(timer);
                resolve(value);
            },
            error => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

export class RedisService implements RedisCommandExecutor {
    private client: RedisClientLike | null = null;
    private connectPromise: Promise<void> | null = null;
    private connected = false;

    constructor(
        private readonly config: RedisRuntimeConfig,
        private readonly clientFactory: RedisClientFactory = createRedisClient,
    ) {}

    getHealth(): RedisHealth {
        return {
            configured: this.config.configured,
            required: this.config.required,
            connected: this.connected && this.client?.isReady === true,
        };
    }

    async ping(): Promise<boolean> {
        if (!this.config.configured) return false;
        const response = await this.sendCommand(['PING']);
        return response === 'PONG';
    }

    async sendCommand(command: string[]): Promise<unknown> {
        if (!this.config.url) throw new Error('Redis is not configured');
        const client = await this.ensureConnected();

        try {
            const response = await withTimeout(
                client.sendCommand(command),
                this.config.commandTimeoutMs,
                'Redis command',
            );
            this.connected = true;
            return response;
        } catch {
            this.connected = false;
            this.destroyClient(client);
            throw new Error('Redis command failed');
        }
    }

    async disconnect(): Promise<void> {
        const client = this.client;
        this.client = null;
        this.connectPromise = null;
        this.connected = false;
        if (!client) return;

        try {
            if (client.isOpen) await client.close();
            else this.destroyClient(client);
        } catch {
            this.destroyClient(client);
        }
    }

    private async ensureConnected(): Promise<RedisClientLike> {
        if (this.client?.isReady) return this.client;

        if (!this.connectPromise) {
            const client = this.clientFactory({
                url: this.config.url!,
                disableOfflineQueue: true,
                pingInterval: this.config.pingIntervalMs,
                socket: {
                    connectTimeout: this.config.connectTimeoutMs,
                    reconnectStrategy: false,
                },
            });
            client.on('error', () => {
                this.connected = false;
            });
            this.client = client;

            const pendingConnection = withTimeout(
                client.connect().then(() => undefined),
                this.config.connectTimeoutMs,
                'Redis connection',
            ).then(() => {
                if (this.client !== client) {
                    this.destroyClient(client);
                    throw new Error('Redis connection was superseded');
                }
                this.connected = client.isReady;
            }).catch(() => {
                if (this.client === client) this.connected = false;
                this.destroyClient(client);
                throw new Error('Redis connection failed');
            }).finally(() => {
                if (this.connectPromise === pendingConnection) this.connectPromise = null;
            });
            this.connectPromise = pendingConnection;
        }

        await this.connectPromise;
        if (!this.client?.isReady) throw new Error('Redis is unavailable');
        return this.client;
    }

    private destroyClient(client: RedisClientLike): void {
        if (this.client === client) this.client = null;
        try {
            client.destroy();
        } catch {
            // The connection is already closed.
        }
    }
}

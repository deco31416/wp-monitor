import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRedisConfig, RedisService, type RedisClientLike, type RedisRuntimeConfig } from '../src/redis.js';

class FakeRedisClient implements RedisClientLike {
    isReady = false;
    isOpen = false;
    connectCalls = 0;
    closeCalls = 0;
    destroyCalls = 0;
    commands: string[][] = [];
    commandResult: unknown = 'PONG';
    commandError: Error | null = null;
    connectError: Error | null = null;
    connectGate: Promise<void> | null = null;

    on(): this {
        return this;
    }

    async connect(): Promise<void> {
        this.connectCalls += 1;
        if (this.connectError) throw this.connectError;
        if (this.connectGate) await this.connectGate;
        this.isOpen = true;
        this.isReady = true;
    }

    async sendCommand(command: string[]): Promise<unknown> {
        this.commands.push(command);
        if (this.commandError) throw this.commandError;
        return this.commandResult;
    }

    async close(): Promise<void> {
        this.closeCalls += 1;
        this.isOpen = false;
        this.isReady = false;
    }

    destroy(): void {
        this.destroyCalls += 1;
        this.isOpen = false;
        this.isReady = false;
    }
}

function configuredRedis(): RedisRuntimeConfig {
    return {
        configured: true,
        required: true,
        url: 'rediss://redis.example.test:6380',
        keyPrefix: 'unit',
        connectTimeoutMs: 100,
        commandTimeoutMs: 100,
        pingIntervalMs: 1_000,
    };
}

test('Redis is required in development and production', () => {
    assert.deepEqual(buildRedisConfig({ NODE_ENV: 'development' }), {
        configured: false,
        required: true,
        url: null,
        keyPrefix: 'wp-monitor',
        connectTimeoutMs: 2_000,
        commandTimeoutMs: 1_500,
        pingIntervalMs: 30_000,
    });

    const production = buildRedisConfig({
        NODE_ENV: 'production',
        REDIS_URL: 'rediss://redis.example.test:6380',
        REDIS_KEY_PREFIX: 'wp monitor/prod',
        REDIS_CONNECT_TIMEOUT_MS: '3000',
        REDIS_COMMAND_TIMEOUT_MS: '900',
        REDIS_PING_INTERVAL_MS: '15000',
    });
    assert.equal(production.configured, true);
    assert.equal(production.required, true);
    assert.equal(production.keyPrefix, 'wp-monitor-prod');
    assert.equal(production.connectTimeoutMs, 3_000);
    assert.equal(production.commandTimeoutMs, 900);
    assert.equal(production.pingIntervalMs, 15_000);
});

test('Redis service connects once, reports health, sends commands, and closes cleanly', async () => {
    const client = new FakeRedisClient();
    let factoryCalls = 0;
    const service = new RedisService(configuredRedis(), () => {
        factoryCalls += 1;
        return client;
    });

    assert.equal(await service.ping(), true);
    assert.equal(await service.sendCommand(['GET', 'unit:key']), 'PONG');
    assert.equal(factoryCalls, 1);
    assert.equal(client.connectCalls, 1);
    assert.deepEqual(client.commands, [['PING'], ['GET', 'unit:key']]);
    assert.deepEqual(service.getHealth(), { configured: true, required: true, connected: true });

    await service.disconnect();
    assert.equal(client.closeCalls, 1);
    assert.deepEqual(service.getHealth(), { configured: true, required: true, connected: false });
});

test('Redis service fails safely and destroys a client after a command error', async () => {
    const client = new FakeRedisClient();
    client.commandError = new Error('sensitive redis endpoint details');
    const service = new RedisService(configuredRedis(), () => client);

    await assert.rejects(service.sendCommand(['GET', 'unit:key']), /^Error: Redis command failed$/);
    assert.equal(client.destroyCalls, 1);
    assert.deepEqual(service.getHealth(), { configured: true, required: true, connected: false });
});

test('Redis service hides connection errors and destroys the failed client', async () => {
    const client = new FakeRedisClient();
    client.connectError = new Error('sensitive connection details');
    const service = new RedisService(configuredRedis(), () => client);

    await assert.rejects(service.sendCommand(['PING']), /Redis connection failed/);
    assert.equal(client.destroyCalls, 1);
    assert.equal(JSON.stringify(service.getHealth()).includes('sensitive'), false);
});

test('Redis disconnect supersedes an in-flight connection without leaking a ready client', async () => {
    let releaseConnection!: () => void;
    const client = new FakeRedisClient();
    client.connectGate = new Promise<void>(resolve => {
        releaseConnection = resolve;
    });
    const service = new RedisService({ ...configuredRedis(), connectTimeoutMs: 1_000 }, () => client);

    const pendingCommand = assert.rejects(service.sendCommand(['PING']), /Redis connection failed/);
    await new Promise<void>(resolve => setImmediate(resolve));
    await service.disconnect();
    releaseConnection();

    await pendingCommand;
    assert.ok(client.destroyCalls >= 1);
    assert.deepEqual(service.getHealth(), { configured: true, required: true, connected: false });
});

test('Redis service remains disabled when no URL is configured', async () => {
    const service = new RedisService(buildRedisConfig({ NODE_ENV: 'development' }), () => {
        throw new Error('factory must not be called');
    });

    assert.equal(await service.ping(), false);
    await assert.rejects(service.sendCommand(['PING']), /Redis is not configured/);
});

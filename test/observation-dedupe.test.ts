import test from 'node:test';
import assert from 'node:assert/strict';
import { RedisObservationCoordinator, type ObservationPersistenceResult } from '../src/observation-dedupe.js';

function coordinator(responses: unknown[]) {
    const commands: string[][] = [];
    const instance = new RedisObservationCoordinator({
        async sendCommand(command) {
            commands.push(command);
            const response = responses.shift();
            if (response instanceof Error) throw response;
            return response;
        },
    }, 'unit', 'unit-observation-identity-secret-1234567890', 60_000, () => 'reservation-token');
    return { instance, commands };
}

test('builds stable opaque fingerprints without raw identity material', () => {
    const { instance } = coordinator([]);
    const first = instance.fingerprint(['CASE-1', 'session-1', '573001112233@s.whatsapp.net']);
    const second = instance.fingerprint(['CASE-1', 'session-1', '573001112233@s.whatsapp.net']);
    assert.equal(first, second);
    assert.match(first, /^[a-f0-9]{64}$/);
    assert.equal(first.includes('573001112233'), false);
});

test('claims, persists and confirms an observation atomically in Redis', async () => {
    const { instance, commands } = coordinator([null, 'OK', 1]);
    let writes = 0;
    const result = await instance.persistOnce(instance.fingerprint(['event-1']), async () => {
        writes += 1;
        return 'inserted';
    });

    assert.equal(writes, 1);
    assert.deepEqual(result, { persistence: 'inserted', redisCoordinated: true, suppressedByRedis: false });
    assert.deepEqual(commands.map(command => command[0]), ['GET', 'SET', 'EVAL']);
    assert.equal(commands[1]?.includes('NX'), true);
});

test('suppresses a confirmed duplicate without touching MongoDB', async () => {
    const { instance } = coordinator(['stored']);
    let writes = 0;
    const result = await instance.persistOnce(instance.fingerprint(['event-2']), async () => {
        writes += 1;
        return 'inserted';
    });

    assert.equal(writes, 0);
    assert.deepEqual(result, { persistence: 'duplicate', redisCoordinated: true, suppressedByRedis: true });
});

test('falls back to the MongoDB unique constraint while another writer is pending', async () => {
    const { instance } = coordinator(['another-reservation']);
    const result = await instance.persistOnce(
        instance.fingerprint(['event-3']),
        async () => 'duplicate',
    );
    assert.deepEqual(result, { persistence: 'duplicate', redisCoordinated: true, suppressedByRedis: false });
});

test('persists through a Redis outage and releases an owned reservation after Mongo failure', async () => {
    const degraded = coordinator([new Error('redis unavailable')]);
    const degradedResult = await degraded.instance.persistOnce(
        degraded.instance.fingerprint(['event-4']),
        async () => 'inserted',
    );
    assert.deepEqual(degradedResult, { persistence: 'inserted', redisCoordinated: false, suppressedByRedis: false });

    const failed = coordinator([null, 'OK', 1]);
    const persistence: ObservationPersistenceResult = 'failed';
    const failedResult = await failed.instance.persistOnce(
        failed.instance.fingerprint(['event-5']),
        async () => persistence,
    );
    assert.equal(failedResult.persistence, 'failed');
    assert.deepEqual(failed.commands.map(command => command[0]), ['GET', 'SET', 'EVAL']);
    assert.equal(failed.commands[2]?.join(' ').includes("DEL"), true);
});

test('reports degraded coordination when a reservation expires before confirmation', async () => {
    const { instance } = coordinator([null, 'OK', 0]);
    const result = await instance.persistOnce(
        instance.fingerprint(['event-6']),
        async () => 'inserted',
    );
    assert.deepEqual(result, { persistence: 'inserted', redisCoordinated: false, suppressedByRedis: false });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { CallTransportStateStore, type CallTransportScope } from '../src/call-transport-state.js';
import type { CallTransportObservation } from '../src/call-transport-observer.js';
import type { RedisCommandExecutor } from '../src/rate-limit.js';

const SECRET = 'unit-call-transport-identity-secret-1234567890';
const BASE_SCOPE: CallTransportScope = {
    callId: 'CALL-STATE-001',
    targetJid: '573001112233@s.whatsapp.net',
    caseId: 'CASE-AUTHORIZED',
    trackingSessionId: 'SESSION-001',
};

function observation(overrides: Partial<CallTransportObservation> = {}): CallTransportObservation {
    return {
        callId: BASE_SCOPE.callId,
        observedAt: new Date('2026-09-07T20:00:00.000Z'),
        action: 'transport',
        peerNegotiationObserved: true,
        relayNegotiationObserved: false,
        keepaliveObserved: false,
        candidateRound: 2,
        endpoints: [{
            ip: '203.0.113.10',
            port: 3478,
            addressFamily: 4,
            role: 'relay',
            source: 'baileys_transport',
            rttMs: 42,
        }],
        limitations: ['peer_candidate_payload_not_decoded'],
        ...overrides,
    };
}

class MemoryRedis implements RedisCommandExecutor {
    readonly commands: string[][] = [];
    private readonly lists = new Map<string, string[]>();
    private readonly sets = new Map<string, Set<string>>();
    private readonly expiresAt = new Map<string, number>();

    constructor(private clock = 0) {}

    advance(milliseconds: number): void {
        this.clock += milliseconds;
    }

    async sendCommand(command: string[]): Promise<unknown> {
        this.commands.push(command);
        this.purgeExpired();
        if (command[0] === 'LRANGE') return [...(this.lists.get(command[1]!) ?? [])];
        if (command[0] === 'DEL') {
            let removed = 0;
            for (const key of command.slice(1)) {
                if (this.lists.delete(key) || this.sets.delete(key)) removed += 1;
                this.expiresAt.delete(key);
            }
            return removed;
        }
        if (command[0] !== 'EVAL') throw new Error('Unsupported command');
        if (command[1]!.includes("redis.call('SADD'")) return this.write(command);
        if (command[1]!.includes("redis.call('LRANGE'")) {
            const entries = [...(this.lists.get(command[3]!) ?? [])];
            this.lists.delete(command[3]!);
            this.sets.delete(command[4]!);
            this.expiresAt.delete(command[3]!);
            this.expiresAt.delete(command[4]!);
            return entries;
        }
        throw new Error('Unsupported script');
    }

    private write(command: string[]): [number, number] {
        const eventsKey = command[3]!;
        const dedupeKey = command[4]!;
        const payload = command[5]!;
        const fingerprint = command[6]!;
        const ttlMs = Number(command[7]);
        const maximum = Number(command[8]);
        const list = this.lists.get(eventsKey) ?? [];
        const dedupe = this.sets.get(dedupeKey) ?? new Set<string>();
        this.lists.set(eventsKey, list);
        this.sets.set(dedupeKey, dedupe);
        this.expiresAt.set(eventsKey, this.clock + ttlMs);
        this.expiresAt.set(dedupeKey, this.clock + ttlMs);
        if (dedupe.has(fingerprint)) return [0, list.length];
        if (list.length >= maximum) return [-1, list.length];
        dedupe.add(fingerprint);
        list.push(payload);
        return [1, list.length];
    }

    private purgeExpired(): void {
        for (const [key, expiry] of this.expiresAt) {
            if (expiry > this.clock) continue;
            this.expiresAt.delete(key);
            this.lists.delete(key);
            this.sets.delete(key);
        }
    }
}

test('stores only sanitized evidence behind an opaque call scope', async () => {
    const redis = new MemoryRedis();
    const store = new CallTransportStateStore(redis, 'unit', SECRET, 60_000, 4);
    const input = observation();
    (input.endpoints[0] as any).token = 'must-not-be-stored';
    const result = await store.record(BASE_SCOPE, input);

    assert.deepEqual(result, { status: 'stored', observationCount: 1 });
    const command = redis.commands[0]!;
    assert.match(command[3]!, /^unit:call-transport:[a-f0-9]{64}:events$/);
    assert.match(command[4]!, /^unit:call-transport:[a-f0-9]{64}:dedupe$/);
    const serializedCommand = command.join('\n');
    for (const rawIdentity of Object.values(BASE_SCOPE)) {
        assert.equal(serializedCommand.includes(rawIdentity), false);
    }
    assert.equal(command[5]!.includes('callId'), false);
    assert.equal(command[5]!.includes('must-not-be-stored'), false);
});

test('deduplicates concurrent reconnect events atomically and aggregates temporal evidence', async () => {
    const redis = new MemoryRedis();
    const store = new CallTransportStateStore(redis, 'unit', SECRET, 60_000, 8);
    const duplicate = observation();
    const distinct = observation({
        observedAt: new Date('2026-09-07T20:00:01.000Z'),
        candidateRound: 3,
        peerNegotiationObserved: false,
        relayNegotiationObserved: true,
    });
    const results = await Promise.all([
        store.record(BASE_SCOPE, duplicate),
        store.record(BASE_SCOPE, duplicate),
        store.record(BASE_SCOPE, distinct),
    ]);

    assert.deepEqual(results.map(result => result.status).sort(), ['duplicate', 'stored', 'stored']);
    const snapshot = await store.read(BASE_SCOPE);
    assert.equal(snapshot.observationCount, 2);
    assert.deepEqual(snapshot.evidence?.candidateRounds, [2, 3]);
    assert.equal(snapshot.evidence?.peerNegotiationObserved, true);
    assert.equal(snapshot.evidence?.relayNegotiationObserved, true);
    assert.equal(snapshot.evidence?.firstObservedAt.toISOString(), '2026-09-07T20:00:00.000Z');
    assert.equal(snapshot.evidence?.lastObservedAt.toISOString(), '2026-09-07T20:00:01.000Z');
});

test('isolates call, contact, case and tracking-session scopes', async () => {
    const redis = new MemoryRedis();
    const store = new CallTransportStateStore(redis, 'unit', SECRET);
    const alternate = { ...BASE_SCOPE, caseId: 'CASE-OTHER' };

    await store.record(BASE_SCOPE, observation());
    assert.equal((await store.read(alternate)).observationCount, 0);
    assert.equal((await store.read(BASE_SCOPE)).observationCount, 1);
    assert.notEqual(redis.commands[0]?.[3], redis.commands[1]?.[1]);
});

test('expires idle state, enforces the hard observation cap and atomically cleans completed calls', async () => {
    const redis = new MemoryRedis();
    const store = new CallTransportStateStore(redis, 'unit', SECRET, 10_000, 2);
    await store.record(BASE_SCOPE, observation());
    await store.record(BASE_SCOPE, observation({ observedAt: new Date('2026-09-07T20:00:01.000Z') }));
    assert.deepEqual(await store.record(
        BASE_SCOPE,
        observation({ observedAt: new Date('2026-09-07T20:00:02.000Z') }),
    ), { status: 'limit_reached', observationCount: 2 });

    const completed = await store.take(BASE_SCOPE);
    assert.equal(completed.observationCount, 2);
    assert.equal((await store.read(BASE_SCOPE)).observationCount, 0);

    await store.record(BASE_SCOPE, observation());
    redis.advance(10_001);
    assert.equal((await store.read(BASE_SCOPE)).observationCount, 0);
});

test('fails closed without process-local fallback when Redis is degraded', async () => {
    const store = new CallTransportStateStore({
        async sendCommand() {
            throw new Error('redis unavailable');
        },
    }, 'unit', SECRET);

    assert.deepEqual(await store.record(BASE_SCOPE, observation()), {
        status: 'degraded',
        observationCount: 0,
    });
    assert.deepEqual(await store.read(BASE_SCOPE), {
        evidence: null,
        observationCount: 0,
        invalidEntries: 0,
        degraded: true,
    });
    assert.equal(await store.clear(BASE_SCOPE), false);
});

test('rejects cross-call writes and skips corrupted Redis entries', async () => {
    const redis = new MemoryRedis();
    const store = new CallTransportStateStore(redis, 'unit', SECRET);
    await assert.rejects(
        () => store.record(BASE_SCOPE, observation({ callId: 'CALL-OTHER-002' })),
        /does not match/,
    );

    await store.record(BASE_SCOPE, observation());
    const eventsKey = redis.commands[0]![3]!;
    // Injected through the test double to represent an externally corrupted cache entry.
    (redis as any).lists.get(eventsKey).push('{malformed');
    const snapshot = await store.read(BASE_SCOPE);
    assert.equal(snapshot.observationCount, 1);
    assert.equal(snapshot.invalidEntries, 1);
    assert.ok(snapshot.evidence?.limitations.includes('stored_observation_invalid'));
});

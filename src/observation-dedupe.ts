import { createHmac, randomBytes } from 'node:crypto';
import type { RedisCommandExecutor } from './rate-limit.js';

export type ObservationPersistenceResult = 'inserted' | 'duplicate' | 'failed';

export interface ObservationCoordinationResult {
    persistence: ObservationPersistenceResult;
    redisCoordinated: boolean;
    suppressedByRedis: boolean;
}

const CONFIRM_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
    redis.call('SET', KEYS[1], 'stored', 'PX', ARGV[2])
    return 1
end
return 0
`;

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
end
return 0
`;

function normalizePrefix(value: string): string {
    return value.replace(/[^a-zA-Z0-9:_-]/g, '-').replace(/-+/g, '-').slice(0, 80) || 'wp-monitor';
}

export class RedisObservationCoordinator {
    private readonly keyPrefix: string;

    constructor(
        private readonly redis: RedisCommandExecutor,
        keyPrefix: string,
        private readonly identitySecret: string,
        private readonly ttlMs: number = 10 * 60_000,
        private readonly createToken: () => string = () => randomBytes(18).toString('base64url'),
    ) {
        this.keyPrefix = normalizePrefix(keyPrefix);
        if (identitySecret.length < 32) throw new Error('Observation identity secret must contain at least 32 characters');
        if (!Number.isSafeInteger(ttlMs) || ttlMs < 10_000 || ttlMs > 24 * 60 * 60_000) {
            throw new Error('Observation dedupe TTL must be between 10000 and 86400000 milliseconds');
        }
    }

    fingerprint(parts: readonly string[]): string {
        if (parts.length === 0 || parts.some(part => !part.trim())) {
            throw new Error('Observation identity parts must be non-empty');
        }
        const hash = createHmac('sha256', this.identitySecret);
        hash.update('observation-event\0');
        for (const part of parts) hash.update(part).update('\0');
        return hash.digest('hex');
    }

    async persistOnce(
        idempotencyKey: string,
        persist: () => Promise<ObservationPersistenceResult>,
    ): Promise<ObservationCoordinationResult> {
        if (!/^[a-f0-9]{64}$/.test(idempotencyKey)) throw new Error('Invalid observation idempotency key');
        const redisKey = `${this.keyPrefix}:observation:dedupe:${idempotencyKey}`;
        const token = this.createToken();
        let ownsReservation = false;
        let redisCoordinated = true;

        try {
            const current = await this.redis.sendCommand(['GET', redisKey]);
            if (current === 'stored') {
                return { persistence: 'duplicate', redisCoordinated: true, suppressedByRedis: true };
            }
            if (current !== null && typeof current !== 'string') throw new Error('Invalid Redis dedupe state');
            if (current === null) {
                const claimed = await this.redis.sendCommand([
                    'SET', redisKey, token, 'PX', String(this.ttlMs), 'NX',
                ]);
                if (claimed !== null && claimed !== 'OK') throw new Error('Invalid Redis claim response');
                ownsReservation = claimed === 'OK';
            }
        } catch {
            redisCoordinated = false;
        }

        const persistence = await persist();
        if (!redisCoordinated || !ownsReservation) {
            return { persistence, redisCoordinated, suppressedByRedis: false };
        }

        try {
            if (persistence === 'failed') {
                await this.redis.sendCommand([
                    'EVAL', RELEASE_SCRIPT, '1', redisKey, token,
                ]);
            } else {
                const confirmed = await this.redis.sendCommand([
                    'EVAL', CONFIRM_SCRIPT, '1', redisKey, token, String(this.ttlMs),
                ]);
                if (Number(confirmed) !== 1) throw new Error('Redis reservation confirmation failed');
            }
        } catch {
            redisCoordinated = false;
        }

        return { persistence, redisCoordinated, suppressedByRedis: false };
    }
}

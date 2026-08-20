import { createHmac } from 'crypto';

export interface RateLimitRule {
    key: string;
    limit: number;
}

export interface RateLimitDecision {
    allowed: boolean;
    retryAfterSeconds: number;
    counts: number[];
}

export interface FixedWindowRateLimitStore {
    consume(rules: RateLimitRule[], windowMs: number): Promise<RateLimitDecision>;
}

export interface RedisCommandExecutor {
    sendCommand(command: string[]): Promise<unknown>;
}

interface MemoryBucket {
    count: number;
    resetAt: number;
}

const FIXED_WINDOW_SCRIPT = `
local windowMs = tonumber(ARGV[1])
local blocked = 0
local retryMs = 0
local counts = {}

for index, key in ipairs(KEYS) do
    local current = redis.call('INCR', key)
    if current == 1 then
        redis.call('PEXPIRE', key, windowMs)
    end

    local ttl = redis.call('PTTL', key)
    if ttl < 0 then
        redis.call('PEXPIRE', key, windowMs)
        ttl = windowMs
    end

    local limit = tonumber(ARGV[index + 1])
    if current > limit then
        blocked = 1
        if ttl > retryMs then
            retryMs = ttl
        end
    end

    table.insert(counts, current)
end

table.insert(counts, 1, retryMs)
table.insert(counts, 1, blocked)
return counts
`;

export function hashRateLimitIdentity(secret: string, scope: string, ...parts: string[]): string {
    const hash = createHmac('sha256', secret);
    hash.update(scope);
    for (const part of parts) {
        hash.update('\0');
        hash.update(part);
    }
    return hash.digest('hex');
}

function normalizeRules(rules: RateLimitRule[]): RateLimitRule[] {
    if (rules.length === 0) throw new Error('At least one rate-limit rule is required');
    return rules.map(rule => {
        const key = rule.key.trim();
        if (!key || !/^[a-zA-Z0-9:_-]+$/.test(key)) {
            throw new Error('Rate-limit keys must be non-empty opaque identifiers');
        }
        if (!Number.isSafeInteger(rule.limit) || rule.limit < 1) {
            throw new Error('Rate-limit values must be positive integers');
        }
        return { key, limit: rule.limit };
    });
}

export class MemoryFixedWindowRateLimitStore implements FixedWindowRateLimitStore {
    private readonly buckets = new Map<string, MemoryBucket>();

    constructor(private readonly now: () => number = Date.now) {}

    async consume(rules: RateLimitRule[], windowMs: number): Promise<RateLimitDecision> {
        const normalizedRules = normalizeRules(rules);
        if (!Number.isSafeInteger(windowMs) || windowMs < 1) {
            throw new Error('Rate-limit window must be a positive integer');
        }

        const now = this.now();
        if (this.buckets.size > 10_000) {
            for (const [key, bucket] of this.buckets) {
                if (bucket.resetAt <= now) this.buckets.delete(key);
            }
        }

        let retryAfterSeconds = 0;
        const counts = normalizedRules.map(rule => {
            const current = this.buckets.get(rule.key);
            const bucket = !current || current.resetAt <= now
                ? { count: 1, resetAt: now + windowMs }
                : { ...current, count: current.count + 1 };
            this.buckets.set(rule.key, bucket);

            if (bucket.count > rule.limit) {
                retryAfterSeconds = Math.max(
                    retryAfterSeconds,
                    Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
                );
            }
            return bucket.count;
        });

        return {
            allowed: retryAfterSeconds === 0,
            retryAfterSeconds,
            counts,
        };
    }
}

export class RedisFixedWindowRateLimitStore implements FixedWindowRateLimitStore {
    private readonly keyPrefix: string;

    constructor(
        private readonly redis: RedisCommandExecutor,
        keyPrefix = 'wp-monitor',
    ) {
        this.keyPrefix = keyPrefix.replace(/[^a-zA-Z0-9:_-]/g, '-').replace(/-+/g, '-') || 'wp-monitor';
    }

    async consume(rules: RateLimitRule[], windowMs: number): Promise<RateLimitDecision> {
        const normalizedRules = normalizeRules(rules);
        if (!Number.isSafeInteger(windowMs) || windowMs < 1) {
            throw new Error('Rate-limit window must be a positive integer');
        }

        const keys = normalizedRules.map(rule => `${this.keyPrefix}:rate-limit:${rule.key}`);
        const response = await this.redis.sendCommand([
            'EVAL',
            FIXED_WINDOW_SCRIPT,
            String(keys.length),
            ...keys,
            String(windowMs),
            ...normalizedRules.map(rule => String(rule.limit)),
        ]);

        return parseRedisRateLimitResponse(response, normalizedRules.length);
    }
}

export function parseRedisRateLimitResponse(response: unknown, expectedCounts: number): RateLimitDecision {
    if (!Array.isArray(response) || response.length !== expectedCounts + 2) {
        throw new Error('Redis returned an invalid rate-limit response');
    }

    const values = response.map(value => Number(value));
    if (values.some(value => !Number.isSafeInteger(value) || value < 0)) {
        throw new Error('Redis returned invalid rate-limit counters');
    }

    const [blocked, retryMs, ...counts] = values;
    if (blocked === undefined || retryMs === undefined) {
        throw new Error('Redis returned an incomplete rate-limit response');
    }
    if (blocked !== 0 && blocked !== 1) {
        throw new Error('Redis returned an invalid rate-limit decision');
    }

    return {
        allowed: blocked === 0,
        retryAfterSeconds: blocked === 1 ? Math.max(1, Math.ceil(retryMs / 1000)) : 0,
        counts,
    };
}

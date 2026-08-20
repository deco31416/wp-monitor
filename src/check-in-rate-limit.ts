import {
    hashRateLimitIdentity,
    type FixedWindowRateLimitStore,
    type RateLimitRule,
} from './rate-limit.js';

export interface PublicCheckInSubmitRateLimitOptions {
    store: FixedWindowRateLimitStore;
    identitySecret: string;
    windowMs: number;
    maxPerIp: number;
    maxPerTokenIp: number;
}

export interface ClientAddressRequestLike {
    ip?: string | null | undefined;
    socket?: {
        remoteAddress?: string | null | undefined;
    } | undefined;
}

export interface RateLimitResponseLike {
    setHeader(name: string, value: string): unknown;
    status(code: number): {
        json(body: { error: string }): unknown;
    };
}

export type PublicCheckInSubmitRateLimitGuard = (
    request: ClientAddressRequestLike,
    response: RateLimitResponseLike,
    token: string,
) => Promise<boolean>;

export function getClientIp(request: ClientAddressRequestLike): string {
    return String(request.ip || request.socket?.remoteAddress || '')
        .trim()
        .replace(/^::ffff:/, '') || 'unknown';
}

export function buildPublicCheckInSubmitRateLimitRules(
    identitySecret: string,
    token: string,
    ip: string,
    maxPerIp: number,
    maxPerTokenIp: number,
): RateLimitRule[] {
    return [
        {
            key: `checkin-submit:ip:${hashRateLimitIdentity(identitySecret, 'checkin-submit-ip', ip)}`,
            limit: maxPerIp,
        },
        {
            key: `checkin-submit:token-ip:${hashRateLimitIdentity(identitySecret, 'checkin-submit-token-ip', token, ip)}`,
            limit: maxPerTokenIp,
        },
    ];
}

export function createPublicCheckInSubmitRateLimitGuard(
    options: PublicCheckInSubmitRateLimitOptions,
): PublicCheckInSubmitRateLimitGuard {
    const identitySecret = options.identitySecret.trim();
    if (!identitySecret) throw new Error('Rate-limit identity secret is required');

    return async (request, response, token) => {
        const ip = getClientIp(request);

        try {
            const decision = await options.store.consume(
                buildPublicCheckInSubmitRateLimitRules(
                    identitySecret,
                    token,
                    ip,
                    options.maxPerIp,
                    options.maxPerTokenIp,
                ),
                options.windowMs,
            );

            if (decision.allowed) return true;
            response.setHeader('Retry-After', String(decision.retryAfterSeconds));
            response.status(429).json({ error: 'Too many check-in submit attempts. Try again later.' });
            return false;
        } catch {
            response.setHeader('Retry-After', '5');
            response.status(503).json({ error: 'Rate limit service unavailable. Try again later.' });
            return false;
        }
    };
}

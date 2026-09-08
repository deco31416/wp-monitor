import { createHmac } from 'node:crypto';
import type { RedisCommandExecutor } from './rate-limit.js';

export type PresenceSubscriptionReason = 'tracking_start' | 'connection_restore';

export interface PresenceSubscriptionTarget {
    jid: string;
    trackingSessionId: string;
}

export interface PresenceSubscriptionSocket {
    presenceSubscribe(jid: string): Promise<void>;
}

export interface PresenceSubscriptionResult {
    subscribed: boolean;
    attempts: number;
    reason: PresenceSubscriptionReason;
    redisCoordinated: boolean;
}

function normalizePrefix(value: string): string {
    return value.replace(/[^a-zA-Z0-9:_-]/g, '-').replace(/-+/g, '-').slice(0, 80) || 'wp-monitor';
}

function assertTarget(target: PresenceSubscriptionTarget): void {
    if (!/^\d{6,20}@s\.whatsapp\.net$/.test(target.jid)) {
        throw new TypeError('Presence subscriptions require a canonical individual WhatsApp JID');
    }
    if (!target.trackingSessionId.trim()) {
        throw new TypeError('trackingSessionId is required');
    }
}

/**
 * Performs bounded Baileys presence subscriptions and records only an opaque,
 * expiring confirmation in Redis. MongoDB remains the source of authorized
 * active sessions; this marker is operational state, never contact activity.
 */
export class PresenceSubscriptionCoordinator {
    private readonly keyPrefix: string;

    constructor(
        private readonly redis: RedisCommandExecutor,
        keyPrefix: string,
        private readonly identitySecret: string,
        private readonly stateTtlMs: number = 30 * 60_000,
        private readonly retryDelaysMs: readonly number[] = [0, 250, 750],
        private readonly sleep: (delayMs: number) => Promise<void> = delayMs => (
            new Promise(resolve => setTimeout(resolve, delayMs))
        ),
    ) {
        this.keyPrefix = normalizePrefix(keyPrefix);
        if (identitySecret.length < 32) throw new Error('Presence identity secret must contain at least 32 characters');
        if (!Number.isSafeInteger(stateTtlMs) || stateTtlMs < 60_000 || stateTtlMs > 24 * 60 * 60_000) {
            throw new Error('Presence subscription TTL must be between 60000 and 86400000 milliseconds');
        }
        if (retryDelaysMs.length === 0 || retryDelaysMs.length > 5
            || retryDelaysMs.some(delay => !Number.isSafeInteger(delay) || delay < 0 || delay > 30_000)) {
            throw new Error('Presence retry delays must contain between one and five bounded delays');
        }
    }

    async subscribe(
        target: PresenceSubscriptionTarget,
        socket: PresenceSubscriptionSocket,
        reason: PresenceSubscriptionReason,
    ): Promise<PresenceSubscriptionResult> {
        assertTarget(target);
        let attempts = 0;

        for (const delayMs of this.retryDelaysMs) {
            if (delayMs > 0) await this.sleep(delayMs);
            attempts += 1;
            try {
                await socket.presenceSubscribe(target.jid);
                const redisCoordinated = await this.recordConfirmation(target, reason);
                return { subscribed: true, attempts, reason, redisCoordinated };
            } catch {
                // A later bounded attempt may recover a transient Baileys error.
            }
        }

        return { subscribed: false, attempts, reason, redisCoordinated: false };
    }

    private opaqueTarget(target: PresenceSubscriptionTarget): string {
        return createHmac('sha256', this.identitySecret)
            .update('presence-subscription\0')
            .update(target.trackingSessionId)
            .update('\0')
            .update(target.jid)
            .digest('hex');
    }

    private async recordConfirmation(
        target: PresenceSubscriptionTarget,
        reason: PresenceSubscriptionReason,
    ): Promise<boolean> {
        const key = `${this.keyPrefix}:presence:subscription:${this.opaqueTarget(target)}`;
        try {
            const response = await this.redis.sendCommand([
                'SET', key, `subscribed:v1:${reason}`, 'PX', String(this.stateTtlMs),
            ]);
            return response === 'OK';
        } catch {
            return false;
        }
    }
}

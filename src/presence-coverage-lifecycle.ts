import type {
    PresenceCoverageCloseReason,
    PresenceCoverageOpenReason,
} from './presence-coverage.js';

export interface PresenceCoverageOpenInput {
    caseId: string;
    trackingSessionId: string;
    jid: string;
    openReason: PresenceCoverageOpenReason;
    openedAt?: Date;
}

export interface PresenceCoveragePersistence {
    open(input: PresenceCoverageOpenInput): Promise<boolean>;
    confirm(trackingSessionId: string, confirmedAt?: Date): Promise<boolean>;
    close(
        trackingSessionId: string,
        reason: PresenceCoverageCloseReason,
        closedAt?: Date,
    ): Promise<boolean>;
}

/**
 * Serializes coverage writes per tracking session while allowing independent
 * contacts to progress concurrently. It also owns the in-process list of
 * sessions whose subscription has a durable open window.
 */
export class PresenceCoverageLifecycle {
    private readonly activeSessions = new Set<string>();
    private readonly operationTails = new Map<string, Promise<void>>();

    constructor(private readonly persistence: PresenceCoveragePersistence) {}

    isActive(trackingSessionId: string): boolean {
        return this.activeSessions.has(trackingSessionId);
    }

    async open(input: PresenceCoverageOpenInput): Promise<boolean> {
        return this.serialize(
            input.trackingSessionId,
            async () => {
                const opened = await this.persistence.open(input);
                if (opened) this.activeSessions.add(input.trackingSessionId);
                return opened;
            },
        );
    }

    async confirm(trackingSessionId: string, confirmedAt: Date = new Date()): Promise<boolean> {
        if (!this.activeSessions.has(trackingSessionId)) return false;
        return this.serialize(
            trackingSessionId,
            async () => this.activeSessions.has(trackingSessionId)
                ? this.persistence.confirm(trackingSessionId, confirmedAt)
                : false,
        );
    }

    async close(
        trackingSessionId: string,
        reason: PresenceCoverageCloseReason,
        closedAt: Date = new Date(),
    ): Promise<boolean> {
        return this.serialize(
            trackingSessionId,
            async () => {
                const wasActive = this.activeSessions.delete(trackingSessionId);
                const closed = await this.persistence.close(trackingSessionId, reason, closedAt);
                if (!closed && wasActive) this.activeSessions.add(trackingSessionId);
                return closed;
            },
        );
    }

    private serialize<T>(trackingSessionId: string, operation: () => Promise<T>): Promise<T> {
        const previous = this.operationTails.get(trackingSessionId) ?? Promise.resolve();
        const result = previous.then(operation);
        const tail = result.then(() => undefined, () => undefined);
        this.operationTails.set(trackingSessionId, tail);
        return result.finally(() => {
            if (this.operationTails.get(trackingSessionId) === tail) {
                this.operationTails.delete(trackingSessionId);
            }
        });
    }
}

import { createHash } from 'node:crypto';

export type MessageReceiptStatus = 2 | 3 | 4 | 5;

export interface MessageReceiptTransition {
    jid: string;
    messageIdHash: string;
    status: MessageReceiptStatus;
    state: 'accepted' | 'delivered' | 'read' | 'played';
    label: string;
    observedAt: number;
    receiptAt: number;
    latencyMs: number | null;
}

interface OutgoingObservation {
    jid: string;
    observedAt: number;
    lastStatus: number;
}

interface PendingReceipt {
    jid: string;
    status: MessageReceiptStatus;
    receiptAt: number;
}

const DEFAULT_TTL_MS = 30 * 60_000;
const DEFAULT_MAX_ENTRIES = 10_000;

function cleanId(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const id = value.trim();
    return id || null;
}

function receiptKey(jid: string, messageId: string): string {
    return `${jid}\u0000${messageId}`;
}

export function normalizeReceiptStatus(value: unknown): MessageReceiptStatus | null {
    const status = Number(value);
    return status === 2 || status === 3 || status === 4 || status === 5 ? status : null;
}

export function messageReceiptState(status: MessageReceiptStatus): MessageReceiptTransition['state'] {
    if (status === 2) return 'accepted';
    if (status === 3) return 'delivered';
    if (status === 4) return 'read';
    return 'played';
}

export function messageReceiptLabel(status: MessageReceiptStatus): string {
    if (status === 2) return 'Mensaje aceptado por WhatsApp';
    if (status === 3) return 'Mensaje entregado';
    if (status === 4) return 'Mensaje leído';
    return 'Mensaje reproducido';
}

export function fingerprintMessageId(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

export class MessageReceiptRegistry {
    private readonly outgoing = new Map<string, OutgoingObservation>();
    private readonly pending = new Map<string, PendingReceipt>();

    constructor(
        private readonly ttlMs = DEFAULT_TTL_MS,
        private readonly maxEntries = DEFAULT_MAX_ENTRIES,
    ) {}

    clearContact(jid: string): void {
        if (!jid) return;
        for (const [key, observation] of this.outgoing) {
            if (observation.jid === jid) this.outgoing.delete(key);
        }
        for (const [key, receipt] of this.pending) {
            if (receipt.jid === jid) this.pending.delete(key);
        }
    }

    registerOutgoing(
        messageIdValue: unknown,
        jid: string,
        observedAt: number = Date.now(),
    ): MessageReceiptTransition | null {
        const messageId = cleanId(messageIdValue);
        if (!messageId || !jid) return null;
        this.prune(observedAt);
        const key = receiptKey(jid, messageId);

        const existing = this.outgoing.get(key);
        this.outgoing.set(key, {
            jid,
            observedAt: existing?.observedAt ?? observedAt,
            lastStatus: existing?.lastStatus ?? 0,
        });

        const pending = this.pending.get(key);
        if (!pending) return null;
        this.pending.delete(key);
        return this.recordStatus(messageId, jid, pending.status, pending.receiptAt);
    }

    recordStatus(
        messageIdValue: unknown,
        jid: string,
        statusValue: unknown,
        receiptAt: number = Date.now(),
    ): MessageReceiptTransition | null {
        const messageId = cleanId(messageIdValue);
        const status = normalizeReceiptStatus(statusValue);
        if (!messageId || !jid || !status) return null;
        this.prune(receiptAt);
        const key = receiptKey(jid, messageId);

        const observation = this.outgoing.get(key);
        if (!observation) {
            const previous = this.pending.get(key);
            if (!previous || status > previous.status) {
                this.pending.set(key, { jid, status, receiptAt });
                this.trim();
            }
            return null;
        }
        if (status <= observation.lastStatus) return null;

        observation.lastStatus = status;
        const latency = receiptAt >= observation.observedAt
            ? Math.round(receiptAt - observation.observedAt)
            : null;
        return {
            jid,
            messageIdHash: fingerprintMessageId(messageId),
            status,
            state: messageReceiptState(status),
            label: messageReceiptLabel(status),
            observedAt: observation.observedAt,
            receiptAt,
            latencyMs: latency,
        };
    }

    private prune(now: number): void {
        for (const [messageId, observation] of this.outgoing) {
            if (now - observation.observedAt > this.ttlMs) this.outgoing.delete(messageId);
        }
        for (const [messageId, receipt] of this.pending) {
            if (now - receipt.receiptAt > this.ttlMs) this.pending.delete(messageId);
        }
        this.trim();
    }

    private trim(): void {
        while (this.outgoing.size > this.maxEntries) {
            const oldest = this.outgoing.keys().next().value;
            if (typeof oldest !== 'string') break;
            this.outgoing.delete(oldest);
        }
        while (this.pending.size > this.maxEntries) {
            const oldest = this.pending.keys().next().value;
            if (typeof oldest !== 'string') break;
            this.pending.delete(oldest);
        }
    }
}

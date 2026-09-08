import type { BaileysEventMap } from 'baileys';

export type BaileysCallEvent = BaileysEventMap['call'][number];

export interface ObservedBaileysCall {
    jid: string;
    call: BaileysCallEvent;
}

export interface BaileysCallObserverOptions {
    resolveTrackedJid: (value: unknown) => string | null;
    onCall: (event: ObservedBaileysCall) => void | Promise<void>;
}

/**
 * Attributes Baileys call events to one explicitly active contact before any
 * commercial publication or capture lifecycle action is allowed to run.
 */
export class BaileysCallObserver {
    constructor(private readonly options: BaileysCallObserverOptions) {}

    async handleCalls(calls: BaileysEventMap['call']): Promise<void> {
        for (const call of calls) {
            // Group calls cannot be attributed to one monitored contact.
            if (call.isGroup) continue;
            const jid = this.options.resolveTrackedJid(call.from)
                ?? this.options.resolveTrackedJid(call.chatId)
                ?? this.options.resolveTrackedJid(call.callerPn);
            if (!jid) continue;
            await this.options.onCall({ jid, call });
        }
    }
}

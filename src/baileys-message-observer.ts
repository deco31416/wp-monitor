import type { BaileysEventMap } from 'baileys';
import {
    MessageReceiptRegistry,
    fingerprintMessageId,
    type MessageReceiptTransition,
} from './message-receipts.js';
import { isSyntheticProbeId, isSyntheticProbeMessage } from './probe-messages.js';

export type MessageDirection = 'incoming' | 'outgoing';

export interface ObservedMessageActivity {
    jid: string;
    messageIdHash: string | null;
    direction: MessageDirection;
    messageType: string;
    syntheticProbe: false;
    upsertType: 'notify';
    timestamp: string;
    timestampMs: number;
    label: string;
}

export interface BaileysMessageObserverOptions {
    resolveTrackedJid: (value: unknown) => string | null;
    onMessage: (activity: ObservedMessageActivity) => boolean | void | Promise<boolean | void>;
    onReceipt: (transition: MessageReceiptTransition) => void | Promise<void>;
    now?: () => number;
    registry?: MessageReceiptRegistry;
}

export function getObservedMessageType(message: BaileysEventMap['messages.upsert']['messages'][number]): string {
    const payload = message?.message;
    if (!payload) return 'unknown';
    if (payload.conversation || payload.extendedTextMessage) return 'text';
    if (payload.imageMessage) return 'image';
    if (payload.videoMessage) return 'video';
    if (payload.audioMessage) return 'audio';
    if (payload.documentMessage) return 'document';
    if (payload.stickerMessage) return 'sticker';
    if (payload.locationMessage || payload.liveLocationMessage) return 'location';
    if (payload.contactMessage || payload.contactsArrayMessage) return 'contact';
    if (payload.reactionMessage) return 'reaction';
    if (payload.call) return 'call';
    return Object.keys(payload)[0] || 'unknown';
}

export function formatObservedMessageLabel(direction: MessageDirection, messageType: string): string {
    const typeLabel = (() => {
        switch (messageType) {
            case 'image': return 'imagen';
            case 'video': return 'video';
            case 'audio': return 'audio';
            case 'document': return 'documento';
            case 'sticker': return 'sticker';
            case 'location': return 'ubicación';
            case 'contact': return 'contacto';
            case 'text': return '';
            default: return '';
        }
    })();
    const suffix = typeLabel ? ` · ${typeLabel}` : '';
    return direction === 'outgoing'
        ? `Mensaje enviado${suffix}`
        : `Mensaje recibido${suffix}`;
}

export class BaileysMessageObserver {
    private readonly registry: MessageReceiptRegistry;
    private readonly now: () => number;

    constructor(private readonly options: BaileysMessageObserverOptions) {
        this.registry = options.registry ?? new MessageReceiptRegistry();
        this.now = options.now ?? Date.now;
    }

    clearContact(jid: string): void {
        this.registry.clearContact(jid);
    }

    async handleUpdates(updates: BaileysEventMap['messages.update']): Promise<void> {
        for (const update of updates) {
            const remoteJid = this.options.resolveTrackedJid(update?.key?.remoteJid);
            if (!remoteJid || !update?.key?.fromMe || isSyntheticProbeId(update?.key?.id)) continue;
            const transition = this.registry.recordStatus(
                update?.key?.id,
                remoteJid,
                update?.update?.status,
                this.now(),
            );
            if (transition) await this.options.onReceipt(transition);
        }
    }

    async handleUpsert(event: BaileysEventMap['messages.upsert']): Promise<void> {
        // `append` is history synchronization, not evidence of current activity.
        if (event.type !== 'notify') return;

        for (const message of event.messages) {
            if (isSyntheticProbeMessage(message)) continue;
            const remoteJid = this.options.resolveTrackedJid(message?.key?.remoteJid);
            if (!remoteJid) continue;

            const direction: MessageDirection = message?.key?.fromMe ? 'outgoing' : 'incoming';
            const messageType = getObservedMessageType(message);
            if (messageType === 'protocolMessage' || messageType === 'senderKeyDistributionMessage') continue;

            const observedAt = this.now();
            const rawTimestamp = Number(message?.messageTimestamp || 0);
            const timestampMs = rawTimestamp > 0 ? rawTimestamp * 1000 : observedAt;
            const messageId = typeof message?.key?.id === 'string' ? message.key.id : null;
            const messageIdHash = messageId ? fingerprintMessageId(messageId) : null;
            const activity: ObservedMessageActivity = {
                jid: remoteJid,
                messageIdHash,
                direction,
                messageType,
                syntheticProbe: false,
                upsertType: 'notify',
                timestamp: new Date(timestampMs).toISOString(),
                timestampMs,
                label: formatObservedMessageLabel(direction, messageType),
            };

            const pendingTransition = direction === 'outgoing' && messageId
                ? this.registry.registerOutgoing(messageId, remoteJid, observedAt)
                : null;
            const published = await this.options.onMessage(activity);
            if (pendingTransition && published !== false) await this.options.onReceipt(pendingTransition);
        }
    }
}

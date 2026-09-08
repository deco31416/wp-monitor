import type { BaileysEventEmitter, BaileysEventMap } from 'baileys';

export const BAILEYS_OBSERVATION_EVENTS = [
    'lid-mapping.update',
    'contacts.update',
    'contacts.upsert',
    'messages.update',
    'messages.upsert',
    'messages.reaction',
    'messages.delete',
    'message-receipt.update',
    'presence.update',
    'call',
] as const;

export type BaileysObservationEventName = typeof BAILEYS_OBSERVATION_EVENTS[number];

export type BaileysObservationHubEvent = {
    [Name in BaileysObservationEventName]: {
        name: Name;
        payload: BaileysEventMap[Name];
    }
}[BaileysObservationEventName];

export type BaileysObservationSink = (
    event: BaileysObservationHubEvent,
) => void | Promise<void>;

export type BaileysObservationErrorHandler = (
    error: unknown,
    context: { operation: 'dispatch' | 'detach'; event: BaileysObservationEventName },
) => void;

/**
 * Owns one stable set of passive-observation listeners for one Baileys socket.
 * Domain normalization and persistence are deliberately delegated to the sink.
 */
export class BaileysObservationHub {
    private emitter: BaileysEventEmitter | null = null;

    private readonly lidMappingUpdate = (payload: BaileysEventMap['lid-mapping.update']) => {
        this.dispatch({ name: 'lid-mapping.update', payload });
    };
    private readonly contactsUpdate = (payload: BaileysEventMap['contacts.update']) => {
        this.dispatch({ name: 'contacts.update', payload });
    };
    private readonly contactsUpsert = (payload: BaileysEventMap['contacts.upsert']) => {
        this.dispatch({ name: 'contacts.upsert', payload });
    };
    private readonly messagesUpdate = (payload: BaileysEventMap['messages.update']) => {
        this.dispatch({ name: 'messages.update', payload });
    };
    private readonly messagesUpsert = (payload: BaileysEventMap['messages.upsert']) => {
        this.dispatch({ name: 'messages.upsert', payload });
    };
    private readonly messagesReaction = (payload: BaileysEventMap['messages.reaction']) => {
        this.dispatch({ name: 'messages.reaction', payload });
    };
    private readonly messagesDelete = (payload: BaileysEventMap['messages.delete']) => {
        this.dispatch({ name: 'messages.delete', payload });
    };
    private readonly messageReceiptUpdate = (payload: BaileysEventMap['message-receipt.update']) => {
        this.dispatch({ name: 'message-receipt.update', payload });
    };
    private readonly presenceUpdate = (payload: BaileysEventMap['presence.update']) => {
        this.dispatch({ name: 'presence.update', payload });
    };
    private readonly call = (payload: BaileysEventMap['call']) => {
        this.dispatch({ name: 'call', payload });
    };

    constructor(
        private readonly sink: BaileysObservationSink,
        private readonly onError: BaileysObservationErrorHandler,
    ) {}

    isAttached(): boolean {
        return this.emitter !== null;
    }

    /**
     * Attach once. Reattaching the same emitter is a no-op; attaching a new one
     * first removes every listener owned by this hub from the previous emitter.
     */
    attach(emitter: BaileysEventEmitter): boolean {
        if (this.emitter === emitter) return false;
        this.detach();
        this.emitter = emitter;

        try {
            emitter.on('lid-mapping.update', this.lidMappingUpdate);
            emitter.on('contacts.update', this.contactsUpdate);
            emitter.on('contacts.upsert', this.contactsUpsert);
            emitter.on('messages.update', this.messagesUpdate);
            emitter.on('messages.upsert', this.messagesUpsert);
            emitter.on('messages.reaction', this.messagesReaction);
            emitter.on('messages.delete', this.messagesDelete);
            emitter.on('message-receipt.update', this.messageReceiptUpdate);
            emitter.on('presence.update', this.presenceUpdate);
            emitter.on('call', this.call);
        } catch (error) {
            this.detach();
            throw error;
        }

        return true;
    }

    detach(): boolean {
        const emitter = this.emitter;
        if (!emitter) return false;
        this.emitter = null;

        this.removeListener(emitter, 'lid-mapping.update', this.lidMappingUpdate);
        this.removeListener(emitter, 'contacts.update', this.contactsUpdate);
        this.removeListener(emitter, 'contacts.upsert', this.contactsUpsert);
        this.removeListener(emitter, 'messages.update', this.messagesUpdate);
        this.removeListener(emitter, 'messages.upsert', this.messagesUpsert);
        this.removeListener(emitter, 'messages.reaction', this.messagesReaction);
        this.removeListener(emitter, 'messages.delete', this.messagesDelete);
        this.removeListener(emitter, 'message-receipt.update', this.messageReceiptUpdate);
        this.removeListener(emitter, 'presence.update', this.presenceUpdate);
        this.removeListener(emitter, 'call', this.call);
        return true;
    }

    private removeListener<Name extends BaileysObservationEventName>(
        emitter: BaileysEventEmitter,
        event: Name,
        listener: (payload: BaileysEventMap[Name]) => void,
    ): void {
        try {
            emitter.off(event, listener);
        } catch (error) {
            this.onError(error, { operation: 'detach', event });
        }
    }

    private dispatch(event: BaileysObservationHubEvent): void {
        try {
            const result = this.sink(event);
            void Promise.resolve(result).catch(error => {
                this.onError(error, { operation: 'dispatch', event: event.name });
            });
        } catch (error) {
            this.onError(error, { operation: 'dispatch', event: event.name });
        }
    }
}

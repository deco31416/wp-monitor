export interface BaileysRawNodeEmitter {
    on(event: 'CB:call' | 'CB:receipt', listener: (node: unknown) => void): unknown;
    off?(event: 'CB:call' | 'CB:receipt', listener: (node: unknown) => void): unknown;
}

export interface BaileysRawNodeHubOptions {
    onCallNode: (node: unknown) => void | Promise<void>;
    onReceiptNode: (node: unknown) => void | Promise<void>;
    onError: (error: unknown, context: { operation: 'dispatch' | 'detach'; event: 'CB:call' | 'CB:receipt' }) => void;
}

/** Owns the two raw websocket listeners required by call and RTT fallbacks. */
export class BaileysRawNodeHub {
    private emitter: BaileysRawNodeEmitter | null = null;

    private readonly callListener = (node: unknown): void => {
        this.dispatch('CB:call', node, this.options.onCallNode);
    };

    private readonly receiptListener = (node: unknown): void => {
        this.dispatch('CB:receipt', node, this.options.onReceiptNode);
    };

    constructor(private readonly options: BaileysRawNodeHubOptions) {}

    attach(emitter: BaileysRawNodeEmitter): boolean {
        if (this.emitter === emitter) return false;
        this.detach();
        this.emitter = emitter;
        try {
            emitter.on('CB:call', this.callListener);
            emitter.on('CB:receipt', this.receiptListener);
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
        this.removeListener(emitter, 'CB:call', this.callListener);
        this.removeListener(emitter, 'CB:receipt', this.receiptListener);
        return true;
    }

    private removeListener(
        emitter: BaileysRawNodeEmitter,
        event: 'CB:call' | 'CB:receipt',
        listener: (node: unknown) => void,
    ): void {
        try {
            emitter.off?.(event, listener);
        } catch (error) {
            this.options.onError(error, { operation: 'detach', event });
        }
    }

    private dispatch(
        event: 'CB:call' | 'CB:receipt',
        node: unknown,
        handler: (value: unknown) => void | Promise<void>,
    ): void {
        try {
            const result = handler(node);
            void Promise.resolve(result).catch(error => {
                this.options.onError(error, { operation: 'dispatch', event });
            });
        } catch (error) {
            this.options.onError(error, { operation: 'dispatch', event });
        }
    }
}

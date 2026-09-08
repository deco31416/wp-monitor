export type DurablePersistenceResult = 'inserted' | 'duplicate' | 'failed' | 'not_required';

export interface DurablePublicationResult<Value> {
    persistence: DurablePersistenceResult;
    published: boolean;
    value: Value | null;
    error?: unknown;
}

/**
 * Serializes evidence for one contact while allowing unrelated contacts to run
 * concurrently. Publication is permitted only after a durable insert, or when
 * the signal is explicitly technical and requires no durable activity record.
 */
export class OrderedDurablePublicationQueue {
    private readonly tails = new Map<string, Promise<void>>();

    enqueue<Value>(
        key: string,
        persist: () => Promise<DurablePersistenceResult>,
        publish: () => Value | Promise<Value>,
    ): Promise<DurablePublicationResult<Value>> {
        if (!key.trim()) throw new TypeError('Publication queue key is required');
        const previous = this.tails.get(key) ?? Promise.resolve();

        const operation = previous
            .catch(() => undefined)
            .then(async (): Promise<DurablePublicationResult<Value>> => {
                let persistence: DurablePersistenceResult;
                try {
                    persistence = await persist();
                } catch (error) {
                    return { persistence: 'failed', published: false, value: null, error };
                }

                if (persistence === 'duplicate' || persistence === 'failed') {
                    return { persistence, published: false, value: null };
                }

                try {
                    const value = await publish();
                    return { persistence, published: true, value };
                } catch (error) {
                    return { persistence, published: false, value: null, error };
                }
            });

        const tail = operation.then(() => undefined, () => undefined);
        this.tails.set(key, tail);
        void tail.finally(() => {
            if (this.tails.get(key) === tail) this.tails.delete(key);
        });
        return operation;
    }

    pendingKeys(): number {
        return this.tails.size;
    }

    async drain(timeoutMs: number = 5_000): Promise<boolean> {
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
            throw new TypeError('Publication drain timeout must be between 1 and 60000 milliseconds');
        }
        const pending = Array.from(this.tails.values());
        if (pending.length === 0) return true;

        let timer: NodeJS.Timeout | null = null;
        try {
            return await Promise.race([
                Promise.all(pending).then(() => true),
                new Promise<boolean>(resolve => {
                    timer = setTimeout(() => resolve(false), timeoutMs);
                }),
            ]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }
}

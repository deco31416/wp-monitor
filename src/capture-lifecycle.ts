export interface ClosableCaptureSession {
    close(): boolean | void;
    once?(event: 'close', listener: () => void): unknown;
    removeListener?(event: 'close', listener: () => void): unknown;
}

export function closeCaptureSessionIfOpened(
    session: ClosableCaptureSession | null,
    opened: boolean,
    onCloseError: (error: unknown) => void = () => undefined,
): boolean {
    if (!session || !opened) return false;

    try {
        return session.close() !== false;
    } catch (error) {
        onCloseError(error);
        return false;
    }
}

/**
 * libuv closes native poll handles in its close-callback phase. The patched
 * cap binding emits `close` from that callback, so descriptor reuse is gated
 * by the native lifecycle instead of a timer guess.
 */
export class NativeCaptureCloseBarrier {
    private pending: Promise<void> | null = null;

    get isPending(): boolean {
        return this.pending !== null;
    }

    close(
        session: ClosableCaptureSession | null,
        opened: boolean,
        onCloseError: (error: unknown) => void = () => undefined,
    ): boolean {
        if (!session || !opened) return false;

        let resolveClose!: () => void;
        const pending = new Promise<void>(resolve => {
            resolveClose = resolve;
        });
        let observesNativeClose = false;
        if (typeof session.once === 'function') {
            session.once('close', resolveClose);
            observesNativeClose = true;
        }

        const closeStarted = closeCaptureSessionIfOpened(session, true, error => {
            resolveClose();
            onCloseError(error);
        });
        if (!closeStarted) {
            if (observesNativeClose) session.removeListener?.('close', resolveClose);
            return false;
        }

        this.pending = pending;
        // Unit-test doubles and alternate adapters may not expose EventEmitter.
        // Production cap sessions always use the native `close` event above.
        if (!observesNativeClose) {
            setImmediate(() => setImmediate(resolveClose));
        }
        void pending.then(() => {
            if (this.pending === pending) this.pending = null;
        });
        return true;
    }

    async wait(): Promise<void> {
        await this.pending;
    }
}

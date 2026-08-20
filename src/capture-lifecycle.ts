export interface ClosableCaptureSession {
    close(): void;
}

export function closeCaptureSessionIfOpened(
    session: ClosableCaptureSession | null,
    opened: boolean,
    onCloseError: (error: unknown) => void = () => undefined,
): void {
    if (!session || !opened) return;

    try {
        session.close();
    } catch (error) {
        onCloseError(error);
    }
}

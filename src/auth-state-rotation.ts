import { mkdir, readdir, rename } from 'node:fs/promises';
import path from 'node:path';

const QUARANTINE_PREFIX = '.logged-out-quarantine-';

function safeTimestamp(now: Date): string {
    return now.toISOString().replace(/[:.]/g, '-');
}

export async function quarantineAuthStateContents(
    authDirectory: string,
    now: Date = new Date(),
): Promise<{ quarantineDirectory: string; movedEntries: number }> {
    await mkdir(authDirectory, { recursive: true, mode: 0o700 });
    const entries = (await readdir(authDirectory, { withFileTypes: true }))
        .filter(entry => !entry.name.startsWith(QUARANTINE_PREFIX));
    const quarantineDirectory = path.join(authDirectory, `${QUARANTINE_PREFIX}${safeTimestamp(now)}`);

    if (entries.length === 0) {
        return { quarantineDirectory, movedEntries: 0 };
    }

    await mkdir(quarantineDirectory, { mode: 0o700 });
    for (const entry of entries) {
        await rename(
            path.join(authDirectory, entry.name),
            path.join(quarantineDirectory, entry.name),
        );
    }

    return { quarantineDirectory, movedEntries: entries.length };
}

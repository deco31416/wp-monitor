export interface PageMetadata {
    returned: number;
    total: number;
    truncated: boolean;
    limit: number;
}

function normalizeCount(value: number, fallback = 0): number {
    return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : fallback;
}

export function buildPageMetadata(returned: number, total: number, limit: number): PageMetadata {
    const safeReturned = normalizeCount(returned);
    const safeTotal = Math.max(safeReturned, normalizeCount(total, safeReturned));
    const safeLimit = normalizeCount(limit);

    return {
        returned: safeReturned,
        total: safeTotal,
        truncated: safeReturned < safeTotal,
        limit: safeLimit,
    };
}

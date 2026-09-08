import type { BaileysEventMap } from 'baileys';
import { normalizeComparableJid } from './tracker-signals.js';

const SUPPORTED_CANONICAL_JID = /^(?:[0-9]{6,20}@s\.whatsapp\.net|[0-9-]+@g\.us|[0-9]+@lid)$/;

export interface WhatsAppIdentityResolverOptions {
    resolveStoredLid?: (canonicalLid: string) => string | null;
}

function normalizeCandidate(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const text = value.trim().slice(0, 140);
    if (!text) return null;
    const candidate = text.includes('@') ? text : `${text}@s.whatsapp.net`;
    const comparable = normalizeComparableJid(candidate);
    return comparable && SUPPORTED_CANONICAL_JID.test(comparable) ? comparable : null;
}

/**
 * Resolves PN, device JID and LID into one canonical account identity. LIDs
 * fail closed until an authenticated mapping is known.
 */
export class WhatsAppIdentityResolver {
    private readonly lidToPn = new Map<string, string>();

    constructor(private readonly options: WhatsAppIdentityResolverOptions = {}) {}

    learn(mapping: BaileysEventMap['lid-mapping.update']): boolean {
        const lid = normalizeCandidate(mapping.lid);
        const pn = normalizeCandidate(mapping.pn);
        if (!lid?.endsWith('@lid') || !pn?.endsWith('@s.whatsapp.net')) return false;
        if (this.lidToPn.get(lid) === pn) return false;
        this.lidToPn.set(lid, pn);
        return true;
    }

    clear(): void {
        this.lidToPn.clear();
    }

    canonicalize(value: unknown): string | null {
        const candidate = normalizeCandidate(value);
        if (!candidate) return null;
        if (!candidate.endsWith('@lid')) return candidate;

        const mapped = this.lidToPn.get(candidate)
            ?? this.options.resolveStoredLid?.(candidate)
            ?? null;
        const canonicalPn = normalizeCandidate(mapped);
        return canonicalPn?.endsWith('@s.whatsapp.net') ? canonicalPn : null;
    }

    resolveActive(
        values: readonly unknown[],
        isActive: (canonicalJid: string) => boolean,
    ): string | null {
        for (const value of values) {
            const jid = this.canonicalize(value);
            if (jid && jid.endsWith('@s.whatsapp.net') && isActive(jid)) return jid;
        }
        return null;
    }
}

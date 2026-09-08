import type { BaileysEventMap } from 'baileys';
import {
    getScopedPresenceEntries,
    isTechnicalLidJid,
    normalizeComparableJid,
} from './tracker-signals.js';
import { normalizeObservedPresence, type ObservedPresenceValue } from './presence-semantics.js';

export interface ObservedPresenceTransition {
    jid: string;
    presence: ObservedPresenceValue;
    timestamp: number;
    lastSeen?: number;
}

export interface ObservedTechnicalDestination {
    deviceJid: string;
    targetJid: string;
    totalDevices: number;
    timestamp: number;
}

export interface LearnedPresenceAlias {
    jid: string;
    targetJid: string;
}

export interface PresenceUpdateHandlingResult {
    rawEntries: number;
    activeContexts: number;
    resolvedAliases: number;
    attributedContexts: number;
    scopedEntries: number;
    unsupportedTransitions: number;
    duplicateTransitions: number;
    attemptedTransitions: number;
    acceptedTransitions: number;
    rejectedTransitions: number;
}

export interface BaileysPresenceObserverOptions {
    resolveTrackedJid?: (value: unknown) => string | null;
    onPresence: (transition: ObservedPresenceTransition) => boolean | void | Promise<boolean | void>;
    onAliasLearned: (alias: LearnedPresenceAlias) => void;
    onNewDevice: (destination: ObservedTechnicalDestination) => void;
    now?: () => number;
}

interface ActivePresenceContext {
    targetJid: string;
    knownJids: Set<string>;
    displayableDestinations: Set<string>;
    lastPresence: string | null;
}

/**
 * Routes the single global Baileys presence stream to explicitly active
 * contacts. It owns dedupe and technical alias correlation, but not UI expiry.
 */
export class BaileysPresenceObserver {
    private readonly contexts = new Map<string, ActivePresenceContext>();
    private readonly now: () => number;

    constructor(private readonly options: BaileysPresenceObserverOptions) {
        this.now = options.now ?? Date.now;
    }

    activate(targetJid: string): boolean {
        const jid = targetJid.trim();
        if (!jid) throw new TypeError('targetJid is required');
        if (this.contexts.has(jid)) return false;
        this.contexts.set(jid, {
            targetJid: jid,
            knownJids: new Set([jid]),
            displayableDestinations: new Set([jid]),
            lastPresence: null,
        });
        return true;
    }

    deactivate(targetJid: string): boolean {
        return this.contexts.delete(targetJid);
    }

    clear(): void {
        this.contexts.clear();
    }

    getLastPresence(targetJid: string): string | null {
        return this.contexts.get(targetJid)?.lastPresence ?? null;
    }

    getTechnicalDestinationCount(targetJid: string): number {
        return this.contexts.get(targetJid)?.displayableDestinations.size ?? 0;
    }

    expire(targetJid: string, expectedPresence: ObservedPresenceValue): boolean {
        const context = this.contexts.get(targetJid);
        if (!context || context.lastPresence !== expectedPresence) return false;
        context.lastPresence = null;
        return true;
    }

    async handleUpdate(update: BaileysEventMap['presence.update']): Promise<PresenceUpdateHandlingResult> {
        const observedAt = this.now();
        const result: PresenceUpdateHandlingResult = {
            rawEntries: update && typeof update === 'object' && update.presences
                ? Object.keys(update.presences).length
                : 0,
            activeContexts: this.contexts.size,
            resolvedAliases: 0,
            attributedContexts: 0,
            scopedEntries: 0,
            unsupportedTransitions: 0,
            duplicateTransitions: 0,
            attemptedTransitions: 0,
            acceptedTransitions: 0,
            rejectedTransitions: 0,
        };

        for (const context of this.contexts.values()) {
            result.resolvedAliases += this.learnResolvedAliases(update, context);
            const scoped = getScopedPresenceEntries(update, context.targetJid, context.knownJids);
            if (scoped.length === 0) continue;
            result.attributedContexts += 1;
            result.scopedEntries += scoped.length;

            for (const [technicalJid] of scoped) {
                if (!context.knownJids.has(technicalJid)) {
                    context.knownJids.add(technicalJid);
                    this.options.onAliasLearned({ jid: technicalJid, targetJid: context.targetJid });
                }
                if (!isTechnicalLidJid(technicalJid)
                    && !context.displayableDestinations.has(technicalJid)) {
                    context.displayableDestinations.add(technicalJid);
                    this.options.onNewDevice({
                        deviceJid: technicalJid,
                        targetJid: context.targetJid,
                        totalDevices: context.displayableDestinations.size,
                        timestamp: observedAt,
                    });
                }
            }

            const selected = scoped[0];
            if (!selected) continue;
            const presenceData = selected[1];
            const nextPresence = normalizeObservedPresence(presenceData.lastKnownPresence);
            if (!nextPresence) {
                result.unsupportedTransitions += 1;
                continue;
            }
            if (nextPresence === context.lastPresence) {
                result.duplicateTransitions += 1;
                continue;
            }
            const previousPresence = context.lastPresence;
            context.lastPresence = nextPresence;

            const lastSeen = Number(presenceData.lastSeen);
            result.attemptedTransitions += 1;
            const accepted = await this.options.onPresence({
                jid: context.targetJid,
                presence: nextPresence,
                timestamp: observedAt,
                ...(Number.isFinite(lastSeen) && lastSeen > 0 ? { lastSeen } : {}),
            });
            if (accepted === false && context.lastPresence === nextPresence) {
                context.lastPresence = previousPresence;
                result.rejectedTransitions += 1;
            } else {
                result.acceptedTransitions += 1;
            }
        }

        return result;
    }

    /**
     * Presence updates can arrive under WhatsApp's LID namespace even when the
     * active tracker is keyed by phone-number JID. Reuse the authenticated
     * identity resolver before applying the strict per-contact scope filter.
     */
    private learnResolvedAliases(
        update: BaileysEventMap['presence.update'],
        context: ActivePresenceContext,
    ): number {
        const resolveTrackedJid = this.options.resolveTrackedJid;
        if (!resolveTrackedJid || !update || typeof update !== 'object') return 0;

        const candidates: unknown[] = [
            update.id,
            ...Object.keys(update.presences ?? {}),
        ];
        let learned = 0;

        for (const candidate of candidates) {
            if (resolveTrackedJid(candidate) !== context.targetJid) continue;
            const comparable = normalizeComparableJid(candidate);
            if (!comparable) continue;
            const rawCandidate = typeof candidate === 'string' ? candidate.trim() : comparable;
            const alreadyKnown = context.knownJids.has(comparable);
            context.knownJids.add(comparable);
            if (rawCandidate) context.knownJids.add(rawCandidate);
            if (alreadyKnown) continue;
            this.options.onAliasLearned({ jid: comparable, targetJid: context.targetJid });
            learned += 1;
        }

        return learned;
    }
}

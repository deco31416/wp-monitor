import type { BaileysEventMap } from 'baileys';

export interface ContactProfileSnapshot {
    pushName: string | null;
    about: string | null;
    profilePic: string | null;
}

export interface ContactProfileChanges {
    pushName?: string | null;
    about?: string | null;
    profilePic?: string | null;
}

export type ProfilePictureSignal =
    | { kind: 'removed' }
    | { kind: 'refresh' };

export interface ObservedProfileCandidate {
    jid: string;
    source: 'contacts.update' | 'contacts.upsert';
    changes: ContactProfileChanges;
    picture?: ProfilePictureSignal;
}

export interface AppliedProfileChange {
    jid: string;
    source: ObservedProfileCandidate['source'];
    changes: ContactProfileChanges;
}

export interface BaileysProfileObserverOptions {
    resolveTrackedJid: (value: unknown) => string | null;
    loadProfile: (jid: string) => Promise<ContactProfileSnapshot | null>;
    persistProfile: (jid: string, changes: ContactProfileChanges) => Promise<void>;
    fetchProfilePicture: (jid: string) => Promise<string | null>;
    onApplied: (change: AppliedProfileChange) => void | Promise<void>;
    onUnavailable?: (context: {
        jid: string;
        field: 'profile' | 'profilePic';
        reason: 'profile_missing' | 'picture_unavailable';
    }) => void;
}

function normalizeNonEmptyText(value: unknown, maxLength: number): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().slice(0, maxLength);
    return normalized || null;
}

function hasOwn(value: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function buildUpdateCandidate(
    update: BaileysEventMap['contacts.update'][number],
    resolveTrackedJid: BaileysProfileObserverOptions['resolveTrackedJid'],
): ObservedProfileCandidate | null {
    const jid = resolveTrackedJid(update.id);
    if (!jid) return null;

    const changes: ContactProfileChanges = {};
    const pushName = normalizeNonEmptyText(update.notify, 256);
    if (pushName) changes.pushName = pushName;
    if (hasOwn(update, 'status') && update.status !== undefined) {
        changes.about = normalizeNonEmptyText(update.status, 1024);
    }

    let picture: ProfilePictureSignal | undefined;
    if (hasOwn(update, 'imgUrl') && update.imgUrl !== undefined) {
        const imageValue = normalizeNonEmptyText(update.imgUrl, 32);
        if (update.imgUrl === null || imageValue === 'removed') {
            picture = { kind: 'removed' };
        } else if (imageValue) {
            picture = { kind: 'refresh' };
        }
    }

    if (Object.keys(changes).length === 0 && !picture) return null;
    return {
        jid,
        source: 'contacts.update',
        changes,
        ...(picture ? { picture } : {}),
    };
}

function buildUpsertCandidate(
    contact: BaileysEventMap['contacts.upsert'][number],
    resolveTrackedJid: BaileysProfileObserverOptions['resolveTrackedJid'],
): ObservedProfileCandidate | null {
    const jid = resolveTrackedJid(contact.id);
    if (!jid) return null;

    const changes: ContactProfileChanges = {};
    const pushName = normalizeNonEmptyText(contact.notify, 256);
    const about = normalizeNonEmptyText(contact.status, 1024);
    if (pushName) changes.pushName = pushName;
    if (about) changes.about = about;
    if (Object.keys(changes).length === 0) return null;

    return { jid, source: 'contacts.upsert', changes };
}

function getChangedFields(
    current: ContactProfileSnapshot,
    candidate: ContactProfileChanges,
): ContactProfileChanges {
    const changed: ContactProfileChanges = {};
    if (candidate.pushName !== undefined && candidate.pushName !== current.pushName) {
        changed.pushName = candidate.pushName;
    }
    if (candidate.about !== undefined && candidate.about !== current.about) {
        changed.about = candidate.about;
    }
    if (candidate.profilePic !== undefined && candidate.profilePic !== current.profilePic) {
        changed.profilePic = candidate.profilePic;
    }
    return changed;
}

/**
 * Converts Baileys contact synchronization events into idempotent profile
 * mutations. Per-contact serialization prevents simultaneous resync events
 * from creating duplicate writes or moving lastProfileUpdate without a change.
 */
export class BaileysProfileObserver {
    private readonly pendingByJid = new Map<string, Promise<void>>();

    constructor(private readonly options: BaileysProfileObserverOptions) {}

    async handleUpdates(updates: BaileysEventMap['contacts.update']): Promise<void> {
        const candidates = updates
            .map(update => buildUpdateCandidate(update, this.options.resolveTrackedJid))
            .filter((value): value is ObservedProfileCandidate => value !== null);
        await Promise.all(candidates.map(candidate => this.enqueue(candidate)));
    }

    async handleUpserts(contacts: BaileysEventMap['contacts.upsert']): Promise<void> {
        const candidates = contacts
            .map(contact => buildUpsertCandidate(contact, this.options.resolveTrackedJid))
            .filter((value): value is ObservedProfileCandidate => value !== null);
        await Promise.all(candidates.map(candidate => this.enqueue(candidate)));
    }

    private async enqueue(candidate: ObservedProfileCandidate): Promise<void> {
        const previous = this.pendingByJid.get(candidate.jid) ?? Promise.resolve();
        const operation = previous
            .catch(() => undefined)
            .then(() => this.applyCandidate(candidate));
        this.pendingByJid.set(candidate.jid, operation);
        try {
            await operation;
        } finally {
            if (this.pendingByJid.get(candidate.jid) === operation) {
                this.pendingByJid.delete(candidate.jid);
            }
        }
    }

    private async applyCandidate(candidate: ObservedProfileCandidate): Promise<void> {
        const current = await this.options.loadProfile(candidate.jid);
        if (!current) {
            this.options.onUnavailable?.({
                jid: candidate.jid,
                field: 'profile',
                reason: 'profile_missing',
            });
            return;
        }

        const desired: ContactProfileChanges = { ...candidate.changes };
        if (candidate.picture?.kind === 'removed') {
            desired.profilePic = null;
        } else if (candidate.picture?.kind === 'refresh') {
            let profilePic: string | null;
            try {
                profilePic = await this.options.fetchProfilePicture(candidate.jid);
            } catch {
                profilePic = null;
            }
            if (profilePic) {
                desired.profilePic = profilePic;
            } else {
                this.options.onUnavailable?.({
                    jid: candidate.jid,
                    field: 'profilePic',
                    reason: 'picture_unavailable',
                });
            }
        }

        const changes = getChangedFields(current, desired);
        if (Object.keys(changes).length === 0) return;
        await this.options.persistProfile(candidate.jid, changes);
        await this.options.onApplied({
            jid: candidate.jid,
            source: candidate.source,
            changes,
        });
    }
}

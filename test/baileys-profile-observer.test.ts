import test from 'node:test';
import assert from 'node:assert/strict';
import type { BaileysEventMap } from 'baileys';
import {
    BaileysProfileObserver,
    type AppliedProfileChange,
    type ContactProfileChanges,
    type ContactProfileSnapshot,
} from '../src/baileys-profile-observer.js';

const JID = '573001112233@s.whatsapp.net';

function updates(value: unknown): BaileysEventMap['contacts.update'] {
    return value as BaileysEventMap['contacts.update'];
}

function upserts(value: unknown): BaileysEventMap['contacts.upsert'] {
    return value as BaileysEventMap['contacts.upsert'];
}

function fixture(initial?: Partial<ContactProfileSnapshot>) {
    let profile: ContactProfileSnapshot | null = {
        pushName: 'Nombre actual',
        about: 'Estado actual',
        profilePic: 'https://example.test/current.jpg',
        ...initial,
    };
    const writes: ContactProfileChanges[] = [];
    const applied: AppliedProfileChange[] = [];
    const unavailable: string[] = [];
    let fetchedPicture: string | null = 'https://example.test/fresh.jpg';
    let fetchFails = false;

    const observer = new BaileysProfileObserver({
        resolveTrackedJid: value => value === JID ? JID : null,
        loadProfile: async () => profile,
        persistProfile: async (_jid, changes) => {
            writes.push(changes);
            if (profile) profile = { ...profile, ...changes };
        },
        fetchProfilePicture: async () => {
            if (fetchFails) throw new Error('temporary upstream failure');
            return fetchedPicture;
        },
        onApplied: change => { applied.push(change); },
        onUnavailable: context => { unavailable.push(`${context.field}:${context.reason}`); },
    });

    return {
        observer,
        writes,
        applied,
        unavailable,
        setMissing: () => { profile = null; },
        setFetchedPicture: (value: string | null) => { fetchedPicture = value; },
        setFetchFails: () => { fetchFails = true; },
    };
}

test('ignores foreign contacts and identical synchronization data', async () => {
    const { observer, writes, applied } = fixture();

    await observer.handleUpserts(upserts([
        { id: '573009998877@s.whatsapp.net', notify: 'Ajeno' },
        { id: JID, notify: 'Nombre actual', status: 'Estado actual' },
    ]));

    assert.deepEqual(writes, []);
    assert.deepEqual(applied, []);
});

test('persists and publishes only fields that actually changed', async () => {
    const { observer, writes, applied } = fixture();

    await observer.handleUpdates(updates([{
        id: JID,
        notify: 'Nombre nuevo',
        status: 'Estado actual',
    }]));

    assert.deepEqual(writes, [{ pushName: 'Nombre nuevo' }]);
    assert.deepEqual(applied, [{
        jid: JID,
        source: 'contacts.update',
        changes: { pushName: 'Nombre nuevo' },
    }]);
});

test('distinguishes explicit picture removal from a temporary fetch failure', async () => {
    const first = fixture();
    await first.observer.handleUpdates(updates([{ id: JID, imgUrl: null }]));
    assert.deepEqual(first.writes, [{ profilePic: null }]);

    const second = fixture();
    second.setFetchFails();
    await second.observer.handleUpdates(updates([{ id: JID, imgUrl: 'changed' }]));
    assert.deepEqual(second.writes, []);
    assert.deepEqual(second.unavailable, ['profilePic:picture_unavailable']);
});

test('refreshes picture signals through the authenticated socket without trusting event URLs', async () => {
    const direct = fixture();
    direct.setFetchedPicture('https://example.test/verified-direct.jpg');
    await direct.observer.handleUpdates(updates([{
        id: JID,
        imgUrl: 'https://untrusted.invalid/event-value.jpg',
    }]));
    assert.deepEqual(direct.writes, [{ profilePic: 'https://example.test/verified-direct.jpg' }]);

    const refreshed = fixture();
    refreshed.setFetchedPicture('https://example.test/fetched.jpg');
    await refreshed.observer.handleUpdates(updates([{ id: JID, imgUrl: 'changed' }]));
    assert.deepEqual(refreshed.writes, [{ profilePic: 'https://example.test/fetched.jpg' }]);

    const privatePicture = fixture();
    privatePicture.setFetchedPicture(null);
    await privatePicture.observer.handleUpdates(updates([{ id: JID, imgUrl: 'changed' }]));
    assert.deepEqual(privatePicture.writes, []);
});

test('serializes concurrent updates for the same contact and rejects missing profiles', async () => {
    const active = fixture();
    await Promise.all([
        active.observer.handleUpdates(updates([{ id: JID, notify: 'Nombre nuevo' }])),
        active.observer.handleUpdates(updates([{ id: JID, notify: 'Nombre nuevo' }])),
    ]);
    assert.deepEqual(active.writes, [{ pushName: 'Nombre nuevo' }]);

    const missing = fixture();
    missing.setMissing();
    await missing.observer.handleUpdates(updates([{ id: JID, status: 'Nuevo estado' }]));
    assert.deepEqual(missing.writes, []);
    assert.deepEqual(missing.unavailable, ['profile:profile_missing']);
});

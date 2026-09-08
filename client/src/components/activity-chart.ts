import type { ObservedActivityEvent } from '../types';
import { classifyObservedPresenceType } from '../observed-patterns';

export function buildHourlyActivity(events: ObservedActivityEvent[]) {
    const buckets = Array.from({ length: 24 }, (_, hour) => ({
        hour: `${String(hour).padStart(2, '0')}:00`,
        messages: 0,
        receipts: 0,
        availability: 0,
        chatSignals: 0,
        calls: 0,
    }));

    events.forEach(event => {
        const date = new Date(event.timestamp);
        if (Number.isNaN(date.getTime())) return;
        const bucket = buckets[date.getHours()];
        if (!bucket) return;
        if (event.source === 'message') bucket.messages += 1;
        if (event.source === 'receipt') bucket.receipts += 1;
        if (event.source === 'presence') {
            const scope = classifyObservedPresenceType(event.type);
            if (scope === 'availability') bucket.availability += 1;
            if (scope === 'direct_chat') bucket.chatSignals += 1;
        }
        if (event.source === 'call') bucket.calls += 1;
    });

    return buckets;
}

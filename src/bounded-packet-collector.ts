export interface BoundedPacketCollectionStats {
    packetLimit: number;
    storedPackets: number;
    droppedPackets: number;
    totalObservedPackets: number;
    truncated: boolean;
}

export class BoundedPacketCollector<T> {
    private readonly stored: T[] = [];
    private dropped = 0;

    constructor(readonly packetLimit: number) {
        if (!Number.isSafeInteger(packetLimit) || packetLimit < 1 || packetLimit > 1_000_000) {
            throw new Error('Packet collection limit must be between 1 and 1000000');
        }
    }

    add(packet: T): boolean {
        if (this.stored.length >= this.packetLimit) {
            if (this.dropped < Number.MAX_SAFE_INTEGER) this.dropped += 1;
            return false;
        }
        this.stored.push(packet);
        return true;
    }

    packets(): readonly T[] {
        return this.stored;
    }

    stats(): BoundedPacketCollectionStats {
        return {
            packetLimit: this.packetLimit,
            storedPackets: this.stored.length,
            droppedPackets: this.dropped,
            totalObservedPackets: this.stored.length + this.dropped,
            truncated: this.dropped > 0,
        };
    }

    clear(): void {
        this.stored.length = 0;
        this.dropped = 0;
    }
}

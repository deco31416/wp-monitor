export const CALL_TRAFFIC_ONSET_DETECTOR_VERSION = 1 as const;

export interface CallTrafficOnsetSample {
    observedAt: Date;
    endpointKey: string;
    protocol: 6 | 17;
    direction: 'inbound' | 'outbound';
    bytes: number;
}

export interface CallTrafficOnsetDetection {
    detectorVersion: typeof CALL_TRAFFIC_ONSET_DETECTOR_VERSION;
    onsetAt: Date;
    detectedAt: Date;
}

interface EndpointWindowStats {
    packets: number;
    bytes: number;
    inbound: number;
    outbound: number;
    buckets: Set<number>;
    firstObservedAtMs: number | null;
    lastObservedAtMs: number | null;
}

export interface CallTrafficOnsetDetectorOptions {
    baselineDurationMs?: number;
    observationWindowMs?: number;
    minimumPackets?: number;
    minimumBytes?: number;
    minimumPacketsPerDirection?: number;
    minimumSustainedDurationMs?: number;
    minimumPacketRateDelta?: number;
    packetRateMultiplier?: number;
    minimumByteRateDelta?: number;
    byteRateMultiplier?: number;
}

const MAX_TRACKED_ENDPOINTS = 512;
const MAX_ROLLING_SAMPLES = 4_096;
const EVALUATION_INTERVAL_MS = 250;

function emptyStats(): EndpointWindowStats {
    return {
        packets: 0,
        bytes: 0,
        inbound: 0,
        outbound: 0,
        buckets: new Set(),
        firstObservedAtMs: null,
        lastObservedAtMs: null,
    };
}

function requirePositive(name: string, value: number, integer = false): number {
    if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isSafeInteger(value))) {
        throw new RangeError(`${name} must be a positive${integer ? ' integer' : ''}`);
    }
    return value;
}

function requireAtLeastOne(name: string, value: number): number {
    if (!Number.isFinite(value) || value < 1) throw new RangeError(`${name} must be at least 1`);
    return value;
}

/**
 * Detects a sustained, bidirectional UDP increase relative to a fixed capture
 * baseline. It only identifies a traffic phase boundary; it does not classify
 * an endpoint as a peer or attach the traffic to a person's identity.
 */
export class CallTrafficOnsetDetector {
    private readonly baselineDurationMs: number;
    private readonly observationWindowMs: number;
    private readonly minimumPackets: number;
    private readonly minimumBytes: number;
    private readonly minimumPacketsPerDirection: number;
    private readonly minimumSustainedDurationMs: number;
    private readonly minimumPacketRateDelta: number;
    private readonly packetRateMultiplier: number;
    private readonly minimumByteRateDelta: number;
    private readonly byteRateMultiplier: number;
    private readonly baselineByEndpoint = new Map<string, EndpointWindowStats>();
    private readonly rollingSamples: CallTrafficOnsetSample[] = [];
    private rollingStartIndex = 0;
    private detected: CallTrafficOnsetDetection | null = null;
    private lastObservedAtMs: number;
    private lastEvaluatedAtMs = Number.NEGATIVE_INFINITY;

    constructor(
        private readonly startedAt: Date,
        options: CallTrafficOnsetDetectorOptions = {},
    ) {
        if (!Number.isFinite(startedAt.getTime())) throw new RangeError('startedAt must be a valid date');
        this.baselineDurationMs = requirePositive('baselineDurationMs', options.baselineDurationMs ?? 5_000, true);
        this.observationWindowMs = requirePositive('observationWindowMs', options.observationWindowMs ?? 2_000, true);
        this.minimumPackets = requirePositive('minimumPackets', options.minimumPackets ?? 12, true);
        this.minimumBytes = requirePositive('minimumBytes', options.minimumBytes ?? 2_400, true);
        this.minimumPacketsPerDirection = requirePositive(
            'minimumPacketsPerDirection',
            options.minimumPacketsPerDirection ?? 2,
            true,
        );
        this.minimumSustainedDurationMs = requirePositive(
            'minimumSustainedDurationMs',
            options.minimumSustainedDurationMs ?? 1_000,
            true,
        );
        this.minimumPacketRateDelta = requirePositive(
            'minimumPacketRateDelta',
            options.minimumPacketRateDelta ?? 6,
        );
        this.packetRateMultiplier = requireAtLeastOne('packetRateMultiplier', options.packetRateMultiplier ?? 3);
        this.minimumByteRateDelta = requirePositive(
            'minimumByteRateDelta',
            options.minimumByteRateDelta ?? 1_200,
        );
        this.byteRateMultiplier = requireAtLeastOne('byteRateMultiplier', options.byteRateMultiplier ?? 2.5);
        if (this.minimumSustainedDurationMs > this.observationWindowMs) {
            throw new RangeError('minimumSustainedDurationMs cannot exceed observationWindowMs');
        }
        this.lastObservedAtMs = startedAt.getTime();
    }

    observe(sample: CallTrafficOnsetSample): CallTrafficOnsetDetection | null {
        if (this.detected) return null;
        if (!this.isValidSample(sample)) return null;

        const observedAtMs = sample.observedAt.getTime();
        if (observedAtMs < this.lastObservedAtMs) return null;
        this.lastObservedAtMs = observedAtMs;

        const baselineEndsAtMs = this.startedAt.getTime() + this.baselineDurationMs;
        if (observedAtMs < baselineEndsAtMs) {
            this.addBaselineSample(sample);
            return null;
        }

        this.rollingSamples.push({ ...sample, observedAt: new Date(observedAtMs) });
        const windowStartsAtMs = observedAtMs - this.observationWindowMs;
        let oldest = this.rollingSamples[this.rollingStartIndex];
        while (oldest && oldest.observedAt.getTime() < windowStartsAtMs) {
            this.rollingStartIndex++;
            oldest = this.rollingSamples[this.rollingStartIndex];
        }
        const activeSampleCount = this.rollingSamples.length - this.rollingStartIndex;
        if (activeSampleCount > MAX_ROLLING_SAMPLES) {
            this.rollingStartIndex += activeSampleCount - MAX_ROLLING_SAMPLES;
        }
        if (this.rollingStartIndex >= 2_048 && this.rollingStartIndex * 2 >= this.rollingSamples.length) {
            this.rollingSamples.splice(0, this.rollingStartIndex);
            this.rollingStartIndex = 0;
        }

        if (observedAtMs < baselineEndsAtMs + this.observationWindowMs) return null;
        if (observedAtMs - this.lastEvaluatedAtMs < EVALUATION_INTERVAL_MS) return null;
        this.lastEvaluatedAtMs = observedAtMs;
        const onsetAt = this.findOnset();
        if (!onsetAt) return null;

        this.detected = {
            detectorVersion: CALL_TRAFFIC_ONSET_DETECTOR_VERSION,
            onsetAt,
            detectedAt: new Date(observedAtMs),
        };
        return { ...this.detected, onsetAt: new Date(onsetAt), detectedAt: new Date(observedAtMs) };
    }

    private isValidSample(sample: CallTrafficOnsetSample): boolean {
        return sample.protocol === 17
            && sample.endpointKey.length > 0
            && Number.isFinite(sample.observedAt.getTime())
            && Number.isSafeInteger(sample.bytes)
            && sample.bytes > 0;
    }

    private addBaselineSample(sample: CallTrafficOnsetSample): void {
        let stats = this.baselineByEndpoint.get(sample.endpointKey);
        if (!stats) {
            if (this.baselineByEndpoint.size >= MAX_TRACKED_ENDPOINTS) return;
            stats = emptyStats();
            this.baselineByEndpoint.set(sample.endpointKey, stats);
        }
        this.addToStats(stats, sample);
    }

    private findOnset(): Date | null {
        const currentByEndpoint = new Map<string, EndpointWindowStats>();
        for (let index = this.rollingStartIndex; index < this.rollingSamples.length; index++) {
            const sample = this.rollingSamples[index];
            if (!sample) continue;
            let stats = currentByEndpoint.get(sample.endpointKey);
            if (!stats) {
                stats = emptyStats();
                currentByEndpoint.set(sample.endpointKey, stats);
            }
            this.addToStats(stats, sample);
        }

        const baselineSeconds = this.baselineDurationMs / 1_000;
        const windowSeconds = this.observationWindowMs / 1_000;
        for (const [endpointKey, current] of currentByEndpoint) {
            if (
                current.packets < this.minimumPackets
                || current.bytes < this.minimumBytes
                || current.inbound < this.minimumPacketsPerDirection
                || current.outbound < this.minimumPacketsPerDirection
                || current.buckets.size < 2
                || current.firstObservedAtMs === null
                || current.lastObservedAtMs === null
                || current.lastObservedAtMs - current.firstObservedAtMs < this.minimumSustainedDurationMs
            ) continue;

            const baseline = this.baselineByEndpoint.get(endpointKey) ?? emptyStats();
            const baselinePacketRate = baseline.packets / baselineSeconds;
            const currentPacketRate = current.packets / windowSeconds;
            const baselineByteRate = baseline.bytes / baselineSeconds;
            const currentByteRate = current.bytes / windowSeconds;
            if (
                currentPacketRate < baselinePacketRate * this.packetRateMultiplier
                || currentPacketRate - baselinePacketRate < this.minimumPacketRateDelta
                || currentByteRate < baselineByteRate * this.byteRateMultiplier
                || currentByteRate - baselineByteRate < this.minimumByteRateDelta
            ) continue;

            const first = this.rollingSamples
                .slice(this.rollingStartIndex)
                .find(sample => sample.endpointKey === endpointKey);
            if (first) return new Date(first.observedAt);
        }
        return null;
    }

    private addToStats(stats: EndpointWindowStats, sample: CallTrafficOnsetSample): void {
        stats.packets++;
        stats.bytes += sample.bytes;
        if (sample.direction === 'inbound') stats.inbound++;
        else stats.outbound++;
        stats.buckets.add(Math.floor(sample.observedAt.getTime() / 1_000));
        const observedAtMs = sample.observedAt.getTime();
        stats.firstObservedAtMs ??= observedAtMs;
        stats.lastObservedAtMs = observedAtMs;
    }
}

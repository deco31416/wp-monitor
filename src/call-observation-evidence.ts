import { isIP } from 'node:net';
import {
    classifyDetailedCapturePacketPhase,
    createCallCapturePhaseCounts,
    normalizeCallCapturePhaseCounts,
    recordCallCapturePhasePacket,
    sumCallCapturePhaseCounts,
    type CallCapturePhaseCounts,
    type CallCapturePhases,
} from './call-capture-phases.js';
import type { ParsedStunMessage, TurnChannelData } from './stun-parser.js';

export type WebRtcCandidateType = 'host' | 'srflx' | 'prflx' | 'relay' | 'unknown';
export type WebRtcTransportProtocol = 'udp' | 'tcp' | 'unknown';
export type WebRtcConnectionState =
    | 'new'
    | 'checking'
    | 'connected'
    | 'completed'
    | 'disconnected'
    | 'failed'
    | 'closed'
    | 'unknown';

export interface BrowserWebRtcCandidateEvidence {
    candidateType: WebRtcCandidateType;
    protocol: WebRtcTransportProtocol;
    relayProtocol: 'udp' | 'tcp' | 'tls' | 'unknown';
    address: string | null;
    addressFamily: 4 | 6 | null;
    port: number | null;
}

export interface BrowserWebRtcSelectedPairEvidence {
    peerConnectionId: string;
    state: 'frozen' | 'waiting' | 'in-progress' | 'failed' | 'succeeded' | 'unknown';
    nominated: boolean;
    selected: boolean;
    firstObservedAt: Date;
    lastObservedAt: Date;
    local: BrowserWebRtcCandidateEvidence;
    remote: BrowserWebRtcCandidateEvidence;
    packetsSent: number | null;
    packetsReceived: number | null;
    bytesSent: number | null;
    bytesReceived: number | null;
    currentRoundTripTimeMs: number | null;
}

export interface BrowserWebRtcStateEvidence {
    peerConnectionId: string;
    state: WebRtcConnectionState;
    observedAt: Date;
}

export interface BrowserWebRtcEvidence {
    version: 1;
    status: 'available' | 'unavailable';
    startedAt: Date;
    endedAt: Date;
    connectionCount: number;
    selectedPairs: BrowserWebRtcSelectedPairEvidence[];
    stateTransitions: BrowserWebRtcStateEvidence[];
    truncated: boolean;
    limitations: string[];
}

export interface CallFlowTuple {
    addressFamily: 4 | 6;
    protocol: 'udp' | 'tcp';
    localPort: number;
    remoteIp: string;
    remotePort: number;
    firstSeen: Date;
    lastSeen: Date;
    direction: 'incoming' | 'outgoing' | 'bidirectional';
    packets: number;
    bytesTotal: number;
    phaseCounts: CallCapturePhaseCounts;
    protocolEvidence: string[];
}

export interface CallFlowEvidence {
    version: 1;
    flowLimit: number;
    storedFlows: number;
    droppedPackets: number;
    truncated: boolean;
    flows: CallFlowTuple[];
}

export interface StunTransactionEvidence {
    transactionFingerprint: string;
    method: ParsedStunMessage['method'];
    firstObservedAt: Date;
    lastObservedAt: Date;
    requestObserved: boolean;
    successResponseObserved: boolean;
    errorResponseObserved: boolean;
    requestDirection: 'incoming' | 'outgoing' | null;
    responseDirection: 'incoming' | 'outgoing' | null;
    useCandidate: boolean;
    iceRole: 'controlling' | 'controlled' | 'unknown';
    channelNumber: number | null;
    endpointKeys: string[];
}

export interface TurnChannelEvidence {
    channelNumber: number;
    peerEndpointKey: string;
    firstObservedAt: Date;
    lastObservedAt: Date;
    packets: number;
    bytesTotal: number;
}

export interface StunTurnEvidence {
    version: 1;
    transactionLimit: number;
    storedTransactions: number;
    droppedTransactions: number;
    truncated: boolean;
    transactions: StunTransactionEvidence[];
    channels: TurnChannelEvidence[];
    limitations: string[];
}

export interface ObservedCallPacketMetadata {
    timestamp: Date;
    srcIp: string;
    dstIp: string;
    srcPort: number;
    dstPort: number;
    protocol: 6 | 17;
    addressFamily: 4 | 6;
    length: number;
    protocolEvidence: string[];
    stun: ParsedStunMessage | null;
    turnChannelData: TurnChannelData | null;
}

const MAX_FLOW_COUNT = 1_024;
const MAX_STUN_TRANSACTIONS = 256;
const STUN_TRANSACTION_MAX_SPAN_MS = 39_500;
const MAX_TURN_CHANNELS = 64;
const MAX_WEBRTC_PAIRS = 16;
const MAX_WEBRTC_STATES = 64;
const MAX_LIMITATIONS = 32;
const CODE_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,119}$/;

function boundedCodes(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((entry): entry is string => (
        typeof entry === 'string' && CODE_PATTERN.test(entry)
    )))].slice(0, MAX_LIMITATIONS);
}

function validDate(value: unknown): Date | null {
    const date = value instanceof Date ? new Date(value) : typeof value === 'string' ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
}

function nonNegativeInteger(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function finiteMetric(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum
        ? value
        : null;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
    return typeof value === 'string' && values.includes(value as T) ? value as T : fallback;
}

function normalizeCandidate(value: unknown): BrowserWebRtcCandidateEvidence | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const candidate = value as Record<string, unknown>;
    const address = typeof candidate.address === 'string' && isIP(candidate.address) !== 0
        ? candidate.address
        : null;
    const addressFamily = address ? isIP(address) as 4 | 6 : null;
    const port = nonNegativeInteger(candidate.port);
    return {
        candidateType: enumValue(candidate.candidateType, ['host', 'srflx', 'prflx', 'relay', 'unknown'], 'unknown'),
        protocol: enumValue(candidate.protocol, ['udp', 'tcp', 'unknown'], 'unknown'),
        relayProtocol: enumValue(candidate.relayProtocol, ['udp', 'tcp', 'tls', 'unknown'], 'unknown'),
        address,
        addressFamily,
        port: port && port <= 65_535 ? port : null,
    };
}

export function normalizeBrowserWebRtcEvidence(value: unknown): BrowserWebRtcEvidence | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const object = value as Record<string, unknown>;
    if (object.version !== 1 || (object.status !== 'available' && object.status !== 'unavailable')) return undefined;
    const startedAt = validDate(object.startedAt);
    const endedAt = validDate(object.endedAt);
    if (!startedAt || !endedAt || endedAt.getTime() < startedAt.getTime()) return undefined;
    const rawPairs = Array.isArray(object.selectedPairs) ? object.selectedPairs : [];
    const rawStates = Array.isArray(object.stateTransitions) ? object.stateTransitions : [];
    if (rawPairs.length > MAX_WEBRTC_PAIRS || rawStates.length > MAX_WEBRTC_STATES) return undefined;

    const selectedPairs: BrowserWebRtcSelectedPairEvidence[] = [];
    for (const [index, valuePair] of rawPairs.entries()) {
        if (!valuePair || typeof valuePair !== 'object' || Array.isArray(valuePair)) return undefined;
        const pair = valuePair as Record<string, unknown>;
        const firstObservedAt = validDate(pair.firstObservedAt);
        const lastObservedAt = validDate(pair.lastObservedAt);
        const local = normalizeCandidate(pair.local);
        const remote = normalizeCandidate(pair.remote);
        if (
            !firstObservedAt || !lastObservedAt || !local || !remote
            || firstObservedAt < startedAt || lastObservedAt > endedAt || lastObservedAt < firstObservedAt
        ) return undefined;
        const peerConnectionId = typeof pair.peerConnectionId === 'string' && /^[a-z0-9-]{1,64}$/i.test(pair.peerConnectionId)
            ? pair.peerConnectionId
            : `pc-${index + 1}`;
        selectedPairs.push({
            peerConnectionId,
            state: enumValue(pair.state, ['frozen', 'waiting', 'in-progress', 'failed', 'succeeded', 'unknown'], 'unknown'),
            nominated: pair.nominated === true,
            selected: pair.selected === true,
            firstObservedAt,
            lastObservedAt,
            local,
            remote,
            packetsSent: finiteMetric(pair.packetsSent),
            packetsReceived: finiteMetric(pair.packetsReceived),
            bytesSent: finiteMetric(pair.bytesSent),
            bytesReceived: finiteMetric(pair.bytesReceived),
            currentRoundTripTimeMs: finiteMetric(pair.currentRoundTripTimeMs, 3_600_000),
        });
    }

    const stateTransitions: BrowserWebRtcStateEvidence[] = [];
    let previousStateAt = startedAt.getTime();
    for (const valueState of rawStates) {
        if (!valueState || typeof valueState !== 'object' || Array.isArray(valueState)) return undefined;
        const state = valueState as Record<string, unknown>;
        const observedAt = validDate(state.observedAt);
        if (!observedAt || observedAt.getTime() < previousStateAt || observedAt > endedAt) return undefined;
        const peerConnectionId = typeof state.peerConnectionId === 'string' && /^[a-z0-9-]{1,64}$/i.test(state.peerConnectionId)
            ? state.peerConnectionId
            : null;
        if (!peerConnectionId) return undefined;
        stateTransitions.push({
            peerConnectionId,
            state: enumValue(
                state.state,
                ['new', 'checking', 'connected', 'completed', 'disconnected', 'failed', 'closed', 'unknown'],
                'unknown',
            ),
            observedAt,
        });
        previousStateAt = observedAt.getTime();
    }

    const connectionCount = nonNegativeInteger(object.connectionCount);
    const truncated = object.truncated === true;
    if (
        connectionCount === null || connectionCount > 32
        || (selectedPairs.length > 0 && connectionCount === 0)
        || (object.status === 'unavailable' && (connectionCount !== 0 || selectedPairs.length > 0 || stateTransitions.length > 0))
    ) return undefined;
    return {
        version: 1,
        status: object.status,
        startedAt,
        endedAt,
        connectionCount,
        selectedPairs,
        stateTransitions,
        truncated,
        limitations: boundedCodes(object.limitations),
    };
}

function packetDirection(packet: ObservedCallPacketMetadata, isLocalIp: (ip: string) => boolean) {
    const localSource = isLocalIp(packet.srcIp);
    const localDestination = isLocalIp(packet.dstIp);
    if (localSource === localDestination) return null;
    return localSource
        ? {
            direction: 'outgoing' as const,
            localIp: packet.srcIp,
            localPort: packet.srcPort,
            remoteIp: packet.dstIp,
            remotePort: packet.dstPort,
        }
        : {
            direction: 'incoming' as const,
            localIp: packet.dstIp,
            localPort: packet.dstPort,
            remoteIp: packet.srcIp,
            remotePort: packet.srcPort,
        };
}

export function buildCallFlowEvidence(
    packets: readonly ObservedCallPacketMetadata[],
    isLocalIp: (ip: string) => boolean,
    capturePhases?: CallCapturePhases,
    flowLimit = MAX_FLOW_COUNT,
): CallFlowEvidence {
    const boundedLimit = Math.max(1, Math.min(MAX_FLOW_COUNT, Math.floor(flowLimit)));
    const flows = new Map<string, CallFlowTuple & { incoming: number; outgoing: number }>();
    let droppedPackets = 0;
    for (const packet of packets) {
        const direction = packetDirection(packet, isLocalIp);
        if (!direction || isIP(direction.remoteIp) !== packet.addressFamily) continue;
        const protocol = packet.protocol === 17 ? 'udp' : 'tcp';
        const key = `${packet.addressFamily}|${protocol}|${direction.localPort}|${direction.remoteIp}|${direction.remotePort}`;
        let flow = flows.get(key);
        if (!flow) {
            if (flows.size >= boundedLimit) {
                droppedPackets += 1;
                continue;
            }
            flow = {
                addressFamily: packet.addressFamily,
                protocol,
                localPort: direction.localPort,
                remoteIp: direction.remoteIp,
                remotePort: direction.remotePort,
                firstSeen: packet.timestamp,
                lastSeen: packet.timestamp,
                direction: direction.direction,
                incoming: 0,
                outgoing: 0,
                packets: 0,
                bytesTotal: 0,
                phaseCounts: createCallCapturePhaseCounts(),
                protocolEvidence: [],
            };
            flows.set(key, flow);
        }
        flow.packets += 1;
        flow.bytesTotal += packet.length;
        if (packet.timestamp < flow.firstSeen) flow.firstSeen = packet.timestamp;
        if (packet.timestamp > flow.lastSeen) flow.lastSeen = packet.timestamp;
        flow[direction.direction] += 1;
        flow.direction = flow.incoming > 0 && flow.outgoing > 0 ? 'bidirectional' : direction.direction;
        flow.protocolEvidence = [...new Set([...flow.protocolEvidence, ...packet.protocolEvidence])].sort().slice(0, 16);
        recordCallCapturePhasePacket(
            flow.phaseCounts,
            classifyDetailedCapturePacketPhase(packet.timestamp, capturePhases),
            packet.length,
        );
    }
    return {
        version: 1,
        flowLimit: boundedLimit,
        storedFlows: flows.size,
        droppedPackets,
        truncated: droppedPackets > 0,
        flows: [...flows.values()].map(({ incoming: _incoming, outgoing: _outgoing, ...flow }) => flow),
    };
}

export function buildStunTurnEvidence(
    packets: readonly ObservedCallPacketMetadata[],
    isLocalIp: (ip: string) => boolean,
    transactionLimit = MAX_STUN_TRANSACTIONS,
): StunTurnEvidence {
    const boundedLimit = Math.max(1, Math.min(MAX_STUN_TRANSACTIONS, Math.floor(transactionLimit)));
    const transactions: StunTransactionEvidence[] = [];
    const transactionBuckets = new Map<string, StunTransactionEvidence[]>();
    const droppedTransactionStarts = new Map<string, number[]>();
    let droppedTransactions = 0;
    let droppedTransactionCountCapped = false;
    const channelBindings = new Map<number, string>();
    const channels = new Map<number, TurnChannelEvidence>();
    const orderedPackets = [...packets].sort((left, right) => (
        left.timestamp.getTime() - right.timestamp.getTime()
    ));
    for (const packet of orderedPackets) {
        const direction = packetDirection(packet, isLocalIp);
        if (!direction) continue;
        const stun = packet.stun;
        if (stun) {
            const observedAt = packet.timestamp.getTime();
            if (!Number.isFinite(observedAt)) continue;
            const key = [
                stun.transactionFingerprint,
                stun.method,
                packet.addressFamily,
                packet.protocol,
                direction.localIp,
                direction.localPort,
                direction.remoteIp,
                direction.remotePort,
            ].join('|');
            const bucket = transactionBuckets.get(key) ?? [];
            const latest = bucket[bucket.length - 1];
            let transaction = latest
                && observedAt - latest.firstObservedAt.getTime() <= STUN_TRANSACTION_MAX_SPAN_MS
                ? latest
                : undefined;
            if (!transaction) {
                if (transactions.length >= boundedLimit) {
                    const starts = droppedTransactionStarts.get(key) ?? [];
                    const latestStart = starts[starts.length - 1];
                    if (latestStart === undefined || observedAt - latestStart > STUN_TRANSACTION_MAX_SPAN_MS) {
                        if (droppedTransactions < MAX_STUN_TRANSACTIONS) {
                            starts.push(observedAt);
                            droppedTransactionStarts.set(key, starts);
                            droppedTransactions += 1;
                        } else {
                            droppedTransactionCountCapped = true;
                        }
                    }
                    continue;
                }
                transaction = {
                    transactionFingerprint: stun.transactionFingerprint,
                    method: stun.method,
                    firstObservedAt: packet.timestamp,
                    lastObservedAt: packet.timestamp,
                    requestObserved: false,
                    successResponseObserved: false,
                    errorResponseObserved: false,
                    requestDirection: null,
                    responseDirection: null,
                    useCandidate: false,
                    iceRole: 'unknown',
                    channelNumber: stun.channelNumber ?? null,
                    endpointKeys: [],
                };
                transactions.push(transaction);
                bucket.push(transaction);
                transactionBuckets.set(key, bucket);
            }
            if (packet.timestamp < transaction.firstObservedAt) transaction.firstObservedAt = packet.timestamp;
            if (packet.timestamp > transaction.lastObservedAt) transaction.lastObservedAt = packet.timestamp;
            if (stun.messageClass === 'request') {
                transaction.requestObserved = true;
                transaction.requestDirection = direction.direction;
            } else {
                transaction.responseDirection = direction.direction;
                if (stun.messageClass === 'success_response') transaction.successResponseObserved = true;
                if (stun.messageClass === 'error_response') transaction.errorResponseObserved = true;
            }
            transaction.useCandidate ||= stun.useCandidate;
            if (stun.iceRole !== 'unknown') transaction.iceRole = stun.iceRole;
            if (stun.channelNumber !== null) transaction.channelNumber = stun.channelNumber;
            const endpointKeys = stun.endpoints.map(endpoint => `${endpoint.ip}:${endpoint.port}:${endpoint.role}`);
            transaction.endpointKeys = [...new Set([...transaction.endpointKeys, ...endpointKeys])].slice(0, 16);
            const peerEndpoint = stun.endpoints.find(endpoint => endpoint.role === 'peer_candidate');
            if (stun.method === 'channel_bind' && stun.channelNumber && peerEndpoint) {
                channelBindings.set(stun.channelNumber, `${peerEndpoint.ip}:${peerEndpoint.port}`);
            }
        }

        const channel = packet.turnChannelData;
        const peerEndpointKey = channel ? channelBindings.get(channel.channelNumber) : undefined;
        if (!channel || !peerEndpointKey) continue;
        let evidence = channels.get(channel.channelNumber);
        if (!evidence) {
            if (channels.size >= MAX_TURN_CHANNELS) continue;
            evidence = {
                channelNumber: channel.channelNumber,
                peerEndpointKey,
                firstObservedAt: packet.timestamp,
                lastObservedAt: packet.timestamp,
                packets: 0,
                bytesTotal: 0,
            };
            channels.set(channel.channelNumber, evidence);
        }
        if (packet.timestamp < evidence.firstObservedAt) evidence.firstObservedAt = packet.timestamp;
        if (packet.timestamp > evidence.lastObservedAt) evidence.lastObservedAt = packet.timestamp;
        evidence.packets += 1;
        evidence.bytesTotal += channel.payloadLength;
    }

    const limitations = new Set<string>();
    if (droppedTransactions > 0) limitations.add('stun_transaction_limit_reached');
    if (droppedTransactionCountCapped) limitations.add('stun_dropped_transaction_count_capped');
    if (packets.some(packet => packet.turnChannelData) && channels.size === 0) {
        limitations.add('turn_channel_data_without_observed_channel_bind');
    }
    return {
        version: 1,
        transactionLimit: boundedLimit,
        storedTransactions: transactions.length,
        droppedTransactions,
        truncated: droppedTransactions > 0,
        transactions,
        channels: [...channels.values()],
        limitations: [...limitations],
    };
}

export function normalizeCallFlowEvidence(value: unknown): CallFlowEvidence | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const object = value as Record<string, unknown>;
    const flowLimit = nonNegativeInteger(object.flowLimit);
    const storedFlows = nonNegativeInteger(object.storedFlows);
    const droppedPackets = nonNegativeInteger(object.droppedPackets);
    if (
        object.version !== 1 || !flowLimit || flowLimit > MAX_FLOW_COUNT
        || storedFlows === null || droppedPackets === null
        || object.truncated !== (droppedPackets > 0)
    ) return undefined;
    const rawFlows = Array.isArray(object.flows) ? object.flows : [];
    if (rawFlows.length !== storedFlows || rawFlows.length > flowLimit) return undefined;
    const flows: CallFlowTuple[] = [];
    for (const rawFlow of rawFlows) {
        if (!rawFlow || typeof rawFlow !== 'object' || Array.isArray(rawFlow)) return undefined;
        const flow = rawFlow as Record<string, unknown>;
        const firstSeen = validDate(flow.firstSeen);
        const lastSeen = validDate(flow.lastSeen);
        const remoteIp = typeof flow.remoteIp === 'string' ? flow.remoteIp : '';
        const addressFamily = isIP(remoteIp);
        const localPort = nonNegativeInteger(flow.localPort);
        const remotePort = nonNegativeInteger(flow.remotePort);
        const packets = nonNegativeInteger(flow.packets);
        const bytesTotal = nonNegativeInteger(flow.bytesTotal);
        const phaseCounts = normalizeCallCapturePhaseCounts(flow.phaseCounts);
        const protocol = typeof flow.protocol === 'string' && ['udp', 'tcp'].includes(flow.protocol)
            ? flow.protocol as 'udp' | 'tcp'
            : null;
        const direction = typeof flow.direction === 'string'
            && ['incoming', 'outgoing', 'bidirectional'].includes(flow.direction)
            ? flow.direction as CallFlowTuple['direction']
            : null;
        const protocolEvidence = boundedCodes(flow.protocolEvidence).slice(0, 16);
        if (
            (addressFamily !== 4 && addressFamily !== 6)
            || flow.addressFamily !== addressFamily
            || !localPort || localPort > 65_535
            || !remotePort || remotePort > 65_535
            || packets === null || bytesTotal === null
            || !firstSeen || !lastSeen || lastSeen < firstSeen
            || !phaseCounts || sumCallCapturePhaseCounts(phaseCounts).packets !== packets
            || sumCallCapturePhaseCounts(phaseCounts).bytes !== bytesTotal
            || !protocol || !direction
            || !Array.isArray(flow.protocolEvidence)
            || flow.protocolEvidence.length !== protocolEvidence.length
            || flow.protocolEvidence.length > 16
        ) return undefined;
        flows.push({
            addressFamily,
            protocol,
            localPort,
            remoteIp,
            remotePort,
            firstSeen,
            lastSeen,
            direction,
            packets,
            bytesTotal,
            phaseCounts,
            protocolEvidence,
        });
    }
    return {
        version: 1,
        flowLimit,
        storedFlows,
        droppedPackets,
        truncated: object.truncated === true,
        flows,
    };
}

export function normalizeStunTurnEvidence(value: unknown): StunTurnEvidence | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const object = value as Record<string, unknown>;
    const transactionLimit = nonNegativeInteger(object.transactionLimit);
    const storedTransactions = nonNegativeInteger(object.storedTransactions);
    const droppedTransactions = nonNegativeInteger(object.droppedTransactions);
    const transactions = Array.isArray(object.transactions) ? object.transactions : [];
    const channels = Array.isArray(object.channels) ? object.channels : [];
    if (
        object.version !== 1 || !transactionLimit || transactionLimit > MAX_STUN_TRANSACTIONS
        || storedTransactions === null || storedTransactions !== transactions.length
        || droppedTransactions === null || channels.length > MAX_TURN_CHANNELS
        || object.truncated !== (droppedTransactions > 0)
    ) return undefined;
    // Stored STUN/TURN evidence is optional context. Rebuild only from objects
    // that satisfy the producer contract; otherwise discard the whole ledger.
    const methods: ParsedStunMessage['method'][] = [
        'binding', 'allocate', 'refresh', 'send', 'data', 'create_permission',
        'channel_bind', 'connect', 'connection_bind', 'connection_attempt', 'unknown',
    ];
    const normalizedTransactions: StunTransactionEvidence[] = [];
    for (const entry of transactions) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
        const item = entry as Record<string, unknown>;
        const firstObservedAt = validDate(item.firstObservedAt);
        const lastObservedAt = validDate(item.lastObservedAt);
        const endpointKeys = boundedCodes(item.endpointKeys);
        if (
            typeof item.transactionFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(item.transactionFingerprint)
            || typeof item.method !== 'string' || !methods.includes(item.method as ParsedStunMessage['method'])
            || !firstObservedAt || !lastObservedAt || lastObservedAt < firstObservedAt
            || typeof item.requestObserved !== 'boolean'
            || typeof item.successResponseObserved !== 'boolean'
            || typeof item.errorResponseObserved !== 'boolean'
            || !['incoming', 'outgoing', null].includes(item.requestDirection as string | null)
            || !['incoming', 'outgoing', null].includes(item.responseDirection as string | null)
            || typeof item.useCandidate !== 'boolean'
            || !['controlling', 'controlled', 'unknown'].includes(String(item.iceRole))
            || !(item.channelNumber === null || (
                Number.isSafeInteger(item.channelNumber)
                && Number(item.channelNumber) >= 0x4000
                && Number(item.channelNumber) <= 0x7fff
            ))
            || !Array.isArray(item.endpointKeys) || item.endpointKeys.length !== endpointKeys.length || endpointKeys.length > 16
        ) return undefined;
        normalizedTransactions.push({
            transactionFingerprint: item.transactionFingerprint,
            method: item.method as ParsedStunMessage['method'],
            firstObservedAt,
            lastObservedAt,
            requestObserved: item.requestObserved,
            successResponseObserved: item.successResponseObserved,
            errorResponseObserved: item.errorResponseObserved,
            requestDirection: item.requestDirection as 'incoming' | 'outgoing' | null,
            responseDirection: item.responseDirection as 'incoming' | 'outgoing' | null,
            useCandidate: item.useCandidate,
            iceRole: item.iceRole as 'controlling' | 'controlled' | 'unknown',
            channelNumber: item.channelNumber as number | null,
            endpointKeys,
        });
    }
    const normalizedChannels: TurnChannelEvidence[] = [];
    for (const entry of channels) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
        const item = entry as Record<string, unknown>;
        const channelNumber = nonNegativeInteger(item.channelNumber);
        const firstObservedAt = validDate(item.firstObservedAt);
        const lastObservedAt = validDate(item.lastObservedAt);
        const packets = nonNegativeInteger(item.packets);
        const bytesTotal = nonNegativeInteger(item.bytesTotal);
        if (
            channelNumber === null || channelNumber < 0x4000 || channelNumber > 0x7fff
            || typeof item.peerEndpointKey !== 'string' || item.peerEndpointKey.length > 160
            || !firstObservedAt || !lastObservedAt || lastObservedAt < firstObservedAt
            || packets === null || bytesTotal === null
        ) return undefined;
        normalizedChannels.push({
            channelNumber,
            peerEndpointKey: item.peerEndpointKey,
            firstObservedAt,
            lastObservedAt,
            packets,
            bytesTotal,
        });
    }
    return {
        version: 1,
        transactionLimit,
        storedTransactions,
        droppedTransactions,
        truncated: object.truncated === true,
        transactions: normalizedTransactions,
        channels: normalizedChannels,
        limitations: boundedCodes(object.limitations),
    };
}

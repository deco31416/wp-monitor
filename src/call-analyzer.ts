/**
 * Call IP Analyzer
 *
 * Captures local network traffic during WhatsApp calls to classify
 * observed infrastructure and direct-path candidate IPs.
 *
 * Flow:
 * 1. Baileys detects a call event (offer/accept/terminate)
 * 2. This module starts a focused UDP packet capture
 * 3. When the call ends, captured packets are analyzed:
 *    - Meta/Facebook IPs are classified as relay/infrastructure
 *    - Remaining IPs are classified as observed direct-path candidates
 *    - Candidates receive geoip-lite hints when available
 * 4. Results are returned with confidence scores
 *
 * For educational and security research purposes only.
 */

// @ts-ignore - cap is a CJS module
import capModule from 'cap';
// @ts-ignore - geoip-lite is CJS
import geoipModule from 'geoip-lite';
import os from 'os';
import { BlockList, isIP } from 'node:net';
import { isMetaIP, isKnownRelayIP, isPrivateIP, classifyIP } from './meta-ip-ranges.js';
import { decodeCallPacketFrame } from './call-packet-decoder.js';
import { BoundedPacketCollector } from './bounded-packet-collector.js';
import { CallTrafficOnsetDetector } from './call-traffic-onset-detector.js';
import {
    CallCapturePhaseLifecycle,
    classifyCapturePacketPhase,
    classifyDetailedCapturePacketPhase,
    createCallCapturePhaseCounts,
    recordCallCapturePhasePacket,
} from './call-capture-phases.js';
import type {
    CallCapturePhaseCounts,
    CallCapturePhaseObservation,
    CallCapturePhases,
    CallCaptureTrigger,
    OperatorCallMarker,
} from './call-capture-phases.js';
import {
    lookupNetworkIntelligence,
    scoreCandidate,
} from './call-scoring.js';
import { NativeCaptureCloseBarrier } from './capture-lifecycle.js';
import { hasPacketCapturePrivileges } from './capture-permissions.js';
import type {
    CandidateConfidence,
    CandidateCorrelation,
    CandidateDirection,
    CandidateProvider,
    CandidateReasonCode,
    CandidateNetworkContext,
    CandidateScoreBreakdown,
    NetworkCategory,
    NetworkIntelligence,
} from './call-scoring.js';
import type { IpEnrichment } from './ip-enrichment.js';

const geoip = (geoipModule as any)?.default ?? geoipModule as any;
const { Cap, findDevice } = capModule as any;
const MAX_CAPTURED_CALL_PACKETS = 50_000;

// ── Types ──────────────────────────────────────────────────────

export interface CallGeoInfo {
    country: string;
    region: string;
    city: string;
    lat: number;
    lon: number;
    timezone: string;
}

export type CallEndpointRole =
    | 'direct_candidate'
    | 'relay'
    | 'stun_turn'
    | 'dns'
    | 'background'
    | 'own_public_endpoint'
    | 'unknown';

export type CallProtocolEvidence =
    | 'stun_binding_request'
    | 'stun_binding_response'
    | 'stun_other'
    | 'transport_flow'
    | 'frame_length_86';

export type CallRouteEvidenceSource =
    | 'baileys_transport'
    | 'packet_flow'
    | 'stun'
    | 'baseline'
    | 'infrastructure_registry'
    | 'ip_enrichment';

export interface SanitizedCallEndpoint {
    ip: string;
    port: number;
    addressFamily: 4 | 6;
    role: 'peer_candidate' | 'relay' | 'unknown';
    source: 'baileys_transport';
    relayName?: string;
    rttMs?: number;
}

export interface SanitizedStunEndpoint {
    ip: string;
    port: number;
    addressFamily: 4 | 6;
    role: 'own_public_endpoint' | 'peer_candidate' | 'relay' | 'stun_turn';
    source: 'stun';
}

export interface CallTransportEvidence {
    firstObservedAt: Date;
    lastObservedAt: Date;
    peerNegotiationObserved: boolean;
    relayNegotiationObserved: boolean;
    keepaliveObserved: boolean;
    candidateRounds: number[];
    endpoints: SanitizedCallEndpoint[];
    limitations: string[];
}

export interface CallRouteAssessment {
    assessmentVersion: 2 | 3;
    classification: 'direct_confirmed' | 'direct_probable' | 'relay_confirmed' | 'mixed' | 'unresolved';
    confidenceScore: number;
    evidenceSources: CallRouteEvidenceSource[];
    independentDirectEvidenceCount: number;
    primaryCandidateIp: string | null;
    reasonCodes: string[];
    limitations: string[];
}

export type { CallCapturePhases } from './call-capture-phases.js';

export interface CandidateIP {
    ip: string;
    packets: number;
    bytesTotal: number;
    firstSeen: Date;
    lastSeen: Date;
    avgSize: number;
    ports: number[];
    direction: CandidateDirection;
    provider: CandidateProvider;
    networkCategory: NetworkCategory;
    networkIntelligence: NetworkIntelligence;
    geo: CallGeoInfo | null;
    confidence: CandidateConfidence;
    confidenceScore: number;
    reasonCodes: CandidateReasonCode[];
    technicalNote: string;
    isP2P: boolean;
    correlation?: CandidateCorrelation;
    ipEnrichment?: IpEnrichment;
    addressFamily?: 4 | 6;
    endpointRole?: CallEndpointRole;
    baselinePackets?: number;
    activeCallPackets?: number;
    phaseCounts?: CallCapturePhaseCounts;
    protocolEvidence?: CallProtocolEvidence[];
    scoreVersion?: 2 | 3;
    networkContext?: CandidateNetworkContext;
    scoreBreakdown?: CandidateScoreBreakdown;
}

export interface CallAnalysisResult {
    callId: string;
    targetJid: string;
    startTime: Date;
    endTime: Date | null;
    durationSec: number;
    isVideo: boolean;
    totalPackets: number;
    candidateIps: CandidateIP[];
    metaIps: string[];
    verdict: 'p2p' | 'relay' | 'mixed' | 'insufficient_data';
    captureInterface: string;
    schemaVersion?: 2;
    capturePhases?: CallCapturePhases;
    stunEndpoints?: SanitizedStunEndpoint[];
    transportEvidence?: CallTransportEvidence;
    routeAssessment?: CallRouteAssessment;
    captureBounds?: CallCaptureBounds;
    phaseCounts?: CallCapturePhaseCounts;
}

export interface CallCaptureBounds {
    packetLimit: number;
    storedPackets: number;
    droppedPackets: number;
    truncated: boolean;
}

export interface CallCaptureStatus {
    isCapturing: boolean;
    targetJid: string | null;
    callId: string | null;
    startTime: Date | null;
    packetsCollected: number;
    elapsed: number;
}

// ── Internal packet structure for call capture ─────────────────

interface RawCallPacket {
    timestamp: Date;
    srcIp: string;
    dstIp: string;
    srcPort: number;
    dstPort: number;
    protocol: 6 | 17;
    addressFamily: 4 | 6;
    length: number;
    payloadLength: number;
    protocolEvidence: CallProtocolEvidence[];
    ownPublicEndpoints: string[];
    stunEndpoints: SanitizedStunEndpoint[];
}

// ── State ──────────────────────────────────────────────────────

let capSession: any = null;
let isCapturing = false;
let currentCallId: string | null = null;
let currentTargetJid: string | null = null;
let currentIsVideo: boolean = false;
let captureStartTime: Date | null = null;
const capturedPacketCollector = new BoundedPacketCollector<RawCallPacket>(MAX_CAPTURED_CALL_PACKETS);
const capturePhaseLifecycle = new CallCapturePhaseLifecycle();
let captureInterfaceAddr: string = '';
let localIPs: Set<string> = new Set();
let localIpBlockList = new BlockList();
let trafficOnsetDetector: CallTrafficOnsetDetector | null = null;

const privateIpBlockList = new BlockList();
privateIpBlockList.addSubnet('fc00::', 7, 'ipv6');
privateIpBlockList.addSubnet('fe80::', 10, 'ipv6');
privateIpBlockList.addAddress('::1', 'ipv6');
privateIpBlockList.addAddress('::', 'ipv6');

// Callback for real-time packet streaming
let onCallPacket: ((packet: RawCallPacket & { isMetaIP: boolean }) => void) | null = null;
const nativeCaptureCloseBarrier = new NativeCaptureCloseBarrier();

// Store completed analyses
const analysisHistory: Map<string, CallAnalysisResult[]> = new Map(); // jid -> results

function resetCaptureState() {
    capSession = null;
    isCapturing = false;
    currentCallId = null;
    currentTargetJid = null;
    currentIsVideo = false;
    captureStartTime = null;
    capturedPacketCollector.clear();
    captureInterfaceAddr = '';
    localIPs = new Set();
    localIpBlockList = new BlockList();
    trafficOnsetDetector = null;
    onCallPacket = null;
    capturePhaseLifecycle.reset();
}

// ── Helpers ────────────────────────────────────────────────────

function getLocalIPs(): Set<string> {
    const ips = new Set<string>();
    const interfaces = os.networkInterfaces();
    for (const addrs of Object.values(interfaces)) {
        if (!addrs) continue;
        for (const addr of addrs) {
            if (addr.family === 'IPv4' || addr.family === 'IPv6') {
                ips.add(addr.address);
            }
        }
    }
    return ips;
}

function buildLocalIpBlockList(ips: Set<string>): BlockList {
    const list = new BlockList();
    for (const ip of ips) {
        const family = isIP(ip);
        if (family === 4) list.addAddress(ip, 'ipv4');
        if (family === 6) list.addAddress(ip, 'ipv6');
    }
    return list;
}

function isLocalOrPrivateIP(ip: string): boolean {
    const family = isIP(ip);
    if (family === 4) return localIpBlockList.check(ip, 'ipv4') || isPrivateIP(ip);
    if (family === 6) return localIpBlockList.check(ip, 'ipv6') || privateIpBlockList.check(ip, 'ipv6');
    return false;
}

function lookupGeo(ip: string): CallGeoInfo | null {
    if (isPrivateIP(ip)) return null;
    const geo = geoip.lookup(ip);
    if (!geo) return null;
    return {
        country: geo.country || '',
        region: geo.region || '',
        city: geo.city || '',
        lat: geo.ll?.[0] ?? 0,
        lon: geo.ll?.[1] ?? 0,
        timezone: geo.timezone || '',
    };
}

/**
 * Auto-detect the best network interface for capture
 */
export function autoDetectInterface(): string | null {
    const interfaces = os.networkInterfaces();
    for (const [_name, addrs] of Object.entries(interfaces)) {
        if (!addrs) continue;
        for (const addr of addrs) {
            if (addr.family === 'IPv4' && !addr.internal) {
                return addr.address;
            }
        }
    }
    return null;
}

// ── Core capture functions ─────────────────────────────────────

/**
 * Start capturing packets for a WhatsApp call.
 * Focuses on UDP traffic which is used for SRTP voice/video.
 */
export function startCallCapture(
    interfaceAddr: string,
    targetJid: string,
    callId: string,
    isVideo: boolean = false,
    packetCallback?: (packet: RawCallPacket & { isMetaIP: boolean }) => void,
    phaseContext?: {
        trigger: CallCaptureTrigger;
        observedCallId?: string;
        initialCallStatus?: string;
    },
): boolean {
    if (isCapturing) {
        console.log('[CALL-ANALYZER] Already capturing, stop first');
        return false;
    }
    if (nativeCaptureCloseBarrier.isPending) {
        console.log('[CALL-ANALYZER] Previous native capture is still closing');
        return false;
    }
    if (!hasPacketCapturePrivileges()) {
        console.error('[CALL-ANALYZER] Capture requires CAP_NET_RAW on Linux');
        return false;
    }

    let captureOpened = false;
    try {
        capSession = new Cap();
        currentCallId = callId;
        currentTargetJid = targetJid;
        currentIsVideo = isVideo;
        captureStartTime = new Date();
        capturedPacketCollector.clear();
        captureInterfaceAddr = interfaceAddr;
        localIPs = getLocalIPs();
        localIpBlockList = buildLocalIpBlockList(localIPs);
        onCallPacket = packetCallback || null;
        if (phaseContext) {
            const phaseLifecycleStarted = capturePhaseLifecycle.start({
                captureCallId: callId,
                targetJid,
                ...phaseContext,
            });
            trafficOnsetDetector = phaseLifecycleStarted
                && phaseContext.trigger === 'manual'
                && !capturePhaseLifecycle.snapshot()?.negotiationStartedAt
                ? new CallTrafficOnsetDetector(captureStartTime)
                : null;
        }

        // Calls primarily use UDP, but signaling and relay fallback can use TCP.
        const bpfFilter = '(udp or tcp) and (ip or ip6)';

        const device = findDevice(interfaceAddr);
        if (!device) {
            console.error('[CALL-ANALYZER] Could not resolve the requested network interface');
            resetCaptureState();
            return false;
        }

        const bufSize = 10 * 1024 * 1024; // 10MB buffer
        const snapLen = 65535;
        const buffer = Buffer.alloc(snapLen);

        const linkType = capSession.open(device, bpfFilter, bufSize, buffer);
        captureOpened = true;
        capSession.setMinBytes && capSession.setMinBytes(0);

        capSession.on('packet', (nbytes: number, truncated: boolean) => {
            if (truncated || !Number.isSafeInteger(nbytes) || nbytes < 1 || nbytes > buffer.length) return;

            try {
                const decoded = decodeCallPacketFrame(buffer.subarray(0, nbytes), linkType);
                if (decoded.status !== 'decoded') return;
                const observed = decoded.packet;

                // Skip local-only traffic
                if (isLocalOrPrivateIP(observed.srcIp) && isLocalOrPrivateIP(observed.dstIp)) return;

                const packet: RawCallPacket = {
                    timestamp: new Date(),
                    srcIp: observed.srcIp,
                    dstIp: observed.dstIp,
                    srcPort: observed.srcPort,
                    dstPort: observed.dstPort,
                    protocol: observed.protocol,
                    addressFamily: observed.addressFamily,
                    length: observed.length,
                    payloadLength: observed.payloadLength,
                    protocolEvidence: observed.protocolEvidence,
                    ownPublicEndpoints: [...new Set(observed.stun?.endpoints
                        .filter(endpoint => endpoint.role === 'own_public_endpoint')
                        .map(endpoint => endpoint.ip) ?? [])].slice(0, 8),
                    stunEndpoints: (observed.stun?.endpoints ?? []).slice(0, 8).map(endpoint => ({
                        ip: endpoint.ip,
                        port: endpoint.port,
                        addressFamily: endpoint.addressFamily,
                        role: endpoint.role,
                        source: 'stun' as const,
                    })),
                };

                if (!capturedPacketCollector.add(packet)) return;

                if (trafficOnsetDetector && currentTargetJid) {
                    const isLocalSrc = isLocalOrPrivateIP(packet.srcIp);
                    const isLocalDst = isLocalOrPrivateIP(packet.dstIp);
                    if (isLocalSrc !== isLocalDst) {
                        const remoteIp = isLocalSrc ? packet.dstIp : packet.srcIp;
                        const detection = trafficOnsetDetector.observe({
                            observedAt: packet.timestamp,
                            endpointKey: `${packet.addressFamily}:${remoteIp}`,
                            protocol: packet.protocol,
                            direction: isLocalSrc ? 'outbound' : 'inbound',
                            bytes: packet.length,
                        });
                        if (detection) {
                            capturePhaseLifecycle.markNetworkOnset(currentTargetJid, detection.onsetAt);
                        }
                    }
                }

                // Emit real-time packet
                if (onCallPacket) {
                    const remoteIp = isLocalOrPrivateIP(packet.srcIp) ? packet.dstIp : packet.srcIp;
                    onCallPacket({
                        ...packet,
                        isMetaIP: isKnownRelayIP(remoteIp),
                    });
                }
            } catch {
                // Malformed packet, skip
            }
        });

        isCapturing = true;
        console.log(`[CALL-ANALYZER] Capture started (${isVideo ? 'video' : 'voice'})`);
        return true;
    } catch (err) {
        console.error('[CALL-ANALYZER] Failed to start capture:', err);
        nativeCaptureCloseBarrier.close(capSession, captureOpened);
        resetCaptureState();
        return false;
    }
}

export function observeCallCapturePhase(
    targetJid: string,
    observedCallId: string,
    status: string,
    observation?: CallCapturePhaseObservation,
): boolean {
    const accepted = capturePhaseLifecycle.observe(targetJid, observedCallId, status, observation);
    if (accepted && capturePhaseLifecycle.snapshot()?.negotiationStartedAt) trafficOnsetDetector = null;
    return accepted;
}

export function markOperatorCallCapturePhase(targetJid: string, marker: OperatorCallMarker): boolean {
    const accepted = capturePhaseLifecycle.markOperatorPhase(targetJid, marker);
    if (accepted && capturePhaseLifecycle.snapshot()?.negotiationStartedAt) trafficOnsetDetector = null;
    return accepted;
}

/**
 * Stop capture and analyze collected packets.
 * Returns the analysis result with observed candidate IPs.
 */
export function stopCallCapture(): CallAnalysisResult | null {
    if (!capSession || !isCapturing) {
        console.log('[CALL-ANALYZER] No active capture to stop');
        return null;
    }

    nativeCaptureCloseBarrier.close(
        capSession,
        true,
        err => console.error('[CALL-ANALYZER] Error closing capture session:', err),
    );
    capSession = null;
    isCapturing = false;
    onCallPacket = null;

    const endTime = new Date();
    const durationSec = captureStartTime
        ? Math.round((endTime.getTime() - captureStartTime.getTime()) / 1000)
        : 0;

    const collectionStats = capturedPacketCollector.stats();
    console.log(`[CALL-ANALYZER] Capture stopped. ${collectionStats.storedPackets} packets stored, ${collectionStats.droppedPackets} dropped by bound in ${durationSec}s`);

    const capturePhases = capturePhaseLifecycle.finish(
        currentCallId || 'unknown',
        currentTargetJid || 'unknown',
        endTime,
    );
    const result = analyzePackets(
        [...capturedPacketCollector.packets()],
        currentCallId || 'unknown',
        currentTargetJid || 'unknown',
        captureStartTime || new Date(),
        endTime,
        durationSec,
        currentIsVideo,
        captureInterfaceAddr,
        collectionStats.droppedPackets,
        capturePhases ?? undefined,
    );

    // Store in history
    const jid = currentTargetJid || 'unknown';
    if (!analysisHistory.has(jid)) {
        analysisHistory.set(jid, []);
    }
    const history = analysisHistory.get(jid)!;
    history.push(result);
    // Keep last 20 analyses per contact
    if (history.length > 20) history.shift();

    resetCaptureState();

    return result;
}

export async function waitForCallCaptureClose(): Promise<void> {
    await nativeCaptureCloseBarrier.wait();
}

/**
 * Analyze captured packets to classify observed remote IPs
 */
function analyzePackets(
    packets: RawCallPacket[],
    callId: string,
    targetJid: string,
    startTime: Date,
    endTime: Date,
    durationSec: number,
    isVideo: boolean,
    captureInterface: string,
    droppedPacketCount: number = 0,
    capturePhases?: CallCapturePhases,
): CallAnalysisResult {
    const totalObservedPackets = packets.length + droppedPacketCount;
    const captureBounds: CallCaptureBounds = {
        packetLimit: MAX_CAPTURED_CALL_PACKETS,
        storedPackets: packets.length,
        droppedPackets: droppedPacketCount,
        truncated: droppedPacketCount > 0,
    };
    const phaseCounts = createCallCapturePhaseCounts();
    for (const packet of packets) {
        recordCallCapturePhasePacket(
            phaseCounts,
            classifyDetailedCapturePacketPhase(packet.timestamp, capturePhases),
            packet.length,
        );
    }
    if (packets.length === 0) {
        return {
            callId,
            targetJid,
            startTime,
            endTime,
            durationSec,
            isVideo,
            totalPackets: totalObservedPackets,
            candidateIps: [],
            metaIps: [],
            verdict: 'insufficient_data',
            captureInterface,
            schemaVersion: 2,
            ...(capturePhases ? { capturePhases } : {}),
            captureBounds,
            phaseCounts,
        };
    }

    // Group packets by remote IP
    const ipStats = new Map<string, {
        packets: number;
        bytesTotal: number;
        firstSeen: Date;
        lastSeen: Date;
        ports: Set<number>;
        inbound: number;
        outbound: number;
        addressFamily: 4 | 6;
        protocolEvidence: Set<CallProtocolEvidence>;
        activeProtocolEvidence: Set<CallProtocolEvidence>;
        baselinePackets: number;
        activeCallPackets: number;
        activeBytesTotal: number;
        activeInbound: number;
        activeOutbound: number;
        activePorts: Set<number>;
        activeFirstSeenAt: Date | null;
        phaseCounts: CallCapturePhaseCounts;
    }>();

    const metaIpSet = new Set<string>();
    const activeMetaIpSet = new Set<string>();
    const ownPublicEndpoints = new Set(packets.flatMap(packet => packet.ownPublicEndpoints));
    const stunEndpointMap = new Map<string, SanitizedStunEndpoint>();

    for (const packet of packets) {
        for (const endpoint of packet.stunEndpoints) {
            if (stunEndpointMap.size >= 256) break;
            stunEndpointMap.set(
                `${endpoint.ip}\0${endpoint.port}\0${endpoint.role}`,
                endpoint,
            );
        }
    }

    for (const pkt of packets) {
        // Determine which IP is "remote" (not local)
        const isLocalSrc = isLocalOrPrivateIP(pkt.srcIp);
        const isLocalDst = isLocalOrPrivateIP(pkt.dstIp);

        let remoteIp: string;
        let isInbound: boolean;

        if (isLocalSrc && !isLocalDst) {
            remoteIp = pkt.dstIp;
            isInbound = false;
        } else if (!isLocalSrc && isLocalDst) {
            remoteIp = pkt.srcIp;
            isInbound = true;
        } else if (!isLocalSrc && !isLocalDst) {
            // Both remote — take destination as the remote target
            remoteIp = pkt.dstIp;
            isInbound = false;
        } else {
            // Both local, skip
            continue;
        }

        // Skip private IPs
        if (isLocalOrPrivateIP(remoteIp)) continue;

        // Track Meta IPs separately
        const packetPhase = classifyCapturePacketPhase(pkt.timestamp, capturePhases);
        if (isMetaIP(remoteIp)) {
            metaIpSet.add(remoteIp);
            if (packetPhase === 'call') activeMetaIpSet.add(remoteIp);
        }

        if (!ipStats.has(remoteIp)) {
            ipStats.set(remoteIp, {
                packets: 0,
                bytesTotal: 0,
                firstSeen: pkt.timestamp,
                lastSeen: pkt.timestamp,
                ports: new Set(),
                inbound: 0,
                outbound: 0,
                addressFamily: pkt.addressFamily,
                protocolEvidence: new Set(),
                activeProtocolEvidence: new Set(),
                baselinePackets: 0,
                activeCallPackets: 0,
                activeBytesTotal: 0,
                activeInbound: 0,
                activeOutbound: 0,
                activePorts: new Set(),
                activeFirstSeenAt: null,
                phaseCounts: createCallCapturePhaseCounts(),
            });
        }

        const stats = ipStats.get(remoteIp)!;
        stats.packets++;
        stats.bytesTotal += pkt.length;
        stats.lastSeen = pkt.timestamp;
        if (pkt.srcPort) stats.ports.add(pkt.srcPort);
        if (pkt.dstPort) stats.ports.add(pkt.dstPort);
        if (isInbound) stats.inbound++;
        else stats.outbound++;
        for (const evidence of pkt.protocolEvidence) stats.protocolEvidence.add(evidence);
        recordCallCapturePhasePacket(
            stats.phaseCounts,
            classifyDetailedCapturePacketPhase(pkt.timestamp, capturePhases),
            pkt.length,
        );
        if (packetPhase === 'baseline') {
            stats.baselinePackets++;
        } else {
            stats.activeCallPackets++;
            stats.activeBytesTotal += pkt.length;
            stats.activeFirstSeenAt ??= pkt.timestamp;
            if (isInbound) stats.activeInbound++;
            else stats.activeOutbound++;
            if (pkt.srcPort) stats.activePorts.add(pkt.srcPort);
            if (pkt.dstPort) stats.activePorts.add(pkt.dstPort);
            for (const evidence of pkt.protocolEvidence) stats.activeProtocolEvidence.add(evidence);
        }
    }

    // Build candidate list
    const candidates: CandidateIP[] = [];

    for (const [ip, stats] of ipStats) {
        const provider = classifyIP(ip);
        const geo = lookupGeo(ip);
        const networkIntelligence = lookupNetworkIntelligence(ip, provider, { ownPublicEndpoints });
        const registryRole = networkIntelligence.registryEvidence?.endpointRole;
        const endpointRole: CallEndpointRole = registryRole === 'relay'
            || registryRole === 'stun_turn'
            || registryRole === 'dns'
            || registryRole === 'own_public_endpoint'
            ? registryRole
            : registryRole === 'cdn' || registryRole === 'cloud_hosting'
                ? 'background'
                : 'unknown';

        // Determine direction
        let direction: 'incoming' | 'outgoing' | 'bidirectional';
        if (stats.inbound > 0 && stats.outbound > 0) {
            direction = 'bidirectional';
        } else if (stats.inbound > 0) {
            direction = 'incoming';
        } else {
            direction = 'outgoing';
        }

        const ports = Array.from(stats.ports).sort((a, b) => a - b).slice(0, 10);
        const scoringPorts = Array.from(stats.activePorts).sort((a, b) => a - b).slice(0, 10);
        let scoringDirection: 'incoming' | 'outgoing' | 'bidirectional';
        if (stats.activeInbound > 0 && stats.activeOutbound > 0) scoringDirection = 'bidirectional';
        else if (stats.activeInbound > 0) scoringDirection = 'incoming';
        else scoringDirection = 'outgoing';
        const scoringDurationSec = capturePhases?.baselineAvailable && capturePhases.baselineEndedAt
            ? Math.max(0, Math.round((endTime.getTime() - capturePhases.baselineEndedAt.getTime()) / 1000))
            : durationSec;
        const baselineDurationSec = capturePhases?.baselineAvailable
            && capturePhases.baselineStartedAt
            && capturePhases.baselineEndedAt
            ? Math.max(0, (capturePhases.baselineEndedAt.getTime() - capturePhases.baselineStartedAt.getTime()) / 1_000)
            : 0;
        const scoringWindowStartedAt = capturePhases?.baselineAvailable
            ? capturePhases.baselineEndedAt
            : capturePhases?.negotiationStartedAt ?? capturePhases?.activeCallStartedAt ?? null;
        const onsetDelayMs = scoringWindowStartedAt && stats.activeFirstSeenAt
            ? Math.max(0, stats.activeFirstSeenAt.getTime() - scoringWindowStartedAt.getTime())
            : null;
        const score = scoreCandidate({
            provider,
            networkIntelligence,
            packets: stats.activeCallPackets,
            bytesTotal: stats.activeBytesTotal,
            direction: scoringDirection,
            ports: scoringPorts,
            durationSec: scoringDurationSec,
            targetJid,
            observedCountryCode: geo?.country ?? null,
            addressFamily: stats.addressFamily,
            baselinePackets: stats.baselinePackets,
            baselineDurationSec,
            onsetDelayMs,
            protocolEvidence: [...stats.activeProtocolEvidence],
        });

        candidates.push({
            ip,
            packets: stats.packets,
            bytesTotal: stats.bytesTotal,
            firstSeen: stats.firstSeen,
            lastSeen: stats.lastSeen,
            avgSize: Math.round(stats.bytesTotal / stats.packets),
            ports,
            direction,
            provider,
            networkCategory: score.networkCategory,
            networkIntelligence,
            geo,
            confidence: score.confidence,
            confidenceScore: score.confidenceScore,
            reasonCodes: score.reasonCodes,
            technicalNote: score.technicalNote,
            isP2P: score.isP2P,
            correlation: score.correlation,
            addressFamily: stats.addressFamily,
            endpointRole,
            protocolEvidence: [...stats.protocolEvidence].sort(),
            baselinePackets: stats.baselinePackets,
            activeCallPackets: stats.activeCallPackets,
            phaseCounts: stats.phaseCounts,
            scoreVersion: 3,
            networkContext: score.networkContext,
            scoreBreakdown: score.scoreBreakdown,
        });
    }

    // Sort direct-path candidates first, then by packet count descending
    candidates.sort((a, b) => {
        if (a.isP2P !== b.isP2P) return a.isP2P ? -1 : 1;
        return b.packets - a.packets;
    });

    // Determine verdict
    const p2pCandidates = candidates.filter(c => c.isP2P && c.confidence !== 'low');
    const hasRelay = activeMetaIpSet.size > 0;
    const activeObservedPackets = [...ipStats.values()]
        .reduce((total, stats) => total + stats.activeCallPackets, 0);

    let verdict: 'p2p' | 'relay' | 'mixed' | 'insufficient_data';
    if (activeObservedPackets < 10) {
        verdict = 'insufficient_data';
    } else if (p2pCandidates.length > 0 && hasRelay) {
        verdict = 'mixed';
    } else if (p2pCandidates.length > 0) {
        verdict = 'p2p';
    } else {
        verdict = 'relay';
    }

    const result: CallAnalysisResult = {
        callId,
        targetJid,
        startTime,
        endTime,
        durationSec,
        isVideo,
        totalPackets: totalObservedPackets,
        candidateIps: candidates,
        metaIps: Array.from(metaIpSet),
        verdict,
        captureInterface,
        schemaVersion: 2,
        ...(capturePhases ? { capturePhases } : {}),
        ...(stunEndpointMap.size > 0 ? { stunEndpoints: [...stunEndpointMap.values()] } : {}),
        captureBounds,
        phaseCounts,
    };

    console.log(`[CALL-ANALYZER] Analysis complete: ${verdict} | ${p2pCandidates.length} direct-path candidates | ${metaIpSet.size} Meta IPs | ${totalObservedPackets} observed packets`);

    return result;
}

// ── Public query functions ─────────────────────────────────────

/**
 * Get current capture status
 */
export function getCallCaptureStatus(): CallCaptureStatus {
    return {
        isCapturing,
        targetJid: currentTargetJid,
        callId: currentCallId,
        startTime: captureStartTime,
        packetsCollected: capturedPacketCollector.stats().totalObservedPackets,
        elapsed: captureStartTime
            ? Math.round((Date.now() - captureStartTime.getTime()) / 1000)
            : 0,
    };
}

/**
 * Get analysis history for a specific contact
 */
export function getCallAnalysisHistory(jid: string): CallAnalysisResult[] {
    return analysisHistory.get(jid) || [];
}

/**
 * Get the latest analysis result for a contact
 */
export function getLatestCallAnalysis(jid: string): CallAnalysisResult | null {
    const history = analysisHistory.get(jid);
    if (!history || history.length === 0) return null;
    return history[history.length - 1] ?? null;
}

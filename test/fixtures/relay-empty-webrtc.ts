import type { CallAnalysisResult } from '../../src/call-analyzer.js';
import { correlateCallRoute } from '../../src/call-route-correlator.js';

/** Synthetic network relay with a valid, empty browser observation window. */
export function relayWithEmptyWebRtc(): CallAnalysisResult {
    const startTime = new Date('2026-09-14T12:00:00.000Z');
    const endTime = new Date('2026-09-14T12:01:00.000Z');
    return correlateCallRoute({
        callId: 'CALL-SYNTHETIC-RELAY-001',
        targetJid: '15555550123@s.whatsapp.net',
        startTime, endTime, durationSec: 60, isVideo: false,
        totalPackets: 100, captureInterface: '192.0.2.10', verdict: 'relay',
        metaIps: ['198.51.100.20'],
        candidateIps: [{
            ip: '198.51.100.20', packets: 100, bytesTotal: 20_000,
            firstSeen: startTime, lastSeen: endTime, avgSize: 200,
            ports: [40_000], direction: 'bidirectional', provider: 'meta',
            endpointRole: 'relay', networkCategory: 'meta',
            networkIntelligence: {
                asn: 64512, org: 'Synthetic relay', category: 'meta',
                source: 'local_rules', isDatacenterLikely: true,
                caution: 'Synthetic fixture only',
            },
            geo: null, confidence: 'low', confidenceScore: 0, reasonCodes: [],
            technicalNote: 'Synthetic relay only', isP2P: false,
        }],
        browserWebRtcEvidence: {
            version: 1, status: 'available', startedAt: startTime, endedAt: endTime,
            connectionCount: 0, selectedPairs: [], stateTransitions: [], truncated: false,
            limitations: ['browser_peer_connection_not_observed'],
        },
        flowEvidence: {
            version: 1, flowLimit: 1024, storedFlows: 1, droppedPackets: 0, truncated: false,
            flows: [{
                addressFamily: 4, protocol: 'udp', localPort: 50_000,
                remoteIp: '198.51.100.20', remotePort: 40_000,
                firstSeen: startTime, lastSeen: endTime, direction: 'bidirectional',
                packets: 100, bytesTotal: 20_000,
                phaseCounts: {
                    version: 1, baseline: { packets: 0, bytes: 0 },
                    negotiation: { packets: 20, bytes: 4000 },
                    active: { packets: 60, bytes: 12_000 },
                    postCall: { packets: 20, bytes: 4000 },
                    unclassified: { packets: 0, bytes: 0 },
                },
                protocolEvidence: ['transport_flow'],
            }],
        },
    });
}

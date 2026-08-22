/**
 * Packet Capture Service
 *
 * Uses Npcap (via `cap`) to capture network packets in real-time.
 * Extracts metadata only: IPs, ports, protocols, sizes, timestamps.
 * NO payload/content inspection — metadata capture only.
 *
 * For educational and research purposes only.
 */

// @ts-ignore - cap is a CJS module
import capModule from 'cap';
// @ts-ignore - geoip-lite is CJS
import geoipModule from 'geoip-lite';
import os from 'os';
import { classifyIP, isPrivateIP } from './meta-ip-ranges.js';
import {
    lookupNetworkIntelligence,
    type CandidateProvider,
    type NetworkIntelligenceCategory,
} from './call-scoring.js';
import { closeCaptureSessionIfOpened } from './capture-lifecycle.js';
import { hasPacketCapturePrivileges } from './capture-permissions.js';

const geoip = (geoipModule as any)?.default ?? geoipModule as any;

const { Cap, decoders, findDevice } = capModule as any;

// ── Types ──────────────────────────────────────────────────────

export interface PacketMeta {
    id: number;
    timestamp: string;
    srcIp: string;
    dstIp: string;
    srcPort: number | null;
    dstPort: number | null;
    protocol: string;
    length: number;
    ttl: number;
    srcGeo: GeoInfo | null;
    dstGeo: GeoInfo | null;
    severity: 'info' | 'warning' | 'danger';
}

export interface GeoInfo {
    country: string;
    region: string;
    city: string;
    ll: [number, number]; // [lat, lon]
}

export interface CaptureFilter {
    protocol?: string;       // tcp, udp, icmp, all
    port?: number;
    ip?: string;
    minSize?: number;
    maxSize?: number;
}

export interface CaptureStats {
    totalPackets: number;
    totalBytes: number;
    startTime: string | null;
    protocols: Record<string, number>;
    topSrcIps: Array<{ ip: string; count: number; geo: GeoInfo | null }>;
    topDstIps: Array<{ ip: string; count: number; geo: GeoInfo | null }>;
    ipInsights: NetworkIpInsight[];
}

export interface NetworkIpInsight {
    ip: string;
    count: number;
    sourceCount: number;
    destinationCount: number;
    direction: 'source' | 'destination' | 'bidirectional';
    geo: GeoInfo | null;
    provider: CandidateProvider | 'local';
    networkCategory: NetworkIntelligenceCategory | 'local';
    asn: number | null;
    org: string;
    role: string;
    verdict: 'Descartada' | 'Infraestructura' | 'Candidata preliminar' | 'Revisar';
    tone: 'success' | 'warning' | 'accent' | 'neutral';
    reason: string;
}

export interface NetworkInterface {
    name: string;
    address: string;
    description: string;
}

// ── Private state ──────────────────────────────────────────────

let capSession: any = null;
let isCapturing = false;
let packetCounter = 0;
let captureFilter: CaptureFilter = {};
let captureStats: CaptureStats = {
    totalPackets: 0,
    totalBytes: 0,
    startTime: null,
    protocols: {},
    topSrcIps: [],
    topDstIps: [],
    ipInsights: [],
};

const recentPackets: PacketMeta[] = [];
const MAX_RECENT = 2000;

// Counters for stats
const srcIpCounts = new Map<string, number>();
const dstIpCounts = new Map<string, number>();

// Callback for emitting packets
let onPacket: ((packet: PacketMeta) => void) | null = null;

function resetCaptureState(closeOpenedSession = true) {
    closeCaptureSessionIfOpened(
        capSession,
        closeOpenedSession,
        err => console.error('[CAPTURE] Error closing capture session:', err),
    );
    capSession = null;
    isCapturing = false;
    onPacket = null;
}

// ── Helpers ────────────────────────────────────────────────────

function lookupGeo(ip: string): GeoInfo | null {
    // Skip private/local IPs
    if (isPrivateIP(ip)) return null;
    const geo = geoip.lookup(ip);
    if (!geo) return null;
    return {
        country: geo.country || '',
        region: geo.region || '',
        city: geo.city || '',
        ll: geo.ll as [number, number],
    };
}

function getProtocolName(proto: number): string {
    switch (proto) {
        case 1: return 'ICMP';
        case 6: return 'TCP';
        case 17: return 'UDP';
        case 41: return 'IPv6';
        case 47: return 'GRE';
        case 50: return 'ESP';
        case 58: return 'ICMPv6';
        default: return `OTHER(${proto})`;
    }
}

function classifySeverity(packet: { protocol: string; dstPort: number | null; srcPort: number | null }): 'info' | 'warning' | 'danger' {
    const dangerPorts = [22, 23, 3389, 445, 135, 139, 4444, 5555, 1433, 3306, 5432];
    const warningPorts = [80, 8080, 8443, 53, 25, 587, 993, 995, 110, 143];

    const port = packet.dstPort || packet.srcPort || 0;
    if (dangerPorts.includes(port)) return 'danger';
    if (warningPorts.includes(port) || packet.protocol === 'ICMP') return 'warning';
    return 'info';
}

function matchesFilter(packet: PacketMeta, filter: CaptureFilter): boolean {
    if (filter.protocol && filter.protocol !== 'all') {
        if (packet.protocol.toLowerCase() !== filter.protocol.toLowerCase()) return false;
    }
    if (filter.port) {
        if (packet.srcPort !== filter.port && packet.dstPort !== filter.port) return false;
    }
    if (filter.ip) {
        if (!packet.srcIp.includes(filter.ip) && !packet.dstIp.includes(filter.ip)) return false;
    }
    if (filter.minSize && packet.length < filter.minSize) return false;
    if (filter.maxSize && packet.length > filter.maxSize) return false;
    return true;
}

function updateStats(packet: PacketMeta) {
    captureStats.totalPackets++;
    captureStats.totalBytes += packet.length;
    captureStats.protocols[packet.protocol] = (captureStats.protocols[packet.protocol] || 0) + 1;

    // Track IP counts
    srcIpCounts.set(packet.srcIp, (srcIpCounts.get(packet.srcIp) || 0) + 1);
    dstIpCounts.set(packet.dstIp, (dstIpCounts.get(packet.dstIp) || 0) + 1);

    if (captureStats.totalPackets === 1 || captureStats.totalPackets % 25 === 0) {
        rebuildIpStats();
    }
}

function rebuildIpStats() {
    captureStats.topSrcIps = [...srcIpCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([ip, count]) => ({ ip, count, geo: lookupGeo(ip) }));

    captureStats.topDstIps = [...dstIpCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([ip, count]) => ({ ip, count, geo: lookupGeo(ip) }));

    captureStats.ipInsights = buildIpInsights(captureStats.topSrcIps, captureStats.topDstIps);
}

function buildIpInsights(
    topSrcIps: CaptureStats['topSrcIps'],
    topDstIps: CaptureStats['topDstIps'],
): NetworkIpInsight[] {
    const merged = new Map<string, { ip: string; sourceCount: number; destinationCount: number; geo: GeoInfo | null }>();

    for (const entry of topSrcIps) {
        const current = merged.get(entry.ip) || { ip: entry.ip, sourceCount: 0, destinationCount: 0, geo: entry.geo };
        current.sourceCount += entry.count;
        current.geo = current.geo || entry.geo;
        merged.set(entry.ip, current);
    }

    for (const entry of topDstIps) {
        const current = merged.get(entry.ip) || { ip: entry.ip, sourceCount: 0, destinationCount: 0, geo: entry.geo };
        current.destinationCount += entry.count;
        current.geo = current.geo || entry.geo;
        merged.set(entry.ip, current);
    }

    return [...merged.values()]
        .map(entry => {
            const count = entry.sourceCount + entry.destinationCount;
            const direction: NetworkIpInsight['direction'] = entry.sourceCount > 0 && entry.destinationCount > 0
                ? 'bidirectional'
                : entry.sourceCount > 0 ? 'source' : 'destination';
            return classifyNetworkIp(entry.ip, count, entry.sourceCount, entry.destinationCount, direction, entry.geo);
        })
        .sort((a, b) => {
            const rank = { success: 0, accent: 1, warning: 2, neutral: 3 };
            return rank[a.tone] - rank[b.tone] || b.count - a.count;
        });
}

function classifyNetworkIp(
    ip: string,
    count: number,
    sourceCount: number,
    destinationCount: number,
    direction: NetworkIpInsight['direction'],
    geo: GeoInfo | null,
): NetworkIpInsight {
    if (isPrivateIP(ip)) {
        return {
            ip,
            count,
            sourceCount,
            destinationCount,
            direction,
            geo,
            provider: 'local',
            networkCategory: 'local',
            asn: null,
            org: 'Red local / privada',
            role: 'Red local / privada',
            verdict: 'Descartada',
            tone: 'neutral',
            reason: 'IP privada, local, CGNAT o reservada del entorno de captura. No representa ubicacion publica del contacto.',
        };
    }

    const provider = classifyIP(ip);
    const intelligence = lookupNetworkIntelligence(ip, provider);

    if (provider === 'meta') {
        return baseInsight(ip, count, sourceCount, destinationCount, direction, geo, provider, intelligence, 'Meta / WhatsApp relay', 'Infraestructura', 'warning', 'Rango asociado a Meta/Facebook. Normalmente corresponde a relay, mensajeria o infraestructura WhatsApp.');
    }
    if (provider === 'google') {
        return baseInsight(ip, count, sourceCount, destinationCount, direction, geo, provider, intelligence, 'Google / STUN-TURN probable', 'Infraestructura', 'warning', 'Rango Google observado frecuentemente en servicios, resolucion, STUN/TURN o infraestructura auxiliar.');
    }
    if (provider === 'cloudflare') {
        return baseInsight(ip, count, sourceCount, destinationCount, direction, geo, provider, intelligence, 'Cloudflare / CDN', 'Infraestructura', 'warning', 'Rango Cloudflare. Suele ser CDN, proxy o proteccion de aplicaciones; no debe tratarse como IP del objetivo.');
    }

    if (intelligence.isDatacenterLikely || intelligence.category === 'cloud_hosting' || intelligence.category === 'cdn') {
        return baseInsight(ip, count, sourceCount, destinationCount, direction, geo, provider, intelligence, intelligence.org, 'Infraestructura', 'warning', `${intelligence.org}. Puede ser infraestructura de aplicaciones, CDN, proxy, VPN o servicios auxiliares.`);
    }

    if (direction === 'bidirectional' && count >= 20) {
        return baseInsight(ip, count, sourceCount, destinationCount, direction, geo, provider, intelligence, 'IP publica no clasificada', 'Candidata preliminar', 'success', 'Flujo bidireccional y volumen suficiente para revision manual. Requiere correlacion con hora de llamada, caso y fuentes externas.');
    }

    return baseInsight(ip, count, sourceCount, destinationCount, direction, geo, provider, intelligence, 'IP publica observada', 'Revisar', 'accent', 'No coincide con infraestructura catalogada localmente. Muestra preliminar; revisar volumen, direccion y contexto antes de reportar.');
}

function baseInsight(
    ip: string,
    count: number,
    sourceCount: number,
    destinationCount: number,
    direction: NetworkIpInsight['direction'],
    geo: GeoInfo | null,
    provider: CandidateProvider,
    intelligence: ReturnType<typeof lookupNetworkIntelligence>,
    role: string,
    verdict: NetworkIpInsight['verdict'],
    tone: NetworkIpInsight['tone'],
    reason: string,
): NetworkIpInsight {
    return {
        ip,
        count,
        sourceCount,
        destinationCount,
        direction,
        geo,
        provider,
        networkCategory: intelligence.category,
        asn: intelligence.asn,
        org: intelligence.org,
        role,
        verdict,
        tone,
        reason,
    };
}

// ── Public API ─────────────────────────────────────────────────

/**
 * List available network interfaces
 */
export function listInterfaces(): NetworkInterface[] {
    const interfaces = os.networkInterfaces();
    const result: NetworkInterface[] = [];

    for (const [name, addrs] of Object.entries(interfaces)) {
        if (!addrs) continue;
        for (const addr of addrs) {
            if (addr.family === 'IPv4' && !addr.internal) {
                result.push({
                    name,
                    address: addr.address,
                    description: `${name} (${addr.address})`,
                });
            }
        }
    }
    return result;
}

/**
 * Start packet capture on a given interface
 */
export function startCapture(
    interfaceAddress: string,
    filter: CaptureFilter = {},
    callback: (packet: PacketMeta) => void
): boolean {
    if (isCapturing) {
        console.log('[CAPTURE] Already capturing, stop first');
        return false;
    }
    if (!hasPacketCapturePrivileges()) {
        console.error('[CAPTURE] Capture requires CAP_NET_RAW on Linux');
        return false;
    }

    let captureOpened = false;
    try {
        capSession = new Cap();
        captureFilter = filter;
        onPacket = callback;
        packetCounter = 0;
        recentPackets.length = 0;
        srcIpCounts.clear();
        dstIpCounts.clear();
        captureStats = {
            totalPackets: 0,
            totalBytes: 0,
            startTime: new Date().toISOString(),
            protocols: {},
            topSrcIps: [],
            topDstIps: [],
            ipInsights: [],
        };

        // Build BPF filter string
        let bpfFilter = 'ip';
        if (filter.protocol && filter.protocol !== 'all') {
            bpfFilter = filter.protocol.toLowerCase();
        }
        if (filter.port) {
            bpfFilter += ` port ${filter.port}`;
        }

        const device = findDevice(interfaceAddress);
        if (!device) {
            console.error('[CAPTURE] Could not resolve the requested network interface');
            resetCaptureState(false);
            return false;
        }

        const bufSize = 10 * 1024 * 1024; // 10MB buffer
        const snapLen = 65535;
        const buffer = Buffer.alloc(snapLen);

        capSession.open(device, bpfFilter, bufSize, buffer);
        captureOpened = true;
        capSession.setMinBytes && capSession.setMinBytes(0);

        const linkType = capSession.linkType;

        capSession.on('packet', (nbytes: number) => {
            const raw = buffer.slice(0, nbytes);

            try {
                let ethSize = 0;
                // ETHERNET or undefined (Wi-Fi on Windows can report undefined)
                if (linkType === 'ETHERNET' || linkType === undefined || linkType === null) {
                    try {
                        const ethInfo = decoders.Ethernet(raw);
                        if (ethInfo.info.type !== 0x0800) { return; } // Only IPv4
                        ethSize = ethInfo.offset;
                    } catch {
                        // Not ethernet-framed, try raw IPv4
                        ethSize = 0;
                    }
                }

                const ipInfo = decoders.IPV4(raw, ethSize);
                const ip = ipInfo.info;

                let srcPort: number | null = null;
                let dstPort: number | null = null;
                const protocolName = getProtocolName(ip.protocol);

                if (ip.protocol === 6) { // TCP
                    const tcpInfo = decoders.TCP(raw, ipInfo.offset);
                    srcPort = tcpInfo.info.srcport;
                    dstPort = tcpInfo.info.dstport;
                } else if (ip.protocol === 17) { // UDP
                    const udpInfo = decoders.UDP(raw, ipInfo.offset);
                    srcPort = udpInfo.info.srcport;
                    dstPort = udpInfo.info.dstport;
                }

                const packet: PacketMeta = {
                    id: ++packetCounter,
                    timestamp: new Date().toISOString(),
                    srcIp: ip.srcaddr,
                    dstIp: ip.dstaddr,
                    srcPort,
                    dstPort,
                    protocol: protocolName,
                    length: ip.totallen,
                    ttl: ip.ttl,
                    srcGeo: lookupGeo(ip.srcaddr),
                    dstGeo: lookupGeo(ip.dstaddr),
                    severity: classifySeverity({ protocol: protocolName, dstPort, srcPort }),
                };

                // Apply user filter (extra filtering beyond BPF)
                if (!matchesFilter(packet, captureFilter)) return;

                // Store in recent buffer
                recentPackets.push(packet);
                if (recentPackets.length > MAX_RECENT) {
                    recentPackets.shift();
                }

                // Update stats
                updateStats(packet);

                // Emit to callback
                if (onPacket) onPacket(packet);
            } catch (e: any) {
                // Malformed packet, skip silently
            }
        });

        isCapturing = true;
        console.log(`[CAPTURE] Started | protocol filter: ${filter.protocol || 'all'} | linkType: ${linkType || 'unknown'}`);
        return true;
    } catch (err) {
        console.error('[CAPTURE] Failed to start:', err);
        resetCaptureState(captureOpened);
        return false;
    }
}

/**
 * Stop packet capture
 */
export function stopCapture(): void {
    if (capSession && isCapturing) {
        rebuildIpStats();
        resetCaptureState();
        console.log('[CAPTURE] Stopped');
    }
}

/**
 * Get capture status
 */
export function getCaptureStatus(): { isCapturing: boolean; stats: CaptureStats } {
    if (captureStats.totalPackets > 0) rebuildIpStats();
    return { isCapturing, stats: captureStats };
}

/**
 * Get recent captured packets
 */
export function getRecentPackets(limit: number = 100): PacketMeta[] {
    return recentPackets.slice(-limit);
}

/**
 * Update filter without restarting capture
 */
export function updateFilter(filter: CaptureFilter): void {
    captureFilter = filter;
}

/**
 * Export packets as JSON
 */
export function exportJSON(limit?: number): string {
    const data = limit ? recentPackets.slice(-limit) : recentPackets;
    return JSON.stringify(data, null, 2);
}

/**
 * Export packets as CSV
 */
export function exportCSV(limit?: number): string {
    const data = limit ? recentPackets.slice(-limit) : recentPackets;
    const header = 'id,timestamp,srcIp,srcPort,dstIp,dstPort,protocol,length,ttl,severity,srcCountry,srcCity,dstCountry,dstCity';
    const rows = data.map(p =>
        `${p.id},${p.timestamp},${p.srcIp},${p.srcPort ?? ''},${p.dstIp},${p.dstPort ?? ''},${p.protocol},${p.length},${p.ttl},${p.severity},${p.srcGeo?.country ?? ''},${p.srcGeo?.city ?? ''},${p.dstGeo?.country ?? ''},${p.dstGeo?.city ?? ''}`
    );
    return [header, ...rows].join('\n');
}

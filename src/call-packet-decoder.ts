import { isIP } from 'node:net';
import {
    parseStunMessage,
    parseTurnChannelData,
    type ParsedStunMessage,
    type TurnChannelData,
} from './stun-parser.js';
import type { CallProtocolEvidence } from './call-analyzer.js';

export interface DecodedCallPacket {
    srcIp: string;
    dstIp: string;
    srcPort: number;
    dstPort: number;
    protocol: 6 | 17;
    addressFamily: 4 | 6;
    frameLength: number;
    length: number;
    payloadLength: number;
    protocolEvidence: CallProtocolEvidence[];
    stun: ParsedStunMessage | null;
    turnChannelData: TurnChannelData | null;
}

export type CallPacketDecodeResult =
    | { status: 'decoded'; packet: DecodedCallPacket }
    | { status: 'unsupported'; reason: CallPacketUnsupportedReason }
    | { status: 'malformed'; reason: CallPacketMalformedReason };

export type CallPacketUnsupportedReason =
    | 'link_type'
    | 'ether_type'
    | 'network_protocol'
    | 'transport_protocol'
    | 'fragmented_packet'
    | 'encrypted_ipv6_extension';

export type CallPacketMalformedReason =
    | 'empty_frame'
    | 'truncated_ethernet'
    | 'truncated_vlan'
    | 'invalid_ip_version'
    | 'truncated_ipv4'
    | 'invalid_ipv4_header'
    | 'invalid_ipv4_length'
    | 'truncated_ipv6'
    | 'invalid_ipv6_length'
    | 'invalid_ipv6_extension'
    | 'too_many_ipv6_extensions'
    | 'truncated_udp'
    | 'invalid_udp_length'
    | 'truncated_tcp'
    | 'invalid_tcp_header';

const ETHERNET_HEADER_BYTES = 14;
const IPV4_ETHERTYPE = 0x0800;
const IPV6_ETHERTYPE = 0x86dd;
const VLAN_ETHERTYPES = new Set([0x8100, 0x88a8, 0x9100]);
const MAX_VLAN_HEADERS = 2;
const MAX_IPV6_EXTENSION_HEADERS = 8;

function readUInt16(bytes: Uint8Array, offset: number): number {
    return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function formatIPv4(bytes: Uint8Array, offset: number): string {
    return `${bytes[offset]}.${bytes[offset + 1]}.${bytes[offset + 2]}.${bytes[offset + 3]}`;
}

function formatIPv6(bytes: Uint8Array, offset: number): string {
    const groups: string[] = [];
    for (let index = 0; index < 16; index += 2) {
        groups.push(((bytes[offset + index]! << 8) | bytes[offset + index + 1]!).toString(16));
    }
    return groups.join(':');
}

function parseTransport(
    frame: Uint8Array,
    transportOffset: number,
    packetEnd: number,
    protocol: number,
    network: Omit<DecodedCallPacket, 'srcPort' | 'dstPort' | 'payloadLength' | 'protocolEvidence' | 'stun' | 'turnChannelData'>,
): CallPacketDecodeResult {
    let srcPort: number;
    let dstPort: number;
    let payloadStart: number;
    let payloadEnd = packetEnd;

    if (protocol === 17) {
        if (transportOffset + 8 > packetEnd) return { status: 'malformed', reason: 'truncated_udp' };
        srcPort = readUInt16(frame, transportOffset);
        dstPort = readUInt16(frame, transportOffset + 2);
        const udpLength = readUInt16(frame, transportOffset + 4);
        if (udpLength < 8 || transportOffset + udpLength > packetEnd) {
            return { status: 'malformed', reason: 'invalid_udp_length' };
        }
        payloadStart = transportOffset + 8;
        payloadEnd = transportOffset + udpLength;
    } else if (protocol === 6) {
        if (transportOffset + 20 > packetEnd) return { status: 'malformed', reason: 'truncated_tcp' };
        srcPort = readUInt16(frame, transportOffset);
        dstPort = readUInt16(frame, transportOffset + 2);
        const tcpHeaderBytes = (frame[transportOffset + 12]! >> 4) * 4;
        if (tcpHeaderBytes < 20 || transportOffset + tcpHeaderBytes > packetEnd) {
            return { status: 'malformed', reason: 'invalid_tcp_header' };
        }
        payloadStart = transportOffset + tcpHeaderBytes;
    } else {
        return { status: 'unsupported', reason: 'transport_protocol' };
    }

    if (srcPort < 1 || dstPort < 1) return { status: 'malformed', reason: protocol === 17 ? 'invalid_udp_length' : 'invalid_tcp_header' };
    const payload = frame.subarray(payloadStart, payloadEnd);
    const stunResult = parseStunMessage(payload);
    const stun = stunResult.status === 'parsed' ? stunResult.message : null;
    const channelResult = stun ? null : parseTurnChannelData(payload);
    const turnChannelData = channelResult?.status === 'parsed' ? channelResult.channelData : null;
    const protocolEvidence = new Set<CallProtocolEvidence>(['transport_flow']);
    if (stun) protocolEvidence.add(stun.protocolEvidence);
    if (network.frameLength === 86) protocolEvidence.add('frame_length_86');

    return {
        status: 'decoded',
        packet: {
            ...network,
            protocol: protocol as 6 | 17,
            srcPort,
            dstPort,
            payloadLength: payload.length,
            protocolEvidence: [...protocolEvidence],
            stun,
            turnChannelData,
        },
    };
}

function decodeIPv4(frame: Uint8Array, offset: number): CallPacketDecodeResult {
    if (offset + 20 > frame.length) return { status: 'malformed', reason: 'truncated_ipv4' };
    if ((frame[offset]! >> 4) !== 4) return { status: 'malformed', reason: 'invalid_ip_version' };
    const headerBytes = (frame[offset]! & 0x0f) * 4;
    if (headerBytes < 20 || offset + headerBytes > frame.length) {
        return { status: 'malformed', reason: 'invalid_ipv4_header' };
    }
    const totalLength = readUInt16(frame, offset + 2);
    if (totalLength < headerBytes || offset + totalLength > frame.length) {
        return { status: 'malformed', reason: 'invalid_ipv4_length' };
    }
    const fragmentField = readUInt16(frame, offset + 6);
    if ((fragmentField & 0x3fff) !== 0) return { status: 'unsupported', reason: 'fragmented_packet' };
    const srcIp = formatIPv4(frame, offset + 12);
    const dstIp = formatIPv4(frame, offset + 16);
    if (isIP(srcIp) !== 4 || isIP(dstIp) !== 4) return { status: 'malformed', reason: 'invalid_ipv4_header' };
    const protocol = frame[offset + 9]!;
    return parseTransport(frame, offset + headerBytes, offset + totalLength, protocol, {
        srcIp,
        dstIp,
        protocol: protocol as 6 | 17,
        addressFamily: 4,
        frameLength: frame.length,
        length: totalLength,
    });
}

function decodeIPv6(frame: Uint8Array, offset: number): CallPacketDecodeResult {
    if (offset + 40 > frame.length) return { status: 'malformed', reason: 'truncated_ipv6' };
    if ((frame[offset]! >> 4) !== 6) return { status: 'malformed', reason: 'invalid_ip_version' };
    const payloadLength = readUInt16(frame, offset + 4);
    if (payloadLength === 0 || offset + 40 + payloadLength > frame.length) {
        return { status: 'malformed', reason: 'invalid_ipv6_length' };
    }
    const packetEnd = offset + 40 + payloadLength;
    const srcIp = formatIPv6(frame, offset + 8);
    const dstIp = formatIPv6(frame, offset + 24);
    if (isIP(srcIp) !== 6 || isIP(dstIp) !== 6) return { status: 'malformed', reason: 'truncated_ipv6' };

    let nextHeader = frame[offset + 6]!;
    let transportOffset = offset + 40;
    let extensionCount = 0;
    while ([0, 43, 44, 50, 51, 60, 135].includes(nextHeader)) {
        extensionCount += 1;
        if (extensionCount > MAX_IPV6_EXTENSION_HEADERS) {
            return { status: 'malformed', reason: 'too_many_ipv6_extensions' };
        }
        if (nextHeader === 50) return { status: 'unsupported', reason: 'encrypted_ipv6_extension' };
        if (nextHeader === 44) return { status: 'unsupported', reason: 'fragmented_packet' };
        if (transportOffset + 2 > packetEnd) return { status: 'malformed', reason: 'invalid_ipv6_extension' };
        const followingHeader = frame[transportOffset]!;
        const extensionBytes = nextHeader === 51
            ? (frame[transportOffset + 1]! + 2) * 4
            : (frame[transportOffset + 1]! + 1) * 8;
        if (extensionBytes < 8 || transportOffset + extensionBytes > packetEnd) {
            return { status: 'malformed', reason: 'invalid_ipv6_extension' };
        }
        nextHeader = followingHeader;
        transportOffset += extensionBytes;
    }

    if (nextHeader === 59) return { status: 'unsupported', reason: 'network_protocol' };
    return parseTransport(frame, transportOffset, packetEnd, nextHeader, {
        srcIp,
        dstIp,
        protocol: nextHeader as 6 | 17,
        addressFamily: 6,
        frameLength: frame.length,
        length: 40 + payloadLength,
    });
}

export function decodeCallPacketFrame(frame: unknown, linkType: unknown): CallPacketDecodeResult {
    if (!(frame instanceof Uint8Array) || frame.length === 0) {
        return { status: 'malformed', reason: 'empty_frame' };
    }

    let networkOffset = 0;
    let etherType: number | null = null;
    if (linkType === 'ETHERNET') {
        if (frame.length < ETHERNET_HEADER_BYTES) return { status: 'malformed', reason: 'truncated_ethernet' };
        networkOffset = ETHERNET_HEADER_BYTES;
        etherType = readUInt16(frame, 12);
        let vlanHeaders = 0;
        while (VLAN_ETHERTYPES.has(etherType) && vlanHeaders < MAX_VLAN_HEADERS) {
            if (networkOffset + 4 > frame.length) return { status: 'malformed', reason: 'truncated_vlan' };
            etherType = readUInt16(frame, networkOffset + 2);
            networkOffset += 4;
            vlanHeaders += 1;
        }
        if (VLAN_ETHERTYPES.has(etherType)) return { status: 'unsupported', reason: 'ether_type' };
    } else if (linkType !== 'RAW') {
        return { status: 'unsupported', reason: 'link_type' };
    }

    if (etherType === IPV4_ETHERTYPE || (etherType === null && (frame[networkOffset]! >> 4) === 4)) {
        return decodeIPv4(frame, networkOffset);
    }
    if (etherType === IPV6_ETHERTYPE || (etherType === null && (frame[networkOffset]! >> 4) === 6)) {
        return decodeIPv6(frame, networkOffset);
    }
    return { status: 'unsupported', reason: etherType === null ? 'network_protocol' : 'ether_type' };
}

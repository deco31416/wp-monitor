import { isIP } from 'node:net';
import type { SanitizedCallEndpoint } from './call-analyzer.js';

type UnknownRecord = Record<string, unknown>;

export interface CallTransportObservation {
    callId: string;
    observedAt: Date;
    action: 'transport' | 'relaylatency';
    peerNegotiationObserved: boolean;
    relayNegotiationObserved: boolean;
    keepaliveObserved: boolean;
    candidateRound: number | null;
    endpoints: SanitizedCallEndpoint[];
    limitations: string[];
}

export interface CallTransportObserverOptions {
    now?: () => Date;
    maxNodes?: number;
    maxDepth?: number;
    maxEndpoints?: number;
}

const CALL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,119}$/;
const SAFE_RELAY_NAME_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/;
const SENSITIVE_TAGS = new Set(['token', 'auth_token', 'key', 'hbh_key', 'relay_key']);

function asRecord(value: unknown): UnknownRecord | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as UnknownRecord
        : null;
}

function readTag(node: UnknownRecord): string {
    return typeof node.tag === 'string' ? node.tag : '';
}

function readAttrs(node: UnknownRecord): UnknownRecord {
    return asRecord(node.attrs) ?? {};
}

function readBoundedAttr(attrs: UnknownRecord, key: string, maximum: number): string | null {
    const value = attrs[key];
    return typeof value === 'string' && value.length > 0 && value.length <= maximum ? value : null;
}

function readChildren(node: UnknownRecord): UnknownRecord[] {
    if (!Array.isArray(node.content)) return [];
    return node.content.map(asRecord).filter((child): child is UnknownRecord => child !== null);
}

function readBytes(node: UnknownRecord): Uint8Array | null {
    const content = node.content;
    if (Buffer.isBuffer(content)) return content;
    return content instanceof Uint8Array ? content : null;
}

function parseObservedAt(attrs: UnknownRecord, now: () => Date): Date {
    const timestamp = readBoundedAttr(attrs, 't', 20);
    if (!timestamp || !/^\d{1,13}$/.test(timestamp)) return now();
    const numeric = Number(timestamp);
    if (!Number.isSafeInteger(numeric)) return now();
    const milliseconds = timestamp.length <= 10 ? numeric * 1_000 : numeric;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? now() : date;
}

function parseCandidateRound(attrs: UnknownRecord): number | null {
    const value = readBoundedAttr(attrs, 'p2p-cand-round', 10);
    if (!value || !/^\d+$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 1_000_000 ? parsed : null;
}

function formatIPv6(bytes: Uint8Array): string {
    const groups: string[] = [];
    for (let offset = 0; offset < 16; offset += 2) {
        groups.push(((bytes[offset]! << 8) | bytes[offset + 1]!).toString(16));
    }
    return groups.join(':');
}

function parsePackedEndpoint(
    node: UnknownRecord,
    role: SanitizedCallEndpoint['role'],
): SanitizedCallEndpoint | null {
    const bytes = readBytes(node);
    if (!bytes || (bytes.length !== 6 && bytes.length !== 18)) return null;

    const addressFamily = bytes.length === 6 ? 4 : 6;
    const ip = addressFamily === 4
        ? `${bytes[0]}.${bytes[1]}.${bytes[2]}.${bytes[3]}`
        : formatIPv6(bytes.subarray(0, 16));
    if (isIP(ip) !== addressFamily) return null;

    const portOffset = bytes.length - 2;
    const port = (bytes[portOffset]! << 8) | bytes[portOffset + 1]!;
    if (port < 1 || port > 65_535) return null;

    const attrs = readAttrs(node);
    const relayNameValue = readBoundedAttr(attrs, 'relay_name', 80);
    const relayName = relayNameValue && SAFE_RELAY_NAME_PATTERN.test(relayNameValue)
        ? relayNameValue
        : null;
    const rttValue = readBoundedAttr(attrs, 'c2r_rtt', 10);
    const rttMs = rttValue && /^\d+$/.test(rttValue) ? Number(rttValue) : null;

    return {
        ip,
        port,
        addressFamily,
        role,
        source: 'baileys_transport',
        ...(relayName ? { relayName } : {}),
        ...(rttMs !== null && Number.isSafeInteger(rttMs) && rttMs <= 600_000 ? { rttMs } : {}),
    };
}

function collectEndpointNodes(
    root: UnknownRecord,
    options: Required<Pick<CallTransportObserverOptions, 'maxNodes' | 'maxDepth'>>,
    includeLatencyEndpoint: boolean,
): { nodes: UnknownRecord[]; truncated: boolean; sensitiveNodesSkipped: boolean } {
    const result: UnknownRecord[] = [];
    const queue: Array<{ node: UnknownRecord; depth: number }> = [{ node: root, depth: 0 }];
    let visited = 0;
    let truncated = false;
    let sensitiveNodesSkipped = false;

    while (queue.length > 0) {
        const current = queue.shift()!;
        visited += 1;
        if (visited > options.maxNodes) {
            truncated = true;
            break;
        }
        const tag = readTag(current.node);
        if (SENSITIVE_TAGS.has(tag)) {
            sensitiveNodesSkipped = true;
            continue;
        }
        if (tag === 'te2' || (includeLatencyEndpoint && tag === 'te')) result.push(current.node);
        if (current.depth >= options.maxDepth) {
            if (readChildren(current.node).length > 0) truncated = true;
            continue;
        }
        for (const child of readChildren(current.node)) {
            queue.push({ node: child, depth: current.depth + 1 });
        }
    }

    return { nodes: result, truncated, sensitiveNodesSkipped };
}

export function observeCallTransportNode(
    value: unknown,
    options: CallTransportObserverOptions = {},
): CallTransportObservation | null {
    const root = asRecord(value);
    if (!root || readTag(root) !== 'call') return null;
    const actionNode = readChildren(root)[0];
    if (!actionNode) return null;
    const action = readTag(actionNode);
    if (action !== 'transport' && action !== 'relaylatency') return null;

    const attrs = readAttrs(actionNode);
    const callId = readBoundedAttr(attrs, 'call-id', 120);
    if (!callId || !CALL_ID_PATTERN.test(callId)) return null;

    const messageType = readBoundedAttr(attrs, 'transport-message-type', 8);
    const peerNegotiationObserved = action === 'transport' && messageType === '3';
    const relayNegotiationObserved = action === 'relaylatency' || (action === 'transport' && messageType === '1');
    const keepaliveObserved = action === 'transport' && messageType === '9';
    const limitations: string[] = [];
    if (action === 'transport' && messageType && !['1', '3', '9'].includes(messageType)) {
        limitations.push('unknown_transport_message_type');
    }
    if (peerNegotiationObserved && readChildren(actionNode).some(child => readTag(child) === 'te')) {
        limitations.push('peer_candidate_payload_not_decoded');
    }

    const limits = {
        maxNodes: Math.min(Math.max(options.maxNodes ?? 256, 1), 1_024),
        maxDepth: Math.min(Math.max(options.maxDepth ?? 8, 1), 16),
    };
    const collected = collectEndpointNodes(actionNode, limits, action === 'relaylatency');
    if (collected.truncated) limitations.push('node_traversal_truncated');
    if (collected.sensitiveNodesSkipped) limitations.push('sensitive_fields_excluded');

    const maxEndpoints = Math.min(Math.max(options.maxEndpoints ?? 32, 1), 128);
    const endpoints: SanitizedCallEndpoint[] = [];
    let malformedEndpoint = false;
    for (const endpointNode of collected.nodes) {
        if (endpoints.length >= maxEndpoints) {
            limitations.push('endpoint_list_truncated');
            break;
        }
        const endpoint = parsePackedEndpoint(endpointNode, 'relay');
        if (endpoint) endpoints.push(endpoint);
        else malformedEndpoint = true;
    }
    if (malformedEndpoint) limitations.push('malformed_endpoint_skipped');

    const now = options.now ?? (() => new Date());
    return {
        callId,
        observedAt: parseObservedAt(readAttrs(root), now),
        action,
        peerNegotiationObserved,
        relayNegotiationObserved,
        keepaliveObserved,
        candidateRound: parseCandidateRound(attrs),
        endpoints,
        limitations: Array.from(new Set(limitations)),
    };
}

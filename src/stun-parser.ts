import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

export type StunMessageClass = 'request' | 'indication' | 'success_response' | 'error_response';

export type StunMethod =
    | 'binding'
    | 'allocate'
    | 'refresh'
    | 'send'
    | 'data'
    | 'create_permission'
    | 'channel_bind'
    | 'connect'
    | 'connection_bind'
    | 'connection_attempt'
    | 'unknown';

export type StunEndpointRole = 'own_public_endpoint' | 'peer_candidate' | 'relay' | 'stun_turn';

export interface ParsedStunEndpoint {
    ip: string;
    port: number;
    addressFamily: 4 | 6;
    role: StunEndpointRole;
    attribute: StunAddressAttribute;
}

export type StunAddressAttribute =
    | 'mapped_address'
    | 'xor_mapped_address'
    | 'xor_peer_address'
    | 'xor_relayed_address'
    | 'alternate_server'
    | 'response_origin'
    | 'other_address';

export interface ParsedStunMessage {
    messageClass: StunMessageClass;
    method: StunMethod;
    methodCode: number;
    messageType: number;
    transactionFingerprint: string;
    endpoints: ParsedStunEndpoint[];
    attributeCount: number;
    ignoredAttributeCount: number;
    unknownAttributeCount: number;
    protocolEvidence: 'stun_binding_request' | 'stun_binding_response' | 'stun_other';
    limitations: string[];
}

export type StunParseResult =
    | { status: 'parsed'; message: ParsedStunMessage }
    | { status: 'not_stun' }
    | { status: 'malformed'; reason: StunMalformedReason };

export type StunMalformedReason =
    | 'message_too_large'
    | 'truncated_header'
    | 'invalid_message_type'
    | 'invalid_message_length'
    | 'truncated_message'
    | 'trailing_bytes'
    | 'too_many_attributes'
    | 'truncated_attribute'
    | 'invalid_address_attribute';

const STUN_HEADER_BYTES = 20;
const STUN_MAGIC_COOKIE = 0x2112a442;
const MAX_STUN_MESSAGE_BYTES = STUN_HEADER_BYTES + 65_532;
const MAX_ATTRIBUTES = 128;

const ADDRESS_ATTRIBUTES = new Map<number, {
    name: StunAddressAttribute;
    role: StunEndpointRole;
    xor: boolean;
    allowZeroPort?: boolean;
}>([
    [0x0001, { name: 'mapped_address', role: 'own_public_endpoint', xor: false }],
    [0x0012, { name: 'xor_peer_address', role: 'peer_candidate', xor: true, allowZeroPort: true }],
    [0x0016, { name: 'xor_relayed_address', role: 'relay', xor: true }],
    [0x0020, { name: 'xor_mapped_address', role: 'own_public_endpoint', xor: true }],
    [0x8023, { name: 'alternate_server', role: 'stun_turn', xor: false }],
    [0x802b, { name: 'response_origin', role: 'stun_turn', xor: false }],
    [0x802c, { name: 'other_address', role: 'stun_turn', xor: false }],
]);

const METHODS = new Map<number, StunMethod>([
    [0x001, 'binding'],
    [0x003, 'allocate'],
    [0x004, 'refresh'],
    [0x006, 'send'],
    [0x007, 'data'],
    [0x008, 'create_permission'],
    [0x009, 'channel_bind'],
    [0x00a, 'connect'],
    [0x00b, 'connection_bind'],
    [0x00c, 'connection_attempt'],
]);

// Standard attributes whose payload is deliberately not retained. This set
// distinguishes understood-but-unneeded data from genuinely unknown protocol
// extensions without exposing credentials, integrity material or media data.
const KNOWN_IGNORED_ATTRIBUTES = new Set([
    0x0006, // USERNAME
    0x0008, // MESSAGE-INTEGRITY
    0x0009, // ERROR-CODE
    0x000a, // UNKNOWN-ATTRIBUTES
    0x000c, // CHANNEL-NUMBER
    0x000d, // LIFETIME
    0x0013, // DATA
    0x0014, // REALM
    0x0015, // NONCE
    0x0017, // REQUESTED-ADDRESS-FAMILY
    0x0018, // EVEN-PORT
    0x0019, // REQUESTED-TRANSPORT
    0x001a, // DONT-FRAGMENT
    0x001b, // ACCESS-TOKEN
    0x001c, // MESSAGE-INTEGRITY-SHA256
    0x001d, // PASSWORD-ALGORITHM
    0x001e, // USERHASH
    0x0022, // RESERVATION-TOKEN
    0x0024, // PRIORITY
    0x0025, // USE-CANDIDATE
    0x0026, // PADDING
    0x0027, // RESPONSE-PORT
    0x002a, // CONNECTION-ID
    0x8000, // ADDITIONAL-ADDRESS-FAMILY
    0x8001, // ADDRESS-ERROR-CODE
    0x8002, // PASSWORD-ALGORITHMS
    0x8003, // ALTERNATE-DOMAIN
    0x8004, // ICMP
    0x8022, // SOFTWARE
    0x8028, // FINGERPRINT
    0x8029, // ICE-CONTROLLED
    0x802a, // ICE-CONTROLLING
    0x802d, // ECN-CHECK
    0x802e, // THIRD-PARTY-AUTHORIZATION
    0x8030, // MOBILITY-TICKET
]);

function readUInt16(bytes: Uint8Array, offset: number): number {
    return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function readUInt32(bytes: Uint8Array, offset: number): number {
    return (
        (bytes[offset]! * 0x1000000)
        + (bytes[offset + 1]! << 16)
        + (bytes[offset + 2]! << 8)
        + bytes[offset + 3]!
    ) >>> 0;
}

function decodeMessageClass(messageType: number): StunMessageClass {
    const value = ((messageType >> 4) & 0x1) | ((messageType >> 7) & 0x2);
    return ['request', 'indication', 'success_response', 'error_response'][value] as StunMessageClass;
}

function decodeMethodCode(messageType: number): number {
    return (messageType & 0x000f)
        | ((messageType & 0x00e0) >> 1)
        | ((messageType & 0x3e00) >> 2);
}

function formatIPv6(bytes: Uint8Array): string {
    const groups: string[] = [];
    for (let offset = 0; offset < 16; offset += 2) {
        groups.push(((bytes[offset]! << 8) | bytes[offset + 1]!).toString(16));
    }
    return groups.join(':');
}

function decodeAddressAttribute(
    value: Uint8Array,
    definition: { name: StunAddressAttribute; role: StunEndpointRole; xor: boolean; allowZeroPort?: boolean },
    transactionId: Uint8Array,
): ParsedStunEndpoint | null {
    if (value.length !== 8 && value.length !== 20) return null;
    if (value[0] !== 0) return null;
    const family = value[1] === 0x01 ? 4 : value[1] === 0x02 ? 6 : 0;
    if (family === 0 || value.length !== (family === 4 ? 8 : 20)) return null;

    const encodedPort = readUInt16(value, 2);
    const port = definition.xor ? encodedPort ^ (STUN_MAGIC_COOKIE >>> 16) : encodedPort;
    if ((!definition.allowZeroPort && port < 1) || port > 65_535) return null;

    const addressBytes = Uint8Array.from(value.subarray(4));
    if (definition.xor) {
        const mask = new Uint8Array(16);
        mask[0] = 0x21;
        mask[1] = 0x12;
        mask[2] = 0xa4;
        mask[3] = 0x42;
        mask.set(transactionId, 4);
        for (let index = 0; index < addressBytes.length; index += 1) {
            addressBytes[index] = addressBytes[index]! ^ mask[index]!;
        }
    }

    const ip = family === 4
        ? `${addressBytes[0]}.${addressBytes[1]}.${addressBytes[2]}.${addressBytes[3]}`
        : formatIPv6(addressBytes);
    if (isIP(ip) !== family) return null;
    return {
        ip,
        port,
        addressFamily: family,
        role: definition.role,
        attribute: definition.name,
    };
}

function protocolEvidence(
    method: StunMethod,
    messageClass: StunMessageClass,
): ParsedStunMessage['protocolEvidence'] {
    if (method !== 'binding') return 'stun_other';
    if (messageClass === 'request') return 'stun_binding_request';
    if (messageClass === 'success_response' || messageClass === 'error_response') {
        return 'stun_binding_response';
    }
    return 'stun_other';
}

export function parseStunMessage(input: unknown): StunParseResult {
    if (!(input instanceof Uint8Array)) return { status: 'not_stun' };
    if (input.byteLength > MAX_STUN_MESSAGE_BYTES) return { status: 'malformed', reason: 'message_too_large' };
    if (input.byteLength < 8) return { status: 'not_stun' };
    if (readUInt32(input, 4) !== STUN_MAGIC_COOKIE) return { status: 'not_stun' };
    if (input.byteLength < STUN_HEADER_BYTES) return { status: 'malformed', reason: 'truncated_header' };

    const messageType = readUInt16(input, 0);
    if ((messageType & 0xc000) !== 0) return { status: 'malformed', reason: 'invalid_message_type' };
    const messageLength = readUInt16(input, 2);
    if (messageLength % 4 !== 0) return { status: 'malformed', reason: 'invalid_message_length' };
    const declaredBytes = STUN_HEADER_BYTES + messageLength;
    if (input.byteLength < declaredBytes) return { status: 'malformed', reason: 'truncated_message' };
    if (input.byteLength > declaredBytes) return { status: 'malformed', reason: 'trailing_bytes' };

    const transactionId = input.subarray(8, 20);
    const transactionFingerprint = createHash('sha256')
        .update('stun-transaction\0')
        .update(transactionId)
        .digest('hex');
    const messageClass = decodeMessageClass(messageType);
    const methodCode = decodeMethodCode(messageType);
    const method = METHODS.get(methodCode) ?? 'unknown';
    const endpoints = new Map<string, ParsedStunEndpoint>();
    const limitations = new Set<string>();
    let attributeCount = 0;
    let ignoredAttributeCount = 0;
    let unknownAttributeCount = 0;
    let offset = STUN_HEADER_BYTES;

    while (offset < declaredBytes) {
        attributeCount += 1;
        if (attributeCount > MAX_ATTRIBUTES) return { status: 'malformed', reason: 'too_many_attributes' };
        if (offset + 4 > declaredBytes) return { status: 'malformed', reason: 'truncated_attribute' };
        const attributeType = readUInt16(input, offset);
        const attributeLength = readUInt16(input, offset + 2);
        const valueStart = offset + 4;
        const valueEnd = valueStart + attributeLength;
        if (valueEnd > declaredBytes) return { status: 'malformed', reason: 'truncated_attribute' };

        const definition = ADDRESS_ATTRIBUTES.get(attributeType);
        if (definition) {
            const endpoint = decodeAddressAttribute(input.subarray(valueStart, valueEnd), definition, transactionId);
            if (!endpoint) return { status: 'malformed', reason: 'invalid_address_attribute' };
            endpoints.set(
                `${endpoint.ip}\0${endpoint.port}\0${endpoint.role}\0${endpoint.attribute}`,
                endpoint,
            );
        } else if (KNOWN_IGNORED_ATTRIBUTES.has(attributeType)) {
            ignoredAttributeCount += 1;
        } else {
            unknownAttributeCount += 1;
            if (attributeType < 0x8000) limitations.add('unknown_required_attribute_skipped');
        }

        const paddedLength = (attributeLength + 3) & ~3;
        offset = valueStart + paddedLength;
        if (offset > declaredBytes) return { status: 'malformed', reason: 'truncated_attribute' };
    }

    if (method === 'unknown') limitations.add('unknown_stun_method');
    return {
        status: 'parsed',
        message: {
            messageClass,
            method,
            methodCode,
            messageType,
            transactionFingerprint,
            endpoints: [...endpoints.values()],
            attributeCount,
            ignoredAttributeCount,
            unknownAttributeCount,
            protocolEvidence: protocolEvidence(method, messageClass),
            limitations: [...limitations],
        },
    };
}

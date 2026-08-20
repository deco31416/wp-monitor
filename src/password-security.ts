import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const PASSWORD_HASH_SCHEME = 'scrypt';
const PASSWORD_HASH_VERSION = 1;
const SCRYPT_COST = 131_072;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_MAX_MEMORY = 256 * 1024 * 1024;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_HASH_BYTES = 64;

export const MIN_PASSWORD_LENGTH = 15;
export const MAX_PASSWORD_LENGTH = 128;
export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 64;

export interface ValidatedUsername {
    username: string;
    normalizedUsername: string;
}

function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        scrypt(password, salt, PASSWORD_HASH_BYTES, {
            N: SCRYPT_COST,
            r: SCRYPT_BLOCK_SIZE,
            p: SCRYPT_PARALLELIZATION,
            maxmem: SCRYPT_MAX_MEMORY,
        }, (error, derivedKey) => {
            if (error) reject(error);
            else resolve(derivedKey);
        });
    });
}

export function validateUsername(value: unknown): ValidatedUsername | null {
    if (typeof value !== 'string') return null;
    const username = value.trim().normalize('NFKC');
    if (username.length < MIN_USERNAME_LENGTH || username.length > MAX_USERNAME_LENGTH) return null;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*[a-zA-Z0-9]$/.test(username)) return null;
    return {
        username,
        normalizedUsername: username.toLocaleLowerCase('en-US'),
    };
}

export function validatePassword(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    const characterLength = Array.from(value).length;
    return characterLength >= MIN_PASSWORD_LENGTH
        && characterLength <= MAX_PASSWORD_LENGTH
        && Buffer.byteLength(value, 'utf8') <= 512;
}

export async function hashPassword(password: string): Promise<string> {
    if (!validatePassword(password)) throw new Error('Password does not satisfy the security policy');
    const salt = randomBytes(PASSWORD_SALT_BYTES);
    const derivedKey = await derivePassword(password, salt);
    return [
        PASSWORD_HASH_SCHEME,
        String(PASSWORD_HASH_VERSION),
        String(SCRYPT_COST),
        String(SCRYPT_BLOCK_SIZE),
        String(SCRYPT_PARALLELIZATION),
        salt.toString('base64url'),
        derivedKey.toString('base64url'),
    ].join('$');
}

interface ParsedPasswordHash {
    salt: Buffer;
    derivedKey: Buffer;
}

function parsePasswordHash(encodedHash: string): ParsedPasswordHash | null {
    const parts = encodedHash.split('$');
    if (parts.length !== 7) return null;
    const [scheme, version, cost, blockSize, parallelization, encodedSalt, encodedKey] = parts;
    if (scheme !== PASSWORD_HASH_SCHEME
        || version !== String(PASSWORD_HASH_VERSION)
        || cost !== String(SCRYPT_COST)
        || blockSize !== String(SCRYPT_BLOCK_SIZE)
        || parallelization !== String(SCRYPT_PARALLELIZATION)
        || !encodedSalt
        || !encodedKey) {
        return null;
    }

    try {
        const salt = Buffer.from(encodedSalt, 'base64url');
        const derivedKey = Buffer.from(encodedKey, 'base64url');
        if (salt.length !== PASSWORD_SALT_BYTES || derivedKey.length !== PASSWORD_HASH_BYTES) return null;
        return { salt, derivedKey };
    } catch {
        return null;
    }
}

export async function verifyPassword(password: unknown, encodedHash: unknown): Promise<boolean> {
    if (typeof password !== 'string' || typeof encodedHash !== 'string') return false;
    if (Buffer.byteLength(password, 'utf8') > 512) return false;
    const parsed = parsePasswordHash(encodedHash);
    if (!parsed) return false;

    try {
        const candidate = await derivePassword(password, parsed.salt);
        return timingSafeEqual(parsed.derivedKey, candidate);
    } catch {
        return false;
    }
}

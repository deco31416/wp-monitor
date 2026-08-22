import type { Request } from 'express';
import type { AuthPrincipal } from './operator-auth.js';

export const DEVELOPMENT_SESSION_COOKIE = 'wp_monitor_session';
export const PRODUCTION_SESSION_COOKIE = '__Host-wp_monitor_session';

export interface AuthenticatedRequest extends Request {
    authPrincipal?: AuthPrincipal;
    authSessionToken?: string;
}

export function getSessionCookieName(secure: boolean): string {
    return secure ? PRODUCTION_SESSION_COOKIE : DEVELOPMENT_SESSION_COOKIE;
}

export function extractCookieValue(cookieHeader: unknown, cookieName: string): string {
    if (typeof cookieHeader !== 'string' || !cookieHeader.trim()) return '';
    const matches: string[] = [];
    for (const entry of cookieHeader.split(';')) {
        const separator = entry.indexOf('=');
        if (separator < 1) continue;
        const name = entry.slice(0, separator).trim();
        if (name !== cookieName) continue;
        matches.push(entry.slice(separator + 1).trim());
    }
    if (matches.length !== 1) return '';
    return matches[0] || '';
}

export function extractSessionToken(request: Pick<Request, 'headers'>, secure: boolean): string {
    return extractCookieValue(request.headers.cookie, getSessionCookieName(secure));
}

export function isTrustedRequestOrigin(origin: unknown, allowedOrigins: string[]): boolean {
    if (typeof origin !== 'string' || !origin.trim()) return false;
    let normalized: string;
    try {
        normalized = new URL(origin).origin;
    } catch {
        return false;
    }
    return allowedOrigins.some(allowed => {
        try {
            return new URL(allowed).origin === normalized;
        } catch {
            return false;
        }
    });
}

export function requiresOriginProtection(method: string): boolean {
    return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

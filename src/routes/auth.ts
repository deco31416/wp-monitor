import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import {
    DEVELOPMENT_SESSION_COOKIE,
    PRODUCTION_SESSION_COOKIE,
    extractSessionToken,
    getSessionCookieName,
    isTrustedRequestOrigin,
    requiresOriginProtection,
    type AuthenticatedRequest,
} from '../access-control.js';
import {
    AuthServiceUnavailableError,
    LoginRateLimitError,
    type AuthPrincipal,
    type OperatorAuthService,
} from '../operator-auth.js';
import { getClientIp } from '../check-in-rate-limit.js';

export interface AuthRouteOptions {
    authService: Pick<OperatorAuthService, 'login' | 'authenticate' | 'logout' | 'changeCredentials'>;
    allowedOrigins: string[];
    secureCookies: boolean;
    onSessionRevoked?: (sessionFingerprint: string) => void;
    onCredentialsChanged?: () => void;
    recordAudit?: (action: 'operator_login' | 'operator_logout' | 'operator_credentials_changed', username: string) => Promise<void>;
}

function setNoStore(response: Response): void {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
}

function setSessionCookie(response: Response, secure: boolean, token: string, expiresAt: string): void {
    const expires = new Date(expiresAt);
    const maxAge = Math.max(0, expires.getTime() - Date.now());
    response.cookie(getSessionCookieName(secure), token, {
        httpOnly: true,
        secure,
        sameSite: 'strict',
        path: '/',
        expires,
        maxAge,
        priority: 'high',
    });
}

function clearSessionCookies(response: Response): void {
    for (const cookieName of [DEVELOPMENT_SESSION_COOKIE, PRODUCTION_SESSION_COOKIE]) {
        response.clearCookie(cookieName, {
            httpOnly: true,
            secure: cookieName === PRODUCTION_SESSION_COOKIE,
            sameSite: 'strict',
            path: '/',
            priority: 'high',
        });
    }
}

function trustedOriginOrReject(request: Request, response: Response, allowedOrigins: string[]): boolean {
    if (isTrustedRequestOrigin(request.headers.origin, allowedOrigins)) return true;
    response.status(403).json({ error: 'Request origin is not allowed' });
    return false;
}

async function resolvePrincipal(
    request: AuthenticatedRequest,
    options: AuthRouteOptions,
): Promise<AuthPrincipal | null> {
    const token = extractSessionToken(request, options.secureCookies);
    if (!token) return null;
    const principal = await options.authService.authenticate(token);
    if (principal) {
        request.authPrincipal = principal;
        request.authSessionToken = token;
    }
    return principal;
}

function recordAuditSafely(options: AuthRouteOptions, action: Parameters<NonNullable<AuthRouteOptions['recordAudit']>>[0], username: string): void {
    void options.recordAudit?.(action, username).catch(() => {
        console.error('[AUTH] Failed to record authentication audit event');
    });
}

function sendUnavailable(response: Response): void {
    response.setHeader('Retry-After', '5');
    response.status(503).json({ error: 'Authentication service unavailable. Try again later.' });
}

export function registerAuthRoutes(app: Express, options: AuthRouteOptions): void {
    app.post('/api/auth/login', async (request, response) => {
        setNoStore(response);
        if (!trustedOriginOrReject(request, response, options.allowedOrigins)) return;
        const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
            ? request.body as Record<string, unknown>
            : {};

        try {
            const result = await options.authService.login(body.username, body.password, getClientIp(request));
            if (!result) {
                response.status(401).json({ error: 'Invalid username or password' });
                return;
            }
            setSessionCookie(response, options.secureCookies, result.session.token, result.session.expiresAt);
            recordAuditSafely(options, 'operator_login', result.user.username);
            response.json({
                authenticated: true,
                username: result.user.username,
                expiresAt: result.session.expiresAt,
            });
        } catch (error) {
            if (error instanceof LoginRateLimitError) {
                response.setHeader('Retry-After', String(error.retryAfterSeconds));
                response.status(429).json({ error: 'Too many login attempts. Try again later.' });
                return;
            }
            sendUnavailable(response);
        }
    });

    app.get('/api/auth/session', async (request: AuthenticatedRequest, response) => {
        setNoStore(response);
        try {
            const principal = await resolvePrincipal(request, options);
            if (!principal) {
                clearSessionCookies(response);
                response.status(401).json({ authenticated: false });
                return;
            }
            response.json({
                authenticated: true,
                username: principal.username,
                expiresAt: principal.expiresAt,
            });
        } catch (error) {
            if (error instanceof AuthServiceUnavailableError) {
                sendUnavailable(response);
                return;
            }
            sendUnavailable(response);
        }
    });

    app.post('/api/auth/logout', async (request: AuthenticatedRequest, response) => {
        setNoStore(response);
        if (!trustedOriginOrReject(request, response, options.allowedOrigins)) return;
        try {
            const principal = await resolvePrincipal(request, options);
            if (principal && request.authSessionToken) {
                await options.authService.logout(request.authSessionToken);
                options.onSessionRevoked?.(principal.sessionFingerprint);
                recordAuditSafely(options, 'operator_logout', principal.username);
            }
            clearSessionCookies(response);
            response.status(204).send();
        } catch {
            sendUnavailable(response);
        }
    });

    app.put('/api/auth/credentials', async (request: AuthenticatedRequest, response) => {
        setNoStore(response);
        if (!trustedOriginOrReject(request, response, options.allowedOrigins)) return;
        try {
            const principal = await resolvePrincipal(request, options);
            if (!principal) {
                clearSessionCookies(response);
                response.status(401).json({ error: 'Unauthorized' });
                return;
            }
            const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
                ? request.body as Record<string, unknown>
                : {};
            const result = await options.authService.changeCredentials(
                principal,
                body.currentPassword,
                body.username,
                body.newPassword,
            );
            if (!result.ok) {
                const status = result.code === 'session_stale' ? 401 : 400;
                const messages = {
                    invalid_current_password: 'Current password is incorrect',
                    invalid_username: 'Username must contain 3-64 letters, numbers, dots, underscores, or hyphens',
                    invalid_new_password: 'New password must contain between 15 and 128 characters',
                    no_changes: 'No credential changes were provided',
                    session_stale: 'Session is no longer valid',
                } as const;
                response.status(status).json({ error: messages[result.code], code: result.code });
                return;
            }

            setSessionCookie(response, options.secureCookies, result.session.token, result.session.expiresAt);
            if (request.authSessionToken) {
                void options.authService.logout(request.authSessionToken).catch(() => undefined);
            }
            options.onCredentialsChanged?.();
            recordAuditSafely(options, 'operator_credentials_changed', result.user.username);
            response.json({
                authenticated: true,
                username: result.user.username,
                expiresAt: result.session.expiresAt,
            });
        } catch {
            sendUnavailable(response);
        }
    });
}

export function createApiSessionGuard(options: AuthRouteOptions): RequestHandler {
    return (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
        void (async () => {
            setNoStore(response);
            try {
                const principal = await resolvePrincipal(request, options);
                if (!principal) {
                    clearSessionCookies(response);
                    response.status(401).json({ error: 'Unauthorized' });
                    return;
                }
                next();
            } catch {
                sendUnavailable(response);
            }
        })();
    };
}

export function createApiOriginGuard(allowedOrigins: string[]): RequestHandler {
    return (request, response, next) => {
        if (!requiresOriginProtection(request.method)
            || isTrustedRequestOrigin(request.headers.origin, allowedOrigins)) {
            next();
            return;
        }
        response.status(403).json({ error: 'Request origin is not allowed' });
    };
}

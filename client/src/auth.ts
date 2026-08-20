function resolveDefaultApiUrl(): string {
    if (typeof window === 'undefined') return 'http://localhost:4000';
    return `${window.location.protocol}//${window.location.hostname}:4000`;
}

export const API_URL = (import.meta.env.VITE_API_URL || resolveDefaultApiUrl()).replace(/\/+$/, '');
export const AUTH_UNAUTHORIZED_EVENT = 'wp-monitor:auth-unauthorized';

export interface AuthSessionResponse {
    authenticated: boolean;
    username?: string;
    expiresAt?: string;
    error?: string;
    code?: string;
}

export function clearLegacyDashboardToken(): void {
    localStorage.removeItem('dat_dashboard_token');
}

export async function sessionFetch(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${API_URL}${path}`, {
        ...init,
        credentials: 'include',
        cache: 'no-store',
    });
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(input, {
        ...init,
        credentials: 'include',
    });
    if (response.status === 401) {
        window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
    }
    return response;
}

export async function downloadAuthenticatedFile(url: string, fallbackFilename: string): Promise<void> {
    const response = await authFetch(url);
    if (!response.ok) {
        throw new Error(`Download failed: HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const filename = getFilenameFromDisposition(response.headers.get('Content-Disposition')) || fallbackFilename;
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(objectUrl);
}

function getFilenameFromDisposition(disposition: string | null): string | null {
    if (!disposition) return null;

    const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1].replace(/"/g, ''));

    const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
    return plainMatch?.[1] || null;
}

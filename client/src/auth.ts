export const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:4000';

const TOKEN_KEY = 'dat_dashboard_token';

export function getDashboardToken(): string {
    return localStorage.getItem(TOKEN_KEY) || '';
}

export function setDashboardToken(token: string) {
    const trimmed = token.trim();
    if (trimmed) localStorage.setItem(TOKEN_KEY, trimmed);
    else localStorage.removeItem(TOKEN_KEY);
}

export function clearDashboardToken() {
    localStorage.removeItem(TOKEN_KEY);
}

export function authHeaders(headers?: HeadersInit): HeadersInit {
    const token = getDashboardToken();
    return {
        ...(headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
}

export function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
    return fetch(input, {
        ...init,
        headers: authHeaders(init.headers),
    });
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

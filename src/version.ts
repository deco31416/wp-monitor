import { readFileSync } from 'node:fs';

export function resolveSoftwareVersion(environmentVersion = process.env.npm_package_version): string {
    if (typeof environmentVersion === 'string' && environmentVersion.trim()) {
        return environmentVersion.trim();
    }

    try {
        const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
        if (typeof manifest.version === 'string' && manifest.version.trim()) {
            return manifest.version.trim();
        }
    } catch {
        // Keep startup and evidence generation available if packaging omits package.json.
    }

    return 'unknown';
}

export const SOFTWARE_VERSION = resolveSoftwareVersion();

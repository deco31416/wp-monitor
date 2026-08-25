import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const REVIEWED_COPYLEFT = new Map([
    ['GPL-3.0:libsignal@6.0.0', 'Baileys runtime dependency; see THIRD_PARTY_NOTICES.md'],
    ['LGPL-3.0-or-later:@img/sharp-libvips-linux-x64@1.3.2', 'Sharp/Baileys image runtime; see THIRD_PARTY_NOTICES.md'],
]);
const REVIEW_REQUIRED = /AGPL|GPL|LGPL|UNKNOWN|UNLICENSED|SEE LICENSE/i;

if (!existsSync('THIRD_PARTY_NOTICES.md')) {
    console.error('[LICENSES] THIRD_PARTY_NOTICES.md is required');
    process.exit(1);
}

const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const result = spawnSync(pnpmCommand, ['licenses', 'list', '--prod', '--json'], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
});
if (result.error) throw result.error;
if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
}

const inventory = JSON.parse(result.stdout);
let packageCount = 0;
const unreviewed = [];
const reviewedFound = new Set();

for (const [license, packages] of Object.entries(inventory)) {
    if (!Array.isArray(packages)) continue;
    packageCount += packages.length;
    if (!REVIEW_REQUIRED.test(license)) continue;
    for (const packageInfo of packages) {
        const versions = Array.isArray(packageInfo.versions) ? packageInfo.versions : [];
        if (versions.length === 0) unreviewed.push(`${license}:${packageInfo.name}@version-missing`);
        for (const version of versions) {
            const key = `${license}:${packageInfo.name}@${version}`;
            if (REVIEWED_COPYLEFT.has(key)) reviewedFound.add(key);
            else unreviewed.push(key);
        }
    }
}

for (const key of REVIEWED_COPYLEFT.keys()) {
    if (!reviewedFound.has(key)) unreviewed.push(`${key} (reviewed dependency missing or metadata changed)`);
}

console.log(`[LICENSES] ${packageCount} paquetes de producción inventariados`);
for (const key of reviewedFound) console.log(`[LICENSES] revisado: ${key}`);
if (unreviewed.length) {
    for (const entry of unreviewed) console.error(`[LICENSES] revisión requerida: ${entry}`);
    process.exit(1);
}
console.log('[LICENSES] PASS: no hay copyleft desconocido o sin revisión');

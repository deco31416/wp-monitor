import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';

const SKIPPED_DIRECTORIES = new Set([
    '.agents',
    '.codex',
    '.git',
    '.runtime-logs',
    'build',
    'dist',
    'node_modules',
]);

function listMarkdown(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) return [];
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return listMarkdown(path);
        return extname(entry.name).toLowerCase() === '.md' ? [path] : [];
    });
}

const markdownFiles = listMarkdown('.');
const errors = [];
let relativeLinks = 0;
let mermaidBlocks = 0;

for (const file of markdownFiles) {
    const source = readFileSync(file, 'utf8');
    const fences = source.match(/^```/gm) || [];
    if (fences.length % 2 !== 0) errors.push(`${file}: cercas Markdown desbalanceadas`);
    mermaidBlocks += (source.match(/^```mermaid\s*$/gm) || []).length;

    for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        let target = match[1].trim().replace(/^<|>$/g, '');
        if (!target || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
        target = target.split('#')[0].split('?')[0];
        if (!target) continue;
        relativeLinks += 1;
        try {
            target = decodeURIComponent(target);
        } catch {
            errors.push(`${file}: enlace con codificación inválida -> ${match[1]}`);
            continue;
        }
        if (!existsSync(resolve(dirname(file), target))) {
            errors.push(`${file}: enlace relativo roto -> ${match[1]}`);
        }
    }
}

console.log(`[DOCS] ${markdownFiles.length} Markdown, ${relativeLinks} enlaces relativos, ${mermaidBlocks} bloques Mermaid`);
if (errors.length) {
    for (const error of errors) console.error(`[DOCS] ${error}`);
    process.exit(1);
}
console.log('[DOCS] PASS');

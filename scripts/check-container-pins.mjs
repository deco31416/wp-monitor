import { readFile } from 'node:fs/promises';
import {
  isImmutableImageReference,
  isSelkiesBaseReference,
  isVersionedSelkiesBaseReference,
} from './container-image-policy.mjs';

const dockerfiles = [
  'Dockerfile',
  'Dockerfile.browser',
  'Dockerfile.capture-agent',
  'Dockerfile.webrtc-observer',
  'client/Dockerfile',
];
const composeFiles = ['docker-compose.yml', 'deploy/docker-compose.dokploy.yml'];
function fail(message) {
  console.error(`[containers:check] ${message}`);
  process.exitCode = 1;
}

for (const file of dockerfiles) {
  const contents = await readFile(file, 'utf8');
  const args = new Map();
  let versionedSelkiesBaseFound = file !== 'Dockerfile.browser';

  for (const line of contents.split(/\r?\n/)) {
    const argMatch = line.match(/^ARG\s+([A-Z0-9_]+)=(\S+)\s*$/);
    if (argMatch) args.set(argMatch[1], argMatch[2]);

    const fromMatch = line.match(/^FROM\s+(\S+)/);
    if (!fromMatch) continue;

    const reference = fromMatch[1];
    const variableMatch = reference.match(/^\$\{([A-Z0-9_]+)\}$/);
    const resolved = variableMatch ? args.get(variableMatch[1]) : reference;

    if (!resolved) {
      fail(`${file}: FROM usa ${reference} sin un ARG global con valor por defecto.`);
    } else if (!isImmutableImageReference(resolved)) {
      fail(`${file}: la imagen base ${resolved} no esta fijada por digest SHA-256.`);
    } else if (isSelkiesBaseReference(resolved)) {
      if (isVersionedSelkiesBaseReference(resolved)) {
        versionedSelkiesBaseFound = true;
      } else {
        fail(`${file}: la referencia Selkies no puede usar main/latest ni un release sin el flavor y digest exigidos.`);
      }
    }
  }

  if (!versionedSelkiesBaseFound) {
    fail(`${file}: Selkies debe usar una release versionada debiantrixie fijada por digest; main/latest no son aceptables.`);
  }
}

for (const file of composeFiles) {
  const contents = await readFile(file, 'utf8');

  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    const imageMatch = line.match(/^\s*image:\s*["']?([^\s"']+)["']?\s*$/);
    if (imageMatch && !isImmutableImageReference(imageMatch[1])) {
      fail(`${file}:${index + 1}: la imagen ${imageMatch[1]} no esta fijada por digest SHA-256.`);
    }
  }
}

if (!process.exitCode) {
  console.log(
    `[containers:check] PASS: ${dockerfiles.length} Dockerfiles y ${composeFiles.length} archivos Compose usan imagenes inmutables.`,
  );
}

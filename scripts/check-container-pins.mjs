import { readFile } from 'node:fs/promises';

const dockerfiles = [
  'Dockerfile',
  'Dockerfile.browser',
  'Dockerfile.capture-agent',
  'client/Dockerfile',
];
const composeFiles = ['docker-compose.yml', 'deploy/docker-compose.dokploy.yml'];
const digestPattern = /@sha256:[a-f0-9]{64}$/;

function fail(message) {
  console.error(`[containers:check] ${message}`);
  process.exitCode = 1;
}

for (const file of dockerfiles) {
  const contents = await readFile(file, 'utf8');
  const args = new Map();

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
    } else if (!digestPattern.test(resolved)) {
      fail(`${file}: la imagen base ${resolved} no esta fijada por digest SHA-256.`);
    }
  }
}

for (const file of composeFiles) {
  const contents = await readFile(file, 'utf8');

  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    const imageMatch = line.match(/^\s*image:\s*["']?([^\s"']+)["']?\s*$/);
    if (imageMatch && !digestPattern.test(imageMatch[1])) {
      fail(`${file}:${index + 1}: la imagen ${imageMatch[1]} no esta fijada por digest SHA-256.`);
    }
  }
}

if (!process.exitCode) {
  console.log(
    `[containers:check] PASS: ${dockerfiles.length} Dockerfiles y ${composeFiles.length} archivos Compose usan imagenes inmutables.`,
  );
}

const immutableDigestPattern = /@sha256:[a-f0-9]{64}$/;
const selkiesBasePrefix = 'ghcr.io/selkies-project/selkies/base:';
const versionedSelkiesBasePattern = /^ghcr\.io\/selkies-project\/selkies\/base:v[0-9]+\.[0-9]+\.[0-9]+(?:(?:alpha|beta|rc)[0-9]+)?-debiantrixie@sha256:[a-f0-9]{64}$/;

export function isImmutableImageReference(reference) {
  return immutableDigestPattern.test(String(reference || ''));
}

export function isSelkiesBaseReference(reference) {
  return String(reference || '').startsWith(selkiesBasePrefix);
}

export function isVersionedSelkiesBaseReference(reference) {
  return versionedSelkiesBasePattern.test(String(reference || ''));
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isImmutableImageReference,
  isSelkiesBaseReference,
  isVersionedSelkiesBaseReference,
} from '../scripts/container-image-policy.mjs';

const digest = 'a'.repeat(64);

test('accepts an immutable versioned Selkies Debian Trixie release', () => {
  const reference = `ghcr.io/selkies-project/selkies/base:v2.0.0rc0-debiantrixie@sha256:${digest}`;

  assert.equal(isImmutableImageReference(reference), true);
  assert.equal(isSelkiesBaseReference(reference), true);
  assert.equal(isVersionedSelkiesBaseReference(reference), true);
});

test('rejects moving Selkies tags even when combined with a digest', () => {
  assert.equal(
    isVersionedSelkiesBaseReference(`ghcr.io/selkies-project/selkies/base:main-debiantrixie@sha256:${digest}`),
    false,
  );
  assert.equal(
    isVersionedSelkiesBaseReference(`ghcr.io/selkies-project/selkies/base:latest-debiantrixie@sha256:${digest}`),
    false,
  );
});

test('rejects an unpinned, foreign, or wrong-flavor Selkies base', () => {
  assert.equal(
    isSelkiesBaseReference(`ghcr.io/example/selkies/base:v2.0.0rc0-debiantrixie@sha256:${digest}`),
    false,
  );
  assert.equal(
    isVersionedSelkiesBaseReference('ghcr.io/selkies-project/selkies/base:v2.0.0rc0-debiantrixie'),
    false,
  );
  assert.equal(
    isVersionedSelkiesBaseReference(`ghcr.io/example/selkies/base:v2.0.0rc0-debiantrixie@sha256:${digest}`),
    false,
  );
  assert.equal(
    isVersionedSelkiesBaseReference(`ghcr.io/selkies-project/selkies/base:v2.0.0rc0-ubuntu26.04@sha256:${digest}`),
    false,
  );
});

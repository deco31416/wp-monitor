import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPageMetadata } from '../src/page-metadata.js';

test('distinguishes a complete page from a truncated page', () => {
    assert.deepEqual(buildPageMetadata(2, 2, 200), {
        returned: 2,
        total: 2,
        truncated: false,
        limit: 200,
    });
    assert.deepEqual(buildPageMetadata(200, 315, 200), {
        returned: 200,
        total: 315,
        truncated: true,
        limit: 200,
    });
});

test('normalizes invalid counts without reporting an impossible page', () => {
    assert.deepEqual(buildPageMetadata(4.9, Number.NaN, -20), {
        returned: 4,
        total: 4,
        truncated: false,
        limit: 0,
    });
});

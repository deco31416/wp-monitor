import assert from 'node:assert/strict';
import test from 'node:test';
import { closeCaptureSessionIfOpened } from '../src/capture-lifecycle.js';

test('does not close a native capture session when open failed', () => {
    let closeCalls = 0;

    closeCaptureSessionIfOpened({ close: () => { closeCalls += 1; } }, false);

    assert.equal(closeCalls, 0);
});

test('closes a native capture session after open succeeded', () => {
    let closeCalls = 0;

    closeCaptureSessionIfOpened({ close: () => { closeCalls += 1; } }, true);

    assert.equal(closeCalls, 1);
});

test('contains close errors from an opened native capture session', () => {
    const expected = new Error('synthetic close failure');
    let observed: unknown;

    assert.doesNotThrow(() => closeCaptureSessionIfOpened(
        { close: () => { throw expected; } },
        true,
        error => { observed = error; },
    ));
    assert.equal(observed, expected);
});

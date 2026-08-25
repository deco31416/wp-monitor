import assert from 'node:assert/strict';
import test from 'node:test';
import {
    hasEffectiveLinuxCapability,
    hasDedicatedCapturePrivileges,
    hasPacketCapturePrivileges,
} from '../src/capture-permissions.js';

test('detects CAP_NET_RAW in Linux effective capabilities', () => {
    assert.equal(hasEffectiveLinuxCapability('CapEff:\t0000000000002000\n', 13n), true);
    assert.equal(hasEffectiveLinuxCapability('CapEff:\t0000000000001000\n', 13n), false);
});

test('dedicated capture agent requires both CAP_NET_ADMIN and CAP_NET_RAW', () => {
    assert.equal(hasDedicatedCapturePrivileges('linux', () => 'CapEff:\t0000000000003000\n'), true);
    assert.equal(hasDedicatedCapturePrivileges('linux', () => 'CapEff:\t0000000000002000\n'), false);
    assert.equal(hasDedicatedCapturePrivileges('linux', () => 'CapEff:\t0000000000001000\n'), false);
});

test('fails closed for malformed or unavailable Linux capability state', () => {
    assert.equal(hasEffectiveLinuxCapability('CapEff:\tnot-hex\n', 13n), false);
    assert.equal(hasPacketCapturePrivileges('linux', () => { throw new Error('missing procfs'); }), false);
});

test('does not apply the Linux capability gate to other platforms', () => {
    assert.equal(hasPacketCapturePrivileges('win32', () => { throw new Error('must not read procfs'); }), true);
    assert.equal(hasPacketCapturePrivileges('darwin', () => { throw new Error('must not read procfs'); }), true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyIP, isCloudflareIP, isGoogleSTUN, isKnownRelayIP, isMetaIP, isPrivateIP } from '../src/meta-ip-ranges.js';

test('classifies provider ranges without claiming broad Google space is STUN', () => {
    assert.equal(isMetaIP('157.240.1.1'), true);
    assert.equal(classifyIP('157.240.1.1'), 'meta');
    assert.equal(isMetaIP('57.144.115.57'), true);
    assert.equal(classifyIP('57.144.115.57'), 'meta');

    assert.equal(isGoogleSTUN('74.125.10.10'), false);
    assert.equal(classifyIP('74.125.10.10'), 'google');
    assert.equal(isGoogleSTUN('216.239.36.223'), false);
    assert.equal(classifyIP('216.239.36.223'), 'google');

    assert.equal(isCloudflareIP('104.16.10.10'), true);
    assert.equal(classifyIP('104.16.10.10'), 'cloudflare');

    assert.equal(isKnownRelayIP('104.16.10.10'), false);
    assert.equal(isGoogleSTUN('8.8.8.8'), false);
});

test('keeps unknown public IPs outside relay classification', () => {
    assert.equal(classifyIP('9.9.9.9'), 'unknown');
    assert.equal(isKnownRelayIP('9.9.9.9'), false);
});

test('distinguishes public DNS and IPv6 infrastructure from relay traffic', () => {
    assert.equal(classifyIP('8.8.8.8'), 'google');
    assert.equal(isKnownRelayIP('8.8.8.8'), false);
    assert.equal(classifyIP('2a03:2880:f001::1'), 'meta');
    assert.equal(isKnownRelayIP('2a03:2880:f001::1'), true);
    assert.equal(isPrivateIP('2a03:2880:f001::1'), false);
    assert.equal(isPrivateIP('2001:db8::1'), true);
    assert.equal(isPrivateIP('fd00::1'), true);
});

test('detects private IPv4 ranges without overmatching 172.0.0.0/8', () => {
    assert.equal(isPrivateIP('10.1.2.3'), true);
    assert.equal(isPrivateIP('192.168.1.10'), true);
    assert.equal(isPrivateIP('172.16.0.1'), true);
    assert.equal(isPrivateIP('172.31.255.254'), true);
    assert.equal(isPrivateIP('100.64.0.1'), true);
    assert.equal(isPrivateIP('239.255.255.250'), true);
    assert.equal(isPrivateIP('198.18.0.1'), true);
    assert.equal(isPrivateIP('203.0.113.10'), true);
    assert.equal(isPrivateIP('172.15.0.1'), false);
    assert.equal(isPrivateIP('172.32.0.1'), false);
});

test('rejects malformed IPv4 input without matching infrastructure ranges', () => {
    for (const value of ['', 'not-an-ip', '104.16.1', '104.16.1.999', '104.16.-1.1']) {
        assert.equal(classifyIP(value), 'unknown');
        assert.equal(isKnownRelayIP(value), false);
        assert.equal(isPrivateIP(value), true);
    }
});

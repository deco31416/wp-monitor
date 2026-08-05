import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyIP, isCloudflareIP, isGoogleSTUN, isKnownRelayIP, isMetaIP, isPrivateIP } from '../src/meta-ip-ranges.js';

test('classifies known Meta, Google STUN, and Cloudflare ranges', () => {
    assert.equal(isMetaIP('157.240.1.1'), true);
    assert.equal(classifyIP('157.240.1.1'), 'meta');
    assert.equal(isMetaIP('57.144.115.57'), true);
    assert.equal(classifyIP('57.144.115.57'), 'meta');

    assert.equal(isGoogleSTUN('74.125.10.10'), true);
    assert.equal(classifyIP('74.125.10.10'), 'google');
    assert.equal(isGoogleSTUN('216.239.36.223'), true);
    assert.equal(classifyIP('216.239.36.223'), 'google');

    assert.equal(isCloudflareIP('104.16.10.10'), true);
    assert.equal(classifyIP('104.16.10.10'), 'cloudflare');

    assert.equal(isKnownRelayIP('104.16.10.10'), true);
});

test('keeps unknown public IPs outside relay classification', () => {
    assert.equal(classifyIP('8.8.8.8'), 'unknown');
    assert.equal(isKnownRelayIP('8.8.8.8'), false);
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

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    extractCookieValue,
    getSessionCookieName,
    isTrustedRequestOrigin,
    requiresOriginProtection,
} from '../src/access-control.js';

test('uses a __Host cookie only when secure production cookies are enabled', () => {
    assert.equal(getSessionCookieName(false), 'wp_monitor_session');
    assert.equal(getSessionCookieName(true), '__Host-wp_monitor_session');
});

test('extracts exactly one named session cookie and rejects cookie tossing ambiguity', () => {
    assert.equal(extractCookieValue('theme=dark; wp_monitor_session=opaque-token', 'wp_monitor_session'), 'opaque-token');
    assert.equal(extractCookieValue('wp_monitor_session=first; wp_monitor_session=second', 'wp_monitor_session'), '');
    assert.equal(extractCookieValue(undefined, 'wp_monitor_session'), '');
});

test('matches normalized trusted origins without accepting suffix or malformed values', () => {
    const allowed = ['https://dashboard.example.test', 'http://localhost:4001'];
    assert.equal(isTrustedRequestOrigin('https://dashboard.example.test', allowed), true);
    assert.equal(isTrustedRequestOrigin('https://dashboard.example.test:443', allowed), true);
    assert.equal(isTrustedRequestOrigin('https://dashboard.example.test.attacker.test', allowed), false);
    assert.equal(isTrustedRequestOrigin('null', allowed), false);
});

test('requires origin protection only for state-changing methods', () => {
    assert.equal(requiresOriginProtection('GET'), false);
    assert.equal(requiresOriginProtection('HEAD'), false);
    assert.equal(requiresOriginProtection('OPTIONS'), false);
    assert.equal(requiresOriginProtection('POST'), true);
    assert.equal(requiresOriginProtection('PUT'), true);
    assert.equal(requiresOriginProtection('DELETE'), true);
});

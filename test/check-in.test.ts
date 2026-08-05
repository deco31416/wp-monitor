import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCheckInConsistency, buildCheckInHash, buildConsentText, createCheckInToken, normalizeCheckInSubmission, renderCheckInPage } from '../src/check-in.js';
import type { CheckInDoc } from '../src/db.js';

function fixture(): CheckInDoc {
    const now = new Date('2026-06-22T22:00:00.000Z');
    return {
        token: 'tok_123',
        caseId: 'CASE-TEST',
        operatorName: 'WP MONITOR',
        authorizationNote: 'Autorizado',
        label: 'Prueba autorizada',
        targetName: 'Test Contact',
        targetJid: null,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date('2026-06-23T22:00:00.000Z'),
        completedAt: null,
        request: null,
        browser: null,
        consent: {
            accepted: false,
            text: 'consent',
            acceptedAt: null,
        },
        location: null,
        ipEnrichment: null,
        hash: '',
    };
}

test('creates URL-safe check-in tokens', () => {
    const token = createCheckInToken();
    assert.match(token, /^[A-Za-z0-9_-]+$/);
    assert.ok(token.length >= 32);
});

test('builds stable hash while ignoring existing hash field', () => {
    const doc = fixture();
    const first = buildCheckInHash(doc);
    const second = buildCheckInHash({ ...doc, hash: 'different' });
    assert.equal(first, second);
    assert.match(first, /^[a-f0-9]{64}$/);
});

test('normalizes check-in submission safely', () => {
    const normalized = normalizeCheckInSubmission({
        consentAccepted: true,
        browser: {
            timezone: 'America/Mexico_City',
            screen: { width: '390', height: 844, pixelRatio: 2 },
        },
        location: {
            permission: 'granted',
            lat: '19.4326',
            lon: -99.1332,
            accuracy: 24,
        },
    });

    assert.equal(normalized.consentAccepted, true);
    assert.equal(normalized.browser?.timezone, 'America/Mexico_City');
    assert.equal(normalized.browser?.screen?.width, 390);
    assert.equal(normalized.location?.permission, 'granted');
    assert.equal(normalized.location?.lat, 19.4326);
});

test('renders explicit consent page without raw script injection', () => {
    const html = renderCheckInPage({ ...fixture(), label: '<script>alert(1)</script>' });
    assert.match(html, /Check-in autorizado/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<div class="value"><script>alert/);
});

test('renders custom landing labels, button, and minimum disclosure', () => {
    const html = renderCheckInPage({
        ...fixture(),
        content: {
            pageTitle: 'Portal autorizado',
            brandName: 'Cliente Legal',
            caseLabel: 'Expediente',
            operatorLabel: 'Analista',
            checkInLabel: 'Proceso',
            expiresLabel: 'Caduca',
            consentText: 'Acepto la politica personalizada del cliente.',
            submitButtonText: 'Confirmar verificacion',
            successMessage: 'Recibido:',
            redirectUrl: 'https://example.test/gracias',
            requestGps: false,
        },
    });

    assert.match(html, /Cliente Legal/);
    assert.match(html, /Referencia <strong>Prueba autorizada<\/strong>/);
    assert.doesNotMatch(html, /Expediente/);
    assert.doesNotMatch(html, /Analista/);
    assert.doesNotMatch(html, /Detalles de la solicitud/);
    assert.match(html, /Confirmar verificacion/);
    assert.match(html, /Acepto la politica personalizada del cliente/);
    assert.match(html, /Aviso tecnico minimo/);
    assert.match(html, /const REQUEST_GPS = false/);
    assert.match(html, /https:\/\/example.test\/gracias/);
});

test('builds stored consent text from custom policy plus mandatory disclosure', () => {
    const consent = buildConsentText('Acepto la politica operacional del cliente.', false);

    assert.match(consent, /Acepto la politica operacional del cliente/);
    assert.match(consent, /Aviso tecnico minimo/);
    assert.match(consent, /IP publica observada/);
    assert.doesNotMatch(consent, /permiso GPS/);
});

test('does not allow custom consent to weaken mandatory disclosure', () => {
    const consent = buildConsentText('Acepto la politica operacional.\n\nAviso tecnico minimo: solo guardamos nombre.', true);

    assert.match(consent, /Acepto la politica operacional/);
    assert.match(consent, /ubicacion aproximada solo si se concede permiso GPS/);
    assert.doesNotMatch(consent, /solo guardamos nombre/);
});

test('builds check-in consistency signals from IP, browser, and GPS evidence', () => {
    const consistency = buildCheckInConsistency({
        request: {
            ip: '203.0.113.10',
            userAgent: 'Chrome',
            acceptLanguage: 'es-MX',
            referer: 'https://example.test/',
        },
        browser: {
            timezone: 'America/Mexico_City',
            language: 'es-MX',
            device: { type: 'desktop', os: 'Windows', browser: 'Chrome' },
        },
        location: {
            permission: 'granted',
            lat: 19.4326,
            lon: -99.1332,
        },
        ipEnrichment: {
            status: 'success',
            countryCode: 'NL',
            city: 'Amsterdam',
            timezone: 'Europe/Amsterdam',
            proxy: true,
            hosting: true,
            lat: 52.3676,
            lon: 4.9041,
        },
    });

    assert.equal(consistency.level, 'low');
    assert.ok(consistency.score < 45);
    assert.ok(consistency.signals.some(signal => signal.label === 'Proxy/VPN posible'));
    assert.ok(consistency.signals.some(signal => signal.label === 'Zona horaria divergente'));
    assert.ok(consistency.signals.some(signal => signal.label === 'GPS declarado por navegador'));
    assert.ok(consistency.signals.some(signal => signal.label === 'GPS/IP distantes'));
});

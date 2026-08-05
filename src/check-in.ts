import crypto from 'crypto';
import type { CheckInDoc } from './db.js';

export const CHECK_IN_CONSENT_TEXT = 'Acepto enviar este check-in autorizado. Entiendo que se registrara mi IP publica observada por el servidor, sistema operativo, navegador, tipo de dispositivo, pantalla, idioma, zona horaria, datos basicos de red del navegador y, si doy permiso, mi ubicacion aproximada.';
export const CHECK_IN_CONSENT_TEXT_NO_GPS = 'Acepto enviar este check-in autorizado. Entiendo que se registrara mi IP publica observada por el servidor, sistema operativo, navegador, tipo de dispositivo, pantalla, idioma, zona horaria y datos basicos de red del navegador.';
const REQUIRED_DISCLOSURE_GPS = 'Aviso tecnico minimo: este envio registra IP publica observada por el servidor, navegador, sistema/dispositivo aproximado, pantalla, idioma, zona horaria, datos basicos de red del navegador y ubicacion aproximada solo si se concede permiso GPS.';
const REQUIRED_DISCLOSURE_NO_GPS = 'Aviso tecnico minimo: este envio registra IP publica observada por el servidor, navegador, sistema/dispositivo aproximado, pantalla, idioma, zona horaria y datos basicos de red del navegador.';

export interface CheckInSubmission {
    consentAccepted: boolean;
    browser?: {
        timezone?: string;
        language?: string;
        languages?: string[];
        platform?: string;
        userAgentData?: {
            platform?: string;
            mobile?: boolean;
            brands?: Array<{ brand?: string; version?: string }>;
        };
        device?: {
            type?: 'mobile' | 'tablet' | 'desktop' | 'unknown';
            os?: string;
            browser?: string;
            engine?: string;
            isTouch?: boolean;
            maxTouchPoints?: number;
            hardwareConcurrency?: number;
            deviceMemoryGb?: number;
        };
        viewport?: {
            width?: number;
            height?: number;
        };
        screen?: {
            width?: number;
            height?: number;
            pixelRatio?: number;
            colorDepth?: number;
            orientation?: string;
        };
        network?: {
            online?: boolean;
            effectiveType?: string;
            downlink?: number;
            rtt?: number;
            saveData?: boolean;
        };
        privacy?: {
            cookiesEnabled?: boolean;
            doNotTrack?: string | null;
        };
    };
    location?: {
        permission?: 'granted' | 'denied' | 'unavailable' | 'unsupported';
        lat?: number;
        lon?: number;
        accuracy?: number;
        altitude?: number | null;
        altitudeAccuracy?: number | null;
        heading?: number | null;
        speed?: number | null;
        capturedAt?: string;
    };
}

export interface CheckInConsistency {
    score: number;
    level: 'high' | 'medium' | 'low';
    summary: string;
    signals: Array<{
        severity: 'ok' | 'info' | 'warning' | 'danger';
        label: string;
        detail: string;
    }>;
}

export function createCheckInToken(): string {
    return crypto.randomBytes(24).toString('base64url');
}

export function buildCheckInHash(doc: Partial<CheckInDoc>): string {
    const canonical = JSON.stringify(sortKeys(omitHash(doc)));
    return crypto.createHash('sha256').update(canonical).digest('hex');
}

export function buildCheckInConsistency(doc: Partial<CheckInDoc>): CheckInConsistency {
    const signals: CheckInConsistency['signals'] = [];
    const enrichment = (doc.ipEnrichment || {}) as Record<string, unknown>;
    const browser = doc.browser || {};
    const request = doc.request || null;
    const location = doc.location || null;
    let score = 70;

    const ipStatus = stringValue(enrichment.status);
    const proxy = booleanValue(enrichment.proxy);
    const hosting = booleanValue(enrichment.hosting);
    const mobileNetwork = booleanValue(enrichment.mobile);
    const ipTimezone = stringValue(enrichment.timezone);
    const ipCountry = stringValue(enrichment.countryCode);
    const ipCity = stringValue(enrichment.city);
    const browserTimezone = stringValue(browser.timezone);
    const browserLanguage = stringValue(browser.language);
    const deviceType = stringValue(browser.device?.type);

    if (ipStatus === 'success') {
        score += 8;
        signals.push({ severity: 'ok', label: 'GeoIP disponible', detail: `Proveedor IP reporta ${[ipCity, ipCountry].filter(Boolean).join(', ') || 'ubicacion estimada'}.` });
    } else {
        score -= 8;
        signals.push({ severity: 'info', label: 'GeoIP limitado', detail: stringValue(enrichment.message) || 'No hay enriquecimiento publico para esta IP.' });
    }

    if (proxy) {
        score -= 22;
        signals.push({ severity: 'warning', label: 'Proxy/VPN posible', detail: 'El proveedor de IP marco la red como proxy.' });
    }
    if (hosting) {
        score -= 20;
        signals.push({ severity: 'warning', label: 'Hosting/datacenter', detail: 'La IP parece pertenecer a infraestructura cloud/hosting.' });
    }
    if (mobileNetwork) {
        score += deviceType === 'mobile' ? 8 : 2;
        signals.push({ severity: 'info', label: 'Red movil', detail: 'El proveedor reporta la IP como red movil.' });
    }

    if (ipTimezone && browserTimezone) {
        if (ipTimezone === browserTimezone) {
            score += 14;
            signals.push({ severity: 'ok', label: 'Zona horaria coherente', detail: `${browserTimezone} coincide con la zona estimada por IP.` });
        } else {
            score -= 18;
            signals.push({ severity: 'warning', label: 'Zona horaria divergente', detail: `Navegador ${browserTimezone}; IP ${ipTimezone}.` });
        }
    } else {
        score -= 4;
        signals.push({ severity: 'info', label: 'Zona horaria incompleta', detail: 'No se pudo comparar zona horaria del navegador contra GeoIP.' });
    }

    const languageRegion = browserLanguage.match(/-([A-Z]{2})$/i)?.[1]?.toUpperCase();
    if (languageRegion && ipCountry) {
        if (languageRegion === ipCountry) {
            score += 8;
            signals.push({ severity: 'ok', label: 'Idioma coherente', detail: `${browserLanguage} coincide con pais GeoIP ${ipCountry}.` });
        } else {
            score -= 8;
            signals.push({ severity: 'info', label: 'Idioma diferente', detail: `${browserLanguage} no coincide con pais GeoIP ${ipCountry}. Puede ser normal en equipos multiregion.` });
        }
    }

    const ipLat = numberValue(enrichment.lat);
    const ipLon = numberValue(enrichment.lon);
    if (location?.permission === 'granted' && typeof location.lat === 'number' && typeof location.lon === 'number') {
        const gpsAccuracy = numberValue(location.accuracy);
        signals.push({
            severity: 'info',
            label: 'GPS declarado por navegador',
            detail: 'Las coordenadas GPS fueron entregadas por el navegador del usuario con permiso explicito; son evidencia tecnica declarada por cliente y requieren corroboracion si se usan formalmente.',
        });
        if (typeof gpsAccuracy === 'number' && gpsAccuracy > 1000) {
            score -= 4;
            signals.push({ severity: 'info', label: 'GPS de baja precision', detail: `Precision reportada aproximadamente ${Math.round(gpsAccuracy)} m.` });
        }
        if (typeof ipLat === 'number' && typeof ipLon === 'number') {
            const km = distanceKm(location.lat, location.lon, ipLat, ipLon);
            if (km <= 50) {
                score += 8;
                signals.push({ severity: 'ok', label: 'GPS/IP cercanos', detail: `Distancia aproximada ${Math.round(km)} km entre GPS declarado e IP estimada.` });
            } else if (km <= 250) {
                score += 2;
                signals.push({ severity: 'info', label: 'GPS/IP razonablemente cercanos', detail: `Distancia aproximada ${Math.round(km)} km; puede depender del ISP y debe leerse como corroboracion parcial.` });
            } else {
                score -= 14;
                signals.push({ severity: 'warning', label: 'GPS/IP distantes', detail: `Distancia aproximada ${Math.round(km)} km. Puede indicar VPN, CGNAT, salida centralizada del ISP, GPS declarado incorrecto o GeoIP impreciso.` });
            }
        } else {
            score += 3;
            signals.push({ severity: 'info', label: 'GPS sin comparacion GeoIP', detail: 'El navegador entrego coordenadas, pero no hay coordenadas IP confiables para comparar.' });
        }
    } else if (location?.permission === 'denied') {
        score -= 5;
        signals.push({ severity: 'info', label: 'GPS denegado', detail: 'El usuario no concedio permiso de ubicacion del navegador.' });
    } else {
        signals.push({ severity: 'info', label: 'GPS no disponible', detail: 'No hay coordenadas GPS para comparar contra la IP.' });
    }

    if (request?.referer) {
        score += 3;
        signals.push({ severity: 'ok', label: 'Referer presente', detail: 'El navegador envio pagina de referencia.' });
    }

    if (browser.privacy?.doNotTrack && browser.privacy.doNotTrack !== '0') {
        signals.push({ severity: 'info', label: 'Do Not Track', detail: 'El navegador reporta preferencia de privacidad activa.' });
    }

    const normalizedScore = Math.max(0, Math.min(100, Math.round(score)));
    const level: CheckInConsistency['level'] = normalizedScore >= 75 ? 'high' : normalizedScore >= 45 ? 'medium' : 'low';
    const summary = level === 'high'
        ? 'Senales tecnicas mayormente coherentes.'
        : level === 'medium'
            ? 'Senales tecnicas mixtas; revisar contexto antes de concluir.'
            : 'Senales tecnicas divergentes o de baja confianza; requiere corroboracion externa.';

    return { score: normalizedScore, level, summary, signals };
}

export function normalizeCheckInSubmission(input: unknown): CheckInSubmission {
    const data = typeof input === 'object' && input !== null ? input as Record<string, any> : {};
    const browser = typeof data.browser === 'object' && data.browser !== null ? data.browser : {};
    const screen = typeof browser.screen === 'object' && browser.screen !== null ? browser.screen : {};
    const viewport = typeof browser.viewport === 'object' && browser.viewport !== null ? browser.viewport : {};
    const device = typeof browser.device === 'object' && browser.device !== null ? browser.device : {};
    const network = typeof browser.network === 'object' && browser.network !== null ? browser.network : {};
    const privacy = typeof browser.privacy === 'object' && browser.privacy !== null ? browser.privacy : {};
    const userAgentData = typeof browser.userAgentData === 'object' && browser.userAgentData !== null ? browser.userAgentData : {};
    const location = typeof data.location === 'object' && data.location !== null ? data.location : {};
    const permission = ['granted', 'denied', 'unavailable', 'unsupported'].includes(location.permission)
        ? location.permission
        : 'unavailable';

    return {
        consentAccepted: data.consentAccepted === true,
        browser: {
            timezone: clean(browser.timezone, 120),
            language: clean(browser.language, 80),
            languages: Array.isArray(browser.languages)
                ? browser.languages.map((value: unknown) => clean(value, 40)).filter(Boolean).slice(0, 12) as string[]
                : undefined,
            platform: clean(browser.platform, 120),
            userAgentData: {
                platform: clean(userAgentData.platform, 80),
                mobile: booleanOrUndefined(userAgentData.mobile),
                brands: Array.isArray(userAgentData.brands)
                    ? userAgentData.brands.slice(0, 8).map((item: any) => ({
                        brand: clean(item?.brand, 80),
                        version: clean(item?.version, 30),
                    })).filter((item: { brand?: string; version?: string }) => item.brand || item.version)
                    : undefined,
            },
            device: {
                type: ['mobile', 'tablet', 'desktop', 'unknown'].includes(device.type) ? device.type : 'unknown',
                os: clean(device.os, 80),
                browser: clean(device.browser, 80),
                engine: clean(device.engine, 80),
                isTouch: booleanOrUndefined(device.isTouch),
                maxTouchPoints: numberOrUndefined(device.maxTouchPoints),
                hardwareConcurrency: numberOrUndefined(device.hardwareConcurrency),
                deviceMemoryGb: numberOrUndefined(device.deviceMemoryGb),
            },
            viewport: {
                width: numberOrUndefined(viewport.width),
                height: numberOrUndefined(viewport.height),
            },
            screen: {
                width: numberOrUndefined(screen.width),
                height: numberOrUndefined(screen.height),
                pixelRatio: numberOrUndefined(screen.pixelRatio),
                colorDepth: numberOrUndefined(screen.colorDepth),
                orientation: clean(screen.orientation, 80),
            },
            network: {
                online: booleanOrUndefined(network.online),
                effectiveType: clean(network.effectiveType, 40),
                downlink: numberOrUndefined(network.downlink),
                rtt: numberOrUndefined(network.rtt),
                saveData: booleanOrUndefined(network.saveData),
            },
            privacy: {
                cookiesEnabled: booleanOrUndefined(privacy.cookiesEnabled),
                doNotTrack: privacy.doNotTrack === null ? null : clean(privacy.doNotTrack, 40),
            },
        },
        location: {
            permission,
            lat: numberOrUndefined(location.lat),
            lon: numberOrUndefined(location.lon),
            accuracy: numberOrUndefined(location.accuracy),
            altitude: numberOrNull(location.altitude),
            altitudeAccuracy: numberOrNull(location.altitudeAccuracy),
            heading: numberOrNull(location.heading),
            speed: numberOrNull(location.speed),
            capturedAt: clean(location.capturedAt, 80),
        },
    };
}

export function renderCheckInPage(doc: CheckInDoc, options: { status?: 'ready' | 'completed' | 'expired' | 'revoked' } = {}): string {
    const status = options.status || 'ready';
    const isReady = status === 'ready';
    const fallbackTitle = status === 'completed'
        ? 'Check-in recibido'
        : status === 'expired'
            ? 'Check-in expirado'
            : status === 'revoked'
                ? 'Check-in revocado'
                : 'Check-in autorizado';
    const title = doc.content?.pageTitle || fallbackTitle;
    const description = doc.content?.pageDescription || 'Esta verificacion pertenece a un proceso autorizado. El envio registra IP observada por el servidor, navegador, sistema, tipo de dispositivo, pantalla, red y puede incluir ubicacion aproximada solo si aceptas el permiso del navegador.';
    const ogImageUrl = doc.content?.ogImageUrl || '';
    const brandName = doc.content?.brandName || 'WP MONITOR';
    const accentColor = safeColor(doc.content?.accentColor, '#7c3aed');
    const backgroundColor = safeColor(doc.content?.backgroundColor, '#0b1020');
    const panelColor = safeColor(doc.content?.panelColor, '#151b31');
    const textColor = safeColor(doc.content?.textColor, '#eef4ff');
    const layout = ['classic', 'hero', 'compact'].includes(doc.content?.layout || '') ? doc.content?.layout : 'classic';
    const requestGps = doc.content?.requestGps !== false;
    const consentParts = buildConsentParts(doc.content?.consentText, requestGps);
    const submitButtonText = doc.content?.submitButtonText || 'Aceptar y enviar check-in';
    const successMessage = doc.content?.successMessage || 'Check-in recibido. Hash de evidencia:';
    const redirectUrl = safeRedirectUrl(doc.content?.redirectUrl);
    const heroClass = layout === 'hero' && ogImageUrl ? ' hero' : layout === 'compact' ? ' compact' : '';
    const heroMarkup = layout === 'hero' && ogImageUrl ? `<div class="hero-image" aria-hidden="true"></div>` : '';
    const publicReference = doc.label || doc.caseId;
    const publicExpires = doc.expiresAt ? formatPublicDate(doc.expiresAt) : 'Sin vencimiento';

    return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  ${ogImageUrl ? `<meta property="og:image" content="${escapeHtml(ogImageUrl)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="${escapeHtml(ogImageUrl)}" />` : '<meta name="twitter:card" content="summary" />'}
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <style>
    :root { color-scheme: dark; --bg:${backgroundColor}; --panel:${panelColor}; --line:rgba(142,160,196,.22); --text:${textColor}; --muted:#9fb2d7; --accent:${accentColor}; --ok:#10b981; --warn:#f59e0b; --danger:#ef4444; --surface:#0f172a; }
    * { box-sizing: border-box; }
    html { min-height:100%; scrollbar-width:thin; scrollbar-color:#4b5563 #0f172a; }
    html::-webkit-scrollbar { width:12px; height:12px; }
    html::-webkit-scrollbar-track { background:#0f172a; }
    html::-webkit-scrollbar-thumb { background:linear-gradient(180deg, #64748b, #374151); border:3px solid #0f172a; border-radius:999px; }
    html::-webkit-scrollbar-thumb:hover { background:linear-gradient(180deg, #94a3b8, #4b5563); }
    body { margin:0; min-height:100vh; font-family: "Inter", "Aptos", "Segoe UI", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif; background:linear-gradient(135deg, color-mix(in srgb, var(--bg) 92%, #fff 8%), var(--bg)); color:var(--text); display:flex; align-items:center; justify-content:center; padding:clamp(18px, 4vw, 42px); overflow-x:hidden; }
    body::before { content:""; position:fixed; inset:0; pointer-events:none; background:radial-gradient(circle at 18% 8%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 34%), radial-gradient(circle at 88% 18%, rgba(255,255,255,.12), transparent 28%); opacity:.9; }
    main { position:relative; width:min(880px, calc(100vw - clamp(32px, 8vw, 84px))); background:color-mix(in srgb, var(--panel) 94%, #ffffff 6%); border:1px solid var(--line); border-radius:28px; padding:0; box-shadow:0 30px 90px rgba(0,0,0,.34); overflow:hidden; }
    main.hero { width:min(1040px, 100%); display:grid; grid-template-columns:minmax(280px, .82fr) minmax(0, 1fr); }
    main.compact { width:min(640px, calc(100vw - clamp(32px, 8vw, 84px))); }
    .hero-image { min-height:100%; background:linear-gradient(180deg, rgba(11,16,32,.02), rgba(11,16,32,.56)), url('${escapeCssUrl(ogImageUrl)}') center/cover; }
    .content { padding:40px; min-width:0; }
    main.compact .content { padding:30px; }
    .brand { color:var(--muted); font-size:11px; letter-spacing:.16em; text-transform:uppercase; font-weight:850; margin-bottom:18px; }
    h1 { margin:0 0 10px; font-size:clamp(30px, 5vw, 44px); line-height:1.04; letter-spacing:0; max-width:780px; overflow-wrap:anywhere; }
    p { color:var(--muted); line-height:1.62; margin:0 0 18px; font-size:16px; max-width:780px; overflow-wrap:anywhere; }
    .meta { display:grid; gap:10px; grid-template-columns: repeat(2, minmax(0,1fr)); margin:26px 0 20px; }
    .item { border:1px solid var(--line); border-radius:16px; padding:14px 16px; background:rgba(15,23,42,.58); min-width:0; }
    .label { color:var(--muted); font-size:12px; margin-bottom:6px; }
    .value { font-weight:800; overflow-wrap:anywhere; font-size:17px; }
    .summary-strip { display:flex; flex-wrap:wrap; gap:10px; margin:24px 0 14px; }
    .summary-pill { display:inline-flex; align-items:center; gap:8px; border:1px solid var(--line); border-radius:999px; padding:9px 13px; background:rgba(15,23,42,.44); color:var(--muted); font-size:13px; }
    .summary-pill strong { color:var(--text); font-size:14px; }
    .consent-card { display:grid; grid-template-columns:24px minmax(0,1fr); gap:14px; align-items:start; margin:22px 0 14px; padding:18px; border:1px solid color-mix(in srgb, var(--accent) 28%, var(--line)); border-radius:18px; background:color-mix(in srgb, var(--accent) 9%, transparent); }
    .consent-card span { line-height:1.52; font-size:16px; color:var(--text); overflow-wrap:anywhere; }
    input[type="checkbox"] { margin-top:2px; width:22px; height:22px; accent-color:var(--accent); flex:0 0 auto; }
    .disclosure { margin:0 0 18px; padding:14px 16px; border:1px solid var(--line); border-radius:16px; background:rgba(15,23,42,.46); color:var(--muted); font-size:13px; line-height:1.52; overflow-wrap:anywhere; }
    .actions { display:flex; flex-wrap:wrap; align-items:center; gap:12px; margin-top:16px; }
    button { appearance:none; border:0; border-radius:16px; padding:14px 22px; font-weight:850; color:#fff; background:linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 72%, #2563eb 28%)); cursor:pointer; min-height:48px; box-shadow:0 12px 26px color-mix(in srgb, var(--accent) 28%, transparent); }
    button:disabled { opacity:.58; cursor:not-allowed; box-shadow:none; filter:saturate(.7); }
    .status { margin-top:18px; padding:14px 16px; border-radius:16px; border:1px solid var(--line); background:rgba(15,23,42,.62); color:var(--muted); }
    .ok { border-color:rgba(16,185,129,.45); color:#b7f7df; }
    .warn { border-color:rgba(245,158,11,.45); color:#ffe2a6; }
    .danger { border-color:rgba(239,68,68,.5); color:#ffc6c6; }
    @media (max-width: 760px) { body { padding:18px; align-items:flex-start; justify-content:center; } main, main.compact, main.hero { width:min(100%, calc(100vw - 36px)); } main.hero { display:block; } .hero-image { min-height:190px; } .content { padding:26px; } }
    @media (max-width: 640px) { .meta { grid-template-columns:1fr; } h1 { font-size:30px; } .summary-pill { width:100%; justify-content:space-between; } .consent-card { grid-template-columns:22px minmax(0,1fr); padding:14px; } }
    @media (max-width: 480px) { body { padding:12px; } main, main.compact, main.hero { width:calc(100vw - 24px); border-radius:22px; } .content { padding:22px 18px; } .brand { font-size:10px; } h1 { font-size:28px; } p, .consent-card span { font-size:15px; } button { width:100%; } }
  </style>
</head>
<body>
  <main class="${heroClass.trim()}">
    ${heroMarkup}
    <section class="content">
    <div class="brand">${escapeHtml(brandName)}</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(description)}</p>
    <div class="summary-strip" aria-label="Resumen de solicitud">
      <div class="summary-pill">Referencia <strong>${escapeHtml(publicReference)}</strong></div>
      <div class="summary-pill">Valido hasta <strong>${escapeHtml(publicExpires)}</strong></div>
    </div>
    ${isReady ? `<label class="consent-card"><input id="consent" type="checkbox" /><span>${escapeHtml(consentParts.primary)}</span></label>
    <div class="disclosure">${escapeHtml(consentParts.disclosure)}</div>
    <div class="actions"><button id="send" disabled>${escapeHtml(submitButtonText)}</button></div>
    <div id="status" class="status">Esperando autorizacion del usuario.</div>` : `<div class="status ${status === 'completed' ? 'ok' : status === 'expired' ? 'warn' : 'danger'}">${escapeHtml(statusMessage(status))}</div>`}
    </section>
  </main>
  ${isReady ? `<script>
    const REQUEST_GPS = ${requestGps ? 'true' : 'false'};
    const REDIRECT_URL = ${JSON.stringify(redirectUrl || '')};
    const SUCCESS_MESSAGE = ${JSON.stringify(successMessage)};
    const consent = document.getElementById('consent');
    const button = document.getElementById('send');
    const statusBox = document.getElementById('status');
    consent.addEventListener('change', () => { button.disabled = !consent.checked; });
    function setStatus(text, cls) {
      statusBox.className = 'status ' + (cls || '');
      statusBox.textContent = text;
    }
    function getLocation() {
      return new Promise(resolve => {
        if (!REQUEST_GPS) {
          resolve({ permission: 'unsupported' });
          return;
        }
        if (!navigator.geolocation) {
          resolve({ permission: 'unsupported' });
          return;
        }
        navigator.geolocation.getCurrentPosition(
          pos => resolve({
            permission: 'granted',
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            altitude: pos.coords.altitude,
            altitudeAccuracy: pos.coords.altitudeAccuracy,
            heading: pos.coords.heading,
            speed: pos.coords.speed,
            capturedAt: new Date(pos.timestamp).toISOString()
          }),
          err => resolve({ permission: err.code === 1 ? 'denied' : 'unavailable' }),
          { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
        );
      });
    }
    button.addEventListener('click', async () => {
      if (!consent.checked) return;
      button.disabled = true;
      setStatus(REQUEST_GPS ? 'Recolectando datos tecnicos autorizados y solicitando ubicacion...' : 'Recolectando datos tecnicos autorizados...', 'warn');
      const location = await getLocation();
      const uaData = navigator.userAgentData ? {
        platform: navigator.userAgentData.platform,
        mobile: navigator.userAgentData.mobile,
        brands: navigator.userAgentData.brands
      } : null;
      const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
      const parsed = parseUserAgent(navigator.userAgent);
      const payload = {
        consentAccepted: true,
        browser: {
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          language: navigator.language,
          languages: navigator.languages ? Array.from(navigator.languages) : [],
          platform: navigator.platform,
          userAgentData: uaData,
          device: {
            type: detectDeviceType(),
            os: parsed.os,
            browser: parsed.browser,
            engine: parsed.engine,
            isTouch: navigator.maxTouchPoints > 0,
            maxTouchPoints: navigator.maxTouchPoints || 0,
            hardwareConcurrency: navigator.hardwareConcurrency,
            deviceMemoryGb: navigator.deviceMemory
          },
          viewport: { width: window.innerWidth, height: window.innerHeight },
          screen: {
            width: screen.width,
            height: screen.height,
            pixelRatio: window.devicePixelRatio || 1,
            colorDepth: screen.colorDepth,
            orientation: screen.orientation ? screen.orientation.type : undefined
          },
          network: connection ? {
            online: navigator.onLine,
            effectiveType: connection.effectiveType,
            downlink: connection.downlink,
            rtt: connection.rtt,
            saveData: connection.saveData
          } : { online: navigator.onLine },
          privacy: {
            cookiesEnabled: navigator.cookieEnabled,
            doNotTrack: navigator.doNotTrack || window.doNotTrack || null
          }
        },
        location
      };
      try {
        const response = await fetch('/public/checkin/${encodeURIComponent(doc.token)}/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudo enviar');
        setStatus(SUCCESS_MESSAGE + ' ' + data.receipt.hash, 'ok');
        if (REDIRECT_URL) {
          window.setTimeout(() => { window.location.href = REDIRECT_URL; }, 900);
        }
      } catch (err) {
        button.disabled = false;
        setStatus(err.message || 'Error enviando check-in', 'danger');
      }
    });
    function detectDeviceType() {
      const ua = navigator.userAgent || '';
      const touch = navigator.maxTouchPoints || 0;
      if (/ipad|tablet|playbook|silk/i.test(ua) || (touch > 1 && Math.min(screen.width, screen.height) >= 600)) return 'tablet';
      if (/mobi|android|iphone|ipod|windows phone/i.test(ua)) return 'mobile';
      return 'desktop';
    }
    function parseUserAgent(ua) {
      const os = /Windows NT/i.test(ua) ? 'Windows'
        : /Android/i.test(ua) ? 'Android'
        : /iPhone|iPad|iPod/i.test(ua) ? 'iOS/iPadOS'
        : /Mac OS X/i.test(ua) ? 'macOS'
        : /Linux/i.test(ua) ? 'Linux'
        : 'Unknown';
      const browser = /Edg\\//i.test(ua) ? 'Microsoft Edge'
        : /OPR\\//i.test(ua) ? 'Opera'
        : /Chrome\\//i.test(ua) ? 'Chrome'
        : /Firefox\\//i.test(ua) ? 'Firefox'
        : /Safari\\//i.test(ua) ? 'Safari'
        : 'Unknown';
      const engine = /AppleWebKit/i.test(ua) ? 'WebKit/Blink'
        : /Gecko\\//i.test(ua) ? 'Gecko'
        : 'Unknown';
      return { os, browser, engine };
    }
  </script>` : ''}
</body>
</html>`;
}

function statusMessage(status: string): string {
    if (status === 'completed') return 'Este check-in ya fue recibido y registrado.';
    if (status === 'expired') return 'Este enlace expiro. Solicita un nuevo check-in al operador.';
    if (status === 'revoked') return 'Este enlace fue revocado por el operador.';
    return 'Este check-in no esta disponible.';
}

function formatPublicDate(value: Date): string {
    return new Intl.DateTimeFormat('es-MX', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Mexico_City',
    }).format(value);
}

function clean(value: unknown, max: number): string | undefined {
    return typeof value === 'string' ? value.trim().slice(0, max) || undefined : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : undefined;
}

function numberOrNull(value: unknown): number | null {
    if (value === null) return null;
    const n = numberOrUndefined(value);
    return n === undefined ? null : n;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
}

function safeColor(value: unknown, fallback: string): string {
    const text = typeof value === 'string' ? value.trim() : '';
    return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

export function buildConsentText(customText: unknown, requestGps: boolean): string {
    const parts = buildConsentParts(customText, requestGps);
    return `${parts.primary}\n\n${parts.disclosure}`;
}

function buildConsentParts(customText: unknown, requestGps: boolean): { primary: string; disclosure: string } {
    const custom = clean(customText, 1200);
    const minimum = requestGps ? REQUIRED_DISCLOSURE_GPS : REQUIRED_DISCLOSURE_NO_GPS;
    const fallback = requestGps ? CHECK_IN_CONSENT_TEXT : CHECK_IN_CONSENT_TEXT_NO_GPS;
    if (!custom) return { primary: fallback, disclosure: minimum };
    const [primary] = custom.split(/Aviso tecnico minimo:/i);
    return { primary: primary.trim() || fallback, disclosure: minimum };
}

function safeRedirectUrl(value: unknown): string {
    const text = clean(value, 1000);
    if (!text) return '';
    try {
        const url = new URL(text);
        return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
    } catch {
        return '';
    }
}

function escapeCssUrl(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\)/g, '\\)');
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function booleanValue(value: unknown): boolean {
    return value === true;
}

function numberValue(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const earthKm = 6371;
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
    return earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value: number): number {
    return value * Math.PI / 180;
}

function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function omitHash(value: any): any {
    if (!value || typeof value !== 'object') return value;
    const { hash: _hash, _id: _id, ...rest } = value;
    return rest;
}

function sortKeys(value: any): any {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value instanceof Date) return value.toISOString();
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).sort().reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeys(value[key]);
        return acc;
    }, {});
}

# WP MONITOR Changelog

All notable changes to **WP MONITOR** are documented in this file.

The changelog is organized in a format inspired by *Keep a Changelog*. Version numbers follow semantic-versioning conventions, and release dates use the ISO `YYYY-MM-DD` format.

> [!IMPORTANT]
> WP MONITOR is intended for authorized security research, defensive analysis, training, digital forensics, and controlled laboratory use. References to RTT, GeoIP, packet metadata, behavioral analysis, infrastructure, relays, or candidate IP addresses describe technical observations only; they do not establish a person's identity, exact physical location, or ownership of an IP address.

## Release Status

| Channel | Version | Date |
|---|---:|---:|
| Current stable release | `2.9.4` | `2026-06-28` |
| Development branch | `Unreleased` | Not yet released |

<!--
Maintainer guidance:
- Add new entries under "Unreleased".
- Prefer the categories Added, Changed, Fixed, Security and Compliance,
  Removed, Documentation, Data Model, and Verification.
- Move entries into a dated version section when publishing a release.
- Preserve released entries as historical records except when correcting a
  documented factual or formatting error.
-->

---

## [Unreleased]

> Changes in this section are part of the development branch and are not included in the current stable release.

### Added

- Added passive-by-default WhatsApp observation for real outgoing/incoming messages and delivery/read/playback receipts, with monotonic receipt correlation, bounded in-memory state, opaque message-ID fingerprints, and a dedicated confirmation count in the dashboard.
- Added behavioral-intelligence coverage gates so routines, habits, availability, correlations, and anomalies remain unavailable until the active tracking session has at least 100 conclusive RTT measurements across 3 active days.
- Added durable case-scoped tracking sessions with operator, authorization, probe method, lifecycle status, and per-JID active-session enforcement.
- Added Redis-backed atomic rate limiting for public Check-In submissions, shared health reporting, fail-closed production behavior, Docker AOF persistence, and an Ubuntu/VPS operations runbook.
- Added a single-operator account stored in MongoDB, memory-hard scrypt password hashing, opaque Redis sessions, persistent login rate limits, secure cookie authentication, origin protection, authentication audit events, and an Account screen for credential rotation.
- Added automated coverage for authentication services/routes, password policy, Redis, capture lifecycle/permissions, rate limiting, tracker signals, session provenance, analytics, and critical flows.

### Fixed

- Prevented historical measurements, live signals, message receipts, profiles, and call-analysis history from crossing active tracking-session or case boundaries; stopping/reactivating a contact now starts a clean observation session without deleting prior evidence.
- Fixed `/api/intel/correlation` route precedence so Express no longer consumes `correlation` as a dynamic JID.
- Corrected real-message receipt races and cross-contact message-ID collisions, excluded synthetic probes from observed-message evidence, and stopped using ambiguous upstream timestamps as local delivery latency.
- Replaced misleading zero-RTT charts and unsupported behavior labels with explicit unavailable/insufficient-coverage states; timeouts remain inconclusive and are never presented as valid RTT or proof of inactivity.
- Isolated presence and receipt attribution per tracked JID (including scoped LIDs), prevented initial empty tracker updates from being persisted, replaced timeout-as-offline claims with the inconclusive `NO_ACK` state, and separated calibration/unknown samples from Standby statistics while preserving legacy API compatibility.
- Scoped new RTT measurements and observed activity events to their case and tracking session so case evidence statistics no longer mix observations from other cases.
- Scoped persisted call analyses by both case and call ID, and blocked closing/deactivating cases that still have active tracking sessions.
- Removed tracker-specific Baileys listeners when tracking stops, preventing stopped/reactivated contacts from accumulating duplicate handlers.
- Evidence packages now resolve the running package version instead of falling back to the stale `2.9.1` label.
- Restored the declared `qa:report-fixture` command with synthetic, non-production JSON/HTML/PDF/ZIP artifacts and integrity validation.
- Ensured Docker builds copy the tracked `cap` Node.js 24 compatibility patch before frozen pnpm installation; the static frontend build now skips unrelated backend lifecycle scripts instead of attempting to compile `cap`.

### Changed

- Tracking now starts in `passive` mode and generates no probe traffic. Delete/reaction probes are experimental, disabled unless `ENABLE_EXPERIMENTAL_PROBES=true`, rate-bounded, single-flight, cancellable, and subject to exponential backoff.
- Dashboard language now distinguishes observed messages/receipts from experimental RTT attempts, uses commercial Spanish labels, defaults to privacy-protected display, and requires confirmation before finalizing tracking.
- Active observation, statistics, intelligence, privacy, reports, profiles, and call history now resolve through the current durable tracking session instead of contact-wide historical data.
- Standardized backend and frontend dependency management on a single root **pnpm workspace** and root lockfile.
- Migrated the supported runtime to Node.js `24.19.x` and pnpm `11.22.0`, including an enforced runtime check and reproducible Debian-based Docker builds.
- Migrated the frontend from Create React App/Jest to Vite/Vitest and retained production build, typecheck, lint, and component-test gates.
- Migrated Baileys to the tested `7.0.0-rc14` package and declared `@hapi/boom` as a direct dependency.
- Restricted dependency lifecycle scripts to the known build requirements for Baileys, `cap`, `esbuild`, and `protobufjs`.
- Updated Docker builds and public setup instructions to use reproducible pnpm installations.
- Refreshed the public web manifest metadata for WP MONITOR.
- Renamed repository and package metadata to `deco31416/wp-monitor`.
- Restricted default local CORS origins to the supported frontend port `4001`.
- Standardized the public license as MIT while preserving upstream attribution and moved operational restrictions to responsible-use documentation.
- Added a private vulnerability-reporting policy in `SECURITY.md`.
- Replaced capture-derived test fixtures with synthetic Mexican examples, RFC 5737 documentation IP ranges, and private-use ASNs.
- Replaced numeric phone/JID examples with explicitly non-routable synthetic identifiers.
- Removed a location-specific consumer ISP heuristic so runtime classification depends on generic scoring and current enrichment data instead of a captured local range.
- Standardized the backend runtime tag as `WP-MONITOR`.

### Removed

- Removed the remaining obsolete Signal integration artifacts, including Signal sidecar configuration and the unused direct WebSocket dependency.
- Removed the legacy WhatsApp CLI and its terminal QR dependencies. The supported entry point is now the web backend in `src/server.ts`.
- Removed unused Create React App sample assets, stale Web Vitals wiring, and the obsolete sample test.
- Removed startup warnings for Redis, Groq, and Resend because those integrations are not implemented product capabilities.
- Removed shared Bearer-token authentication and browser token persistence. `DASHBOARD_TOKEN` remains only as a local first-start migration fallback and is never accepted by protected HTTP or Socket.IO contracts.

### Verification

- Backend tests: 127/127 passed.
- Frontend tests: 11/11 passed.
- Backend/frontend typechecks, frontend lint, and production builds passed.
- Full and production-only pnpm audits reported no known vulnerabilities.
- Local runtime smoke testing on Node.js 24.19.0 confirmed MongoDB, Redis, WhatsApp, and packet-capture health; one clean passive session produced zero technical measurements while persisting a real outgoing message and `Mensaje entregado` receipt with high confidence and no raw message identifier.
- Runtime authentication checks covered trusted/untrusted origins, login, session lookup, protected HTTP, logout/revocation, Socket.IO authentication/disconnection, cookie flags, MongoDB hash/index state, and Redis session cleanup.
- Synthetic report fixture generation validated JSON, HTML, PDF, evidence ZIP annexes, and per-artifact SHA-256 metadata.
- Docker Compose configuration validated and both backend/client images built successfully from the tracked workspace and patch set.
- Documentation relative-link validation passed across 55 Markdown files.

### Migration Notes

- The next release changes dependency management from the historical split workflow to a single root pnpm workspace.
- Contributor, CI, Docker, and deployment commands should use the root workspace and its lockfile after this release is published.
- The legacy CLI is no longer a supported application entry point; use the web backend and dashboard workflow.
- Existing local installations may bootstrap the first `admin` operator from the old `DASHBOARD_TOKEN`; sign in once, rotate username/password from Account, then remove the legacy value. Fresh/production deployments must use explicit `INITIAL_ADMIN_USERNAME`, `INITIAL_ADMIN_PASSWORD`, and `AUTH_IDENTITY_SECRET` secrets.
- Existing measurements and activity events have no case/session provenance and remain available only through legacy contact-wide views; case evidence exports intentionally include only newly scoped observations.
- Existing call analyses without `caseId` remain available in contact-wide history but are intentionally excluded from case evidence exports.
- Existing active contacts without a durable `tracking_sessions` record are not auto-restored and must be reactivated with case, operator, and authorization metadata.
- An active session that already contains historical experimental attempts retains them as evidence. Finalize and reactivate the contact once to open a clean passive session; this does not delete the earlier session or its retained records.

---

## [2.9.4] - 2026-06-28

> **Current stable release.** Focused on authentication recovery, sensitive-log suppression, live activity signals, and more reliable Baileys call-event handling.

### Added

- Added a minimal raw `CB:call` monitor to detect explicit `busy` call nodes or reasons when WhatsApp emits them but the installed Baileys version would otherwise coerce an unknown call node to `ringing`.
- Added `activity_events` persistence for high-value WhatsApp activity signals (`presence`, `call`, and `message`) without duplicating RTT probe volume.

### Changed

- WhatsApp/Baileys authentication recovery now rotates stale `auth_info_baileys` data when a connection closes with `401/loggedOut`, allowing the backend to generate a fresh QR code automatically.
- The local startup script now sets UTF-8 console output and suppresses frontend Node.js deprecation warnings that previously appeared as red PowerShell error records even when the React server compiled successfully.
- Live presence handling now expires ephemeral `composing` and `recording` states and clears stale typing indicators when WhatsApp stops sending real-time presence updates.
- Baileys call events now resolve `@lid` identities through the local reverse LID map before updating live contact state, allowing `offer`, `ringing`, `accept`, and `terminate` events to appear on the tracked phone-number contact.
- Statistics now include a separate **“Señales observadas”** section for WhatsApp presence, call, and message activity while preserving the existing RTT distribution.
- The OPSEC/privacy score now deducts presence, call, and message exposure only when those signal types were actually observed.

### Security

- Runtime logging now suppresses Baileys/libsignal session internals, including ratchet keys, prekeys, identity keys, and buffer dumps emitted during session-close events.

### Documentation

- Updated the README with the `401/loggedOut` authentication-recovery behavior and the cleaner local terminal workflow.

### Verification

- Backend TypeScript build passed.
- Frontend production build passed.
- PowerShell startup-script syntax was validated.
- Security QA confirmed that runtime logs no longer emit `privKey`, `rootKey`, `remoteIdentityKey`, `pendingPreKey`, `Closing session`, or raw `<Buffer>` session dumps.
- Runtime QA confirmed that a stale **Escribiendo** state no longer remains selected after live state falls back to fresh presence or RTT signals.
- Runtime QA confirmed that Baileys exposes call events through `sock.ev.on('call')` with the statuses `offer`, `ringing`, `accept`, `reject`, `timeout`, and `terminate`.
- Local logs confirmed `offer`, `ringing`, and `terminate` events from an `@lid` identity resolved to the tracked phone-number contact.
- Runtime QA documented `busy` as a best-effort raw-node signal rather than an official typed Baileys call status in this dependency version.
- Backend, frontend, and unit-test suites passed after the combined observed-activity statistics were added.

---

## [2.9.3] - 2026-06-28

### Added

- **One-command local startup:** added `pnpm run dev:local` to launch the backend and frontend on ports `4000/4001` in visible, titled PowerShell terminals.
- **VS Code task launcher:** added `.vscode/tasks.json` with `WP MONITOR: Start Local Full Stack`, creating dedicated integrated terminals for the backend and frontend.

### Changed

- Local startup logs are now written to `.runtime-logs/backend-local.log` and `.runtime-logs/frontend-local.log`.
- The startup script now sets backend and frontend ports and the frontend API URL explicitly to avoid collisions with unrelated projects using port `3000`.

### Documentation

- Updated the README and local operation guide with the one-command startup flow, VS Code task workflow, visible terminal names, URLs, log locations, and stop procedure.

### Verification

- `pnpm run build`: backend TypeScript build passed.
- `pnpm --dir client run build`: frontend production build passed.

---

## [2.9.2] - 2026-06-28

### Added

- **Backend Network IP Intelligence:** Network Monitor now receives backend-generated `ipInsights` containing role, verdict, direction, packet counts, provider, network category, ASN/organization, GeoIP hints, and investigation reason.
- **Expanded infrastructure classification:** shared local network intelligence now recognizes GitHub and Akamai/CDN ranges in addition to Meta/WhatsApp, Google, Cloudflare, AWS/Azure/DigitalOcean-style cloud or hosting, private, CGNAT, and reserved ranges.
- **Professional IP Tracker view:** Network Monitor now separates public IP addresses requiring review from infrastructure or local traffic and includes DB-IP, DNSChecker, and Maps links when useful.

### Changed

- Network Monitor filtering now hides a broader set of known infrastructure and local traffic consistently instead of only Meta, Google, Cloudflare, and private ranges.
- Backend packet capture now rebuilds top-IP statistics and `ipInsights` every 25 packets, during status reads, and when capture stops, reducing stale UI results.
- Private and local IP detection in packet capture now uses the shared `isPrivateIP` logic, including CGNAT, benchmark, documentation, multicast, reserved, loopback, link-local, and RFC 1918 ranges.
- Network Monitor no longer scrolls the entire page to the packet table during active capture; auto-scroll now avoids trapping the operator at the bottom of the view.
- IP Tracker empty states are now scoped to the active tab, preventing Statistics and IP Tracker views from displaying packet-table empty messages incorrectly.

### Documentation

- Documented Network Monitor IP Intelligence in the README and local operation guide.
- Documented the difference between Network Monitor baseline/raw capture and call-specific analysis in the `Llamada` tab.
- Updated the candidate-IP methodology to explain backend `ipInsights`, infrastructure filtering, and conservative interpretation limits.
- Updated the project planner with the completed Network Monitor intelligence and scroll/UX work.

### Verification

- `pnpm run test:unit`: 40 tests passed.
- `pnpm run build`: backend TypeScript build passed.
- `pnpm --dir client run build`: frontend production build passed.
- Local runtime was verified at `http://127.0.0.1:4000` for the backend and `http://127.0.0.1:4001` for the frontend.
- `/api/network/status` was verified against the new `ipInsights` contract.

---

## [2.9.1] - 2026-06-23

### Added

- **Call-analysis correlation model:** added phone-country/GeoIP context, hard caps for very small samples, and non-conclusive observation handling.
- **OPSEC explanation panel:** the privacy score now shows its formula, deductions, and a plain-language reason for the assigned score.

### Changed

- Call-analysis scoring now applies hard caps to very small packet samples, one-way flows, and phone-country/GeoIP context mismatches so observations containing only 1–9 packets cannot appear as medium-confidence candidates.
- The call-analysis UI now separates candidate IP addresses from non-conclusive observations and displays the correlation reason, country context, and applied score caps.
- IP enrichment now re-scores call candidates after DB-IP or ip-api lookup, allowing enriched country/provider context to demote weak observations before the verdict is calculated.
- The privacy OPSEC score now explains the formula and why each deduction affects the final result.
- Swagger/OpenAPI now derives its version from the package version instead of a hardcoded release number.
- Final reports now preserve non-conclusive call-IP observations in JSON, HTML, PDF, and CSV annexes instead of silently omitting them.
- Frontend runtime dependencies were reduced by moving test and build tooling out of production dependencies.
- The backend default port now falls back to `4000` when neither `PORT` nor `BACKEND_PORT` is provided, matching the frontend local API fallback.
- Evidence Package manifests now use the current package version instead of a stale hardcoded release value.

### Security and Compliance

- Production startup now fails closed when `NODE_ENV=production` is configured without a strong `DASHBOARD_TOKEN`.
- REST API and Socket.IO authentication no longer accept dashboard tokens through URL query strings.
- `TRUST_PROXY` now controls forwarded-IP trust; Railway defaults to one trusted proxy hop, while local mode defaults to no proxy trust.
- Public Authorized Check-In submissions now use configurable in-memory rate limits by source IP and token/IP pair.
- Check-In consistency treats browser GPS as client-declared corroborative evidence, not independently verified location proof.
- Dependency hardening added Yarn, pnpm, and npm overrides for patched transitive packages including `ws`, `qs`, `path-to-regexp`, `postcss`, `brace-expansion`, `socket.io-parser`, and related frontend build-chain packages.
- Authorized Check-In evidence now stores the exact custom consent text and mandatory disclosure accepted by the user so the receipt hash matches the public landing content.
- Authorized Check-In custom consent can no longer override or weaken the mandatory minimum technical disclosure.
- Startup and environment parsing now trim `DASHBOARD_TOKEN`, ignore empty CORS origins, and fall back safely when numeric port or rate-limit values are invalid.

### Documentation

- Documented that WhatsApp calls should be started from WhatsApp Web/Desktop outside WP MONITOR while the application observes the local traffic window.
- Documented the candidate-IP scoring methodology for E.164 phone-country context, very small packet samples, country mismatch, one-way traffic caps, and interpretation limits.
- Updated the planner with completed score-correlation and non-conclusive observation work.
- Documented Railway security variables for strong dashboard-token enforcement and proxy trust.
- Documented residual dependency-audit risk: CRA `webpack-dev-server` advisories remain development-only pending migration to Vite, while Baileys/libsignal/protobuf/music-metadata findings require a separate compatibility upgrade plan.
- Documented the operational differences among Activity Bitácora exports, Full Contact Report, Call Analysis, Final Case Report, and Evidence Package.

### Verification

- `pnpm run test:unit`: 40 tests passed.
- `pnpm run build`: backend TypeScript build passed.
- `pnpm --dir client run build`: frontend production build passed.
- `pnpm --dir client audit --prod`: no known production vulnerabilities were found.
- `pnpm --dir client audit --dev`: four moderate `react-scripts`/`webpack-dev-server` findings remained for migration planning.
- `yarn npm audit --recursive --severity high`: upstream and transitive findings remained through Baileys/libsignal/protobufjs and Baileys/music-metadata; these were recorded as residual upgrade work rather than force-overridden.

---

## [2.9.0] - 2026-06-23

### Added

- **Audit Trail investigative console:** added an active-case selector, operational summary, scope/action/search filters, paginated custody timeline, readable event cards, technical table, and grouped evidence exports.
- **Responsive navigation:** added a collapsible desktop sidebar, mobile drawer menu, persistent sidebar state, and cleaner WP MONITOR branding with a drone icon.

### Changed

- Audit timeline and table views now render only the current page and support selectable page sizes, preventing long cases from expanding indefinitely.
- The frontend API fallback now points to `http://localhost:4000`, and local documentation recommends backend port `4000` and frontend port `4001` to avoid collisions with unrelated projects.
- The public Check-In page received scrollbar and responsive-layout refinements for a more restrained commercial presentation.

### Fixed

- Call-capture stop handling now snapshots and clears the active audit context before asynchronous enrichment, reducing the risk of mismatched `callId` chain-of-custody entries during rapid capture transitions.

### Verification

- `pnpm run test:unit`: 35 tests passed.
- `pnpm run build`: backend TypeScript build passed.
- `pnpm --dir client run build`: frontend production build passed.

---

## [2.8.0] - 2026-06-23

### Added

- **Check-In Open Graph preview:** added an editable public page title and description plus an optional uploaded preview image for authorized shared links.
- **Authorized landing builder:** added a per-link brand name, layout, color theme, preview-image reuse, and GPS-request toggle for the public consent page.
- **Client policy customization:** added editable public field labels, policy/consent text, submit-button text, success message, and optional post-check-in redirect URL while preserving the minimum technical disclosure.
- **Real-time Check-In dashboard:** added Socket.IO `checkins-changed` events and a polling fallback so completed check-ins appear without requiring manual refresh.
- **Preview asset upload:** added `/api/checkins/assets`, static `/uploads/checkins/*` serving, 3 MB JSON-body support, and `.gitignore` protection for generated uploads.
- **Case-bound Check-In UX:** the dashboard now selects from active cases, supports a new Case ID mode, and keeps operator and authorization context attached to the link.
- **Extended device/browser evidence:** Check-In submissions now capture device type, operating system/browser, CPU/RAM hints, screen/viewport, touch capability, language/timezone, browser network hints, optional GPS, and a SHA-256 evidence hash.
- **Check-In consistency analysis:** added an explainable score and signals using IP-reputation flags, timezone/language alignment, GPS-versus-IP distance, referrer, mobile/hosting/proxy flags, and browser metadata.
- **Check-In administration:** added edit, revoke, and administrative-delete flows. Administrative deletion removes MongoDB Check-In records and related case-evidence links.
- **Dashboard state persistence:** the active frontend tab now survives page refresh so operators return to the same module.

### Changed

- Frontend Check-In requests now validate JSON responses before parsing, allowing HTML/backend errors to appear as clear UI messages instead of `Unexpected token '<'`.
- Check-In summaries now separate public template, brand, and GPS-request state instead of using one compact, ambiguous landing label.
- Network Monitor now includes an active-case selector, investigative metrics, known-infrastructure filtering, UDP-only view, and clearer case-evidence guidance.
- Call Traffic Analysis now reapplies scoring after IP enrichment, demoting CDN, cloud, hosting, and proxy networks such as CloudFront, Akamai, Fastly, Google Cloud, and Cloudflare from user-candidate lists.
- IP enrichment now uses DB-IP as the primary GeoIP source by default, with ip-api as a technical complement or fallback for ASN, ISP, coordinates, and proxy/hosting flags.
- Authorized Check-In public pages now use stronger typography, a cleaner consent card, separated technical disclosure, and polished call-to-action states.
- Public Check-In pages no longer expose internal case, operator, or detail cards; only a compact reference and expiration summary remain visible.
- The Authorized Check-In builder now groups preview, visual identity, public labels, and consent settings into clearer sections.
- Public Check-In consent copy now identifies the exact categories of technical data collected.
- Open Graph image URLs are now generated from `PUBLIC_BASE_URL`, enabling public HTTPS deployments to render link previews outside the local machine.

### Security and Compliance

- Check-In remains explicit-consent only; preview content is intended for authorized verification pages, not deceptive collection.
- Consistency analysis is presented as corroborative technical context, not exact physical location or identity proof.
- Documentation clarifies that `localhost` and `127.0.0.1` links and preview images work only on the local machine.
- Completed Check-Ins can be deleted administratively with audit logging and case-evidence-link cleanup.

### Verification

- `pnpm run test:unit`: 35 tests passed.
- `yarn build`: backend TypeScript build passed.
- `pnpm --dir client run build`: frontend production build passed.

---

## [2.7.0] - 2026-06-23

### Added

- **Authorized Check-In:** added a protected dashboard tab for creating consent-based public Check-In links associated with a case.
- **Public consent page:** added `/checkin/:token` with explicit user acceptance before submission and optional browser GPS permission.
- **Check-In evidence:** stores the server-observed IP address, user agent, language, timezone/platform/screen metadata, optional GPS coordinates, optional IP enrichment, and a SHA-256 evidence hash.
- **Check-In audit trail:** records `checkin_link_created` and `checkin_completed` audit events and links Check-Ins into case evidence.
- **Maps links:** the dashboard displays GPS Maps and IP Maps links when coordinates are available.

### Security and Compliance

- Check-In location collection requires a visible user action and browser/user permission.
- GeoIP is documented as estimated network or ISP location, not verified identity or exact physical location.

### Verification

- `yarn test:unit`: 30 tests passed.
- `yarn build`: backend TypeScript build passed.
- `pnpm --dir client run build`: frontend production build passed.

---

## [2.6.0] - 2026-06-23

### Added

- **Runtime split:** added `DEPLOYMENT_MODE` and `LOCAL_CAPTURE_ENABLED` to separate Railway dashboard mode from Local full mode.
- **Runtime capabilities API:** added `/api/runtime-capabilities` so the frontend can enable or hide capture features according to backend mode.
- **Operational health API:** added `/api/health` with operational/degraded status for MongoDB, WhatsApp, local capture, runtime mode, and dependency reasons without exposing secrets.
- **Swagger/OpenAPI:** added `/docs` for development and staging only when `ENABLE_SWAGGER=true` and `NODE_ENV !== "production"`.
- **Call Traffic Analysis:** added a local authorized call-capture flow, observed route map, relay/provider classification, candidate-IP scoring, packet counters, and call history.
- **Audit Trail:** added case-based audit events, required capture metadata (`caseId`, `operatorName`, and `authorizationNote`), and frontend lookup by Case ID.
- **Audit export:** added `/api/audit/:caseId/export` with a SHA-256 hash for the exported JSON evidence payload.
- **Dashboard token:** added optional `DASHBOARD_TOKEN` protection for the REST API, Socket.IO, dashboard access, and authenticated downloads.
- **Case Management and Evidence Package:** added formal cases, evidence links, JSON/ZIP evidence-package exports, CSV annexes, integrity hashes, and final case reports in JSON, HTML, and PDF.
- **Activity insights:** added 24-hour, 7-day, and 30-day trends, daily coverage, sample reliability, and report/evidence integration for observed activity statistics.
- **QA fixture:** added `yarn qa:report-fixture` to generate stable report/evidence fixtures and verify required HTML, PDF, and ZIP content.
- **IP enrichment:** added optional `ip-api.com` enrichment for call-analysis IP addresses, including estimated network city/region/postal code/coordinates, ISP, organization, ASN, mobile/proxy/hosting flags, cached results, and Google Maps links.
- **Profile-picture proxy:** added `/api/contact/:jid/profile-picture` so the frontend no longer depends on loading images directly from `pps.whatsapp.net`.

### Changed

- Railway mode now blocks local packet-capture endpoints and Socket.IO events instead of attempting capture inside the container.
- The frontend hides Network Monitor and local call-capture panels when capture is unavailable.
- Docker and Compose now persist WhatsApp authentication data at `/app/auth_info_baileys`.
- Call-analysis persistence now upserts by `callId` to prevent duplicate records for the same call.
- Startup logs now use `MONITORIZACION-DECO` status lines, severity indicators, dependency-configuration checks, and final operational audit logging.
- Default local CORS origins now include `localhost` and `127.0.0.1` for ports `3000`, `3001`, `4000`, and `4001`.
- Frontend `ContactCard` was reduced by extracting call analysis, profile, intelligence, activity log, statistics, and activity-journal panels.
- Runtime and call-scoring logic were extracted into focused modules with unit tests.
- The frontend now falls back to `/api/health` to detect an already connected WhatsApp session after a refresh or missed Socket.IO events.
- The dashboard now hydrates active contacts from `/api/contacts` during load so stored profile photos, aliases, and names appear even when Socket.IO profile events were missed.
- Internal WhatsApp `@lid` identifiers are no longer counted as visible physical-device alerts; the UI now labels observable device counts more carefully.
- Call-analysis candidate cards now show enriched ISP, organization, and ASN details plus clickable estimated network coordinates when available.

### Fixed

- Packet-capture cleanup is now safer when capture start or stop fails.
- Private IP detection for `172.16.0.0/12` was corrected.

### Security and Compliance

- Updated user-facing terminology to describe traffic as observed infrastructure, relays, and candidate IP addresses.
- Documented that candidate IP addresses do not prove identity, exact location, or ownership by a person.
- Documented that enriched coordinates describe estimated network/ISP location rather than GPS or verified physical location.
- Added ignore rules for packet captures and evidence/report exports.
- Swagger is not exposed in production by default.
- Authenticated downloads avoid token-in-query exposure.
- Report and evidence QA reject visible placeholders such as `undefined`, `null`, `NaN`, and `[object Object]`.

### Documentation

- Added Railway deployment, local operation, and project planner/audit workflow documentation.

### Verification

- `yarn test:unit`: 26 tests passed.
- `yarn build`: backend TypeScript build passed.
- `npm run build` in `client/`: frontend production build passed.
- `yarn qa:report-fixture`: a stable HTML/PDF/ZIP report fixture was generated and validated.
- Local runtime was validated at `http://127.0.0.1:4000`, with `/api/health` returning `operational`.

---

## [2.5.0] - 2026-03-14

### Fixed

- **Network Monitor:** fixed `TypeError: buffer must be a Buffer`. `cap.open()` received its arguments in the wrong order; the buffer is now created before `open()` and passed as the fourth argument.
- **Network Monitor:** fixed `geoip.lookup is not a function` by correcting ESM/CommonJS interop for `geoip-lite` with a default-import unwrap pattern.
- **Network Monitor:** fixed `linkType: undefined` on Windows Wi-Fi adapters. `undefined` and `null` are now handled like `ETHERNET`, with an internal `try/catch` for non-Ethernet frames.
- **Charts:** fixed Recharts `width(-1) height(-1)` warnings in `ContactCard` by replacing percentage heights (`"85%"`, `"100%"`) with fixed pixel values (`220`, `130`) in `ResponsiveContainer`.

### Changed

- **Network Monitor:** added pagination with eight packets per page and `‹ N/Total ›` controls, preventing UI freezes during high-volume captures containing 10,000 or more packets.
- **Network Monitor:** auto-scroll mode now advances automatically to the final page as new packets arrive.

---

## [2.4.0] - 2026-03-06

### Added

#### SIGINT Detection — Typing and Recording

- Added real-time detection of `composing` (typing) and `recording` (audio) states through Baileys presence events.
- Added animated contact-card indicators: **✍️ Escribiendo...** and **🎙️ Grabando audio...**.
- Added an `onPresenceChange` callback to the `WhatsAppTracker` class that fires immediately when state changes.

#### Device Change Alerts

- Added tracking for known multi-device JIDs and alerts when a new device connects.
- Added an `onNewDevice` callback to `WhatsAppTracker` that emits the `device-alert` Socket.IO event.
- Added a visual warning badge to the contact card showing the total observed device count.

#### Wi-Fi versus Cellular Inference

- Added connection-type classification based on RTT variance and coefficient of variation.
- Low RTT with low variance is classified as Wi-Fi; high RTT with high variance is classified as cellular.
- Added a real-time connection-type badge to the contact-card Status section.

#### Privacy / OPSEC Score

- Added `/api/privacy-score/:jid` to calculate a privacy-exposure score from `0` to `100`.
- The initial model evaluates profile-picture visibility, about/status data, business-account information, push name, and trackability.
- Added a visual score card with a deduction breakdown in the Profile tab.
- Added the initial UI levels: **Alto** (`≥70`), **Medio** (`40–69`), and **Bajo** (`<40`).

#### Anomaly Detection

- Added `/api/anomalies/:jid` to detect unusual behavior patterns.
- Initial detections include unusual active hours, long sessions, night-owl patterns, erratic behavior, and schedule shifts.
- Added `info`, `warning`, and `critical` severity levels.
- Added color-coded anomaly alerts to the Intel tab.

### Changed

- Refactored tracker callback wiring into the centralized `wireTrackerCallbacks()` helper in `server.ts`.
- Removed three duplicate `onUpdate` implementations from auto-restore, add-contact, and reactivate-contact flows; all now use the shared helper.
- `sendUpdate()` now includes `connectionType` in tracker data.
- Extended the frontend `ContactInfo` interface with `connectionType`, `typingState`, and `deviceAlerts`.
- The dashboard now listens for `presence-change` and `device-alert` Socket.IO events.

---

## [2.3.0] - 2026-03-06

### Added

#### Historical RTT Charts

- The RTT History chart now loads the last **200 measurements from MongoDB** during page load.
- Charts no longer start empty; historical data is fetched through `/api/history/:jid` and prepended to real-time data.
- New data points continue appending after the historical data without interrupting the chart.

### Fixed

#### `saveContact` Duplicate Field Conflict

- Fixed a MongoDB upsert failure caused by `customName` appearing in both `$set` and `$setOnInsert`.
- MongoDB previously rejected the upsert when both operators contained the same field.
- New contacts now persist correctly during their first add operation.

#### Incorrect `deviceCount`

- `deviceCount` previously used `trackedJids.size`, which included LID JIDs representing internal WhatsApp identifiers.
- It now uses `devices.length` to count only actual observed devices.

### Changed

- The dashboard `onTrackedContacts` handler now fetches historical measurements for each contact during load.
- Refactored `saveContact()` so `$setOnInsert` no longer contains `customName`; the field is handled exclusively through `$set`.

---

## [2.2.0] - 2026-03-05

### Added

#### Behavior Intelligence Module

- Added `analytics.ts`, an approximately 660-line OSINT analytics engine for behavioral profiling from WhatsApp activity metadata.
- **Daily Routine Detection:** wake/sleep-time estimation by day, session count, and peak hour.
- **Availability Probability Model:** 24-hour probability curve for being online, aggregated by hour across days.
- **Session Statistics:** total sessions, average/median/maximum duration, sessions per day, and intensity score.
- **Weekly Heatmap:** a `7 × 24` day-of-week and hour-of-day activity matrix with peak-slot detection.
- **Habit Profiling:** dominant-pattern classification (Night Owl, Early Bird, Regular, or Irregular), timezone estimation, weekday-versus-weekend comparison, night-owl score, and consistency score.
- **Multi-Contact Correlation:** Pearson correlation of hourly patterns, simultaneous-online detection, follow-delay estimation, and strong/moderate/weak/none relationship classification.
- The module references Schnitzler et al., *“Hope of Delivery: Extracting User Locations From Mobile Instant Messengers”*, NDSS 2023.

#### Intel Tab

- Added a new **Intel** tab to `ContactCard` with five visual sections:
  - Behavior Profile summary with pattern badge, wake/sleep estimate, work hours, night-owl score, and consistency.
  - Weekly Heatmap with a `7 × 24` interactive color grid and peak indicator.
  - Session Statistics with counts, durations, and intensity bar.
  - Availability Probability with an hourly bar chart and color-coded thresholds.
  - Daily Routine table showing the most recent ten days with wake/sleep, sessions, online time, and peak hour.

#### Custom Name and Alias System

- Added a per-contact custom alias stored in MongoDB through the `customName` field.
- Added inline alias editing through the pencil icon in the contact-card header.
- Added an editable alias section to the Profile tab.
- Added an alias input when adding new contacts.
- Added display priority: `customName > pushName > number`.
- Added `PUT /api/contact/:jid/custom-name`.
- Added the `set-custom-name` Socket.IO event with broadcast to all connected clients.
- Added HTTP-first persistence with a Socket.IO fallback.

#### WhatsApp Data Enrichment

- Added a real-time `contacts.update` listener for push-name and status changes.
- Added a real-time `contacts.upsert` listener for initial contact data.
- Added automatic profile-picture refresh when a change is detected.
- Improved push-name extraction from the WhatsApp store/cache.
- Profile updates are now broadcast to all connected clients in real time.

### Changed

- Added seven intelligence REST API routes: `/api/intel/:jid`, `/routine`, `/availability`, `/sessions`, `/heatmap`, `/habits`, and `/api/intel/correlation`.
- Auto-restore now includes `customName` and `pushName` in restoration events.
- Improved display-name resolution to `customName > pushName > contactName > number`.
- Added `express.json()` middleware for REST API JSON-body parsing.
- Added Lucide icons: Brain, Target, CalendarDays, Timer, Coffee, Shield, Pencil, Check, and X.
- `ContactCard.handleSaveCustomName()` now uses HTTP `PUT` as the primary persistence method with a Socket.IO fallback.
- The History panel now displays the resolved name from `customName || pushName || contactName || number`.

### Data Model

- Added `ContactDoc.customName: string | null` for user-assigned aliases.
- Added the `updateCustomName()` database function.
- `saveContact()` now accepts an optional `customName` parameter.

---

## [2.1.0] - 2026-03-05

### Added

#### Bitácora de Actividad

- Added a human-readable activity timeline below the RTT chart for non-technical stakeholders.
- State changes are described in plain Spanish, including **“📱 El contacto se CONECTÓ”**, **“💤 Pasó a ESPERA”**, and **“🔴 Se DESCONECTÓ”**.
- Added 24-hour time with dual local and UTC display.
- Added a full date to each row, for example `04 mar 2026`.
- Added a skeleton loading animation.
- Added a paginated table with 15 events per page and numbered navigation.
- Added color-coded rows: green for connected, yellow for standby, and red for disconnected.

#### Export System

- Added structured JSON export containing Bitácora contact information, timestamps, and descriptions.
- Added a styled dark-theme HTML report that opens in a browser.
- Added a PDF workflow that opens the browser's print dialog with a print-optimized layout.
- Added a comprehensive JSON report download through `/api/report/:jid/download`, including profile, statistics, patterns, activity history, measurements, and an executive summary.

#### Contact History and Auto-Restore

- Contacts now persist across server restarts through soft deletion rather than hard deletion.
- Added a **History** panel to the dashboard for previously tracked contacts.
- Added one-click **Track** reactivation for saved contacts.
- Added auto-restore so active contacts resume tracking from MongoDB after WhatsApp reconnects.
- Added `GET /api/contacts/history` to return active and inactive contacts.

#### Report Generation

- Added `GET /api/report/:jid` to generate a comprehensive JSON report containing:
  - Contact profile, including name, about data, business information, and push name.
  - State distribution for online, standby, and offline states.
  - Hourly activity patterns, peak hour, and average session length.
  - Activity-history state transitions.
  - The most recent 500 measurements.
  - Executive summary with tracking duration, data points, average RTT, and estimated daily usage.
- Added `GET /api/report/:jid/download` to return the same report as a downloadable file using `Content-Disposition`.

#### Contact Profile Enrichment

- Expanded contact data with `about`, `aboutSetAt`, `isBusinessAccount`, `businessProfile`, `pushName`, and `verifiedOnWhatsApp`.
- Added a Profile tab with WhatsApp status and business information, including category, website, email, and address.
- Added hourly activity-pattern charts with day and night visual distinction.
- Added peak hour, average session length, and total online minutes.
- Added `GET /api/profile/:jid` to merge stored and current WhatsApp data.
- Added `GET /api/patterns/:jid` for hourly activity distribution.

#### Statistics and Activity Panels

- Added a Statistics panel with total measurements, average RTT, first/last seen, and a state-distribution bar.
- Added an Activity panel with a state-transition timeline and colored timestamped indicators.
- Added automatic refresh every ten seconds.

### Changed

- `removeContact()` now performs a soft delete using `isActive: false` instead of `deleteOne()`.
- Added database functions `reactivateContact()`, `getActiveContacts()`, and `generateReport()`.
- Added the `reactivate-contact` Socket.IO event to resume tracking for a stored contact.
- `ContactCard` now includes RTT Chart with Bitácora, Activity, Statistics, and Profile tabs.
- Added a **Report** button beside **Stop** in each contact-card header.
- Added a **History** button to the dashboard control bar.
- Contacts without the `isActive` field remain backward-compatible and are treated as active.

### Data Model

- Added the following `ContactDoc` fields: `isActive`, `about`, `aboutSetAt`, `isBusinessAccount`, `businessProfile`, `pushName`, `lastProfileUpdate`, and `verifiedOnWhatsApp`.

---

## [2.0.0] - 2026-03-04

> **Major release:** introduced Network Monitor, MongoDB persistence, a redesigned interface, and the first major security-hardening pass.

### Added

- **Network Monitor module:** added real-time packet capture using Npcap and `cap`.
  - Live packet table with protocol badges and severity-based presentation.
  - Protocol-distribution chart and top-destination-IP chart.
  - IP geolocation with country, region, city, latitude, and longitude through `geoip-lite`.
  - BPF filters by protocol, port, and IP address.
  - CSV and JSON export.
  - Real-time Socket.IO streaming and REST API endpoints.
- **MongoDB persistence:** added storage for measurements, contacts, and sessions with 30-day TTL cleanup.
- **Dark-theme UI:** added a navy-based interface using `#070b18` for the background, `#0f1629` for cards, and `#7c3aed` for the accent.
- **Tab navigation:** added WhatsApp Tracker and Network Monitor tabs.
- Added TypeScript declarations for the `cap` module.

### Changed

- Updated the runtime stack to Node.js 22, React 19, and Express 5.
- Switched Baileys installation to GitHub because the referenced npm release candidate returned HTTP `405`.
- Configured Yarn 4 with `nodeLinker: node-modules`.

### Removed

- Removed Signal support.
- Removed the `pdf-parse` dependency after identifying a suspicious `test.js` file in the dependency package.

### Security

- Restricted CORS to localhost.
- Set the Pino logger to `silent` to reduce authentication-token leakage.
- Pinned Docker images to SHA-256 digests.
- Added dependency lockfiles to version control.

---

## [1.0.0] - Original Release

> The original source history does not specify a release date for version `1.0.0`.

### Added

- Original WhatsApp and Signal RTT-based activity-tracking concept.
- React web interface with real-time charts.
- CLI interface.
- Docker support.

### Attribution

- Original concept by [gommzystudio/device-activity-tracker](https://github.com/gommzystudio/device-activity-tracker).
- All version `2.x` improvements, architecture redesign, MongoDB integration, Network Monitor, reporting system, and UI overhaul were developed by [Deco31416](https://www.deco31416.com).

---

## Maintainer

**Deco31416**

Website: [https://www.deco31416.com](https://www.deco31416.com)

Email: [deco31416@gmail.com](mailto:deco31416@gmail.com)

For contribution rules, review `CONTRIBUTING.md`. For licensing and legal notices, review `LICENSE`.

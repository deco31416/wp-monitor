# Deployment Split

This project has two intended runtime modes.

## Railway dashboard mode

Use Railway for the web-facing parts:

- React dashboard
- Express/Socket.IO API
- WhatsApp activity tracker
- contacts, history, reports, behavior analytics
- MongoDB persistence
- audit trail lookup and hashed audit export

Recommended backend variables:

```env
DEPLOYMENT_MODE=railway-dashboard
LOCAL_CAPTURE_ENABLED=false
NODE_ENV=production
ENABLE_SWAGGER=false
PORT=4000
MONGODB_URI=mongodb+srv://...
MONGODB_DB=activity-tracker
REDIS_URL=rediss://USERNAME:PASSWORD@REDIS_HOST:PORT
REDIS_REQUIRED=true
REDIS_KEY_PREFIX=wp-monitor-production
INITIAL_ADMIN_USERNAME=choose-a-non-default-username
INITIAL_ADMIN_PASSWORD=store-a-unique-15-plus-character-password
AUTH_IDENTITY_SECRET=generate-a-unique-64-character-secret
AUTH_SESSION_TTL_SECONDS=28800
ALLOWED_ORIGINS=https://your-client.up.railway.app
TRUST_PROXY=1
PUBLIC_BASE_URL=https://your-backend.up.railway.app
```

Recommended frontend variable:

```env
VITE_API_URL=https://your-backend.up.railway.app
```

If WhatsApp auth should survive redeploys, attach a Railway volume to:

```txt
/app/auth_info_baileys
```

If Authorized Check-In preview images/uploads should survive redeploys, attach a second Railway volume to:

```txt
/app/public/uploads
```

Generated preview assets are served from `/uploads/checkins/*`. Without this volume, Railway may remove them during restarts or redeploys.

Railway is not the right place for packet capture because the container cannot see the local network adapter where WhatsApp Web traffic is generated.

Use [railway.md](railway.md) for the step-by-step Railway deployment checklist.

## Local full mode

Use local mode for the full tool:

- WhatsApp tracker
- Network Monitor
- call traffic analysis
- packet capture from the local machine or an authorized lab host

Recommended local variables:

```env
DEPLOYMENT_MODE=local-full
LOCAL_CAPTURE_ENABLED=true
ENABLE_SWAGGER=true
PORT=4000
MONGODB_URI=mongodb+srv://...
MONGODB_DB=activity-tracker
REDIS_URL=redis://127.0.0.1:6379
REDIS_REQUIRED=true
REDIS_KEY_PREFIX=wp-monitor-local
INITIAL_ADMIN_USERNAME=admin
INITIAL_ADMIN_PASSWORD=use-a-unique-password-with-15-plus-characters
AUTH_IDENTITY_SECRET=generate-a-unique-64-character-secret
# TRUST_PROXY=false
```

When packet capture is needed, grant only `CAP_NET_RAW`/`CAP_NET_ADMIN` to the dedicated backend service/process. Do not run dependency installation or the entire application as root.

The call traffic analyzer reports observed IPs, relays, providers, ports, packet counts, direction, and geolocation hints. Treat non-infrastructure IPs as candidates only; WhatsApp/WebRTC may use relays, and the analysis should not claim that an observed IP identifies a person.

Use [local-runbook.md](local-runbook.md) for the local operating procedure, capture prerequisites, audit metadata, troubleshooting, and known limitations.

Swagger/OpenAPI documentation is available at `/docs` only when `ENABLE_SWAGGER=true` and `NODE_ENV` is not `production`.

## Audit exports

Audit events can be queried from the `Audit Trail` tab by `Case ID`.

The backend also exposes a JSON export:

```txt
GET /api/audit/:caseId/export
```

The export includes:

- case ID
- export timestamp
- event count
- audit events
- SHA-256 hash of the canonical payload

The export requires the same Redis-backed operator session as every protected API route. A Bearer token is not supported. Production startup requires MongoDB, Redis, an explicit 32+ character `AUTH_IDENTITY_SECRET`, and exact HTTPS `ALLOWED_ORIGINS`; a fresh database also needs valid bootstrap credentials.

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
ALLOWED_ORIGINS=https://your-client.up.railway.app
DASHBOARD_TOKEN=change-this-long-random-token-with-32-plus-chars
TRUST_PROXY=1
PUBLIC_BASE_URL=https://your-backend.up.railway.app
```

Recommended frontend variable:

```env
REACT_APP_API_URL=https://your-backend.up.railway.app
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
# Optional in local development:
# DASHBOARD_TOKEN=change-this-long-random-token-with-32-plus-chars
# TRUST_PROXY=false
```

Run the backend locally with administrator/root permissions when packet capture is needed, because `cap` needs access to the network interface.

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

When `DASHBOARD_TOKEN` is configured, the export endpoint requires the same dashboard token through `Authorization: Bearer <token>`. In production, the backend refuses to start without a strong token.

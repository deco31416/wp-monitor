import type express from 'express';
import { createHash } from 'crypto';
import { saveAuditEvent, getAuditEvents } from '../db.js';
import { parseLimit, validateCaseId, validationError } from '../validation.js';

interface CaptureAuditContext {
    caseId: string;
    operatorName: string;
    authorizationNote: string;
}

interface AuditRoutesDeps {
    getCaseExportContext: (caseId: string, authorizationNote: string) => Promise<CaptureAuditContext | null>;
    auditEvent: (
        context: CaptureAuditContext,
        action: string,
        scope: 'network' | 'call' | 'contact' | 'report' | 'system',
        details?: Record<string, unknown>,
        targetJid?: string | null
    ) => Promise<void>;
}

export function registerAuditRoutes(app: express.Express, deps: AuditRoutesDeps) {
    const { getCaseExportContext, auditEvent } = deps;

    app.get('/api/audit/:caseId', async (req, res) => {
        const caseIdResult = validateCaseId(req.params.caseId);
        if (!caseIdResult.ok) {
            validationError(res, caseIdResult.errors || []);
            return;
        }
        const limit = parseLimit(req.query.limit, 100, 5000);
        res.json(await getAuditEvents(caseIdResult.value!, limit));
    });

    app.get('/api/audit/:caseId/export', async (req, res) => {
        const caseIdResult = validateCaseId(req.params.caseId);
        if (!caseIdResult.ok) {
            validationError(res, caseIdResult.errors || []);
            return;
        }
        const caseId = caseIdResult.value!;
        const limit = parseLimit(req.query.limit, 1000, 10000);
        const requestedAt = new Date();
        const exportContext = await getCaseExportContext(caseId, 'Audit trail export requested');
        if (exportContext) {
            await auditEvent(exportContext, 'audit_export_requested', 'report', {
                limit,
                requestedAt: requestedAt.toISOString(),
            });
        }
        const events = await getAuditEvents(caseId, limit);
        const exportedAt = new Date();
        const payload = {
            caseId,
            exportedAt: exportedAt.toISOString(),
            eventCount: events.length,
            events,
        };
        const payloadJson = JSON.stringify(payload, null, 2);
        const sha256 = createHash('sha256').update(payloadJson).digest('hex');
        const exportPackage = {
            ...payload,
            integrity: {
                algorithm: 'SHA-256',
                hash: sha256,
                canonicalPayload: 'JSON.stringify(payload, null, 2) before adding integrity',
            },
        };

        await saveAuditEvent({
            caseId,
            operatorName: 'system',
            authorizationNote: 'Audit trail export',
            action: 'audit_export',
            scope: 'report',
            targetJid: null,
            details: {
                eventCount: events.length,
                sha256,
                exportedAt: exportedAt.toISOString(),
            },
        });

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="audit-${caseId}-${exportedAt.toISOString().slice(0, 10)}.json"`);
        res.send(JSON.stringify(exportPackage, null, 2));
    });
}

import type express from 'express';
import {
    createCase,
    getCase,
    listCases,
    updateCase,
    closeCase,
    getCaseEvidenceLinks,
    saveAuditEvent,
} from '../db.js';
import {
    cleanText,
    collectErrors,
    parseCaseStatus,
    parseLimit,
    parseTags,
    validateCaseId,
    validateRequiredText,
    validationError,
} from '../validation.js';

export function registerCaseRoutes(app: express.Express) {

    app.get('/api/cases', async (req, res) => {
        const limit = parseLimit(req.query.limit, 50, 200);
        const status = parseCaseStatus(req.query.status);
        res.json(await listCases(limit, status || undefined));
    });

    app.post('/api/cases', async (req, res) => {
        const body = req.body || {};
        const caseIdResult = validateCaseId(body.caseId);
        const primaryOperatorResult = validateRequiredText(body.primaryOperator, 'primaryOperator', 120);
        const authorizationNoteResult = validateRequiredText(body.authorizationNote, 'authorizationNote', 1000);
        const errors = collectErrors(caseIdResult, primaryOperatorResult, authorizationNoteResult);
        const status = parseCaseStatus(body.status) || 'authorized';

        if (errors.length > 0) {
            validationError(res, errors);
            return;
        }

        const caseId = caseIdResult.value!;
        const primaryOperator = primaryOperatorResult.value!;
        const authorizationNote = authorizationNoteResult.value!;
        const created = await createCase({
            caseId,
            title: cleanText(body.title, 160) || caseId,
            description: typeof body.description === 'string' ? cleanText(body.description, 2000) : null,
            status,
            primaryOperator,
            authorizationNote,
            tags: parseTags(body.tags),
        });

        if (!created) {
            res.status(500).json({ error: 'Failed to create case' });
            return;
        }

        await saveAuditEvent({
            caseId,
            operatorName: primaryOperator,
            authorizationNote,
            action: 'case_created',
            scope: 'system',
            targetJid: null,
            details: { status, title: created.title },
        });

        res.status(201).json(created);
    });

    app.get('/api/cases/:caseId', async (req, res) => {
        const caseIdResult = validateCaseId(req.params.caseId);
        if (!caseIdResult.ok) {
            validationError(res, caseIdResult.errors || []);
            return;
        }
        const found = await getCase(caseIdResult.value!);
        if (!found) {
            res.status(404).json({ error: 'Case not found' });
            return;
        }
        res.json(found);
    });

    app.patch('/api/cases/:caseId', async (req, res) => {
        const caseIdResult = validateCaseId(req.params.caseId);
        if (!caseIdResult.ok) {
            validationError(res, caseIdResult.errors || []);
            return;
        }
        const body = req.body || {};
        const patch: Parameters<typeof updateCase>[1] = {};
        if (typeof body.title === 'string') patch.title = cleanText(body.title, 160);
        if (typeof body.description === 'string' || body.description === null) patch.description = body.description === null ? null : cleanText(body.description, 2000);
        if (typeof body.primaryOperator === 'string') patch.primaryOperator = cleanText(body.primaryOperator, 120);
        if (typeof body.authorizationNote === 'string') patch.authorizationNote = cleanText(body.authorizationNote, 1000);
        if (Array.isArray(body.tags)) patch.tags = parseTags(body.tags);
        const status = parseCaseStatus(body.status);
        if (status) patch.status = status;

        const updated = await updateCase(caseIdResult.value!, patch);
        if (!updated) {
            res.status(404).json({ error: 'Case not found or database unavailable' });
            return;
        }

        await saveAuditEvent({
            caseId: caseIdResult.value!,
            operatorName: updated.primaryOperator,
            authorizationNote: updated.authorizationNote,
            action: 'case_updated',
            scope: 'system',
            targetJid: null,
            details: { patch: Object.keys(patch), status: updated.status },
        });

        res.json(updated);
    });

    app.post('/api/cases/:caseId/close', async (req, res) => {
        const caseIdResult = validateCaseId(req.params.caseId);
        if (!caseIdResult.ok) {
            validationError(res, caseIdResult.errors || []);
            return;
        }
        const updated = await closeCase(caseIdResult.value!);
        if (!updated) {
            res.status(404).json({ error: 'Case not found or database unavailable' });
            return;
        }

        await saveAuditEvent({
            caseId: caseIdResult.value!,
            operatorName: updated.primaryOperator,
            authorizationNote: updated.authorizationNote,
            action: 'case_closed',
            scope: 'system',
            targetJid: null,
            details: {
                closedBy: cleanText(req.body?.operatorName, 120) || updated.primaryOperator,
            },
        });

        res.json(updated);
    });

    app.get('/api/cases/:caseId/evidence', async (req, res) => {
        const caseIdResult = validateCaseId(req.params.caseId);
        if (!caseIdResult.ok) {
            validationError(res, caseIdResult.errors || []);
            return;
        }
        res.json(await getCaseEvidenceLinks(caseIdResult.value!));
    });
}

import type express from 'express';
import { createHash } from 'crypto';
import { saveAuditEvent, saveCaseEvidenceLink } from '../db.js';
import {
    buildEvidencePackage,
    buildEvidenceZip,
    buildFinalCaseReport,
    renderFinalCaseReportHtml,
    renderFinalCaseReportPdf,
} from '../evidence-package.js';
import { validateCaseId, validationError } from '../validation.js';

interface CaptureAuditContext {
    caseId: string;
    operatorName: string;
    authorizationNote: string;
}

interface ReportRoutesDeps {
    getCaseExportContext: (caseId: string, authorizationNote: string) => Promise<CaptureAuditContext | null>;
    auditEvent: (
        context: CaptureAuditContext,
        action: string,
        scope: 'network' | 'call' | 'contact' | 'report' | 'system',
        details?: Record<string, unknown>,
        targetJid?: string | null
    ) => Promise<void>;
}

export function registerReportRoutes(app: express.Express, deps: ReportRoutesDeps) {
    const { getCaseExportContext, auditEvent } = deps;

    app.get('/api/evidence/:caseId/package', async (req, res) => {
        const caseIdResult = validateCaseId(req.params.caseId);
        if (!caseIdResult.ok) {
            validationError(res, caseIdResult.errors || []);
            return;
        }
        const caseId = caseIdResult.value!;
        const exportContext = await getCaseExportContext(caseId, 'Evidence package export requested');
        if (!exportContext) {
            res.status(404).json({ error: 'No case or evidence found for this Case ID' });
            return;
        }
        await auditEvent(exportContext, 'evidence_package_export_requested', 'report', {
            format: 'json',
            requestedAt: new Date().toISOString(),
        });
        const evidencePackage = await buildEvidencePackage(caseId);
        if (!evidencePackage) {
            res.status(404).json({ error: 'No case or evidence found for this Case ID' });
            return;
        }

        await saveAuditEvent({
            caseId,
            operatorName: evidencePackage.sections.case?.primaryOperator || 'system',
            authorizationNote: evidencePackage.sections.case?.authorizationNote || 'Evidence package export',
            action: 'evidence_package_export',
            scope: 'report',
            targetJid: null,
            details: {
                packageHash: evidencePackage.integrity.packageHash,
                auditEventCount: evidencePackage.sections.audit.length,
                callAnalysisCount: evidencePackage.sections.callAnalysis.length,
                generatedAt: evidencePackage.manifest.generatedAt,
            },
        });

        await saveCaseEvidenceLink({
            caseId,
            type: 'evidence_package',
            refId: evidencePackage.integrity.packageHash,
            label: `Evidence Package ${new Date().toISOString().slice(0, 10)}`,
            targetJid: null,
            metadata: {
                packageHash: evidencePackage.integrity.packageHash,
                auditEventCount: evidencePackage.sections.audit.length,
                callAnalysisCount: evidencePackage.sections.callAnalysis.length,
                evidenceLinkCount: evidencePackage.sections.evidenceLinks.length,
                generatedAt: evidencePackage.manifest.generatedAt,
            },
        });

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="evidence-${caseId}-${new Date().toISOString().slice(0, 10)}.json"`);
        res.send(JSON.stringify(evidencePackage, null, 2));
    });

    app.get('/api/evidence/:caseId/package.zip', async (req, res) => {
        const caseIdResult = validateCaseId(req.params.caseId);
        if (!caseIdResult.ok) {
            validationError(res, caseIdResult.errors || []);
            return;
        }
        const caseId = caseIdResult.value!;
        const exportContext = await getCaseExportContext(caseId, 'Evidence package ZIP export requested');
        if (!exportContext) {
            res.status(404).json({ error: 'No case or evidence found for this Case ID' });
            return;
        }
        await auditEvent(exportContext, 'evidence_package_zip_export_requested', 'report', {
            format: 'zip',
            requestedAt: new Date().toISOString(),
        });
        const evidencePackage = await buildEvidencePackage(caseId);
        if (!evidencePackage) {
            res.status(404).json({ error: 'No case or evidence found for this Case ID' });
            return;
        }

        const zipBuffer = buildEvidenceZip(evidencePackage);
        const zipHash = createHash('sha256').update(zipBuffer).digest('hex');

        await saveAuditEvent({
            caseId,
            operatorName: evidencePackage.sections.case?.primaryOperator || 'system',
            authorizationNote: evidencePackage.sections.case?.authorizationNote || 'Evidence package ZIP export',
            action: 'evidence_package_zip_export',
            scope: 'report',
            targetJid: null,
            details: {
                packageHash: evidencePackage.integrity.packageHash,
                zipHash,
                files: [
                    'manifest.json',
                    'case.json',
                    'audit.json',
                    'evidence-links.json',
                    'call-analysis.json',
                    'network-summary.json',
                    'final-report.json',
                    'final-report.html',
                    'final-report.pdf',
                    'annexes/audit-events.csv',
                    'annexes/evidence-links.csv',
                    'annexes/call-analysis.csv',
                    'annexes/candidate-ips.csv',
                    'annexes/non-conclusive-ip-observations.csv',
                    'annexes/network-captures.csv',
                    'annexes/csv-integrity.json',
                    'integrity.json',
                    'full-package.json',
                ],
                generatedAt: evidencePackage.manifest.generatedAt,
            },
        });

        await saveCaseEvidenceLink({
            caseId,
            type: 'evidence_package',
            refId: `${evidencePackage.integrity.packageHash}.zip`,
            label: `Evidence Package ZIP ${new Date().toISOString().slice(0, 10)}`,
            targetJid: null,
            metadata: {
                packageHash: evidencePackage.integrity.packageHash,
                zipHash,
                format: 'zip',
                generatedAt: evidencePackage.manifest.generatedAt,
            },
        });

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="evidence-${caseId}-${new Date().toISOString().slice(0, 10)}.zip"`);
        res.send(zipBuffer);
    });

    app.get('/api/reports/:caseId/final', async (req, res) => {
        const caseIdResult = validateCaseId(req.params.caseId);
        if (!caseIdResult.ok) {
            validationError(res, caseIdResult.errors || []);
            return;
        }
        const caseId = caseIdResult.value!;
        const exportContext = await getCaseExportContext(caseId, 'Final report JSON export requested');
        if (!exportContext) {
            res.status(404).json({ error: 'No case or evidence found for this Case ID' });
            return;
        }
        await auditEvent(exportContext, 'final_report_json_export_requested', 'report', {
            format: 'json',
            requestedAt: new Date().toISOString(),
        });
        const evidencePackage = await buildEvidencePackage(caseId);
        if (!evidencePackage) {
            res.status(404).json({ error: 'No case or evidence found for this Case ID' });
            return;
        }

        const finalReport = buildFinalCaseReport(evidencePackage);
        await saveAuditEvent({
            caseId,
            operatorName: evidencePackage.sections.case?.primaryOperator || 'system',
            authorizationNote: evidencePackage.sections.case?.authorizationNote || 'Final report JSON export',
            action: 'final_report_json_export',
            scope: 'report',
            targetJid: null,
            details: {
                reportHash: finalReport.integrity.reportHash,
                sourceEvidencePackageHash: finalReport.integrity.sourceEvidencePackageHash,
                generatedAt: finalReport.summary.generatedAt,
            },
        });

        await saveCaseEvidenceLink({
            caseId,
            type: 'report',
            refId: finalReport.integrity.reportHash,
            label: `Final Report JSON ${new Date().toISOString().slice(0, 10)}`,
            targetJid: null,
            metadata: {
                format: 'json',
                reportHash: finalReport.integrity.reportHash,
                sourceEvidencePackageHash: finalReport.integrity.sourceEvidencePackageHash,
            },
        });

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="final-report-${caseId}-${new Date().toISOString().slice(0, 10)}.json"`);
        res.send(JSON.stringify(finalReport, null, 2));
    });

    app.get('/api/reports/:caseId/final.html', async (req, res) => {
        const caseIdResult = validateCaseId(req.params.caseId);
        if (!caseIdResult.ok) {
            validationError(res, caseIdResult.errors || []);
            return;
        }
        const caseId = caseIdResult.value!;
        const exportContext = await getCaseExportContext(caseId, 'Final report HTML export requested');
        if (!exportContext) {
            res.status(404).json({ error: 'No case or evidence found for this Case ID' });
            return;
        }
        await auditEvent(exportContext, 'final_report_html_export_requested', 'report', {
            format: 'html',
            requestedAt: new Date().toISOString(),
        });
        const evidencePackage = await buildEvidencePackage(caseId);
        if (!evidencePackage) {
            res.status(404).json({ error: 'No case or evidence found for this Case ID' });
            return;
        }

        const finalReport = buildFinalCaseReport(evidencePackage);
        const html = renderFinalCaseReportHtml(finalReport);
        const htmlHash = createHash('sha256').update(html).digest('hex');

        await saveAuditEvent({
            caseId,
            operatorName: evidencePackage.sections.case?.primaryOperator || 'system',
            authorizationNote: evidencePackage.sections.case?.authorizationNote || 'Final report HTML export',
            action: 'final_report_html_export',
            scope: 'report',
            targetJid: null,
            details: {
                reportHash: finalReport.integrity.reportHash,
                htmlHash,
                sourceEvidencePackageHash: finalReport.integrity.sourceEvidencePackageHash,
                generatedAt: finalReport.summary.generatedAt,
            },
        });

        await saveCaseEvidenceLink({
            caseId,
            type: 'report',
            refId: `${finalReport.integrity.reportHash}.html`,
            label: `Final Report HTML ${new Date().toISOString().slice(0, 10)}`,
            targetJid: null,
            metadata: {
                format: 'html',
                reportHash: finalReport.integrity.reportHash,
                htmlHash,
                sourceEvidencePackageHash: finalReport.integrity.sourceEvidencePackageHash,
            },
        });

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="final-report-${caseId}-${new Date().toISOString().slice(0, 10)}.html"`);
        res.send(html);
    });

    app.get('/api/reports/:caseId/final.pdf', async (req, res) => {
        const caseIdResult = validateCaseId(req.params.caseId);
        if (!caseIdResult.ok) {
            validationError(res, caseIdResult.errors || []);
            return;
        }
        const caseId = caseIdResult.value!;
        const exportContext = await getCaseExportContext(caseId, 'Final report PDF export requested');
        if (!exportContext) {
            res.status(404).json({ error: 'No case or evidence found for this Case ID' });
            return;
        }
        await auditEvent(exportContext, 'final_report_pdf_export_requested', 'report', {
            format: 'pdf',
            requestedAt: new Date().toISOString(),
        });
        const evidencePackage = await buildEvidencePackage(caseId);
        if (!evidencePackage) {
            res.status(404).json({ error: 'No case or evidence found for this Case ID' });
            return;
        }

        const finalReport = buildFinalCaseReport(evidencePackage);
        const pdfBuffer = renderFinalCaseReportPdf(finalReport);
        const pdfHash = createHash('sha256').update(pdfBuffer).digest('hex');

        await saveAuditEvent({
            caseId,
            operatorName: evidencePackage.sections.case?.primaryOperator || 'system',
            authorizationNote: evidencePackage.sections.case?.authorizationNote || 'Final report PDF export',
            action: 'final_report_pdf_export',
            scope: 'report',
            targetJid: null,
            details: {
                reportHash: finalReport.integrity.reportHash,
                pdfHash,
                sourceEvidencePackageHash: finalReport.integrity.sourceEvidencePackageHash,
                generatedAt: finalReport.summary.generatedAt,
            },
        });

        await saveCaseEvidenceLink({
            caseId,
            type: 'report',
            refId: `${finalReport.integrity.reportHash}.pdf`,
            label: `Final Report PDF ${new Date().toISOString().slice(0, 10)}`,
            targetJid: null,
            metadata: {
                format: 'pdf',
                reportHash: finalReport.integrity.reportHash,
                pdfHash,
                sourceEvidencePackageHash: finalReport.integrity.sourceEvidencePackageHash,
            },
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="final-report-${caseId}-${new Date().toISOString().slice(0, 10)}.pdf"`);
        res.send(pdfBuffer);
    });
}

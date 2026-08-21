import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { countObservedActivityEvents, getAuditEvents, getCallAnalysesByCallIds, getCase, getCaseEvidenceLinks, getObservedActivityEventsForCase, getStateDistribution } from './db.js';
import { buildPageMetadata } from './page-metadata.js';

function resolveSoftwareVersion(): string {
    if (process.env.npm_package_version) return process.env.npm_package_version;
    try {
        const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
        if (typeof manifest.version === 'string' && manifest.version.trim()) return manifest.version.trim();
    } catch {
        // Keep evidence generation available if packaging omits package.json.
    }
    return 'unknown';
}

const SOFTWARE_VERSION = resolveSoftwareVersion();

export function hashJson(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value, null, 2)).digest('hex');
}

function hashText(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}

function extractCallIdsFromAudit(events: Awaited<ReturnType<typeof getAuditEvents>>): string[] {
    const ids = new Set<string>();
    for (const event of events) {
        const callId = event.details?.callId;
        if (typeof callId === 'string' && callId.trim()) ids.add(callId.trim());
    }
    return Array.from(ids);
}

function buildNetworkSummary(events: Awaited<ReturnType<typeof getAuditEvents>>) {
    const captureStarts = events.filter(event => event.scope === 'network' && event.action === 'capture_start');
    const captureStops = events.filter(event => event.scope === 'network' && event.action === 'capture_stop');
    const stopStats = captureStops
        .map(event => event.details?.stats)
        .filter(Boolean);

    return {
        captureStartCount: captureStarts.length,
        captureStopCount: captureStops.length,
        latestStats: stopStats[0] || null,
        captures: captureStops.map(event => ({
            timestampUtc: event.timestampUtc,
            operatorName: event.operatorName,
            stats: event.details?.stats || null,
        })),
    };
}

function extractTargetJids(
    events: Awaited<ReturnType<typeof getAuditEvents>>,
    links: Awaited<ReturnType<typeof getCaseEvidenceLinks>>,
): string[] {
    return Array.from(new Set([
        ...events.map(event => event.targetJid).filter((jid): jid is string => typeof jid === 'string' && jid.trim().length > 0),
        ...links.map(link => link.targetJid).filter((jid): jid is string => typeof jid === 'string' && jid.trim().length > 0),
    ]));
}

export async function buildEvidencePackage(caseId: string) {
    const [caseRecord, auditEvents, evidenceLinks] = await Promise.all([
        getCase(caseId),
        getAuditEvents(caseId, 5000),
        getCaseEvidenceLinks(caseId),
    ]);

    if (!caseRecord && auditEvents.length === 0 && evidenceLinks.length === 0) return null;

    const directCallIds = evidenceLinks
        .filter(link => link.type === 'call_analysis')
        .map(link => link.refId);
    const callIds = Array.from(new Set([...extractCallIdsFromAudit(auditEvents), ...directCallIds]));
    const callAnalyses = await getCallAnalysesByCallIds(callIds, caseId);
    const targetJids = extractTargetJids(auditEvents, evidenceLinks);
    const activityStats = await Promise.all(targetJids.map(async targetJid => ({
        targetJid,
        stats: await getStateDistribution(targetJid, caseId),
    })));
    const observedActivity = await Promise.all(targetJids.map(async targetJid => {
        const limit = 5000;
        const [events, total] = await Promise.all([
            getObservedActivityEventsForCase(targetJid, caseId, limit),
            countObservedActivityEvents(targetJid, caseId),
        ]);
        return {
            targetJid,
            events,
            page: buildPageMetadata(events.length, total, limit),
        };
    }));
    const networkSummary = buildNetworkSummary(auditEvents);
    const generatedAt = new Date().toISOString();

    const sections = {
        case: caseRecord,
        audit: auditEvents,
        evidenceLinks,
        callAnalysis: callAnalyses,
        activityStats,
        observedActivity,
        networkSummary,
    };

    const sectionHashes = {
        case: hashJson(sections.case),
        audit: hashJson(sections.audit),
        evidenceLinks: hashJson(sections.evidenceLinks),
        callAnalysis: hashJson(sections.callAnalysis),
        activityStats: hashJson(sections.activityStats),
        observedActivity: hashJson(sections.observedActivity),
        networkSummary: hashJson(sections.networkSummary),
    };

    const manifest = {
        packageType: 'evidence-package',
        version: '1.1',
        software: {
            name: 'WP MONITOR',
            version: SOFTWARE_VERSION,
            developedBy: 'WP MONITOR',
        },
        caseId,
        generatedAt,
        contents: [
            { name: 'case', format: 'json', sha256: sectionHashes.case },
            { name: 'audit', format: 'json', sha256: sectionHashes.audit, count: auditEvents.length },
            { name: 'evidenceLinks', format: 'json', sha256: sectionHashes.evidenceLinks, count: evidenceLinks.length },
            { name: 'callAnalysis', format: 'json', sha256: sectionHashes.callAnalysis, count: callAnalyses.length },
            { name: 'activityStats', format: 'json', sha256: sectionHashes.activityStats, count: activityStats.length },
            {
                name: 'observedActivity',
                format: 'json',
                sha256: sectionHashes.observedActivity,
                count: observedActivity.reduce((sum, item) => sum + item.events.length, 0),
                totalAvailable: observedActivity.reduce((sum, item) => sum + item.page.total, 0),
                truncated: observedActivity.some(item => item.page.truncated),
            },
            { name: 'networkSummary', format: 'json', sha256: sectionHashes.networkSummary },
        ],
        limitations: [
            'Traffic analysis is based on observed metadata only.',
            'Candidate IPs do not prove identity, exact location, or ownership by a person.',
            'WhatsApp/WebRTC traffic may use relays, NAT, VPNs, CGNAT, or provider infrastructure.',
        ],
    };

    const packageWithoutIntegrity = {
        manifest,
        sections,
    };

    return {
        ...packageWithoutIntegrity,
        integrity: {
            algorithm: 'SHA-256',
            sectionHashes,
            packageHash: hashJson(packageWithoutIntegrity),
            canonicalPayload: 'JSON.stringify({ manifest, sections }, null, 2)',
        },
    };
}

function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatReportDate(value: unknown): string {
    if (!value) return '-';
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return '-';
    return date.toISOString().replace('T', ' ').replace('Z', ' UTC');
}

function getCandidateScore(candidate: any): number {
    if (typeof candidate?.confidenceScore === 'number') {
        return Math.max(0, Math.min(100, Math.round(candidate.confidenceScore)));
    }
    if (candidate?.confidence === 'high') return 80;
    if (candidate?.confidence === 'medium') return 55;
    return 25;
}

function mapCallIpObservation(analysis: any, candidate: any) {
    return {
        callId: analysis.callId,
        targetJid: analysis.targetJid,
        ip: candidate.ip,
        score: getCandidateScore(candidate),
        confidence: candidate.confidence || 'low',
        networkCategory: candidate.networkCategory || 'unknown_public',
        packets: candidate.packets || 0,
        direction: candidate.direction || 'unknown',
        provider: candidate.provider || 'unknown',
        networkIntelligence: candidate.networkIntelligence || null,
        ports: candidate.ports || [],
        geo: candidate.geo || null,
        ipEnrichment: candidate.ipEnrichment || null,
        reasonCodes: candidate.reasonCodes || [],
        technicalNote: candidate.technicalNote || 'IP publica observada como candidata tecnica. No confirma identidad, ubicacion exacta ni titularidad.',
        isP2P: candidate.isP2P === true,
    };
}

function formatStatsChange(value: unknown): string {
    if (typeof value !== 'number') return '-';
    if (value === 0) return '0';
    return `${value > 0 ? '+' : ''}${value}`;
}

function getPeriodMetric(stats: any, key: string) {
    return stats?.insights?.periods?.find((period: any) => period.key === key) || null;
}

function summarizeActivityStats(activityStats: any[]) {
    return (activityStats || []).map(entry => {
        const stats = entry.stats || {};
        const last24h = getPeriodMetric(stats, 'last24h');
        const last7d = getPeriodMetric(stats, 'last7d');
        const last30d = getPeriodMetric(stats, 'last30d');
        const coverage = stats.insights?.dailyCoverage || [];
        const activeDays = coverage.filter((day: any) => (
            (day.conclusiveMeasurements ?? day.totalMeasurements ?? 0) > 0
        )).length;
        const noAckPct = stats.noAck ?? stats.offline ?? 0;
        const observed = stats.observedActivity || {};
        return {
            targetJid: entry.targetJid,
            totalMeasurements: stats.totalMeasurements || 0,
            conclusiveMeasurements: stats.conclusiveMeasurements || 0,
            inconclusiveMeasurements: stats.inconclusiveMeasurements || 0,
            acknowledgedRttMeasurements: stats.acknowledgedRttMeasurements || 0,
            onlinePct: stats.online || 0,
            standbyPct: stats.standby || 0,
            calibratingPct: stats.calibrating || 0,
            noAckPct,
            unknownPct: stats.unknown || 0,
            // Compatibility alias for previously generated JSON consumers.
            offlinePct: noAckPct,
            avgRtt: stats.avgRtt || 0,
            firstSeen: stats.firstSeen || null,
            lastSeen: stats.lastSeen || null,
            lastOnline: stats.lastOnline || null,
            reliability: stats.insights?.reliability || null,
            coverageActiveDays14: activeDays,
            last24h,
            last7d,
            last30d,
            observedEventCount: observed.totalEvents || 0,
            observedActiveDays: observed.activeDays || 0,
            observedBySource: observed.bySource || {},
            observedConfidence: observed.confidence || {},
            lastObservedEvent: observed.lastEvent || null,
        };
    });
}

export function buildFinalCaseReport(evidencePackage: NonNullable<Awaited<ReturnType<typeof buildEvidencePackage>>>) {
    const generatedAt = new Date().toISOString();
    const caseRecord = evidencePackage.sections.case;
    const auditEvents = evidencePackage.sections.audit || [];
    const evidenceLinks = evidencePackage.sections.evidenceLinks || [];
    const callAnalysis = evidencePackage.sections.callAnalysis || [];
    const activityStats = summarizeActivityStats(evidencePackage.sections.activityStats || []);
    const observedSignals = (evidencePackage.sections.observedActivity || [])
        .flatMap((entry: any) => (entry.events || []).map((event: any) => ({
            targetJid: entry.targetJid,
            source: event.source,
            type: event.type,
            label: event.label,
            confidence: event.confidence,
            timestamp: event.timestamp,
            timestampUtc: event.timestampUtc,
        })))
        .sort((a: any, b: any) => new Date(a.timestampUtc).getTime() - new Date(b.timestampUtc).getTime());
    const observedActivityTotalAvailable = (evidencePackage.sections.observedActivity || [])
        .reduce((sum: number, entry: any) => sum + (entry.page?.total ?? entry.events?.length ?? 0), 0);
    const observedActivityTruncated = (evidencePackage.sections.observedActivity || [])
        .some((entry: any) => entry.page?.truncated === true);

    const operators = Array.from(new Set(auditEvents.map(event => event.operatorName).filter(Boolean)));
    const targets = Array.from(new Set([
        ...auditEvents.map(event => event.targetJid).filter(Boolean),
        ...evidenceLinks.map(link => link.targetJid).filter(Boolean),
    ]));
    const observedCallIps = callAnalysis
        .flatMap((analysis: any) => (analysis.candidateIps || [])
            .map((candidate: any) => mapCallIpObservation(analysis, candidate)))
        .sort((a: any, b: any) => b.score - a.score || b.packets - a.packets);
    const candidateIps = observedCallIps.filter((candidate: any) => candidate.isP2P);
    const nonConclusiveIpObservations = observedCallIps.filter((candidate: any) => !candidate.isP2P);

    const timeline = auditEvents
        .slice()
        .sort((a, b) => new Date(a.timestampUtc).getTime() - new Date(b.timestampUtc).getTime())
        .map(event => ({
            timestampUtc: event.timestampUtc,
            scope: event.scope,
            action: event.action,
            operatorName: event.operatorName,
            targetJid: event.targetJid || null,
            details: event.details || {},
        }));

    const summary = {
        caseId: evidencePackage.manifest.caseId,
        title: caseRecord?.title || evidencePackage.manifest.caseId,
        status: caseRecord?.status || 'unknown',
        generatedAt,
        primaryOperator: caseRecord?.primaryOperator || operators[0] || 'system',
        operators,
        targetCount: targets.length,
        auditEventCount: auditEvents.length,
        evidenceLinkCount: evidenceLinks.length,
        callAnalysisCount: callAnalysis.length,
        activityStatsCount: activityStats.length,
        observedActivityEventCount: observedSignals.length,
        observedActivityTotalAvailable,
        observedActivityTruncated,
        networkCaptureCount: evidencePackage.sections.networkSummary?.captureStopCount || 0,
        candidateIpCount: candidateIps.length,
        nonConclusiveIpObservationCount: nonConclusiveIpObservations.length,
        highestCandidateScore: candidateIps[0]?.score || 0,
    };

    const findings = {
        activity: {
            firstEventUtc: timeline[0]?.timestampUtc || null,
            lastEventUtc: timeline[timeline.length - 1]?.timestampUtc || null,
            actions: Array.from(new Set(timeline.map(item => item.action))),
        },
        network: evidencePackage.sections.networkSummary,
        activityStats,
        observedSignals,
        candidateIps,
        nonConclusiveIpObservations,
        limitations: evidencePackage.manifest.limitations,
    };

    const reportWithoutIntegrity = {
        reportType: 'final-case-report',
        version: '1.1',
        software: evidencePackage.manifest.software,
        summary,
        authorization: {
            caseId: summary.caseId,
            authorizationNote: caseRecord?.authorizationNote || 'Not recorded',
            description: caseRecord?.description || null,
            tags: caseRecord?.tags || [],
        },
        findings,
        timeline,
        evidence: {
            links: evidenceLinks,
            sourceEvidencePackageHash: evidencePackage.integrity.packageHash,
            sourceSectionHashes: evidencePackage.integrity.sectionHashes,
        },
    };

    return {
        ...reportWithoutIntegrity,
        integrity: {
            algorithm: 'SHA-256',
            reportHash: hashJson(reportWithoutIntegrity),
            sourceEvidencePackageHash: evidencePackage.integrity.packageHash,
            canonicalPayload: 'JSON.stringify(finalReportWithoutIntegrity, null, 2)',
        },
    };
}

export function renderFinalCaseReportHtml(report: ReturnType<typeof buildFinalCaseReport>): string {
    const topCandidates = report.findings.candidateIps.slice(0, 10);
    const topNonConclusive = (report.findings.nonConclusiveIpObservations || []).slice(0, 10);
    const timelineRows = report.timeline.slice(-80);
    const scoreTone = report.summary.highestCandidateScore >= 75
        ? 'strong'
        : report.summary.highestCandidateScore >= 45
            ? 'medium'
            : 'low';

    const candidateRows = topCandidates.length
        ? topCandidates.map((candidate: any) => `
            <tr>
                <td><code>${escapeHtml(candidate.ip)}</code></td>
                <td><span class="score ${candidate.score >= 75 ? 'strong' : candidate.score >= 45 ? 'medium' : 'low'}">${candidate.score}/100</span></td>
                <td>${escapeHtml(candidate.networkCategory)}</td>
                <td>${escapeHtml(candidate.networkIntelligence?.asn ? `AS${candidate.networkIntelligence.asn}` : '-')}<br><span class="muted">${escapeHtml(candidate.networkIntelligence?.org || '-')}</span></td>
                <td>${escapeHtml(candidate.direction)}</td>
                <td>${escapeHtml(candidate.packets)}</td>
                <td>${escapeHtml(candidate.geo?.country || '-')} / ${escapeHtml(candidate.geo?.city || candidate.geo?.region || '-')}</td>
                <td>${escapeHtml(candidate.technicalNote)}</td>
            </tr>
        `).join('')
        : '<tr><td colspan="8" class="muted">No se registraron IPs candidatas en los analisis vinculados.</td></tr>';

    const nonConclusiveRows = topNonConclusive.length
        ? topNonConclusive.map((candidate: any) => `
            <tr>
                <td><code>${escapeHtml(candidate.ip)}</code></td>
                <td><span class="score low">${candidate.score}/100</span></td>
                <td>${escapeHtml(candidate.networkCategory)}</td>
                <td>${escapeHtml(candidate.direction)}</td>
                <td>${escapeHtml(candidate.packets)}</td>
                <td>${escapeHtml(candidate.technicalNote)}</td>
            </tr>
        `).join('')
        : '<tr><td colspan="6" class="muted">No se registraron observaciones no concluyentes separadas.</td></tr>';

    const activityRows = report.findings.activityStats.length
        ? report.findings.activityStats.map((item: any) => `
            <tr>
                <td><code>${escapeHtml(item.targetJid)}</code></td>
                <td>${escapeHtml(item.observedEventCount)}<br><span class="muted">${escapeHtml(item.observedActiveDays)} día(s)</span></td>
                <td>${escapeHtml(item.observedBySource?.message || 0)} / ${escapeHtml(item.observedBySource?.receipt || 0)} / ${escapeHtml(item.observedBySource?.presence || 0)} / ${escapeHtml(item.observedBySource?.call || 0)}</td>
                <td>${escapeHtml(item.conclusiveMeasurements)} / ${escapeHtml(item.totalMeasurements)}</td>
                <td>${item.conclusiveMeasurements > 0 ? `${escapeHtml(item.onlinePct)}%` : '—'}</td>
                <td>${(item.last24h?.conclusiveMeasurements ?? 0) > 0 ? `${escapeHtml(item.last24h.onlinePct)}% <span class="muted">(${escapeHtml(formatStatsChange(item.last24h.changeOnlinePct))})</span>` : '—'}</td>
                <td>${(item.last7d?.conclusiveMeasurements ?? 0) > 0 ? `${escapeHtml(item.last7d.onlinePct)}% <span class="muted">(${escapeHtml(formatStatsChange(item.last7d.changeOnlinePct))})</span>` : '—'}</td>
                <td>${(item.last30d?.conclusiveMeasurements ?? 0) > 0 ? `${escapeHtml(item.last30d.onlinePct)}%` : '—'}</td>
                <td>${escapeHtml(item.coverageActiveDays14)}/14</td>
                <td><span class="score ${item.reliability?.label === 'strong' ? 'strong' : item.reliability?.label === 'usable' ? 'medium' : 'low'}">${escapeHtml(item.reliability?.score ?? 0)}/100</span><br><span class="muted">${escapeHtml(item.reliability?.label || 'initial')}</span></td>
            </tr>
        `).join('')
        : '<tr><td colspan="10" class="muted">No se registraron estadisticas de actividad para contactos vinculados.</td></tr>';

    const observedSignalRows = report.findings.observedSignals.length
        ? report.findings.observedSignals.slice(-200).reverse().map((item: any) => `
            <tr>
                <td>${escapeHtml(formatReportDate(item.timestampUtc))}</td>
                <td><code>${escapeHtml(item.targetJid)}</code></td>
                <td>${escapeHtml(item.source)}</td>
                <td>${escapeHtml(item.label)}</td>
                <td>${escapeHtml(item.confidence)}</td>
            </tr>
        `).join('')
        : '<tr><td colspan="5" class="muted">No se registraron señales observables atribuibles al caso.</td></tr>';

    const timelineHtml = timelineRows.length
        ? timelineRows.map(item => `
            <tr>
                <td>${escapeHtml(formatReportDate(item.timestampUtc))}</td>
                <td>${escapeHtml(item.scope)}</td>
                <td>${escapeHtml(item.action)}</td>
                <td>${escapeHtml(item.operatorName)}</td>
                <td><code>${escapeHtml(item.targetJid || '-')}</code></td>
            </tr>
        `).join('')
        : '<tr><td colspan="5" class="muted">No hay eventos de auditoria disponibles.</td></tr>';

    const limitationHtml = report.findings.limitations
        .map(item => `<li>${escapeHtml(item)}</li>`)
        .join('');

    return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>WP MONITOR - Informe Final ${escapeHtml(report.summary.caseId)}</title>
  <style>
    :root {
      color-scheme: light;
      --ink:#172033;
      --body:#344256;
      --muted:#6b7789;
      --line:#d7e0e8;
      --line-strong:#afbecb;
      --soft:#f5f8fb;
      --paper:#ffffff;
      --brand:#0b5f50;
      --brand-2:#25d366;
      --navy:#0b141a;
      --warn:#b45309;
      --bad:#b91c1c;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Aptos, "Segoe UI", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      color: var(--body);
      background:
        linear-gradient(180deg, #eaf0f4 0, #f6f8fb 260px, #eef3f7 100%);
      font-size: 13px;
    }
    main {
      max-width: 1180px;
      margin: 28px auto;
      padding: 0;
      background: var(--paper);
      border: 1px solid var(--line);
      box-shadow: 0 22px 60px rgba(21, 32, 43, .14);
    }
    header {
      background: linear-gradient(135deg, var(--navy), #10212a);
      color: #f8fafc;
      padding: 30px 34px;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 28px;
      border-bottom: 4px solid var(--brand-2);
    }
    h1 { margin: 8px 0 6px; font-size: 30px; line-height: 1.05; letter-spacing: -.02em; color: #fff; }
    h2 { margin: 0 0 14px; font-size: 14px; text-transform: uppercase; letter-spacing: .12em; color: var(--ink); }
    h3 { margin: 16px 0 7px; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .1em; }
    p { margin: 0; line-height: 1.58; }
    code { font-family: "Cascadia Mono", "JetBrains Mono", Consolas, monospace; font-size: 11px; color: #0f172a; }
    .content { padding: 28px 34px 34px; }
    .meta { text-align: right; color: #c8d6df; font-size: 12px; line-height: 1.7; }
    .brand { color: var(--brand-2); font-weight: 900; letter-spacing: .16em; font-size: 12px; text-transform: uppercase; }
    .subtitle { color: #c8d6df; font-size: 13px; }
    .classification {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-top: 14px;
      padding: 7px 11px;
      border: 1px solid rgba(37,211,102,.32);
      background: rgba(37,211,102,.1);
      color: #d8fff0;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: .08em;
    }
    .grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 14px; margin: 0 0 26px; }
    .metric {
      border: 1px solid var(--line);
      background: linear-gradient(180deg, #fff, var(--soft));
      padding: 16px;
      min-height: 94px;
      border-radius: 14px;
      box-shadow: 0 10px 24px rgba(15, 23, 42, .05);
    }
    .metric strong { display: block; font-size: 27px; line-height: 1; margin-bottom: 8px; color: var(--ink); }
    .metric span { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .1em; font-weight: 800; }
    section { margin: 26px 0; break-inside: avoid; }
    .panel {
      border: 1px solid var(--line);
      padding: 18px;
      background: #fff;
      border-radius: 14px;
      box-shadow: 0 8px 22px rgba(15, 23, 42, .045);
    }
    .notice {
      border: 1px solid #fed7aa;
      border-left: 4px solid var(--warn);
      background: #fff8ef;
      padding: 13px 15px;
      color: #7c2d12;
      border-radius: 12px;
      margin-bottom: 12px;
    }
    .table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 14px; background: #fff; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 780px; }
    th {
      text-align: left;
      color: #536475;
      background: #f3f7fa;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: .09em;
      border-bottom: 1px solid var(--line);
      padding: 11px 10px;
      white-space: nowrap;
    }
    td { border-bottom: 1px solid #e7edf3; padding: 11px 10px; vertical-align: top; }
    tbody tr:nth-child(even) { background: #fbfdff; }
    tbody tr:last-child td { border-bottom: 0; }
    .score { display: inline-block; min-width: 62px; text-align: center; padding: 4px 8px; border-radius: 999px; font-weight: 900; font-size: 11px; }
    .score.strong { background: #dcfce7; color: #166534; }
    .score.medium { background: #fef3c7; color: #92400e; }
    .score.low { background: #e5e7eb; color: #374151; }
    .verdict { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--soft); border: 1px solid var(--line); font-weight: 800; border-radius: 999px; }
    .muted { color: var(--muted); }
    .hash {
      word-break: break-all;
      color: #334155;
      font-size: 11px;
      font-family: "Cascadia Mono", Consolas, monospace;
      background: #f8fafc;
      border: 1px solid var(--line);
      padding: 10px 12px;
      border-radius: 10px;
    }
    ul { margin: 0; padding-left: 20px; }
    li { margin: 6px 0; line-height: 1.5; }
    footer {
      margin-top: 34px;
      padding-top: 16px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 11px;
      display: flex;
      justify-content: space-between;
      gap: 16px;
    }
    @media print {
      body { background: #fff; }
      main { margin: 0; max-width: none; border: 0; box-shadow: none; }
      header { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .content { padding: 18mm; }
      .no-print { display: none; }
      section { page-break-inside: avoid; }
      .table-wrap { overflow: visible; }
    }
    @media (max-width: 800px) {
      main { margin: 0; border-left: 0; border-right: 0; }
      header { grid-template-columns: 1fr; padding: 24px 20px; }
      .content { padding: 20px; }
      .meta { text-align: left; }
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>
</head>
<body>
<main>
  <header>
    <div>
      <p class="brand">WP MONITOR</p>
      <h1>Informe Final de Caso</h1>
      <p class="subtitle">${escapeHtml(report.summary.title)} · ${escapeHtml(report.summary.caseId)}</p>
      <span class="classification">Documento de auditoria autorizada</span>
    </div>
    <div class="meta">
      <p>Generado: ${escapeHtml(formatReportDate(report.summary.generatedAt))}</p>
      <p>Estado: ${escapeHtml(report.summary.status)}</p>
      <p>Version: ${escapeHtml(report.version)}</p>
    </div>
  </header>

  <div class="content">
  <div class="grid">
    <div class="metric"><strong>${escapeHtml(report.summary.auditEventCount)}</strong><span>Eventos de auditoria</span></div>
    <div class="metric"><strong>${escapeHtml(report.summary.evidenceLinkCount)}</strong><span>Evidencias vinculadas</span></div>
    <div class="metric"><strong>${escapeHtml(report.summary.callAnalysisCount)}</strong><span>Analisis de llamada</span></div>
    <div class="metric"><strong><span class="score ${scoreTone}">${escapeHtml(report.summary.highestCandidateScore)}/100</span></strong><span>Mayor score candidato</span></div>
    <div class="metric"><strong>${escapeHtml(report.summary.observedActivityEventCount)}</strong><span>Señales observadas</span></div>
  </div>

  <section class="panel">
    <h2>Resumen Ejecutivo</h2>
    <p>Este informe consolida actividad autorizada, auditoria, enlaces de evidencia, analisis de llamadas y resumen de capturas para el caso <strong>${escapeHtml(report.summary.caseId)}</strong>.</p>
    <p class="muted">Operador principal: ${escapeHtml(report.summary.primaryOperator)} · Objetivos vinculados: ${escapeHtml(report.summary.targetCount)} · Capturas de red completadas: ${escapeHtml(report.summary.networkCaptureCount)}</p>
  </section>

  <section class="panel">
    <h2>Alcance Autorizado</h2>
    <p>${escapeHtml(report.authorization.authorizationNote)}</p>
    ${report.authorization.description ? `<p class="muted">${escapeHtml(report.authorization.description)}</p>` : ''}
  </section>

  <section>
    <h2>Señales de Actividad Observada</h2>
    <div class="notice">
      Eventos pasivos atribuibles al caso. Se documenta tipo, fuente y confianza, sin incluir contenido de mensajes.
      ${report.summary.observedActivityTruncated ? `El anexo incluye ${escapeHtml(report.summary.observedActivityEventCount)} de ${escapeHtml(report.summary.observedActivityTotalAvailable)} señales disponibles; revise los limites declarados en el JSON.` : ''}
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>UTC</th><th>Target</th><th>Fuente</th><th>Evento</th><th>Confianza</th></tr></thead>
        <tbody>${observedSignalRows}</tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Actividad y Medición Técnica</h2>
    <div class="notice">
      Las señales pasivas y la medición RTT se presentan por separado. Una sesión puede tener actividad real aun cuando no exista latencia confirmada.
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Target</th><th>Señales 30d / días</th><th>M / C / P / L (30d)</th><th>RTT concl. / intentos</th><th>Online RTT</th><th>Online / concl. 24h</th><th>Online / concl. 7d</th><th>Online / concl. 30d</th><th>Cobertura</th><th>Confiabilidad RTT</th></tr></thead>
        <tbody>${activityRows}</tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Hallazgos de IP Candidata</h2>
    <div class="notice">
      Las IPs listadas son observaciones tecnicas dentro de una ventana autorizada. No prueban identidad, ubicacion exacta ni titularidad de una persona.
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>IP</th><th>Score</th><th>Categoria</th><th>ASN/ORG</th><th>Direccion</th><th>Paquetes</th><th>Geo</th><th>Nota tecnica</th></tr></thead>
        <tbody>${candidateRows}</tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Observaciones No Concluyentes</h2>
    <div class="notice">
      Estas IPs quedaron documentadas por transparencia, pero no alcanzaron el criterio tecnico para presentarse como candidatas. Pueden corresponder a muestras pequenas, relays, cloud/CDN, trafico unidireccional o contexto geografico incoherente.
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>IP</th><th>Score</th><th>Categoria</th><th>Direccion</th><th>Paquetes</th><th>Nota tecnica</th></tr></thead>
        <tbody>${nonConclusiveRows}</tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Timeline de Auditoria</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>UTC</th><th>Scope</th><th>Accion</th><th>Operador</th><th>Target</th></tr></thead>
        <tbody>${timelineHtml}</tbody>
      </table>
    </div>
  </section>

  <section class="panel">
    <h2>Integridad</h2>
    <h3>Hash del informe</h3>
    <p class="hash">${escapeHtml(report.integrity.reportHash)}</p>
    <h3>Hash del Evidence Package fuente</h3>
    <p class="hash">${escapeHtml(report.integrity.sourceEvidencePackageHash)}</p>
  </section>

  <section class="panel">
    <h2>Limitaciones Tecnicas</h2>
    <ul>${limitationHtml}</ul>
  </section>

  <footer>
    <span>WP MONITOR</span>
    <span>WP MONITOR · ${escapeHtml(report.summary.caseId)}</span>
  </footer>
  </div>
</main>
</body>
</html>`;
}

function toPdfText(value: unknown): string {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\x20-\x7E]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function escapePdfText(value: unknown): string {
    return toPdfText(value)
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)');
}

function wrapPdfText(value: unknown, maxChars: number): string[] {
    const words = toPdfText(value).split(' ').filter(Boolean);
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (next.length > maxChars && line) {
            lines.push(line);
            line = word;
        } else {
            line = next;
        }
    }
    if (line) lines.push(line);
    return lines.length ? lines : ['-'];
}

class PdfReportCanvas {
    readonly width = 595.28;
    readonly height = 841.89;
    readonly margin = 42;
    private pages: string[] = [];
    private content = '';
    y = this.height - this.margin;
    pageNumber = 0;

    constructor() {
        this.addPage();
    }

    addPage() {
        if (this.pageNumber > 0) {
            this.footer();
            this.pages.push(this.content);
        }
        this.pageNumber += 1;
        this.content = '';
        this.y = this.height - this.margin;
        this.text(this.margin, this.height - 28, 'WP MONITOR - Final Case Report', 8, 'F2', '475569');
        this.text(this.width - this.margin - 55, this.height - 28, `Page ${this.pageNumber}`, 8, 'F1', '64748B');
        this.line(this.margin, this.height - 36, this.width - this.margin, this.height - 36, 'CBD5E1');
    }

    finish(): Buffer {
        this.footer();
        this.pages.push(this.content);
        const objects: string[] = [];
        const pageObjectIds: number[] = [];
        const catalogId = 1;
        const pagesId = 2;
        const fontRegularId = 3;
        const fontBoldId = 4;
        const fontMonoId = 5;
        let nextId = 6;

        objects[catalogId] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
        objects[fontRegularId] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
        objects[fontBoldId] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`;
        objects[fontMonoId] = `<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>`;

        for (const page of this.pages) {
            const contentId = nextId++;
            const pageId = nextId++;
            const pageBuffer = Buffer.from(page, 'ascii');
            objects[contentId] = `<< /Length ${pageBuffer.length} >>\nstream\n${page}\nendstream`;
            objects[pageId] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R /F3 ${fontMonoId} 0 R >> >> /Contents ${contentId} 0 R >>`;
            pageObjectIds.push(pageId);
        }

        objects[pagesId] = `<< /Type /Pages /Kids [${pageObjectIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageObjectIds.length} >>`;

        let pdf = '%PDF-1.4\n';
        const offsets = [0];
        for (let id = 1; id < objects.length; id++) {
            offsets[id] = Buffer.byteLength(pdf, 'ascii');
            pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
        }
        const xrefOffset = Buffer.byteLength(pdf, 'ascii');
        pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
        for (let id = 1; id < objects.length; id++) {
            pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
        }
        pdf += `trailer\n<< /Size ${objects.length} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
        return Buffer.from(pdf, 'ascii');
    }

    ensure(height: number) {
        if (this.y - height < this.margin + 24) this.addPage();
    }

    color(hex: string): string {
        const value = hex.replace('#', '');
        const r = parseInt(value.slice(0, 2), 16) / 255;
        const g = parseInt(value.slice(2, 4), 16) / 255;
        const b = parseInt(value.slice(4, 6), 16) / 255;
        return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`;
    }

    text(x: number, y: number, value: unknown, size = 10, font = 'F1', color = '172033') {
        this.content += `BT /${font} ${size} Tf ${this.color(color)} rg ${x.toFixed(2)} ${y.toFixed(2)} Td (${escapePdfText(value)}) Tj ET\n`;
    }

    rect(x: number, y: number, width: number, height: number, fill = 'FFFFFF', stroke = 'CBD5E1') {
        this.content += `${this.color(fill)} rg ${this.color(stroke)} RG ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re B\n`;
    }

    line(x1: number, y1: number, x2: number, y2: number, color = 'CBD5E1') {
        this.content += `${this.color(color)} RG 0.6 w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S\n`;
    }

    heading(title: string) {
        this.ensure(42);
        this.y -= 14;
        this.text(this.margin, this.y, title.toUpperCase(), 12, 'F2', '0F766E');
        this.y -= 10;
        this.line(this.margin, this.y, this.width - this.margin, this.y, '99F6E4');
        this.y -= 18;
    }

    paragraph(value: unknown, maxChars = 92, size = 9, color = '334155') {
        const lines = wrapPdfText(value, maxChars);
        this.ensure(lines.length * 13 + 8);
        for (const line of lines) {
            this.text(this.margin, this.y, line, size, 'F1', color);
            this.y -= 13;
        }
        this.y -= 4;
    }

    footer() {
        this.line(this.margin, 30, this.width - this.margin, 30, 'E2E8F0');
        this.text(this.margin, 18, 'WP MONITOR', 7, 'F2', '64748B');
    }
}

export function renderFinalCaseReportPdf(report: ReturnType<typeof buildFinalCaseReport>): Buffer {
    const pdf = new PdfReportCanvas();
    const usable = pdf.width - pdf.margin * 2;
    const metricWidth = (usable - 24) / 4;

    pdf.rect(pdf.margin, pdf.y - 82, usable, 78, '0F766E', '0F766E');
    pdf.text(pdf.margin + 18, pdf.y - 30, 'INFORME FINAL DE CASO', 22, 'F2', 'FFFFFF');
    pdf.text(pdf.margin + 18, pdf.y - 52, `${report.summary.caseId} - ${report.summary.title}`, 10, 'F1', 'DDFCF4');
    pdf.text(pdf.margin + 18, pdf.y - 68, `Generado: ${formatReportDate(report.summary.generatedAt)} - Estado: ${report.summary.status}`, 8, 'F1', 'CCFBF1');
    pdf.y -= 112;

    const metrics = [
        ['Eventos', report.summary.auditEventCount],
        ['Evidencias', report.summary.evidenceLinkCount],
        ['Analisis llamada', report.summary.callAnalysisCount],
        ['Score maximo', `${report.summary.highestCandidateScore}/100`],
    ];
    metrics.forEach(([label, value], index) => {
        const x = pdf.margin + index * (metricWidth + 8);
        pdf.rect(x, pdf.y - 54, metricWidth, 54, 'F8FAFC', 'CBD5E1');
        pdf.text(x + 10, pdf.y - 22, value, 18, 'F2', index === 3 ? '0F766E' : '172033');
        pdf.text(x + 10, pdf.y - 40, label, 7, 'F2', '64748B');
    });
    pdf.y -= 82;

    pdf.heading('Resumen ejecutivo');
    pdf.paragraph(`Este informe consolida actividad autorizada, auditoria, enlaces de evidencia, analisis de llamadas y resumen de capturas para el caso ${report.summary.caseId}. Operador principal: ${report.summary.primaryOperator}. Objetivos vinculados: ${report.summary.targetCount}. Capturas de red completadas: ${report.summary.networkCaptureCount}.`);

    pdf.heading('Alcance autorizado');
    pdf.paragraph(report.authorization.authorizationNote);
    if (report.authorization.description) pdf.paragraph(report.authorization.description, 92, 8, '64748B');

    pdf.heading('Senales de actividad observada');
    pdf.paragraph('Eventos pasivos atribuibles al caso. Se documenta tipo, fuente y confianza, sin incluir contenido de mensajes.', 92, 8, '9A3412');
    if (report.summary.observedActivityTruncated) {
        pdf.paragraph(`El anexo incluye ${report.summary.observedActivityEventCount} de ${report.summary.observedActivityTotalAvailable} senales disponibles; revise los limites declarados en el JSON.`, 92, 8, '9A3412');
    }
    const observedSignals = report.findings.observedSignals.slice(-30).reverse();
    if (observedSignals.length === 0) {
        pdf.paragraph('No se registraron senales observables atribuibles al caso.');
    } else {
        for (const item of observedSignals) {
            pdf.ensure(20);
            pdf.text(pdf.margin, pdf.y, formatReportDate(item.timestampUtc), 7, 'F3', '64748B');
            pdf.text(pdf.margin + 150, pdf.y, item.targetJid, 7, 'F3', '334155');
            pdf.text(pdf.margin + 315, pdf.y, item.source, 7, 'F1', '334155');
            pdf.text(pdf.margin + 370, pdf.y, item.label, 7, 'F1', '172033');
            pdf.text(pdf.margin + 500, pdf.y, item.confidence, 7, 'F2', item.confidence === 'high' ? '166534' : '92400E');
            pdf.y -= 14;
        }
    }

    pdf.heading('Actividad y medicion tecnica');
    pdf.paragraph('Las senales pasivas y la medicion RTT se presentan por separado. Una sesion puede tener actividad real aun cuando no exista latencia confirmada.', 92, 8, '9A3412');
    const activityStats = report.findings.activityStats.slice(0, 12);
    if (activityStats.length === 0) {
        pdf.paragraph('No se registraron estadisticas de actividad para contactos vinculados.');
    } else {
        pdf.ensure(28);
        pdf.text(pdf.margin, pdf.y, 'Target', 8, 'F2', '64748B');
        pdf.text(pdf.margin + 145, pdf.y, 'Senales', 8, 'F2', '64748B');
        pdf.text(pdf.margin + 195, pdf.y, 'Concl./int.', 8, 'F2', '64748B');
        pdf.text(pdf.margin + 255, pdf.y, 'Online RTT', 8, 'F2', '64748B');
        pdf.text(pdf.margin + 315, pdf.y, '24h', 8, 'F2', '64748B');
        pdf.text(pdf.margin + 360, pdf.y, '7d', 8, 'F2', '64748B');
        pdf.text(pdf.margin + 405, pdf.y, '30d', 8, 'F2', '64748B');
        pdf.text(pdf.margin + 450, pdf.y, 'Cobertura', 8, 'F2', '64748B');
        pdf.text(pdf.margin + 510, pdf.y, 'Conf.', 8, 'F2', '64748B');
        pdf.y -= 10;
        pdf.line(pdf.margin, pdf.y, pdf.width - pdf.margin, pdf.y, 'CBD5E1');
        pdf.y -= 14;
        for (const item of activityStats) {
            pdf.ensure(22);
            pdf.text(pdf.margin, pdf.y, item.targetJid, 7, 'F3', '334155');
            pdf.text(pdf.margin + 145, pdf.y, String(item.observedEventCount), 7, 'F2', item.observedEventCount > 0 ? '166534' : '475569');
            pdf.text(pdf.margin + 195, pdf.y, `${item.conclusiveMeasurements}/${item.totalMeasurements}`, 7, 'F1', '334155');
            pdf.text(pdf.margin + 255, pdf.y, item.conclusiveMeasurements > 0 ? `${item.onlinePct}%` : '-', 7, 'F1', '334155');
            pdf.text(pdf.margin + 315, pdf.y, (item.last24h?.conclusiveMeasurements ?? 0) > 0 ? `${item.last24h.onlinePct}%` : '-', 7, 'F1', '334155');
            pdf.text(pdf.margin + 360, pdf.y, (item.last7d?.conclusiveMeasurements ?? 0) > 0 ? `${item.last7d.onlinePct}%` : '-', 7, 'F1', '334155');
            pdf.text(pdf.margin + 405, pdf.y, (item.last30d?.conclusiveMeasurements ?? 0) > 0 ? `${item.last30d.onlinePct}%` : '-', 7, 'F1', '334155');
            pdf.text(pdf.margin + 450, pdf.y, `${item.coverageActiveDays14}/14`, 7, 'F1', '334155');
            pdf.text(pdf.margin + 510, pdf.y, `${item.reliability?.score ?? 0}/100`, 7, 'F2', item.reliability?.label === 'strong' ? '166534' : item.reliability?.label === 'usable' ? '92400E' : '475569');
            pdf.y -= 16;
        }
    }

    pdf.heading('Hallazgos de IP candidata');
    pdf.rect(pdf.margin, pdf.y - 38, usable, 36, 'FFF7ED', 'FDBA74');
    pdf.text(pdf.margin + 10, pdf.y - 15, 'Nota tecnica', 8, 'F2', '9A3412');
    pdf.text(pdf.margin + 10, pdf.y - 28, 'Las IPs candidatas no prueban identidad, ubicacion exacta ni titularidad de una persona.', 8, 'F1', '9A3412');
    pdf.y -= 54;

    const candidates = report.findings.candidateIps.slice(0, 12);
    pdf.ensure(34);
    pdf.text(pdf.margin, pdf.y, 'IP', 8, 'F2', '64748B');
    pdf.text(pdf.margin + 95, pdf.y, 'Score', 8, 'F2', '64748B');
    pdf.text(pdf.margin + 145, pdf.y, 'Categoria', 8, 'F2', '64748B');
    pdf.text(pdf.margin + 250, pdf.y, 'Paquetes', 8, 'F2', '64748B');
    pdf.text(pdf.margin + 310, pdf.y, 'Geo / nota tecnica', 8, 'F2', '64748B');
    pdf.y -= 10;
    pdf.line(pdf.margin, pdf.y, pdf.width - pdf.margin, pdf.y, 'CBD5E1');
    pdf.y -= 14;

    if (candidates.length === 0) {
        pdf.paragraph('No se registraron IPs candidatas en los analisis vinculados.');
    } else {
        for (const candidate of candidates) {
            const geo = `${candidate.geo?.country || '-'} / ${candidate.geo?.city || candidate.geo?.region || '-'}`;
            const note = `${geo}. ${candidate.technicalNote}`;
            const noteLines = wrapPdfText(note, 45).slice(0, 3);
            const org = candidate.networkIntelligence?.asn
                ? `AS${candidate.networkIntelligence.asn} ${candidate.networkIntelligence.org}`
                : candidate.networkIntelligence?.org || '-';
            const rowHeight = Math.max(36, noteLines.length * 11 + 12);
            pdf.ensure(rowHeight + 8);
            pdf.rect(pdf.margin, pdf.y - rowHeight + 8, usable, rowHeight, 'FFFFFF', 'E2E8F0');
            pdf.text(pdf.margin + 8, pdf.y - 8, candidate.ip, 8, 'F3', '172033');
            pdf.text(pdf.margin + 98, pdf.y - 8, `${candidate.score}/100`, 9, 'F2', candidate.score >= 75 ? '166534' : candidate.score >= 45 ? '92400E' : '475569');
            pdf.text(pdf.margin + 145, pdf.y - 8, candidate.networkCategory, 8, 'F1', '334155');
            pdf.text(pdf.margin + 145, pdf.y - 19, org.slice(0, 22), 6, 'F1', '64748B');
            pdf.text(pdf.margin + 255, pdf.y - 8, String(candidate.packets), 8, 'F1', '334155');
            noteLines.forEach((line, idx) => pdf.text(pdf.margin + 310, pdf.y - 8 - idx * 11, line, 7, 'F1', '475569'));
            pdf.y -= rowHeight + 6;
        }
    }

    pdf.heading('Observaciones no concluyentes');
    pdf.paragraph('IPs documentadas por transparencia, pero sin criterio suficiente para presentarse como candidatas. Revisar si fueron muestras pequenas, relays, cloud/CDN, trafico unidireccional o contexto geografico incoherente.', 92, 8, '9A3412');
    const nonConclusive = (report.findings.nonConclusiveIpObservations || []).slice(0, 12);
    if (nonConclusive.length === 0) {
        pdf.paragraph('No se registraron observaciones no concluyentes separadas.');
    } else {
        for (const candidate of nonConclusive) {
            const note = `${candidate.networkCategory || 'unknown'} · ${candidate.direction || 'unknown'} · ${candidate.technicalNote || ''}`;
            const noteLines = wrapPdfText(note, 64).slice(0, 2);
            const rowHeight = Math.max(28, noteLines.length * 10 + 10);
            pdf.ensure(rowHeight + 8);
            pdf.rect(pdf.margin, pdf.y - rowHeight + 8, usable, rowHeight, 'FFFFFF', 'E2E8F0');
            pdf.text(pdf.margin + 8, pdf.y - 8, candidate.ip, 8, 'F3', '172033');
            pdf.text(pdf.margin + 98, pdf.y - 8, `${candidate.score}/100`, 8, 'F2', '475569');
            pdf.text(pdf.margin + 150, pdf.y - 8, `${candidate.packets} pkts`, 8, 'F1', '334155');
            noteLines.forEach((line, idx) => pdf.text(pdf.margin + 215, pdf.y - 8 - idx * 10, line, 7, 'F1', '475569'));
            pdf.y -= rowHeight + 6;
        }
    }

    pdf.heading('Timeline de auditoria');
    const timeline = report.timeline.slice(-70);
    const drawTimelineHeader = (continued = false) => {
        if (continued) {
            pdf.text(pdf.margin, pdf.y, 'Timeline de auditoria (continuacion)', 9, 'F2', '0F766E');
            pdf.y -= 16;
        }
        pdf.text(pdf.margin, pdf.y, 'UTC', 8, 'F2', '64748B');
        pdf.text(pdf.margin + 125, pdf.y, 'Scope', 8, 'F2', '64748B');
        pdf.text(pdf.margin + 190, pdf.y, 'Accion', 8, 'F2', '64748B');
        pdf.text(pdf.margin + 330, pdf.y, 'Operador / target', 8, 'F2', '64748B');
        pdf.y -= 10;
        pdf.line(pdf.margin, pdf.y, pdf.width - pdf.margin, pdf.y, 'CBD5E1');
        pdf.y -= 14;
    };
    drawTimelineHeader();
    if (timeline.length === 0) {
        pdf.paragraph('No hay eventos de auditoria disponibles.');
    } else {
        for (const item of timeline) {
            if (pdf.y - 20 < pdf.margin + 24) {
                pdf.addPage();
                drawTimelineHeader(true);
            }
            pdf.text(pdf.margin, pdf.y, formatReportDate(item.timestampUtc), 7, 'F3', '334155');
            pdf.text(pdf.margin + 125, pdf.y, item.scope, 7, 'F1', '334155');
            pdf.text(pdf.margin + 190, pdf.y, item.action, 7, 'F1', '172033');
            pdf.text(pdf.margin + 330, pdf.y, `${item.operatorName} / ${item.targetJid || '-'}`, 7, 'F1', '475569');
            pdf.y -= 16;
        }
    }

    pdf.heading('Integridad');
    pdf.paragraph('Hash del informe:', 92, 8, '64748B');
    pdf.paragraph(report.integrity.reportHash, 78, 7, '334155');
    pdf.paragraph('Hash del Evidence Package fuente:', 92, 8, '64748B');
    pdf.paragraph(report.integrity.sourceEvidencePackageHash, 78, 7, '334155');

    pdf.heading('Limitaciones tecnicas');
    for (const item of report.findings.limitations) {
        pdf.paragraph(`- ${item}`, 90, 8, '334155');
    }

    return pdf.finish();
}

const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
    }
    return table;
})();

function crc32(buffer: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc = (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function getDosDateTime(date = new Date()) {
    const time =
        (date.getHours() << 11) |
        (date.getMinutes() << 5) |
        Math.floor(date.getSeconds() / 2);
    const dosDate =
        ((date.getFullYear() - 1980) << 9) |
        ((date.getMonth() + 1) << 5) |
        date.getDate();
    return { time, dosDate };
}

function createZip(entries: Array<{ name: string; data: string | Buffer }>): Buffer {
    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let offset = 0;
    const { time, dosDate } = getDosDateTime();

    for (const entry of entries) {
        const nameBuffer = Buffer.from(entry.name, 'utf8');
        const dataBuffer = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
        const crc = crc32(dataBuffer);

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0x0800, 6);
        localHeader.writeUInt16LE(0, 8);
        localHeader.writeUInt16LE(time, 10);
        localHeader.writeUInt16LE(dosDate, 12);
        localHeader.writeUInt32LE(crc, 14);
        localHeader.writeUInt32LE(dataBuffer.length, 18);
        localHeader.writeUInt32LE(dataBuffer.length, 22);
        localHeader.writeUInt16LE(nameBuffer.length, 26);
        localHeader.writeUInt16LE(0, 28);

        localParts.push(localHeader, nameBuffer, dataBuffer);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0x0800, 8);
        centralHeader.writeUInt16LE(0, 10);
        centralHeader.writeUInt16LE(time, 12);
        centralHeader.writeUInt16LE(dosDate, 14);
        centralHeader.writeUInt32LE(crc, 16);
        centralHeader.writeUInt32LE(dataBuffer.length, 20);
        centralHeader.writeUInt32LE(dataBuffer.length, 24);
        centralHeader.writeUInt16LE(nameBuffer.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(0, 38);
        centralHeader.writeUInt32LE(offset, 42);
        centralParts.push(centralHeader, nameBuffer);

        offset += localHeader.length + nameBuffer.length + dataBuffer.length;
    }

    const centralOffset = offset;
    const centralDirectory = Buffer.concat(centralParts);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralDirectory.length, 12);
    end.writeUInt32LE(centralOffset, 16);
    end.writeUInt16LE(0, 20);

    return Buffer.concat([...localParts, centralDirectory, end]);
}

function csvCell(value: unknown): string {
    if (value === null || value === undefined) return '';
    const raw = value instanceof Date
        ? value.toISOString()
        : typeof value === 'object'
            ? JSON.stringify(value)
            : String(value);
    const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replace(/"/g, '""')}"`;
}

function toCsv(headers: string[], rows: unknown[][]): string {
    const lines = [
        headers.map(csvCell).join(','),
        ...rows.map(row => row.map(csvCell).join(',')),
    ];
    return `${lines.join('\r\n')}\r\n`;
}

function buildCsvAnnexes(
    evidencePackage: NonNullable<Awaited<ReturnType<typeof buildEvidencePackage>>>,
    finalReport: ReturnType<typeof buildFinalCaseReport>
) {
    const auditRows = (evidencePackage.sections.audit || []).map(event => [
        event.timestampUtc,
        event.timestamp,
        event.caseId,
        event.scope,
        event.action,
        event.operatorName,
        event.targetJid || '',
        event.authorizationNote,
        event.details || {},
    ]);

    const evidenceRows = (evidencePackage.sections.evidenceLinks || []).map(link => [
        link.createdAt,
        link.updatedAt,
        link.caseId,
        link.type,
        link.refId,
        link.label,
        link.targetJid || '',
        link.metadata || {},
    ]);

    const callRows = (evidencePackage.sections.callAnalysis || []).map((analysis: any) => {
        const candidates = Array.isArray(analysis.candidateIps) ? analysis.candidateIps : [];
        const highestScore = candidates
            .map((candidate: any) => getCandidateScore(candidate))
            .sort((a: number, b: number) => b - a)[0] || 0;
        return [
            analysis.callId,
            analysis.targetJid,
            analysis.startTime,
            analysis.endTime || '',
            analysis.durationSec || 0,
            analysis.isVideo ? 'true' : 'false',
            analysis.totalPackets || 0,
            analysis.verdict || '',
            analysis.captureInterface || '',
            candidates.length,
            highestScore,
            Array.isArray(analysis.metaIps) ? analysis.metaIps.length : 0,
        ];
    });

    const candidateRows = finalReport.findings.candidateIps.map((candidate: any) => [
        candidate.callId,
        candidate.targetJid,
        candidate.ip,
        candidate.score,
        candidate.confidence,
        candidate.provider,
        candidate.networkCategory,
        candidate.networkIntelligence?.asn || '',
        candidate.networkIntelligence?.org || '',
        candidate.networkIntelligence?.category || '',
        candidate.networkIntelligence?.isDatacenterLikely ? 'true' : 'false',
        candidate.direction,
        candidate.packets,
        candidate.ports?.join('|') || '',
        candidate.geo?.country || '',
        candidate.geo?.region || '',
        candidate.geo?.city || '',
        candidate.geo?.lat ?? '',
        candidate.geo?.lon ?? '',
        candidate.geo?.timezone || '',
        candidate.ipEnrichment?.provider || '',
        candidate.ipEnrichment?.status || '',
        candidate.ipEnrichment?.city || '',
        candidate.ipEnrichment?.regionName || candidate.ipEnrichment?.region || '',
        candidate.ipEnrichment?.postalCode || '',
        candidate.ipEnrichment?.isp || '',
        candidate.ipEnrichment?.org || '',
        candidate.ipEnrichment?.asn || '',
        candidate.ipEnrichment?.mobile === undefined ? '' : candidate.ipEnrichment.mobile ? 'true' : 'false',
        candidate.ipEnrichment?.proxy === undefined ? '' : candidate.ipEnrichment.proxy ? 'true' : 'false',
        candidate.ipEnrichment?.hosting === undefined ? '' : candidate.ipEnrichment.hosting ? 'true' : 'false',
        candidate.ipEnrichment?.mapsUrl || '',
        candidate.ipEnrichment?.accuracyNote || '',
        candidate.reasonCodes?.map((reason: any) => `${reason.code}:${reason.delta}`).join('|') || '',
        candidate.technicalNote,
    ]);

    const nonConclusiveRows = (finalReport.findings.nonConclusiveIpObservations || []).map((candidate: any) => [
        candidate.callId,
        candidate.targetJid,
        candidate.ip,
        candidate.score,
        candidate.confidence,
        candidate.provider,
        candidate.networkCategory,
        candidate.networkIntelligence?.asn || '',
        candidate.networkIntelligence?.org || '',
        candidate.direction,
        candidate.packets,
        candidate.ports?.join('|') || '',
        candidate.reasonCodes?.map((reason: any) => `${reason.code}:${reason.delta}`).join('|') || '',
        candidate.technicalNote,
    ]);

    const networkRows = (evidencePackage.sections.networkSummary?.captures || []).map((capture: any) => [
        capture.timestampUtc,
        capture.operatorName,
        capture.stats?.interface || capture.stats?.device || '',
        capture.stats?.totalPackets ?? capture.stats?.packets ?? '',
        capture.stats?.dropped ?? '',
        capture.stats || {},
    ]);

    const activityRows = finalReport.findings.activityStats.map((item: any) => [
        item.targetJid,
        item.observedEventCount,
        item.observedActiveDays,
        item.observedBySource?.message || 0,
        item.observedBySource?.receipt || 0,
        item.observedBySource?.presence || 0,
        item.observedBySource?.call || 0,
        item.totalMeasurements,
        item.onlinePct,
        item.standbyPct,
        item.noAckPct,
        item.avgRtt,
        item.firstSeen || '',
        item.lastSeen || '',
        item.lastOnline || '',
        item.last24h?.onlinePct ?? '',
        item.last24h?.changeOnlinePct ?? '',
        item.last7d?.onlinePct ?? '',
        item.last7d?.changeOnlinePct ?? '',
        item.last30d?.onlinePct ?? '',
        item.coverageActiveDays14,
        item.reliability?.score ?? '',
        item.reliability?.label ?? '',
        item.reliability?.reasonCodes?.join('|') || '',
        item.calibratingPct,
        item.unknownPct,
        item.conclusiveMeasurements,
        item.inconclusiveMeasurements,
        item.acknowledgedRttMeasurements,
    ]);

    const observedActivityRows = finalReport.findings.observedSignals.map((item: any) => [
        item.timestampUtc,
        item.targetJid,
        item.source,
        item.type,
        item.label,
        item.confidence,
    ]);

    const annexes = [
        {
            name: 'annexes/audit-events.csv',
            data: toCsv(
                ['timestampUtc', 'timestampLocal', 'caseId', 'scope', 'action', 'operatorName', 'targetJid', 'authorizationNote', 'detailsJson'],
                auditRows
            ),
        },
        {
            name: 'annexes/evidence-links.csv',
            data: toCsv(
                ['createdAt', 'updatedAt', 'caseId', 'type', 'refId', 'label', 'targetJid', 'metadataJson'],
                evidenceRows
            ),
        },
        {
            name: 'annexes/call-analysis.csv',
            data: toCsv(
                ['callId', 'targetJid', 'startTime', 'endTime', 'durationSec', 'isVideo', 'totalPackets', 'verdict', 'captureInterface', 'candidateCount', 'highestCandidateScore', 'metaIpCount'],
                callRows
            ),
        },
        {
            name: 'annexes/candidate-ips.csv',
            data: toCsv(
                ['callId', 'targetJid', 'ip', 'score', 'confidence', 'provider', 'networkCategory', 'asn', 'org', 'asnCategory', 'isDatacenterLikely', 'direction', 'packets', 'ports', 'geoCountry', 'geoRegion', 'geoCity', 'geoLat', 'geoLon', 'geoTimezone', 'enrichmentProvider', 'enrichmentStatus', 'enrichmentCity', 'enrichmentRegion', 'enrichmentPostalCode', 'enrichmentIsp', 'enrichmentOrg', 'enrichmentAsn', 'enrichmentMobile', 'enrichmentProxy', 'enrichmentHosting', 'enrichmentMapsUrl', 'enrichmentAccuracyNote', 'reasonCodes', 'technicalNote'],
                candidateRows
            ),
        },
        {
            name: 'annexes/non-conclusive-ip-observations.csv',
            data: toCsv(
                ['callId', 'targetJid', 'ip', 'score', 'confidence', 'provider', 'networkCategory', 'asn', 'org', 'direction', 'packets', 'ports', 'reasonCodes', 'technicalNote'],
                nonConclusiveRows
            ),
        },
        {
            name: 'annexes/network-captures.csv',
            data: toCsv(
                ['timestampUtc', 'operatorName', 'interface', 'totalPackets', 'droppedPackets', 'statsJson'],
                networkRows
            ),
        },
        {
            name: 'annexes/activity-stats.csv',
            data: toCsv(
                ['targetJid', 'observedEventCount', 'observedActiveDays', 'observedMessages', 'observedReceipts', 'observedPresence', 'observedCalls', 'totalMeasurements', 'onlinePct', 'standbyPct', 'noAckPct', 'avgRtt', 'firstSeen', 'lastSeen', 'lastOnline', 'last24hOnlinePct', 'last24hChangeOnlinePct', 'last7dOnlinePct', 'last7dChangeOnlinePct', 'last30dOnlinePct', 'coverageActiveDays14', 'reliabilityScore', 'reliabilityLabel', 'reliabilityReasonCodes', 'calibratingPct', 'unknownPct', 'conclusiveMeasurements', 'inconclusiveMeasurements', 'acknowledgedRttMeasurements'],
                activityRows
            ),
        },
        {
            name: 'annexes/observed-activity.csv',
            data: toCsv(
                ['timestampUtc', 'targetJid', 'source', 'type', 'label', 'confidence'],
                observedActivityRows,
            ),
        },
    ];

    const integrity = {
        generatedAt: new Date().toISOString(),
        algorithm: 'SHA-256',
        files: annexes.map(annex => ({
            name: annex.name,
            sha256: hashText(annex.data),
            rows: Math.max(0, annex.data.split('\r\n').length - 2),
        })),
        notes: [
            'CSV annexes are derived from the canonical Evidence Package sections.',
            'CSV cells are quoted and formula-prefixed values are escaped to reduce spreadsheet injection risk.',
        ],
    };

    return { annexes, integrity };
}

export function buildEvidenceZip(evidencePackage: NonNullable<Awaited<ReturnType<typeof buildEvidencePackage>>>): Buffer {
    const json = (value: unknown) => JSON.stringify(value, null, 2);
    const finalReport = buildFinalCaseReport(evidencePackage);
    const csv = buildCsvAnnexes(evidencePackage, finalReport);
    const zipManifest = {
        ...evidencePackage.manifest,
        zipAnnexes: csv.integrity.files,
    };
    return createZip([
        { name: 'manifest.json', data: json(zipManifest) },
        { name: 'case.json', data: json(evidencePackage.sections.case) },
        { name: 'audit.json', data: json(evidencePackage.sections.audit) },
        { name: 'evidence-links.json', data: json(evidencePackage.sections.evidenceLinks) },
        { name: 'call-analysis.json', data: json(evidencePackage.sections.callAnalysis) },
        { name: 'activity-stats.json', data: json(evidencePackage.sections.activityStats || []) },
        { name: 'observed-activity.json', data: json(evidencePackage.sections.observedActivity || []) },
        { name: 'network-summary.json', data: json(evidencePackage.sections.networkSummary) },
        { name: 'final-report.json', data: json(finalReport) },
        { name: 'final-report.html', data: renderFinalCaseReportHtml(finalReport) },
        { name: 'final-report.pdf', data: renderFinalCaseReportPdf(finalReport) },
        ...csv.annexes,
        { name: 'annexes/csv-integrity.json', data: json(csv.integrity) },
        { name: 'integrity.json', data: json(evidencePackage.integrity) },
        { name: 'full-package.json', data: json(evidencePackage) },
    ]);
}

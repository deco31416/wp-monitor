import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Archive,
    CheckCircle2,
    ClipboardList,
    Clock,
    Database,
    Download,
    FileText,
    Filter,
    Radio,
    RefreshCw,
    Search,
    ShieldAlert,
    ShieldCheck,
} from 'lucide-react';
import { API_URL, authFetch, downloadAuthenticatedFile } from '../auth';
import { AuditEvent, CaseRecord } from '../types';

type ScopeFilter = 'all' | AuditEvent['scope'];

const SCOPE_STYLES: Record<string, string> = {
    network: 'badge-accent',
    call: 'badge-success',
    contact: 'badge-neutral',
    report: 'badge-warning',
    system: 'badge-neutral',
};

const SCOPE_LABELS: Record<string, string> = {
    network: 'Red',
    call: 'Llamada',
    contact: 'Contacto',
    report: 'Reporte',
    system: 'Sistema',
};

const ACTION_LABELS: Record<string, string> = {
    case_created: 'Caso creado',
    case_updated: 'Caso actualizado',
    case_closed: 'Caso cerrado',
    capture_start: 'Captura de red iniciada',
    capture_stop: 'Captura de red cerrada',
    call_capture_start: 'Captura de llamada iniciada',
    call_capture_stop: 'Analisis de llamada cerrado',
    contact_tracking_start: 'Monitoreo de contacto iniciado',
    checkin_link_created: 'Check-In creado',
    checkin_completed: 'Check-In completado',
    checkin_updated: 'Check-In actualizado',
    checkin_revoked: 'Check-In revocado',
    checkin_deleted: 'Check-In eliminado',
    audit_export_requested: 'Export de auditoria solicitado',
    audit_export: 'Export de auditoria generado',
    evidence_package_export_requested: 'Evidence package solicitado',
    evidence_package_export: 'Evidence package generado',
    evidence_package_zip_export_requested: 'Evidence ZIP solicitado',
    evidence_package_zip_export: 'Evidence ZIP generado',
    final_report_json_export_requested: 'Reporte JSON solicitado',
    final_report_json_export: 'Reporte JSON generado',
    final_report_html_export_requested: 'Reporte HTML solicitado',
    final_report_html_export: 'Reporte HTML generado',
    final_report_pdf_export_requested: 'Reporte PDF solicitado',
    final_report_pdf_export: 'Reporte PDF generado',
    backend_operational: 'Backend operativo',
};

export function AuditTrail() {
    const [cases, setCases] = useState<CaseRecord[]>([]);
    const [caseId, setCaseId] = useState('');
    const [manualCaseId, setManualCaseId] = useState('');
    const [events, setEvents] = useState<AuditEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [casesLoading, setCasesLoading] = useState(true);
    const [searchedCase, setSearchedCase] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
    const [actionFilter, setActionFilter] = useState('all');
    const [query, setQuery] = useState('');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(8);

    const fetchCases = useCallback(async () => {
        try {
            const res = await authFetch(`${API_URL}/api/cases?limit=100`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const list = Array.isArray(data) ? data : [];
            setCases(list);
            if (!caseId && list[0]?.caseId) {
                setCaseId(list[0].caseId);
            } else if (!caseId) {
                setLoading(false);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load cases');
            setLoading(false);
        } finally {
            setCasesLoading(false);
        }
    }, [caseId]);

    const fetchAudit = useCallback(async (requestedCaseId?: string) => {
        const selected = (requestedCaseId || caseId || manualCaseId).trim();
        if (!selected) return;

        try {
            const res = await authFetch(`${API_URL}/api/audit/${encodeURIComponent(selected)}?limit=500`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setEvents(Array.isArray(data) ? data : []);
            setSearchedCase(selected);
            setScopeFilter('all');
            setActionFilter('all');
            setQuery('');
            setPage(1);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load audit events');
            setEvents([]);
            setSearchedCase(selected);
        } finally {
            setLoading(false);
        }
    }, [caseId, manualCaseId]);

    useEffect(() => {
        let cancelled = false;
        queueMicrotask(() => {
            if (!cancelled) void fetchCases();
        });
        return () => {
            cancelled = true;
        };
    }, [fetchCases]);

    useEffect(() => {
        let cancelled = false;
        queueMicrotask(() => {
            if (!cancelled && !searchedCase && caseId) void fetchAudit(caseId);
        });
        return () => {
            cancelled = true;
        };
    }, [caseId, fetchAudit, searchedCase]);

    const selectedCase = useMemo(
        () => cases.find(item => item.caseId === searchedCase || item.caseId === caseId) || null,
        [caseId, cases, searchedCase]
    );

    const actionOptions = useMemo(() => {
        const scopedEvents = scopeFilter === 'all'
            ? events
            : events.filter(event => event.scope === scopeFilter);
        return Array.from(new Set(scopedEvents.map(event => event.action))).sort();
    }, [events, scopeFilter]);

    const filteredEvents = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return events.filter(event => {
            if (scopeFilter !== 'all' && event.scope !== scopeFilter) return false;
            if (actionFilter !== 'all' && event.action !== actionFilter) return false;
            if (!needle) return true;
            return [
                event.caseId,
                event.operatorName,
                event.authorizationNote,
                event.action,
                event.scope,
                event.targetJid || '',
                JSON.stringify(event.details || {}),
            ].some(value => value.toLowerCase().includes(needle));
        });
    }, [actionFilter, events, query, scopeFilter]);

    const stats = useMemo(() => buildStats(events), [events]);
    const totalPages = Math.max(1, Math.ceil(filteredEvents.length / pageSize));
    const safePage = Math.min(page, totalPages);
    const pageStart = filteredEvents.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
    const pageEnd = Math.min(safePage * pageSize, filteredEvents.length);
    const paginatedEvents = useMemo(() => {
        const start = (safePage - 1) * pageSize;
        return filteredEvents.slice(start, start + pageSize);
    }, [filteredEvents, pageSize, safePage]);
    const firstEvent = events[events.length - 1];
    const lastEvent = events[0];
    const operators = Array.from(new Set(events.map(event => event.operatorName).filter(Boolean)));

    const startAuditFetch = (requestedCaseId: string) => {
        setLoading(true);
        setError(null);
        void fetchAudit(requestedCaseId);
    };

    const onSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        startAuditFetch(manualCaseId || caseId);
    };

    const chooseCase = (value: string) => {
        setCaseId(value);
        setManualCaseId('');
        if (value) startAuditFetch(value);
    };

    const updateScopeFilter = (value: ScopeFilter) => {
        setScopeFilter(value);
        setActionFilter('all');
        setPage(1);
    };

    const updateActionFilter = (value: string) => {
        setActionFilter(value);
        setPage(1);
    };

    const updateQuery = (value: string) => {
        setQuery(value);
        setPage(1);
    };

    const updatePageSize = (value: number) => {
        setPageSize(value);
        setPage(1);
    };

    const downloadAuditExport = useCallback(async () => {
        if (!searchedCase) return;
        try {
            await downloadAuthenticatedFile(`${API_URL}/api/audit/${encodeURIComponent(searchedCase)}/export?limit=1000`, `audit-${searchedCase}.json`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to download audit export');
        }
    }, [searchedCase]);

    const downloadEvidencePackage = useCallback(async () => {
        if (!searchedCase) return;
        try {
            await downloadAuthenticatedFile(`${API_URL}/api/evidence/${encodeURIComponent(searchedCase)}/package`, `evidence-${searchedCase}.json`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to download evidence package');
        }
    }, [searchedCase]);

    const downloadEvidenceZip = useCallback(async () => {
        if (!searchedCase) return;
        try {
            await downloadAuthenticatedFile(`${API_URL}/api/evidence/${encodeURIComponent(searchedCase)}/package.zip`, `evidence-${searchedCase}.zip`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to download evidence ZIP');
        }
    }, [searchedCase]);

    const downloadFinalReportJson = useCallback(async () => {
        if (!searchedCase) return;
        try {
            await downloadAuthenticatedFile(`${API_URL}/api/reports/${encodeURIComponent(searchedCase)}/final`, `final-report-${searchedCase}.json`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to download final report JSON');
        }
    }, [searchedCase]);

    const downloadFinalReportHtml = useCallback(async () => {
        if (!searchedCase) return;
        try {
            await downloadAuthenticatedFile(`${API_URL}/api/reports/${encodeURIComponent(searchedCase)}/final.html`, `final-report-${searchedCase}.html`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to download final report HTML');
        }
    }, [searchedCase]);

    const downloadFinalReportPdf = useCallback(async () => {
        if (!searchedCase) return;
        try {
            await downloadAuthenticatedFile(`${API_URL}/api/reports/${encodeURIComponent(searchedCase)}/final.pdf`, `final-report-${searchedCase}.pdf`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to download final report PDF');
        }
    }, [searchedCase]);

    return (
        <div className="space-y-4">
            <section className="card p-5">
                <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <div className="p-2 rounded-xl bg-accent-muted text-accent">
                            <ClipboardList size={18} />
                        </div>
                        <div>
                            <h3 className="text-base font-semibold text-txt-primary">Audit Trail</h3>
                            <p className="text-sm text-txt-dim max-w-3xl">
                                Consolida trazabilidad por caso: capturas, llamadas, check-ins, reportes, exportaciones y acciones administrativas.
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => startAuditFetch(searchedCase || caseId)}
                        disabled={loading || (!searchedCase && !caseId)}
                        className="btn-ghost flex items-center justify-center gap-2"
                    >
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                        Refrescar
                    </button>
                </div>

                <form onSubmit={onSubmit} className="mt-5 grid grid-cols-1 xl:grid-cols-[minmax(260px,1fr)_minmax(240px,0.7fr)_auto] gap-3">
                    <select
                        value={caseId}
                        onChange={event => chooseCase(event.target.value)}
                        className="select-field !py-3"
                        disabled={casesLoading}
                    >
                        <option value="">{casesLoading ? 'Cargando casos...' : 'Seleccionar caso auditado'}</option>
                        {cases.map(item => (
                            <option key={item.caseId} value={item.caseId}>
                                {item.caseId} - {item.title || item.caseId}
                            </option>
                        ))}
                    </select>
                    <input
                        value={manualCaseId}
                        onChange={event => setManualCaseId(event.target.value)}
                        placeholder="O escribir Case ID manual"
                        className="input-field"
                    />
                    <button
                        type="submit"
                        disabled={(!caseId && !manualCaseId.trim()) || loading}
                        className="btn-primary flex items-center justify-center gap-2"
                    >
                        <Search size={16} />
                        {loading ? 'Buscando' : 'Buscar'}
                    </button>
                </form>
            </section>

            {searchedCase && (
                <section className="grid grid-cols-1 lg:grid-cols-5 gap-3">
                    <SummaryCard label="Case ID" value={searchedCase} icon={<ShieldCheck size={16} />} tone="accent" />
                    <SummaryCard label="Eventos" value={String(events.length)} icon={<Database size={16} />} />
                    <SummaryCard label="Operadores" value={operators.length ? operators.join(', ') : '-'} icon={<ClipboardList size={16} />} />
                    <SummaryCard label="Rango UTC" value={firstEvent && lastEvent ? `${formatTime(firstEvent.timestampUtc)} - ${formatTime(lastEvent.timestampUtc)}` : '-'} icon={<Clock size={16} />} />
                    <SummaryCard label="Ultima accion" value={lastEvent ? labelAction(lastEvent.action) : '-'} icon={<Radio size={16} />} tone="success" />
                </section>
            )}

            {searchedCase && (
                <section className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-4">
                    <div className="card p-5 space-y-4">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-sm font-semibold text-txt-primary">Lectura investigativa</p>
                                <p className="text-xs text-txt-dim">Resumen rapido de la actividad formal vinculada al caso.</p>
                            </div>
                            {selectedCase && <span className={selectedCase.status === 'active' ? 'badge-success' : 'badge-neutral'}>{selectedCase.status}</span>}
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <Metric label="Check-ins" value={stats.checkins} />
                            <Metric label="Llamadas" value={stats.calls} />
                            <Metric label="Capturas red" value={stats.network} />
                            <Metric label="Reportes/export" value={stats.reports} />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                            <InfoLine label="Operador principal" value={selectedCase?.primaryOperator || operators[0] || '-'} />
                            <InfoLine label="Autorizacion" value={selectedCase?.authorizationNote || firstEvent?.authorizationNote || '-'} />
                            <InfoLine label="Primer evento" value={firstEvent ? formatDateTime(firstEvent.timestampUtc) : '-'} />
                            <InfoLine label="Ultimo evento" value={lastEvent ? formatDateTime(lastEvent.timestampUtc) : '-'} />
                        </div>
                    </div>

                    <div className="card p-5 space-y-4">
                        <div>
                            <p className="text-sm font-semibold text-txt-primary">Paquete de evidencia</p>
                            <p className="text-xs text-txt-dim">Salidas con hash y anexos para revision o archivo del caso.</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <button onClick={downloadFinalReportPdf} disabled={!events.length} className="btn-primary flex items-center justify-center gap-2"><FileText size={16} />PDF</button>
                            <button onClick={downloadFinalReportHtml} disabled={!events.length} className="btn-primary flex items-center justify-center gap-2"><FileText size={16} />HTML</button>
                            <button onClick={downloadFinalReportJson} disabled={!events.length} className="btn-ghost flex items-center justify-center gap-2"><Download size={16} />JSON</button>
                            <button onClick={downloadAuditExport} disabled={!events.length} className="btn-ghost flex items-center justify-center gap-2"><Download size={16} />Audit</button>
                            <button onClick={downloadEvidencePackage} disabled={!events.length} className="btn-ghost flex items-center justify-center gap-2"><Archive size={16} />Package</button>
                            <button onClick={downloadEvidenceZip} disabled={!events.length} className="btn-primary flex items-center justify-center gap-2"><Archive size={16} />ZIP</button>
                        </div>
                    </div>
                </section>
            )}

            {searchedCase && events.length > 0 && (
                <section className="card p-4">
                    <div className="flex flex-col xl:flex-row xl:items-center gap-3">
                        <div className="flex items-center gap-2 text-sm text-txt-secondary">
                            <Filter size={16} className="text-txt-dim" />
                            <span>Filtros de auditoria</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 flex-1">
                            <select value={scopeFilter} onChange={event => updateScopeFilter(event.target.value as ScopeFilter)} className="select-field">
                                <option value="all">Todos los alcances</option>
                                <option value="system">Sistema</option>
                                <option value="contact">Contacto</option>
                                <option value="call">Llamada</option>
                                <option value="network">Red</option>
                                <option value="report">Reporte</option>
                            </select>
                            <select value={actionFilter} onChange={event => updateActionFilter(event.target.value)} className="select-field">
                                <option value="all">Todas las acciones</option>
                                {actionOptions.map(action => <option key={action} value={action}>{labelAction(action)}</option>)}
                            </select>
                            <input value={query} onChange={event => updateQuery(event.target.value)} placeholder="Buscar operador, target, hash, IP..." className="input-field" />
                            <select value={pageSize} onChange={event => updatePageSize(Number(event.target.value))} className="select-field">
                                <option value={6}>6 por pagina</option>
                                <option value={8}>8 por pagina</option>
                                <option value={12}>12 por pagina</option>
                                <option value={20}>20 por pagina</option>
                            </select>
                        </div>
                    </div>
                </section>
            )}

            {error && (
                <div className="card p-5 border-danger/30 text-danger text-sm">
                    Error cargando auditoria: {error}
                </div>
            )}

            {searchedCase && !loading && !error && events.length === 0 && (
                <div className="empty-state">
                    <ClipboardList size={36} className="mx-auto text-txt-dim mb-3" />
                    <p className="text-sm text-txt-muted">No hay eventos para este Case ID.</p>
                </div>
            )}

            {searchedCase && events.length > 0 && filteredEvents.length === 0 && (
                <div className="empty-state">
                    <Filter size={36} className="mx-auto text-txt-dim mb-3" />
                    <p className="text-sm text-txt-muted">No hay eventos con esos filtros.</p>
                </div>
            )}

            {filteredEvents.length > 0 && (
                <section className="grid grid-cols-1 2xl:grid-cols-[0.88fr_1.12fr] gap-4">
                    <div className="card p-5">
                        <div className="flex items-center justify-between gap-3 mb-5">
                            <div>
                                <h4 className="text-sm font-semibold text-txt-primary">Timeline de cadena de custodia</h4>
                                <p className="text-xs text-txt-dim">
                                    Mostrando {pageStart}-{pageEnd} de {filteredEvents.length} filtrados · {events.length} totales
                                </p>
                            </div>
                            <span className="badge-neutral">{searchedCase}</span>
                        </div>
                        <div className="space-y-3">
                            {paginatedEvents.map(event => (
                                <TimelineEvent key={event._id || `${event.timestampUtc}-${event.action}`} event={event} />
                            ))}
                        </div>
                        <Pagination
                            page={safePage}
                            totalPages={totalPages}
                            pageStart={pageStart}
                            pageEnd={pageEnd}
                            totalItems={filteredEvents.length}
                            onPageChange={setPage}
                        />
                    </div>

                    <div className="card overflow-hidden">
                        <div className="px-5 py-4 border-b border-surface-border flex items-center justify-between">
                            <h4 className="text-xs font-semibold text-txt-muted uppercase tracking-wider">Registro tecnico</h4>
                            <span className="badge-neutral">{pageStart}-{pageEnd} / {filteredEvents.length}</span>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="border-b border-surface-border text-txt-muted uppercase tracking-wider">
                                        <th className="text-left py-3 px-4">UTC</th>
                                        <th className="text-left py-3 px-4">Scope</th>
                                        <th className="text-left py-3 px-4">Action</th>
                                        <th className="text-left py-3 px-4">Operador</th>
                                        <th className="text-left py-3 px-4">Target</th>
                                        <th className="text-left py-3 px-4">Resumen</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {paginatedEvents.map(event => (
                                        <tr key={`row-${event._id || `${event.timestampUtc}-${event.action}`}`} className="border-b border-surface-border/60 hover:bg-surface-hover">
                                            <td className="py-3 px-4 font-mono text-txt-secondary whitespace-nowrap">{formatDateTime(event.timestampUtc)}</td>
                                            <td className="py-3 px-4"><span className={SCOPE_STYLES[event.scope] || 'badge-neutral'}>{SCOPE_LABELS[event.scope] || event.scope}</span></td>
                                            <td className="py-3 px-4 text-txt-primary font-medium whitespace-nowrap">{labelAction(event.action)}</td>
                                            <td className="py-3 px-4 text-txt-secondary">{event.operatorName}</td>
                                            <td className="py-3 px-4 font-mono text-txt-dim">{event.targetJid || '-'}</td>
                                            <td className="py-3 px-4 text-txt-dim min-w-[260px]">{summarizeDetails(event)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>
            )}
        </div>
    );
}

function SummaryCard({ label, value, icon, tone = 'neutral' }: { label: string; value: string; icon: React.ReactNode; tone?: 'neutral' | 'accent' | 'success' }) {
    const toneClass = tone === 'accent' ? 'bg-accent-muted text-accent' : tone === 'success' ? 'bg-success-muted text-success' : 'bg-surface-hover text-txt-dim';
    return (
        <div className="stat-card min-w-0">
            <div className={`stat-icon ${toneClass}`}>{icon}</div>
            <div className="min-w-0">
                <p className="text-[10px] text-txt-muted uppercase tracking-wider">{label}</p>
                <p className="text-sm font-semibold text-txt-primary truncate">{value}</p>
            </div>
        </div>
    );
}

function Metric({ label, value }: { label: string; value: number }) {
    return (
        <div className="rounded-xl border border-surface-border bg-surface-overlay p-3">
            <p className="text-[10px] uppercase tracking-wider text-txt-muted">{label}</p>
            <p className="text-xl font-bold text-txt-primary">{value}</p>
        </div>
    );
}

function InfoLine({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-xl border border-surface-border bg-surface-overlay p-3 min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-txt-muted">{label}</p>
            <p className="mt-1 text-sm font-medium text-txt-primary break-words">{value}</p>
        </div>
    );
}

function TimelineEvent({ event }: { event: AuditEvent }) {
    const issue = detectIssue(event);
    const details = pickImportantDetails(event);
    return (
        <article className={`relative rounded-2xl border p-4 ${issue ? 'border-warning/40 bg-warning-muted/40' : 'border-surface-border bg-surface-overlay/70'}`}>
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                    <div className={`mt-0.5 p-2 rounded-xl ${issue ? 'bg-warning-muted text-warning' : 'bg-surface-hover text-txt-secondary'}`}>
                        {issue ? <ShieldAlert size={16} /> : <CheckCircle2 size={16} />}
                    </div>
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className={SCOPE_STYLES[event.scope] || 'badge-neutral'}>{SCOPE_LABELS[event.scope] || event.scope}</span>
                            <h5 className="text-sm font-semibold text-txt-primary">{labelAction(event.action)}</h5>
                        </div>
                        <p className="mt-1 text-xs text-txt-dim">{summarizeDetails(event)}</p>
                    </div>
                </div>
                <div className="text-left sm:text-right shrink-0">
                    <p className="font-mono text-xs text-txt-secondary">{formatDateTime(event.timestampUtc)}</p>
                    <p className="text-[10px] uppercase tracking-wider text-txt-dim">{event.operatorName || 'system'}</p>
                </div>
            </div>
            {issue && <p className="mt-3 text-xs text-warning">{issue}</p>}
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {event.targetJid && <DetailPill label="Target" value={event.targetJid} />}
                {details.map(item => <DetailPill key={item.label} label={item.label} value={item.value} />)}
            </div>
        </article>
    );
}

function DetailPill({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-xl border border-surface-border bg-surface-raised px-3 py-2 min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-txt-muted">{label}</p>
            <p className="text-xs font-mono text-txt-secondary break-all">{value}</p>
        </div>
    );
}

function Pagination({
    page,
    totalPages,
    pageStart,
    pageEnd,
    totalItems,
    onPageChange,
}: {
    page: number;
    totalPages: number;
    pageStart: number;
    pageEnd: number;
    totalItems: number;
    onPageChange: (page: number) => void;
}) {
    return (
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-surface-border pt-4">
            <p className="text-xs text-txt-dim">
                {totalItems === 0 ? 'Sin eventos visibles' : `Eventos ${pageStart}-${pageEnd} de ${totalItems}`}
            </p>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => onPageChange(1)}
                    disabled={page <= 1}
                    className="btn-ghost !px-3 !py-1.5 !text-xs"
                >
                    First
                </button>
                <button
                    type="button"
                    onClick={() => onPageChange(Math.max(1, page - 1))}
                    disabled={page <= 1}
                    className="btn-ghost !px-3 !py-1.5 !text-xs"
                >
                    Prev
                </button>
                <span className="rounded-xl border border-surface-border bg-surface-overlay px-3 py-1.5 text-xs text-txt-secondary">
                    {page} / {totalPages}
                </span>
                <button
                    type="button"
                    onClick={() => onPageChange(Math.min(totalPages, page + 1))}
                    disabled={page >= totalPages}
                    className="btn-ghost !px-3 !py-1.5 !text-xs"
                >
                    Next
                </button>
                <button
                    type="button"
                    onClick={() => onPageChange(totalPages)}
                    disabled={page >= totalPages}
                    className="btn-ghost !px-3 !py-1.5 !text-xs"
                >
                    Last
                </button>
            </div>
        </div>
    );
}

function buildStats(events: AuditEvent[]) {
    return {
        checkins: events.filter(event => event.action.startsWith('checkin_')).length,
        calls: events.filter(event => event.scope === 'call').length,
        network: events.filter(event => event.scope === 'network').length,
        reports: events.filter(event => event.scope === 'report').length,
    };
}

function labelAction(action: string) {
    return ACTION_LABELS[action] || action.replaceAll('_', ' ');
}

function summarizeDetails(event: AuditEvent) {
    const details = event.details || {};
    if (event.action === 'call_capture_start') {
        return `Call ID ${stringValue(details.callId)} · interfaz ${stringValue(details.interfaceAddr)} · ${stringValue(details.trigger) || 'manual'}`;
    }
    if (event.action === 'call_capture_stop') {
        return `Veredicto ${stringValue(details.verdict)} · ${stringValue(details.totalPackets)} paquetes · ${stringValue(details.candidateCount)} candidatas`;
    }
    if (event.action === 'capture_stop') {
        const stats = isRecord(details.stats) ? details.stats : {};
        return `${stringValue(stats.totalPackets)} paquetes · ${formatBytes(numberValue(stats.totalBytes))} · protocolos ${summarizeProtocols(stats.protocols)}`;
    }
    if (event.action === 'checkin_completed') {
        return `IP ${stringValue(details.ip)} · GPS ${stringValue(details.locationPermission)} · consistencia ${stringValue(details.consistencyScore)}/${stringValue(details.consistencyLevel)}`;
    }
    if (event.action === 'checkin_link_created') {
        return `${stringValue(details.label)} · vence ${formatMaybeDate(stringValue(details.expiresAt))}`;
    }
    if (event.action === 'checkin_deleted') {
        return `${stringValue(details.label)} · estado previo ${stringValue(details.previousStatus)} · eliminacion administrativa`;
    }
    if (event.action === 'checkin_updated') {
        return `${stringValue(details.label)} · check-in actualizado`;
    }
    if (event.action === 'checkin_revoked') {
        return `${stringValue(details.label)} · enlace revocado`;
    }
    if (event.action.includes('export') || event.action.includes('report')) {
        return `Formato ${stringValue(details.format) || '-'} · SHA ${shortHash(stringValue(details.sha256) || stringValue(details.hash))}`;
    }
    return compactJson(details);
}

function pickImportantDetails(event: AuditEvent) {
    const details = event.details || {};
    const keys = ['callId', 'startedCallId', 'captureSessionId', 'verdict', 'totalPackets', 'durationSec', 'candidateCount', 'metaIpCount', 'ip', 'locationPermission', 'consistencyScore', 'evidenceHash', 'sha256'];
    return keys
        .map(key => ({ label: key, value: valueToString(details[key]) }))
        .filter(item => item.value && item.value !== '-')
        .slice(0, 6);
}

function detectIssue(event: AuditEvent) {
    const details = event.details || {};
    const callId = stringValue(details.callId);
    const startedCallId = stringValue(details.startedCallId);
    if (event.action === 'call_capture_stop' && startedCallId && callId && startedCallId !== callId) {
        return `Revision requerida: la captura inicio como ${startedCallId}, pero el analisis cerro como ${callId}.`;
    }
    if (event.action === 'checkin_completed' && stringValue(details.consistencyLevel) === 'low') {
        return 'Consistencia baja: requiere corroboracion externa antes de usarlo como soporte fuerte.';
    }
    return '';
}

function compactJson(value: unknown) {
    if (!value || (isRecord(value) && Object.keys(value).length === 0)) return 'Sin detalles adicionales.';
    const text = JSON.stringify(value);
    return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function summarizeProtocols(value: unknown) {
    if (!isRecord(value)) return '-';
    return Object.entries(value).slice(0, 3).map(([key, count]) => `${key}:${count}`).join(', ');
}

function formatDateTime(value: string) {
    if (!value) return '-';
    return new Date(value).toISOString().replace('T', ' ').replace('Z', ' UTC');
}

function formatTime(value: string) {
    if (!value) return '-';
    return new Date(value).toISOString().slice(11, 19);
}

function formatMaybeDate(value: string) {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 16).replace('T', ' ');
}

function formatBytes(value: number | null) {
    if (typeof value !== 'number' || Number.isNaN(value)) return '-';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function shortHash(value: string) {
    return value ? `${value.slice(0, 10)}...` : '-';
}

function valueToString(value: unknown) {
    if (value === null || value === undefined || value === '') return '-';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value);
}

function stringValue(value: unknown) {
    return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

function numberValue(value: unknown) {
    return typeof value === 'number' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

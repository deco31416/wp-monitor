import React, { useCallback, useEffect, useState } from 'react';
import { Archive, Briefcase, CheckCircle2, Clock, Download, FileText, FilePlus2, Lock, Search, ShieldCheck } from 'lucide-react';
import { API_URL, authFetch, downloadAuthenticatedFile } from '../auth';
import { CaseRecord, CaseStatus } from '../types';

const STATUS_STYLES: Record<CaseStatus, string> = {
    draft: 'badge-neutral',
    authorized: 'badge-accent',
    active: 'badge-success',
    closed: 'badge-warning',
    archived: 'badge-neutral',
};

export function Cases() {
    const [cases, setCases] = useState<CaseRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [caseId, setCaseId] = useState('');
    const [title, setTitle] = useState('');
    const [primaryOperator, setPrimaryOperator] = useState('');
    const [authorizationNote, setAuthorizationNote] = useState('');
    const [description, setDescription] = useState('');
    const [statusFilter, setStatusFilter] = useState<CaseStatus | 'all'>('all');

    const fetchCases = useCallback(async () => {
        try {
            const query = statusFilter === 'all' ? '?limit=100' : `?limit=100&status=${statusFilter}`;
            const res = await authFetch(`${API_URL}/api/cases${query}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setCases(Array.isArray(data) ? data : []);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load cases');
        } finally {
            setLoading(false);
        }
    }, [statusFilter]);

    useEffect(() => {
        let cancelled = false;
        queueMicrotask(() => {
            if (!cancelled) void fetchCases();
        });
        return () => {
            cancelled = true;
        };
    }, [fetchCases]);

    const updateStatusFilter = (value: CaseStatus | 'all') => {
        setLoading(true);
        setError(null);
        setStatusFilter(value);
    };

    const createNewCase = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!caseId.trim() || !primaryOperator.trim() || !authorizationNote.trim()) return;

        setError(null);
        try {
            const res = await authFetch(`${API_URL}/api/cases`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    caseId: caseId.trim(),
                    title: title.trim() || caseId.trim(),
                    description: description.trim() || null,
                    status: 'authorized',
                    primaryOperator: primaryOperator.trim(),
                    authorizationNote: authorizationNote.trim(),
                }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setCaseId('');
            setTitle('');
            setDescription('');
            setAuthorizationNote('');
            await fetchCases();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create case');
        }
    };

    const closeExistingCase = async (item: CaseRecord) => {
        setError(null);
        try {
            const res = await authFetch(`${API_URL}/api/cases/${encodeURIComponent(item.caseId)}/close`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ operatorName: item.primaryOperator }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            await fetchCases();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to close case');
        }
    };

    const downloadEvidencePackage = async (item: CaseRecord) => {
        setError(null);
        try {
            await downloadAuthenticatedFile(
                `${API_URL}/api/evidence/${encodeURIComponent(item.caseId)}/package`,
                `evidence-${item.caseId}.json`
            );
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to download evidence package');
        }
    };

    const downloadEvidenceZip = async (item: CaseRecord) => {
        setError(null);
        try {
            await downloadAuthenticatedFile(
                `${API_URL}/api/evidence/${encodeURIComponent(item.caseId)}/package.zip`,
                `evidence-${item.caseId}.zip`
            );
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to download evidence ZIP');
        }
    };

    const downloadFinalReportJson = async (item: CaseRecord) => {
        setError(null);
        try {
            await downloadAuthenticatedFile(
                `${API_URL}/api/reports/${encodeURIComponent(item.caseId)}/final`,
                `final-report-${item.caseId}.json`
            );
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to download final report JSON');
        }
    };

    const downloadFinalReportHtml = async (item: CaseRecord) => {
        setError(null);
        try {
            await downloadAuthenticatedFile(
                `${API_URL}/api/reports/${encodeURIComponent(item.caseId)}/final.html`,
                `final-report-${item.caseId}.html`
            );
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to download final report HTML');
        }
    };

    const downloadFinalReportPdf = async (item: CaseRecord) => {
        setError(null);
        try {
            await downloadAuthenticatedFile(
                `${API_URL}/api/reports/${encodeURIComponent(item.caseId)}/final.pdf`,
                `final-report-${item.caseId}.pdf`
            );
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to download final report PDF');
        }
    };

    return (
        <div className="space-y-4">
            <div className="card p-5">
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 rounded-xl bg-accent-muted text-accent">
                        <Briefcase size={18} />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-txt-primary">Case Management</h3>
                        <p className="text-xs text-txt-dim">Crea y controla casos antes de capturas, auditorias y reportes.</p>
                    </div>
                </div>

                <form onSubmit={createNewCase} className="grid grid-cols-1 lg:grid-cols-5 gap-3">
                    <input value={caseId} onChange={event => setCaseId(event.target.value)} placeholder="Case ID" className="input-field" />
                    <input value={title} onChange={event => setTitle(event.target.value)} placeholder="Titulo" className="input-field" />
                    <input value={primaryOperator} onChange={event => setPrimaryOperator(event.target.value)} placeholder="Operador principal" className="input-field" />
                    <input value={authorizationNote} onChange={event => setAuthorizationNote(event.target.value)} placeholder="Autorizacion" className="input-field" />
                    <button disabled={!caseId.trim() || !primaryOperator.trim() || !authorizationNote.trim()} className="btn-primary flex items-center justify-center gap-2" type="submit">
                        <FilePlus2 size={16} />
                        Crear
                    </button>
                    <textarea
                        value={description}
                        onChange={event => setDescription(event.target.value)}
                        placeholder="Descripcion opcional"
                        className="input-field lg:col-span-5 min-h-[70px]"
                    />
                </form>
            </div>

            <div className="card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-txt-secondary">
                    <Search size={16} className="text-txt-dim" />
                    <span>{loading ? 'Cargando casos...' : `${cases.length} casos visibles`}</span>
                </div>
                <select value={statusFilter} onChange={event => updateStatusFilter(event.target.value as CaseStatus | 'all')} className="select-field max-w-[220px]">
                    <option value="all">Todos los estados</option>
                    <option value="draft">Draft</option>
                    <option value="authorized">Authorized</option>
                    <option value="active">Active</option>
                    <option value="closed">Closed</option>
                    <option value="archived">Archived</option>
                </select>
            </div>

            {error && (
                <div className="card p-5 border-danger/30 text-danger text-sm">
                    Error: {error}
                </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {cases.map(item => (
                    <div key={item.caseId} className="card p-5 sm:p-6 space-y-5">
                        <div className="space-y-4">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-start gap-2 mb-2">
                                    <h4 className="text-lg font-semibold leading-tight text-txt-primary break-words max-w-full">{item.title || item.caseId}</h4>
                                    <span className={`${STATUS_STYLES[item.status]} shrink-0 mt-0.5`}>{item.status}</span>
                                </div>
                                <p className="text-xs font-mono text-txt-dim break-words max-w-full">{item.caseId}</p>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                <button onClick={() => downloadFinalReportPdf(item)} className="btn-primary !py-2 !px-3 !text-xs flex items-center justify-center gap-1.5 min-w-0">
                                    <FileText size={12} />
                                    Final PDF
                                </button>
                                <button onClick={() => downloadFinalReportHtml(item)} className="btn-primary !py-2 !px-3 !text-xs flex items-center justify-center gap-1.5 min-w-0">
                                    <FileText size={12} />
                                    Final HTML
                                </button>
                                <button onClick={() => downloadFinalReportJson(item)} className="btn-ghost !py-2 !px-3 !text-xs flex items-center justify-center gap-1.5 min-w-0">
                                    <Download size={12} />
                                    Final JSON
                                </button>
                                <button onClick={() => downloadEvidencePackage(item)} className="btn-ghost !py-2 !px-3 !text-xs flex items-center justify-center gap-1.5 min-w-0">
                                    <Download size={12} />
                                    JSON
                                </button>
                                <button onClick={() => downloadEvidenceZip(item)} className="btn-ghost !py-2 !px-3 !text-xs flex items-center justify-center gap-1.5 min-w-0">
                                    <Download size={12} />
                                    ZIP
                                </button>
                                {item.status !== 'closed' && item.status !== 'archived' && (
                                    <button onClick={() => closeExistingCase(item)} className="btn-ghost !py-2 !px-3 !text-xs flex items-center justify-center gap-1.5 min-w-0">
                                        <Lock size={12} />
                                        Cerrar
                                    </button>
                                )}
                            </div>
                        </div>

                        {item.description && (
                            <p className="text-xs text-txt-secondary">{item.description}</p>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <MiniStat icon={<ShieldCheck size={14} />} label="Operador" value={item.primaryOperator || '-'} />
                            <MiniStat icon={<CheckCircle2 size={14} />} label="Autorizacion" value={item.authorizationNote || '-'} />
                            <MiniStat icon={<Clock size={14} />} label="Actualizado" value={formatDateTime(item.updatedAt)} />
                            <MiniStat icon={<Archive size={14} />} label="Ultima auditoria" value={item.lastAuditAction || '-'} />
                        </div>
                    </div>
                ))}
            </div>

            {!loading && cases.length === 0 && (
                <div className="empty-state">
                    <Briefcase size={36} className="mx-auto text-txt-dim mb-3" />
                    <p className="text-sm text-txt-muted">No hay casos para este filtro.</p>
                </div>
            )}
        </div>
    );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
    return (
        <div className="stat-card min-w-0">
            <div className="stat-icon bg-surface-hover text-txt-dim">{icon}</div>
            <div className="min-w-0">
                <p className="text-[10px] text-txt-muted uppercase tracking-wider">{label}</p>
                <p className="text-xs font-medium text-txt-primary truncate">{value}</p>
            </div>
        </div>
    );
}

function formatDateTime(value: string | null) {
    if (!value) return '-';
    return new Date(value).toISOString().replace('T', ' ').slice(0, 16);
}

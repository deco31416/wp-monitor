import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Code, Download, FileDown, FileText, Globe } from 'lucide-react';
import clsx from 'clsx';

interface ActivityEntry {
    state: string;
    timestamp: string;
    rtt: number;
}

interface JournalEntry {
    utc: string;
    local: string;
    date: string;
    rawTimestamp: string;
    state: string;
    stateLabel: string;
    description: string;
    rtt: number;
}

interface ActivityJournalPanelProps {
    activity: ActivityEntry[];
    jid: string;
    displayNumber: string;
    privacyMode: boolean;
    onDownloadFullReport: () => void;
}

const LOG_PAGE_SIZE = 15;

function isNoAckState(value: string): boolean {
    return value === 'NO_ACK' || value === 'OFFLINE';
}

export function ActivityJournalPanel({
    activity,
    jid,
    displayNumber,
    privacyMode,
    onDownloadFullReport,
}: ActivityJournalPanelProps) {
    const [logPage, setLogPage] = useState(1);
    const entries = useMemo(() => buildJournalEntries(activity), [activity]);
    const totalLogPages = Math.max(1, Math.ceil(entries.length / LOG_PAGE_SIZE));
    const pagedEntries = entries.slice((logPage - 1) * LOG_PAGE_SIZE, logPage * LOG_PAGE_SIZE);

    const exportJson = () => {
        const data = {
            contact: privacyMode ? '***' : displayNumber,
            jid: privacyMode ? '***' : jid,
            generatedAt: new Date().toISOString(),
            totalEvents: entries.length,
            events: entries.map(entry => ({
                utc: entry.utc,
                local: entry.local,
                date: entry.date,
                state: entry.stateLabel,
                description: entry.description,
                rtt_ms: entry.rtt,
            })),
        };
        downloadBlob(
            new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
            `bitacora-${displayNumber}-${new Date().toISOString().slice(0, 10)}.json`,
        );
    };

    const exportHtml = () => {
        const html = buildActivityReportHtml(entries, {
            contact: privacyMode ? '***' : displayNumber,
            jid: privacyMode ? '***' : jid,
            mode: 'html',
        });
        downloadBlob(
            new Blob([html], { type: 'text/html' }),
            `bitacora-${displayNumber}-${new Date().toISOString().slice(0, 10)}.html`,
        );
    };

    const exportPdf = () => {
        const html = buildActivityReportHtml(entries, {
            contact: privacyMode ? '***' : displayNumber,
            jid: privacyMode ? '***' : jid,
            mode: 'print',
        });

        const win = window.open('', '_blank');
        if (win) {
            win.document.write(html);
            win.document.close();
            setTimeout(() => win.print(), 500);
        }
    };

    return (
        <div className="bg-surface-overlay rounded-xl border border-surface-border overflow-hidden">
            <div className="px-5 py-3 border-b border-surface-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <FileText size={14} className="text-accent" />
                    <h5 className="text-xs font-semibold text-txt-muted uppercase tracking-wider">Bitacora de Actividad</h5>
                    <span className="badge-neutral !text-[9px] !py-0 !px-1.5">{entries.length} eventos</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                    <button onClick={exportJson} className="btn-ghost !text-[10px] !py-1 !px-2 flex items-center gap-1" title="Exportar JSON">
                        <Code size={10} /> JSON
                    </button>
                    <button onClick={exportHtml} className="btn-ghost !text-[10px] !py-1 !px-2 flex items-center gap-1" title="Exportar HTML">
                        <Globe size={10} /> HTML
                    </button>
                    <button onClick={exportPdf} className="btn-ghost !text-[10px] !py-1 !px-2 flex items-center gap-1" title="Imprimir / PDF">
                        <FileDown size={10} /> PDF
                    </button>
                    <button
                        type="button"
                        onClick={onDownloadFullReport}
                        className="btn-ghost !text-[10px] !py-1 !px-2 flex items-center gap-1"
                        title="Reporte completo"
                    >
                        <Download size={10} /> Full
                    </button>
                </div>
            </div>

            {entries.length === 0 ? (
                <div className="p-4 space-y-3">
                    {[...Array(5)].map((_, index) => (
                        <div key={index} className="flex items-center gap-3 animate-pulse">
                            <div className="w-16 h-4 bg-surface-hover rounded" />
                            <div className="w-16 h-4 bg-surface-hover rounded" />
                            <div className="w-20 h-4 bg-surface-hover rounded" />
                            <div className="flex-1 h-4 bg-surface-hover rounded" />
                        </div>
                    ))}
                    <p className="text-center text-[10px] text-txt-dim mt-2">Esperando cambios de estado...</p>
                </div>
            ) : (
                <>
                    <div className="overflow-x-auto">
                        <div className="min-w-[680px]">
                            <div className="grid grid-cols-[80px_90px_100px_1fr] gap-0 px-5 py-2 bg-surface-hover text-[10px] font-semibold text-txt-dim uppercase tracking-wider">
                                <span>Fecha</span>
                                <span>Hora</span>
                                <span>Estado</span>
                                <span>Descripcion</span>
                            </div>

                            <div className="divide-y divide-surface-border">
                                {pagedEntries.map((entry, index) => (
                                    <JournalRow key={`${entry.rawTimestamp}-${index}`} entry={entry} />
                                ))}
                            </div>
                        </div>
                    </div>

                    {totalLogPages > 1 && (
                        <Pagination
                            logPage={logPage}
                            totalLogPages={totalLogPages}
                            totalEntries={entries.length}
                            onPageChange={setLogPage}
                        />
                    )}
                </>
            )}
        </div>
    );
}

function JournalRow({ entry }: { entry: JournalEntry }) {
    const rowColor = entry.state.includes('Online') ? 'text-success'
        : entry.state === 'Standby' ? 'text-warning'
        : isNoAckState(entry.state) ? 'text-warning' : 'text-txt-secondary';
    const bgHover = entry.state.includes('Online') ? 'hover:bg-success/5'
        : isNoAckState(entry.state) ? 'hover:bg-warning/5'
        : 'hover:bg-surface-hover';

    return (
        <div className={`grid grid-cols-[80px_90px_100px_1fr] gap-0 px-5 py-2.5 transition-colors ${bgHover}`}>
            <span className="text-[11px] font-mono text-txt-dim">{entry.date}</span>
            <div className="flex flex-col">
                <span className="text-[11px] font-mono text-txt-secondary font-medium">{entry.local}</span>
                <span className="text-[9px] font-mono text-txt-dim">{entry.utc} UTC</span>
            </div>
            <span className={`text-[11px] font-bold ${rowColor}`}>
                {entry.stateLabel}
            </span>
            <span className="text-[11px] text-txt-secondary leading-relaxed">
                {entry.description}
            </span>
        </div>
    );
}

function Pagination({
    logPage,
    totalLogPages,
    totalEntries,
    onPageChange,
}: {
    logPage: number;
    totalLogPages: number;
    totalEntries: number;
    onPageChange: (page: number | ((page: number) => number)) => void;
}) {
    return (
        <div className="px-5 py-2.5 border-t border-surface-border flex items-center justify-between">
            <span className="text-[10px] text-txt-dim">
                Mostrando {(logPage - 1) * LOG_PAGE_SIZE + 1}-{Math.min(logPage * LOG_PAGE_SIZE, totalEntries)} de {totalEntries}
            </span>
            <div className="flex items-center gap-1">
                <button
                    onClick={() => onPageChange(page => Math.max(1, page - 1))}
                    disabled={logPage === 1}
                    className="btn-ghost !p-1 disabled:opacity-30"
                >
                    <ChevronLeft size={14} />
                </button>
                {[...Array(Math.min(totalLogPages, 5))].map((_, index) => {
                    const pageNum = resolveVisiblePageNumber(index, logPage, totalLogPages);
                    return (
                        <button
                            key={pageNum}
                            onClick={() => onPageChange(pageNum)}
                            className={clsx(
                                'w-6 h-6 rounded-md text-[10px] font-medium transition-colors',
                                logPage === pageNum
                                    ? 'bg-accent/15 text-accent border border-accent/25'
                                    : 'text-txt-muted hover:bg-surface-hover',
                            )}
                        >
                            {pageNum}
                        </button>
                    );
                })}
                <button
                    onClick={() => onPageChange(page => Math.min(totalLogPages, page + 1))}
                    disabled={logPage === totalLogPages}
                    className="btn-ghost !p-1 disabled:opacity-30"
                >
                    <ChevronRight size={14} />
                </button>
            </div>
        </div>
    );
}

function buildJournalEntries(activity: ActivityEntry[]): JournalEntry[] {
    return activity.slice().reverse().map(entry => ({
        utc: toMilitary(entry.timestamp),
        local: toMilitaryLocal(entry.timestamp),
        date: toDateStr(entry.timestamp),
        rawTimestamp: entry.timestamp,
        state: entry.state,
        stateLabel: describeStateShort(entry.state),
        description: describeState(entry.state, entry.rtt),
        rtt: entry.rtt,
    }));
}

function resolveVisiblePageNumber(index: number, logPage: number, totalLogPages: number): number {
    if (totalLogPages <= 5) return index + 1;
    if (logPage <= 3) return index + 1;
    if (logPage >= totalLogPages - 2) return totalLogPages - 4 + index;
    return logPage - 2 + index;
}

function toMilitary(ts: string | number) {
    const date = new Date(ts);
    return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}:${String(date.getUTCSeconds()).padStart(2, '0')}`;
}

function toMilitaryLocal(ts: string | number) {
    const date = new Date(ts);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

function toDateStr(ts: string | number) {
    return new Date(ts).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function describeState(state: string, rtt: number): string {
    if (state.includes('Online')) return `El contacto se CONECTO - Dispositivo activo (respuesta: ${rtt}ms)`;
    if (state === 'Standby') return `El contacto paso a ESPERA - App abierta en segundo plano (respuesta: ${rtt}ms)`;
    if (isNoAckState(state)) return 'No se recibio ACK del probe; resultado no concluyente';
    return `Estado cambiado a ${state} (respuesta: ${rtt}ms)`;
}

function describeStateShort(state: string): string {
    if (state.includes('Online')) return 'CONECTADO';
    if (state === 'Standby') return 'EN ESPERA';
    if (isNoAckState(state)) return 'SIN ACK';
    return state;
}

function stateColor(state: string, print = false): string {
    if (state.includes('Online')) return print ? '#1faa59' : '#25d366';
    if (state === 'Standby') return print ? '#ca8a04' : '#eab308';
    if (isNoAckState(state)) return print ? '#ca8a04' : '#eab308';
    return print ? '#64748b' : '#94a3b8';
}

function buildActivityReportHtml(
    entries: JournalEntry[],
    options: { contact: string; jid: string; mode: 'html' | 'print' },
): string {
    const generatedAt = new Date();
    const summary = buildActivitySummary(entries);
    const printable = options.mode === 'print';
    const rows = entries.map((entry, index) => {
        const color = stateColor(entry.state, printable);
        return `<tr>
            <td class="idx">${index + 1}</td>
            <td class="date">${escapeHtml(entry.date)}</td>
            <td class="time"><strong>${escapeHtml(entry.local)}</strong><span>${escapeHtml(entry.utc)} UTC</span></td>
            <td><span class="state" style="color:${color};border-color:${color}33;background:${color}12">${escapeHtml(entry.stateLabel)}</span></td>
            <td class="rtt">${entry.rtt > 0 ? `${escapeHtml(entry.rtt)} ms` : '-'}</td>
            <td class="desc">${escapeHtml(entry.description)}</td>
        </tr>`;
    }).join('\n');
    const emptyRows = entries.length === 0
        ? '<tr><td colspan="6" class="empty">Sin eventos registrados para este contacto.</td></tr>'
        : rows;

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>WP MONITOR - Bitacora ${escapeHtml(options.contact)}</title>
  <style>
    :root{--ink:#0f172a;--muted:#64748b;--line:#dbe5ef;--panel:#ffffff;--soft:#f8fafc;--accent:#16a34a;--dark:#071411}
    *{box-sizing:border-box}
    body{margin:0;font-family:"Inter","Aptos","Segoe UI",Arial,sans-serif;color:${printable ? 'var(--ink)' : '#e8f3f0'};background:${printable ? '#fff' : '#071411'};line-height:1.45}
    .page{max-width:${printable ? '100%' : '1120px'};margin:0 auto;padding:${printable ? '22px' : '40px'}}
    .hero{border-radius:${printable ? '0' : '24px'};padding:${printable ? '18px 0 16px' : '30px'};background:${printable ? '#fff' : 'linear-gradient(135deg,#0c1c18,#10241f)'};border-bottom:${printable ? '2px solid #0f172a' : '0'};box-shadow:${printable ? 'none' : '0 22px 70px rgba(0,0,0,.28)'}}
    .brand{font-size:11px;font-weight:850;letter-spacing:.16em;text-transform:uppercase;color:${printable ? '#166534' : '#73e6a1'};margin-bottom:12px}
    h1{margin:0;font-size:${printable ? '24px' : '34px'};line-height:1.08;letter-spacing:0}
    .subtitle{margin:10px 0 0;color:${printable ? 'var(--muted)' : '#9bb9b0'};font-size:13px}
    .meta-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:${printable ? '16px 0' : '18px 0 24px'}}
    .metric{border:1px solid ${printable ? 'var(--line)' : 'rgba(148,163,184,.22)'};border-radius:14px;padding:12px 14px;background:${printable ? 'var(--soft)' : 'rgba(255,255,255,.045)'}}
    .metric span{display:block;color:${printable ? 'var(--muted)' : '#86a69d'};font-size:10px;text-transform:uppercase;letter-spacing:.12em;font-weight:800}
    .metric strong{display:block;margin-top:5px;font-size:18px;color:${printable ? 'var(--ink)' : '#fff'}}
    .note{margin:0 0 18px;padding:12px 14px;border-radius:14px;border:1px solid ${printable ? '#bbf7d0' : 'rgba(37,211,102,.28)'};background:${printable ? '#f0fdf4' : 'rgba(37,211,102,.08)'};color:${printable ? '#14532d' : '#b9f8cf'};font-size:12px}
    .table-wrap{border:1px solid ${printable ? 'var(--line)' : 'rgba(148,163,184,.22)'};border-radius:${printable ? '0' : '18px'};overflow:hidden;background:${printable ? '#fff' : '#0d1c18'}}
    table{width:100%;border-collapse:collapse}
    thead{display:table-header-group}
    th{padding:11px 10px;text-align:left;background:${printable ? '#ecfdf5' : '#122923'};color:${printable ? '#166534' : '#7ae6a8'};font-size:10px;text-transform:uppercase;letter-spacing:.11em;border-bottom:1px solid ${printable ? '#bbf7d0' : 'rgba(37,211,102,.22)'}}
    td{padding:11px 10px;border-bottom:1px solid ${printable ? '#e2e8f0' : 'rgba(148,163,184,.16)'};font-size:${printable ? '10.5px' : '12px'};vertical-align:top}
    tbody tr:nth-child(even){background:${printable ? '#f8fafc' : 'rgba(255,255,255,.025)'}}
    .idx{width:42px;color:var(--muted);font-family:Consolas,monospace}
    .date,.time,.rtt{white-space:nowrap;font-family:Consolas,"SFMono-Regular",monospace}
    .time span{display:block;color:${printable ? 'var(--muted)' : '#78958d'};font-size:10px;margin-top:2px}
    .state{display:inline-flex;border:1px solid;border-radius:999px;padding:4px 8px;font-size:10px;font-weight:850;white-space:nowrap}
    .desc{min-width:260px}
    .empty{text-align:center;color:var(--muted);padding:28px}
    .footer{display:flex;justify-content:space-between;gap:16px;margin-top:16px;color:${printable ? 'var(--muted)' : '#78958d'};font-size:10px;border-top:1px solid ${printable ? 'var(--line)' : 'rgba(148,163,184,.18)'};padding-top:12px}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{padding:16mm}.hero{break-inside:avoid}.metric,.note,.table-wrap{break-inside:avoid}tr{break-inside:avoid}.footer{position:fixed;bottom:8mm;left:16mm;right:16mm}}
    @media(max-width:760px){.page{padding:18px}.meta-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.table-wrap{overflow:auto}.desc{min-width:220px}}
  </style>
</head>
<body>
  <main class="page">
    <section class="hero">
      <div class="brand">WP MONITOR</div>
      <h1>Bitacora de Actividad</h1>
      <p class="subtitle">Registro cronologico de cambios observados para el contacto ${escapeHtml(options.contact)}.</p>
    </section>
    <section class="meta-grid" aria-label="Resumen">
      <div class="metric"><span>Contacto</span><strong>${escapeHtml(options.contact)}</strong></div>
      <div class="metric"><span>JID</span><strong style="font-size:13px;overflow-wrap:anywhere">${escapeHtml(options.jid)}</strong></div>
      <div class="metric"><span>Eventos</span><strong>${entries.length}</strong></div>
      <div class="metric"><span>Rango</span><strong style="font-size:13px">${escapeHtml(summary.range)}</strong></div>
    </section>
    <section class="meta-grid" aria-label="Distribucion">
      <div class="metric"><span>Conectado</span><strong>${summary.online}</strong></div>
      <div class="metric"><span>En espera</span><strong>${summary.standby}</strong></div>
      <div class="metric"><span>Sin ACK</span><strong>${summary.noAck}</strong></div>
      <div class="metric"><span>RTT con ACK</span><strong>${summary.averageRtt ? `${summary.averageRtt} ms` : '-'}</strong></div>
    </section>
    <p class="note">Lectura tecnica: estos eventos describen actividad observada por RTT y cambios de estado. No sustituyen corroboracion externa ni prueban por si solos identidad, ubicacion exacta o titularidad del dispositivo.</p>
    <section class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Fecha</th><th>Hora</th><th>Estado</th><th>RTT</th><th>Descripcion</th></tr></thead>
        <tbody>${emptyRows}</tbody>
      </table>
    </section>
    <footer class="footer">
      <span>Generado: ${escapeHtml(generatedAt.toLocaleString('es-CO'))}</span>
      <span>WP MONITOR · Activity Journal</span>
    </footer>
  </main>
</body>
</html>`;
}

function buildActivitySummary(entries: JournalEntry[]) {
    const online = entries.filter(entry => entry.state.includes('Online')).length;
    const standby = entries.filter(entry => entry.state === 'Standby').length;
    const noAck = entries.filter(entry => isNoAckState(entry.state)).length;
    const rtts = entries
        .filter(entry => {
            const state = entry.state.trim().toUpperCase();
            return state.startsWith('ONLINE') || state === 'STANDBY' || state.startsWith('CALIBRATING');
        })
        .map(entry => entry.rtt)
        .filter(value => value > 0);
    const averageRtt = rtts.length ? Math.round(rtts.reduce((sum, value) => sum + value, 0) / rtts.length) : 0;
    const last = entries[0];
    const first = entries[entries.length - 1];
    const range = first && last ? `${first.date} ${first.local} - ${last.date} ${last.local}` : '-';
    return { online, standby, noAck, averageRtt, range };
}

function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
}

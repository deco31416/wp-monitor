import React from 'react';
import clsx from 'clsx';
import { ExternalLink, Globe, History, Monitor, Phone, Shield, Square, Target, Wifi } from 'lucide-react';
import { CallAnalysisResult, CallEvent, CandidateIP } from '../types';

interface CallAnalysisPanelProps {
    callAnalysis: CallAnalysisResult | null;
    callHistory: CallAnalysisResult[];
    callCapturing: boolean;
    callEvent: CallEvent | null;
    callPacketCount: number;
    callStopping: boolean;
    callCaseId: string;
    callOperatorName: string;
    callAuthorizationNote: string;
    callCaptureError: string | null;
    onCaseIdChange: (value: string) => void;
    onOperatorNameChange: (value: string) => void;
    onAuthorizationNoteChange: (value: string) => void;
    onStartManualCapture: () => void;
    onStopManualCapture: () => void;
    onSelectAnalysis: (analysis: CallAnalysisResult) => void;
}

export function CallAnalysisPanel({
    callAnalysis,
    callHistory,
    callCapturing,
    callEvent,
    callPacketCount,
    callStopping,
    callCaseId,
    callOperatorName,
    callAuthorizationNote,
    callCaptureError,
    onCaseIdChange,
    onOperatorNameChange,
    onAuthorizationNoteChange,
    onStartManualCapture,
    onStopManualCapture,
    onSelectAnalysis,
}: CallAnalysisPanelProps) {
    return (
        <div className="space-y-4">
            <div className="bg-surface-overlay rounded-xl border border-surface-border p-5">
                <h5 className="text-xs font-semibold text-txt-muted uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Phone size={14} className="text-accent" /> Analisis de Trafico de Llamada
                </h5>
                <p className="text-[11px] text-txt-dim mb-4">
                    Captura trafico local durante llamadas WhatsApp para clasificar IPs observadas, relays e infraestructura.
                    La captura se inicia automaticamente al detectar una llamada, o puede iniciarse manualmente.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
                    <input
                        value={callCaseId}
                        onChange={event => onCaseIdChange(event.target.value)}
                        disabled={callCapturing}
                        placeholder="Case ID (ej. CASE-001)"
                        className="input-field !text-xs"
                    />
                    <input
                        value={callOperatorName}
                        onChange={event => onOperatorNameChange(event.target.value)}
                        disabled={callCapturing}
                        placeholder="Operador"
                        className="input-field !text-xs"
                    />
                    <input
                        value={callAuthorizationNote}
                        onChange={event => onAuthorizationNoteChange(event.target.value)}
                        disabled={callCapturing}
                        placeholder="Autorizacion / motivo"
                        className="input-field !text-xs"
                    />
                </div>

                <div className="flex items-center gap-3">
                    {!callCapturing ? (
                        <button
                            onClick={onStartManualCapture}
                            disabled={!callCaseId.trim() || !callOperatorName.trim() || !callAuthorizationNote.trim()}
                            className="btn-primary flex items-center gap-2 !text-xs !py-2 !px-4"
                        >
                            <Phone size={14} /> Iniciar Captura Manual
                        </button>
                    ) : (
                        <button
                            onClick={onStopManualCapture}
                            disabled={callStopping}
                            className="btn-danger flex items-center gap-2 !text-xs !py-2 !px-4 animate-pulse disabled:opacity-60 disabled:cursor-wait"
                        >
                            <Square size={14} /> {callStopping ? 'Analizando captura...' : `Detener Captura (${callPacketCount} paquetes)`}
                        </button>
                    )}
                </div>

                <p className="mt-2 text-[10px] text-txt-dim">
                    Case ID tecnico: letras, numeros, punto, guion bajo, dos puntos o guion. Los espacios se normalizan antes de iniciar.
                </p>

                {callCaptureError && (
                    <div className="mt-3 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
                        <p className="text-xs font-bold text-red-300">No se pudo iniciar la captura</p>
                        <p className="text-[11px] text-red-100/80">{callCaptureError}</p>
                    </div>
                )}

                {callCapturing && (
                    <div className="mt-3 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 flex items-center gap-3">
                        <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                        <div>
                            <p className="text-xs font-bold text-red-400">
                                {callStopping ? 'Cerrando y analizando captura' : 'Captura en curso'}
                            </p>
                            <p className="text-[10px] text-txt-dim">
                                {callPacketCount} paquetes UDP capturados · {callStopping ? 'Procesando resultado, GeoIP y auditoria' : 'Haz la llamada desde este equipo local'}
                            </p>
                        </div>
                    </div>
                )}

                {callEvent && (
                    <div className="mt-3 bg-accent/10 border border-accent/30 rounded-lg px-4 py-2">
                        <p className="text-xs text-accent">
                            Última señal de llamada: <span className="font-bold">{callEvent.label || 'Evento de llamada'}</span>
                            {callEvent.isVideo && ' (Video)'}
                            {callEvent.date && ` · ${new Date(callEvent.date).toLocaleTimeString('es-ES')}`}
                        </p>
                    </div>
                )}
            </div>

            {callAnalysis && <CallAnalysisResultCard analysis={callAnalysis} />}

            {callHistory.length > 0 && (
                <div className="bg-surface-overlay rounded-xl border border-surface-border p-5">
                    <h5 className="text-xs font-semibold text-txt-muted uppercase tracking-wider mb-3 flex items-center gap-2">
                        <History size={14} className="text-txt-dim" /> Historial de Analisis
                    </h5>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="border-b border-surface-border text-txt-muted uppercase tracking-wider">
                                    <th className="text-left py-2 px-2">Fecha</th>
                                    <th className="text-left py-2 px-2">Duracion</th>
                                    <th className="text-left py-2 px-2">Veredicto</th>
                                    <th className="text-right py-2 px-2">Candidatas</th>
                                    <th className="text-right py-2 px-2">Paquetes</th>
                                </tr>
                            </thead>
                            <tbody>
                                {callHistory.map((historyItem, index) => (
                                    <tr
                                        key={index}
                                        className="border-b border-surface-border/50 hover:bg-surface-hover cursor-pointer transition-colors"
                                        onClick={() => onSelectAnalysis(historyItem)}
                                    >
                                        <td className="py-2 px-2 text-txt-secondary font-mono">
                                            {new Date(historyItem.startTime).toLocaleString('es-ES', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                        </td>
                                        <td className="py-2 px-2 text-txt-primary">{historyItem.durationSec}s</td>
                                        <td className="py-2 px-2">
                                            <VerdictBadge verdict={historyItem.verdict} compact />
                                        </td>
                                        <td className="py-2 px-2 text-right text-accent font-bold">
                                            {historyItem.candidateIps.filter(candidate => candidate.isP2P).length}
                                        </td>
                                        <td className="py-2 px-2 text-right text-txt-dim">{historyItem.totalPackets}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {!callAnalysis && callHistory.length === 0 && !callCapturing && (
                <div className="bg-surface-overlay rounded-xl border border-surface-border p-8 text-center">
                    <Phone size={32} className="mx-auto text-txt-dim mb-3" />
                    <p className="text-sm text-txt-muted mb-2">Sin analisis de llamadas</p>
                    <p className="text-[11px] text-txt-dim max-w-md mx-auto">
                        Inicia una captura manual y luego haz la llamada desde WhatsApp en este equipo local.
                        La captura tambien se activa automaticamente cuando se detecta una llamada entrante/saliente.
                    </p>
                </div>
            )}
        </div>
    );
}

function CallAnalysisResultCard({ analysis }: { analysis: CallAnalysisResult }) {
    const observedCandidates = analysis.candidateIps.filter(candidate => candidate.isP2P);
    const infrastructureCandidates = analysis.candidateIps.filter(candidate => !candidate.isP2P);
    const inconclusiveObservations = analysis.candidateIps.filter(candidate => (
        !candidate.isP2P
        && candidate.provider === 'unknown'
        && candidate.correlation?.classification !== 'infrastructure'
    ));

    return (
        <div className="bg-surface-overlay rounded-xl border border-surface-border p-5">
            <div className="flex items-center justify-between mb-4">
                <h5 className="text-xs font-semibold text-txt-muted uppercase tracking-wider flex items-center gap-2">
                    <Target size={14} className="text-success" /> Resultado del Analisis
                </h5>
                <VerdictBadge verdict={analysis.verdict} />
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                <SummaryStat value={analysis.totalPackets} label="Paquetes" tone="primary" />
                <SummaryStat value={observedCandidates.length} label="Candidatas" tone="accent" />
                <SummaryStat value={analysis.metaIps?.length || 0} label="IPs Meta" tone="danger" />
                <SummaryStat value={`${analysis.durationSec || 0}s`} label="Duracion" tone="primary" />
            </div>

            <CallTrafficMap analysis={analysis} />

            {observedCandidates.length > 0 && (
                <div className="mb-4">
                    <h6 className="text-[11px] font-semibold text-success uppercase tracking-wider mb-2">IPs observadas candidatas</h6>
                    <div className="space-y-2">
                        {observedCandidates.map((candidate, index) => (
                            <CandidateCard key={`${candidate.ip}-${index}`} candidate={candidate} />
                        ))}
                    </div>
                </div>
            )}

            {inconclusiveObservations.length > 0 && (
                <details className="mb-4" open>
                    <summary className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider cursor-pointer hover:text-amber-300 transition-colors mb-2">
                        Observaciones no concluyentes ({inconclusiveObservations.length})
                    </summary>
                    <div className="space-y-2">
                        {inconclusiveObservations.map((candidate, index) => (
                            <CandidateCard key={`${candidate.ip}-weak-${index}`} candidate={candidate} />
                        ))}
                    </div>
                </details>
            )}

            {analysis.metaIps?.length > 0 && (
                <details className="mb-2">
                    <summary className="text-[11px] font-semibold text-red-400 uppercase tracking-wider cursor-pointer hover:text-red-300 transition-colors mb-2">
                        IPs Meta/Relay filtradas ({analysis.metaIps.length})
                    </summary>
                    <div className="bg-surface-hover rounded-lg p-3 border border-surface-border">
                        <div className="flex flex-wrap gap-2">
                            {analysis.metaIps.map((ip, index) => (
                                <span key={index} className="text-[10px] font-mono text-txt-dim bg-red-500/10 px-2 py-0.5 rounded">{ip}</span>
                            ))}
                        </div>
                    </div>
                </details>
            )}

            {infrastructureCandidates.filter(candidate => candidate.provider !== 'unknown').length > 0 && (
                <details>
                    <summary className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider cursor-pointer hover:text-amber-300 transition-colors mb-2">
                        IPs Infraestructura ({infrastructureCandidates.length})
                    </summary>
                    <div className="bg-surface-hover rounded-lg p-3 border border-surface-border space-y-1">
                        {infrastructureCandidates.map((candidate, index) => (
                            <div key={index} className="flex items-center justify-between text-[10px]">
                                <span className="font-mono text-txt-dim">{candidate.ip}</span>
                                <span className="text-txt-muted">
                                    {candidate.networkIntelligence?.org || candidate.provider} · {formatNetworkCategory(candidate.networkCategory)} · score {getCandidateScore(candidate)}/100 · {candidate.packets} pkts
                                </span>
                            </div>
                        ))}
                    </div>
                </details>
            )}
        </div>
    );
}

function SummaryStat({ value, label, tone }: { value: React.ReactNode; label: string; tone: 'primary' | 'accent' | 'danger' }) {
    const colors = {
        primary: 'text-txt-primary',
        accent: 'text-accent',
        danger: 'text-red-400',
    };
    return (
        <div className="bg-surface-hover rounded-lg p-3 text-center">
            <p className={clsx("text-lg font-bold", colors[tone])}>{value}</p>
            <p className="text-[10px] text-txt-dim">{label}</p>
        </div>
    );
}

function CandidateCard({ candidate }: { candidate: CandidateIP }) {
    const score = getCandidateScore(candidate);
    const enrichment = candidate.ipEnrichment?.status === 'success' ? candidate.ipEnrichment : null;
    const geoLat = enrichment?.lat ?? candidate.geo?.lat;
    const geoLon = enrichment?.lon ?? candidate.geo?.lon;
    const city = enrichment?.city || candidate.geo?.city || candidate.geo?.region || '-';
    const region = enrichment?.regionName || enrichment?.region || candidate.geo?.region || '-';
    const country = enrichment?.country || enrichment?.countryCode || candidate.geo?.country || '-';
    const timezone = enrichment?.timezone || candidate.geo?.timezone || '-';

    return (
        <div className="bg-surface-hover rounded-lg p-3 border border-surface-border">
            <div className="flex flex-col gap-2 mb-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-mono font-bold text-txt-primary">{candidate.ip}</span>
                        <span className={clsx(
                            "text-[10px] font-bold px-2 py-0.5 rounded-full",
                            score >= 75 ? "bg-emerald-500/20 text-emerald-400" :
                            score >= 45 ? "bg-amber-500/20 text-amber-400" :
                            "bg-slate-500/20 text-slate-400"
                        )}>
                            Score {score}/100 · {formatCandidateConfidence(candidate)}
                        </span>
                        <span className="text-[10px] text-txt-dim">{formatDirection(candidate.direction)}</span>
                    </div>
                    <p className="mt-1 text-[10px] text-txt-dim">
                        Categoria: <span className="font-mono text-txt-secondary">{formatNetworkCategory(candidate.networkCategory)}</span>
                    </p>
                    {candidate.networkIntelligence && (
                        <p className="mt-1 text-[10px] text-txt-dim">
                            ASN/ORG: <span className="font-mono text-txt-secondary">
                                {candidate.networkIntelligence.asn ? `AS${candidate.networkIntelligence.asn} · ` : ''}
                                {candidate.networkIntelligence.org}
                            </span>
                        </p>
                    )}
                </div>
                <span className="text-[10px] text-txt-muted font-mono">{candidate.packets} pkts</span>
            </div>

            {candidate.reasonCodes && candidate.reasonCodes.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                    {candidate.reasonCodes.slice(-5).map(reason => (
                        <span
                            key={reason.code}
                            className={clsx(
                                "text-[10px] rounded px-2 py-0.5 border",
                                reason.delta >= 0
                                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                                    : "border-amber-500/20 bg-amber-500/10 text-amber-300"
                            )}
                        >
                            {reason.delta >= 0 ? '+' : ''}{reason.delta} · {reason.label}
                        </span>
                    ))}
                </div>
            )}

            {candidate.correlation && (
                <div className={clsx(
                    "mb-2 rounded-lg border px-3 py-2",
                    candidate.correlation.classification === 'candidate'
                        ? "border-emerald-500/20 bg-emerald-500/10"
                        : "border-amber-500/20 bg-amber-500/10"
                )}>
                    <p className={clsx(
                        "text-[10px] font-bold uppercase tracking-wider",
                        candidate.correlation.classification === 'candidate' ? "text-emerald-300" : "text-amber-300"
                    )}>
                        Correlacion: {candidate.correlation.label}
                    </p>
                    <p className="mt-1 text-[10px] text-txt-secondary">{candidate.correlation.summary}</p>
                    {(candidate.correlation.phoneCountryCode || candidate.correlation.observedCountryCode || candidate.correlation.caps?.length > 0) && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {candidate.correlation.phoneCountryCode && (
                                <span className="text-[10px] rounded px-2 py-0.5 border border-surface-border bg-surface-overlay text-txt-muted">
                                    Numero: {candidate.correlation.phoneCountryCode}
                                </span>
                            )}
                            {candidate.correlation.observedCountryCode && (
                                <span className="text-[10px] rounded px-2 py-0.5 border border-surface-border bg-surface-overlay text-txt-muted">
                                    GeoIP: {candidate.correlation.observedCountryCode}
                                </span>
                            )}
                            {candidate.correlation.caps?.map(cap => (
                                <span key={cap} className="text-[10px] rounded px-2 py-0.5 border border-amber-500/20 bg-amber-500/10 text-amber-300">
                                    Tope: {cap}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {candidate.geo ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                    <CandidateGeo label="Pais" value={country} />
                    <CandidateGeo label="Ciudad" value={city} />
                    <CandidateGeo
                        label="Coords"
                        value={formatCoords(geoLat, geoLon)}
                        href={enrichment?.mapsUrl || buildGoogleMapsUrl(geoLat, geoLon)}
                        mono
                    />
                    <CandidateGeo label="TZ" value={timezone} />
                </div>
            ) : (
                <p className="text-[10px] text-txt-dim italic">Sin datos de geolocalizacion disponibles</p>
            )}

            {enrichment && (
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px] text-txt-dim">
                    <CandidateGeo label="Region" value={region} />
                    <CandidateGeo label="Postal" value={enrichment.postalCode || '-'} mono />
                    <CandidateGeo label="Fuente" value={formatEnrichmentSource(enrichment.provider)} />
                    <CandidateGeo label="ISP" value={enrichment.isp || '-'} />
                    <CandidateGeo label="Org" value={enrichment.org || '-'} />
                    <CandidateGeo label="ASN" value={enrichment.asn ? `AS${enrichment.asn}` : candidate.networkIntelligence?.asn ? `AS${candidate.networkIntelligence.asn}` : '-'} mono />
                </div>
            )}

            <p className="mt-2 text-[10px] text-txt-dim">
                {candidate.technicalNote || 'IP publica observada como candidata tecnica. No confirma identidad, ubicacion exacta ni titularidad.'}
            </p>
            {enrichment?.accuracyNote && (
                <p className="mt-1 text-[10px] text-sky-300/80">
                    {enrichment.accuracyNote}
                </p>
            )}
            {candidate.networkIntelligence?.caution && (
                <p className="mt-1 text-[10px] text-amber-300/80">
                    {candidate.networkIntelligence.caution}
                </p>
            )}
        </div>
    );
}

function CandidateGeo({ label, value, href, mono = false }: { label: string; value: string; href?: string | null; mono?: boolean }) {
    return (
        <div>
            <span className="text-txt-dim">{label}:</span>{' '}
            {href ? (
                <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className={clsx(
                        "inline-flex items-center gap-1 text-accent font-medium hover:text-accent-light transition-colors",
                        mono && "font-mono text-[10px]"
                    )}
                    title="Abrir coordenadas estimadas de red en Google Maps"
                >
                    {value}
                    <ExternalLink size={10} aria-hidden="true" />
                </a>
            ) : (
                <span className={clsx("text-txt-primary font-medium", mono && "font-mono text-[10px]")}>{value}</span>
            )}
        </div>
    );
}

function buildGoogleMapsUrl(lat?: number, lon?: number): string | null {
    if (typeof lat !== 'number' || typeof lon !== 'number') return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return `https://www.google.com/maps?q=${lat},${lon}`;
}

function formatCoords(lat?: number, lon?: number): string {
    if (typeof lat !== 'number' || typeof lon !== 'number') return '-';
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '-';
    return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

function formatEnrichmentSource(provider: string): string {
    if (provider === 'db-ip+ip-api') return 'DB-IP + ip-api';
    if (provider === 'db-ip') return 'DB-IP';
    if (provider === 'ip-api') return 'ip-api.com';
    return provider;
}

function VerdictBadge({ verdict, compact = false }: { verdict: CallAnalysisResult['verdict']; compact?: boolean }) {
    const label = compact
        ? verdict
        : verdict === 'p2p' ? 'Trafico directo candidato' :
          verdict === 'mixed' ? 'Mixto (candidato + relay)' :
          verdict === 'relay' ? 'Solo Relay (Meta)' :
          'Datos Insuficientes';

    return (
        <span className={clsx(
            "font-bold px-3 py-1 rounded-full",
            compact ? "text-[10px]" : "text-xs",
            verdict === 'p2p' ? "bg-emerald-500/20 text-emerald-400" :
            verdict === 'mixed' ? "bg-amber-500/20 text-amber-400" :
            verdict === 'relay' ? "bg-red-500/20 text-red-400" :
            "bg-slate-500/20 text-slate-400"
        )}>
            {label}
        </span>
    );
}

function CallTrafficMap({ analysis }: { analysis: CallAnalysisResult }) {
    const candidates = analysis.candidateIps;
    const observedCandidates = candidates
        .filter(candidate => candidate.isP2P)
        .sort((a, b) => b.packets - a.packets)
        .slice(0, 3);
    const infrastructure = candidates
        .filter(candidate => !candidate.isP2P && candidate.provider !== 'unknown')
        .sort((a, b) => b.packets - a.packets)
        .slice(0, 2);

    const nodes = [
        {
            title: 'Este equipo',
            subtitle: analysis.captureInterface || 'interfaz local',
            icon: <Monitor size={15} />,
            tone: 'accent',
        },
        {
            title: 'Red local / ISP',
            subtitle: 'NAT + salida publica',
            icon: <Wifi size={15} />,
            tone: 'neutral',
        },
        {
            title: 'WhatsApp / Meta',
            subtitle: `${analysis.metaIps?.length || 0} relays observados`,
            icon: <Shield size={15} />,
            tone: 'danger',
        },
        ...infrastructure.map(item => ({
            title: item.provider || 'infraestructura',
            subtitle: `${item.ip} · ${formatNetworkCategory(item.networkCategory)} · ${item.packets || 0} pkts`,
            icon: <Globe size={15} />,
            tone: 'warning',
        })),
        ...observedCandidates.map(item => ({
            title: 'IP observada candidata',
            subtitle: `${item.ip} · score ${getCandidateScore(item)}/100 · ${item.packets || 0} pkts`,
            icon: <Target size={15} />,
            tone: 'success',
        })),
        {
            title: 'Contacto via WhatsApp',
            subtitle: 'sin IP verificada',
            icon: <Phone size={15} />,
            tone: 'neutral',
        },
    ];

    const toneClasses: Record<string, string> = {
        accent: 'border-accent/40 bg-accent/10 text-accent',
        success: 'border-success/40 bg-success/10 text-success',
        warning: 'border-warning/40 bg-warning/10 text-warning',
        danger: 'border-danger/40 bg-danger/10 text-danger',
        neutral: 'border-surface-border bg-surface-hover text-txt-secondary',
    };

    return (
        <div className="mb-4 bg-surface-hover rounded-lg border border-surface-border p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
                <h6 className="text-[11px] font-semibold text-txt-muted uppercase tracking-wider">Mapa visual de ruta observada</h6>
                <span className="text-[10px] text-txt-dim font-mono">{analysis.verdict || 'unknown'}</span>
            </div>

            <div className="flex flex-col lg:flex-row lg:items-stretch gap-2">
                {nodes.map((node, index) => (
                    <React.Fragment key={`${node.title}-${index}`}>
                        <div className={clsx(
                            "min-w-0 flex-1 rounded-lg border px-3 py-3",
                            toneClasses[node.tone]
                        )}>
                            <div className="flex items-center gap-2 mb-1">
                                <div className="shrink-0">{node.icon}</div>
                                <p className="text-[11px] font-bold uppercase tracking-wider truncate">{node.title}</p>
                            </div>
                            <p className="text-[10px] text-txt-dim font-mono truncate">{node.subtitle}</p>
                        </div>
                        {index < nodes.length - 1 && (
                            <div className="hidden lg:flex items-center justify-center text-txt-dim px-0.5">→</div>
                        )}
                    </React.Fragment>
                ))}
            </div>

            <p className="text-[10px] text-txt-dim mt-3">
                Esta vista resume trafico observado en tu captura local. Las IPs candidatas no prueban identidad ni ubicacion exacta del contacto.
            </p>
        </div>
    );
}

function getCandidateScore(candidate: CandidateIP): number {
    if (typeof candidate.confidenceScore === 'number') {
        return Math.max(0, Math.min(100, Math.round(candidate.confidenceScore)));
    }
    if (candidate.confidence === 'high') return 80;
    if (candidate.confidence === 'medium') return 55;
    return 25;
}

function formatCandidateConfidence(candidate: CandidateIP): string {
    const score = getCandidateScore(candidate);
    if (score >= 75) return 'Alta';
    if (score >= 45) return 'Media';
    return 'Baja';
}

function formatNetworkCategory(category?: CandidateIP['networkCategory']): string {
    const labels: Record<NonNullable<CandidateIP['networkCategory']>, string> = {
        meta: 'Meta/relay',
        stun_turn: 'STUN/TURN probable',
        cdn: 'CDN',
        cloud_hosting: 'Cloud/hosting probable',
        consumer_isp_or_unknown: 'ISP/unknown no verificado',
        unknown_public: 'Publica desconocida',
    };
    return category ? labels[category] : 'Publica desconocida';
}

function formatDirection(direction: CandidateIP['direction']): string {
    if (direction === 'bidirectional') return '↔ bidirectional';
    if (direction === 'incoming') return '<- incoming';
    return '-> outgoing';
}

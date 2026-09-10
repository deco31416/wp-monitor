import React from 'react';
import clsx from 'clsx';
import { ExternalLink, Globe, History, Monitor, Phone, Shield, Square, Target, Wifi } from 'lucide-react';
import { CallAnalysisResult, CallEvent, CandidateIP, type CallCapturePhases, type CallRouteAssessment, type CaseRecord, type OperatorCallMarker } from '../types';

interface CallAnalysisPanelProps {
    callAnalysis: CallAnalysisResult | null;
    callHistory: CallAnalysisResult[];
    callCapturing: boolean;
    callEvent: CallEvent | null;
    callPacketCount: number;
    callStopping: boolean;
    callOperatorMarker: OperatorCallMarker | null;
    callMarkerPending: boolean;
    operatorMarkerAvailable: boolean;
    callCaseId: string;
    callOperatorName: string;
    callAuthorizationNote: string;
    availableCases: CaseRecord[];
    casesLoading: boolean;
    callCaptureError: string | null;
    onCaseIdChange: (value: string) => void;
    onStartManualCapture: () => void;
    onStopManualCapture: () => void;
    onOperatorCallMarker: (marker: OperatorCallMarker) => void;
    onSelectAnalysis: (analysis: CallAnalysisResult) => void;
}

export function CallAnalysisPanel({
    callAnalysis,
    callHistory,
    callCapturing,
    callEvent,
    callPacketCount,
    callStopping,
    callOperatorMarker,
    callMarkerPending,
    operatorMarkerAvailable,
    callCaseId,
    callOperatorName,
    callAuthorizationNote,
    availableCases,
    casesLoading,
    callCaptureError,
    onCaseIdChange,
    onStartManualCapture,
    onStopManualCapture,
    onOperatorCallMarker,
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
                    Iníciala manualmente antes de llamar para separar una línea base. Si comienza automáticamente, el resultado indicará que no existió esa comparación previa.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
                    <select
                        aria-label="Caso de la captura"
                        value={callCaseId}
                        onChange={event => onCaseIdChange(event.target.value)}
                        disabled={callCapturing || casesLoading || availableCases.length === 0}
                        className="select-field !text-xs"
                    >
                        <option value="">
                            {casesLoading ? 'Cargando casos...' : 'Seleccionar caso autorizado'}
                        </option>
                        {availableCases.map(item => (
                            <option key={item.caseId} value={item.caseId}>
                                {item.caseId}{item.title && item.title !== item.caseId ? ` - ${item.title}` : ''} ({item.status})
                            </option>
                        ))}
                    </select>
                    <input
                        aria-label="Operador de la captura"
                        value={callOperatorName}
                        readOnly
                        placeholder="Operador"
                        className="input-field !text-xs"
                    />
                    <input
                        aria-label="Autorización de la captura"
                        value={callAuthorizationNote}
                        readOnly
                        placeholder="Autorizacion / motivo"
                        className="input-field !text-xs"
                    />
                </div>

                <div className="flex flex-wrap items-center gap-3">
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
                            disabled={callStopping || callMarkerPending}
                            className="btn-danger flex items-center gap-2 !text-xs !py-2 !px-4 animate-pulse disabled:opacity-60 disabled:cursor-wait"
                        >
                            <Square size={14} /> {callStopping ? 'Analizando captura...' : `Detener Captura (${callPacketCount} paquetes)`}
                        </button>
                    )}
                    {callCapturing && operatorMarkerAvailable && callOperatorMarker !== 'call_ended' && (
                        <button
                            type="button"
                            disabled={callStopping || callMarkerPending}
                            onClick={() => onOperatorCallMarker(
                                callOperatorMarker === 'call_connected' ? 'call_ended'
                                    : callOperatorMarker === 'call_started' ? 'call_connected'
                                        : 'call_started',
                            )}
                            className="btn-primary flex items-center gap-2 !text-xs !py-2 !px-4 disabled:opacity-60 disabled:cursor-wait"
                        >
                            <Target size={14} />
                            {callMarkerPending
                                ? 'Registrando marcador...'
                                : callOperatorMarker === 'call_connected'
                                    ? 'Marcar fin de llamada'
                                    : callOperatorMarker === 'call_started'
                                        ? 'Marcar llamada conectada'
                                        : 'Marcar inicio de llamada'}
                        </button>
                    )}
                    {callCapturing && operatorMarkerAvailable && callOperatorMarker === 'call_started' && (
                        <button
                            type="button"
                            disabled={callStopping || callMarkerPending}
                            onClick={() => onOperatorCallMarker('call_ended')}
                            className="btn-secondary flex items-center gap-2 !text-xs !py-2 !px-4 disabled:opacity-60 disabled:cursor-wait"
                        >
                            <Square size={14} /> Marcar fin sin conexión
                        </button>
                    )}
                    {callCapturing && operatorMarkerAvailable && callOperatorMarker === 'call_ended' && (
                        <span className="badge-success !text-xs">Fin de llamada marcado</span>
                    )}
                </div>

                <p className="mt-2 text-[10px] text-txt-dim">
                    La captura se asociara al caso seleccionado y usara su operador y autorizacion registrados.
                    Durante la captura, marca el inicio justo antes de llamar, la conexion solo cuando contesten y el fin al colgar.
                </p>

                {callCaptureError && (
                    <div role="alert" className="mt-3 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
                        <p className="text-xs font-bold text-red-300">No se pudo completar la operación de captura</p>
                        <p className="text-[11px] text-red-100/80">{callCaptureError}</p>
                    </div>
                )}

                {callCapturing && (
                    <div role="status" aria-live="polite" className="mt-3 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 flex items-center gap-3">
                        <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                        <div>
                            <p className="text-xs font-bold text-red-400">
                                {callStopping
                                    ? 'Analizando captura'
                                    : callEvent
                                        ? 'Captura de llamada en curso'
                                        : 'Calibrando línea base'}
                            </p>
                            <p className="text-[10px] text-txt-dim">
                                {callPacketCount} paquetes de red capturados · {callStopping
                                    ? 'Procesando ruta, contexto de red y auditoría'
                                    : callEvent
                                        ? 'La observación continuará hasta que detengas la captura'
                                        : 'Espera unos segundos y luego inicia la llamada desde este equipo'}
                            </p>
                        </div>
                    </div>
                )}

                {casesLoading && !callCapturing && (
                    <p role="status" aria-live="polite" className="mt-3 text-[11px] text-txt-secondary">
                        Cargando configuración de captura…
                    </p>
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
                                    <th className="text-right py-2 px-2">Acción</th>
                                </tr>
                            </thead>
                            <tbody>
                                {callHistory.map((historyItem, index) => (
                                    <tr
                                        key={index}
                                        className="border-b border-surface-border/50 hover:bg-surface-hover transition-colors"
                                    >
                                        <td className="py-2 px-2 text-txt-secondary font-mono">
                                            {new Date(historyItem.startTime).toLocaleString('es-ES', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                        </td>
                                        <td className="py-2 px-2 text-txt-primary">{historyItem.durationSec}s</td>
                                        <td className="py-2 px-2">
                                            <RouteBadge analysis={historyItem} compact />
                                        </td>
                                        <td className="py-2 px-2 text-right text-accent font-bold">
                                            {historyItem.candidateIps.filter(candidate => candidate.isP2P).length}
                                        </td>
                                        <td className="py-2 px-2 text-right text-txt-dim">{historyItem.totalPackets}</td>
                                        <td className="py-1 px-1 text-right">
                                            <button
                                                type="button"
                                                className="rounded px-2 py-1 font-semibold text-accent hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                                onClick={() => onSelectAnalysis(historyItem)}
                                                aria-label={`Abrir análisis ${historyItem.callId} del ${new Date(historyItem.startTime).toLocaleString('es-ES')}`}
                                            >
                                                Abrir
                                            </button>
                                        </td>
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
                <RouteBadge analysis={analysis} />
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                <SummaryStat value={analysis.totalPackets} label="Paquetes" tone="primary" />
                <SummaryStat value={observedCandidates.length} label="Candidatas" tone="accent" />
                <SummaryStat value={analysis.metaIps?.length || 0} label="IPs Meta" tone="danger" />
                <SummaryStat value={`${analysis.durationSec || 0}s`} label="Duracion" tone="primary" />
            </div>

            {analysis.captureBounds?.truncated && (
                <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                    La captura alcanzo su limite de memoria: se analizaron {analysis.captureBounds.storedPackets.toLocaleString()} de {analysis.totalPackets.toLocaleString()} paquetes observados.
                </div>
            )}

            {analysis.capturePhases && <CapturePhaseSummary phases={analysis.capturePhases} />}

            <RouteAssessmentSummary analysis={analysis} />

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
                            <div key={index} className="flex flex-col gap-1 text-[10px] sm:flex-row sm:items-center sm:justify-between">
                                <span className="font-mono text-txt-dim">{candidate.ip}</span>
                                <span className="text-txt-muted sm:text-right">
                                    {candidate.networkIntelligence?.org || candidate.provider} · {formatNetworkCategory(candidate.networkCategory)} · score {getCandidateScore(candidate)}/100 · {candidate.packets} pkts
                                    {candidate.networkIntelligence?.registryEvidence && (
                                        <span className={clsx(
                                            'block',
                                            candidate.networkIntelligence.registryEvidence.degraded
                                                ? 'text-amber-300/80'
                                                : 'text-emerald-300/80',
                                        )}>
                                            Registro {candidate.networkIntelligence.registryEvidence.registryVersion} ·{' '}
                                            {formatRegistryStatus(candidate.networkIntelligence.registryEvidence.status)}
                                            {candidate.networkIntelligence.registryEvidence.source?.label
                                                ? ` · ${candidate.networkIntelligence.registryEvidence.source.label}`
                                                : ''}
                                        </span>
                                    )}
                                </span>
                            </div>
                        ))}
                    </div>
                </details>
            )}
        </div>
    );
}

function CapturePhaseSummary({ phases }: { phases: CallCapturePhases }) {
    if (!phases.baselineAvailable) {
        return (
            <div role="status" className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-3">
                <p className="text-xs font-semibold text-amber-300">Resultado sin línea base previa</p>
                <p className="mt-1 text-[11px] text-amber-100/75">
                    No se registró una ventana previa separable. El tráfico de fondo puede influir y limita la confianza del análisis.
                </p>
            </div>
        );
    }

    const baselineDuration = phases.baselineStartedAt && phases.baselineEndedAt
        ? Math.max(0, Math.round((new Date(phases.baselineEndedAt).getTime() - new Date(phases.baselineStartedAt).getTime()) / 1000))
        : 0;
    if (!phases.negotiationStartedAt) {
        return (
            <div role="status" className="mb-4 rounded-lg border border-surface-border bg-surface-hover px-3 py-3">
                <p className="text-xs font-semibold text-txt-primary">Solo se registró la línea base</p>
                <p className="mt-1 text-[11px] text-txt-secondary">
                    Se capturaron {baselineDuration}s de actividad previa, pero no se observó el inicio de una llamada correlacionada en esta ventana.
                </p>
            </div>
        );
    }
    return (
        <div role="status" className="mb-4 rounded-lg border border-success/30 bg-success/10 px-3 py-3">
            <p className="text-xs font-semibold text-success">Comparación con línea base disponible</p>
            <p className="mt-1 text-[11px] text-txt-secondary">
                Se separaron {baselineDuration}s de actividad previa para reducir el peso del tráfico que ya existía antes de la llamada.
            </p>
        </div>
    );
}

const ROUTE_LABELS: Record<CallRouteAssessment['classification'], string> = {
    direct_confirmed: 'Ruta directa confirmada',
    direct_probable: 'Ruta directa probable',
    relay_confirmed: 'Conexión mediante infraestructura de WhatsApp',
    mixed: 'Ruta mixta observada',
    unresolved: 'Ruta no determinada',
};

const ROUTE_DESCRIPTIONS: Record<CallRouteAssessment['classification'], string> = {
    direct_confirmed: 'Dos fuentes independientes coinciden con una ruta directa observada durante la llamada.',
    direct_probable: 'El tráfico observado es compatible con una ruta directa, pero falta una segunda fuente independiente para confirmarla.',
    relay_confirmed: 'La llamada utilizó infraestructura de WhatsApp/Meta y no expuso una ruta directa verificable.',
    mixed: 'Se observaron simultáneamente una ruta directa sustentada e infraestructura de WhatsApp/Meta.',
    unresolved: 'La evidencia disponible no permite distinguir de forma responsable entre una ruta directa y una conexión por relay.',
};

const ROUTE_SOURCE_LABELS: Record<CallRouteAssessment['evidenceSources'][number], string> = {
    baileys_transport: 'Señalización de llamada',
    packet_flow: 'Flujo de red observado',
    stun: 'Negociación STUN',
    baseline: 'Línea base previa',
    infrastructure_registry: 'Registro de infraestructura',
    ip_enrichment: 'Contexto de red y GeoIP',
};

const ROUTE_REASON_LABELS: Record<string, string> = {
    PACKET_FLOW_MATCHES_BAILEYS_PEER: 'El flujo de red coincide con el endpoint señalado durante la llamada.',
    STRONG_DIRECT_PACKET_PATTERN: 'Se observó un patrón bidireccional fuerte compatible con tráfico directo.',
    PACKET_FLOW_MATCHES_STUN_PEER_ONLY: 'El flujo coincide únicamente con una referencia STUN y requiere corroboración independiente.',
    DIRECT_CONFIRMED_WITH_RELAY: 'La ruta directa confirmada coexistió con tráfico de relay.',
    DIRECT_PROBABLE_WITH_RELAY: 'La ruta directa probable coexistió con tráfico de relay.',
    BAILEYS_RELAY_OBSERVED: 'La señalización indicó el uso de infraestructura relay.',
    RELAY_PACKET_FLOW_OBSERVED: 'El flujo de paquetes confirmó tráfico mediante infraestructura relay.',
    NO_CONCLUSIVE_ROUTE_EVIDENCE: 'No se reunieron evidencias suficientes para determinar la ruta.',
    DNS_EXCLUDED_FROM_DIRECT_EVIDENCE: 'El tráfico DNS fue excluido de la evidencia de ruta directa.',
    STUN_CONTEXT_ONLY: 'La señal STUN se utilizó solo como contexto y no como confirmación independiente.',
};

const ROUTE_LIMITATION_LABELS: Record<string, string> = {
    peer_signaling_without_attributable_endpoint: 'La señalización de pares no expuso un endpoint atribuible.',
    stun_peer_is_not_independent_confirmation: 'La referencia STUN no constituye una segunda confirmación independiente.',
    baseline_unavailable: 'No hubo una línea base previa separable.',
    packet_capture_truncated: 'La captura alcanzó su límite y el análisis utiliza una muestra parcial.',
    infrastructure_registry_degraded: 'El registro de infraestructura no estaba completamente disponible.',
    no_eligible_direct_candidate: 'No apareció una IP elegible como candidata directa.',
    unknown_transport_message_type: 'Se observó señalización de transporte todavía no clasificada.',
    peer_candidate_payload_not_decoded: 'La señalización del candidato no pudo interpretarse como endpoint atribuible.',
    node_traversal_truncated: 'La inspección de señalización alcanzó su límite de seguridad.',
    sensitive_fields_excluded: 'Los campos sensibles fueron excluidos de la evidencia almacenada.',
    endpoint_list_truncated: 'La lista de endpoints fue acotada por seguridad.',
    malformed_endpoint_skipped: 'Se descartó un endpoint con formato inválido.',
    stored_observation_invalid: 'Una observación almacenada no superó la validación del contrato.',
};

function routeConfidenceLabel(score: number): string {
    if (score >= 75) return 'Alta';
    if (score >= 45) return 'Media';
    return 'Baja';
}

function humanizeRouteCode(value: string): string {
    return value
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^./, character => character.toUpperCase());
}

function RouteAssessmentSummary({ analysis }: { analysis: CallAnalysisResult }) {
    const assessment = analysis.routeAssessment;
    if (!assessment) {
        return (
            <div role="status" className="mb-4 rounded-lg border border-surface-border bg-surface-hover px-4 py-3">
                <p className="text-xs font-semibold text-txt-primary">Resultado histórico con detalle limitado</p>
                <p className="mt-1 text-[11px] text-txt-secondary">
                    Esta captura conserva el análisis anterior, pero no incluye el modelo de correlación de ruta actual.
                </p>
            </div>
        );
    }

    const tone = assessment.classification === 'direct_confirmed'
        ? 'border-emerald-500/30 bg-emerald-500/10'
        : assessment.classification === 'direct_probable' || assessment.classification === 'mixed'
            ? 'border-amber-500/30 bg-amber-500/10'
            : assessment.classification === 'relay_confirmed'
                ? 'border-sky-500/30 bg-sky-500/10'
                : 'border-surface-border bg-surface-hover';
    const limitations = assessment.limitations.map(item => ROUTE_LIMITATION_LABELS[item] || humanizeRouteCode(item));
    const reasons = assessment.reasonCodes.map(item => ROUTE_REASON_LABELS[item] || humanizeRouteCode(item));

    return (
        <section aria-labelledby={`route-assessment-${analysis.callId}`} className={clsx('mb-4 rounded-lg border px-4 py-4', tone)}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-txt-muted">Conclusión de ruta observada</p>
                    <h6 id={`route-assessment-${analysis.callId}`} className="mt-1 text-sm font-bold text-txt-primary">
                        {ROUTE_LABELS[assessment.classification]}
                    </h6>
                    <p className="mt-1 max-w-2xl text-[11px] text-txt-secondary">
                        {ROUTE_DESCRIPTIONS[assessment.classification]}
                    </p>
                </div>
                <span className="shrink-0 rounded-full border border-current/20 bg-surface-overlay/60 px-3 py-1 text-[11px] font-bold text-txt-primary">
                    Confianza {routeConfidenceLabel(assessment.confidenceScore)} · {assessment.confidenceScore}/100
                </span>
            </div>

            <dl className="mt-3 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2">
                <div>
                    <dt className="text-txt-dim">Evidencia utilizada</dt>
                    <dd className="mt-1 text-txt-primary">
                        {assessment.evidenceSources.length
                            ? assessment.evidenceSources.map(source => ROUTE_SOURCE_LABELS[source]).join(' · ')
                            : 'Sin fuentes concluyentes'}
                    </dd>
                </div>
                <div>
                    <dt className="text-txt-dim">Candidato principal</dt>
                    <dd className="mt-1 font-mono text-txt-primary">{assessment.primaryCandidateIp || 'No identificado'}</dd>
                </div>
            </dl>

            {reasons.length > 0 && (
                <div className="mt-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-txt-muted">Por qué se obtuvo este resultado</p>
                    <ul className="mt-1 space-y-1 text-[11px] text-txt-secondary">
                        {reasons.map(reason => <li key={reason}>• {reason}</li>)}
                    </ul>
                </div>
            )}

            {limitations.length > 0 && (
                <div role="status" className="mt-3 rounded-md border border-amber-500/20 bg-surface-overlay/40 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                        {assessment.limitations.includes('packet_capture_truncated')
                            ? 'Resultado parcial'
                            : 'Alcance y limitaciones'}
                    </p>
                    <ul className="mt-1 space-y-1 text-[11px] text-txt-secondary">
                        {limitations.map(limitation => <li key={limitation}>• {limitation}</li>)}
                    </ul>
                </div>
            )}

            <p className="mt-3 text-[10px] text-txt-dim">
                La ruta e IP observadas describen conectividad de red durante esta captura; no prueban identidad, ubicación exacta ni titularidad del contacto.
            </p>
        </section>
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
                    {candidate.networkIntelligence?.registryEvidence && (
                        <p className={clsx(
                            "mt-1 text-[10px]",
                            candidate.networkIntelligence.registryEvidence.degraded
                                ? "text-amber-300/80"
                                : "text-emerald-300/80"
                        )}>
                            Registro {candidate.networkIntelligence.registryEvidence.registryVersion} ·{' '}
                            {formatRegistryStatus(candidate.networkIntelligence.registryEvidence.status)}
                            {candidate.networkIntelligence.registryEvidence.source?.label
                                ? ` · ${candidate.networkIntelligence.registryEvidence.source.label}`
                                : ''}
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
    const label = verdict === 'p2p' ? 'Tráfico directo candidato' :
        verdict === 'mixed' ? 'Ruta mixta observada' :
        verdict === 'relay' ? 'Conexión mediante infraestructura de WhatsApp' :
        'Datos insuficientes';

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

function RouteBadge({ analysis, compact = false }: { analysis: CallAnalysisResult; compact?: boolean }) {
    if (!analysis.routeAssessment) return <VerdictBadge verdict={analysis.verdict} compact={compact} />;
    const { classification } = analysis.routeAssessment;
    return (
        <span className={clsx(
            'font-bold px-3 py-1 rounded-full',
            compact ? 'text-[10px]' : 'text-xs',
            classification === 'direct_confirmed' ? 'bg-emerald-500/20 text-emerald-400' :
            classification === 'direct_probable' || classification === 'mixed' ? 'bg-amber-500/20 text-amber-400' :
            classification === 'relay_confirmed' ? 'bg-sky-500/20 text-sky-300' :
            'bg-slate-500/20 text-slate-400',
        )}>
            {ROUTE_LABELS[classification]}
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
                <span className="text-[10px] text-txt-dim">
                    {analysis.routeAssessment
                        ? ROUTE_LABELS[analysis.routeAssessment.classification]
                        : analysis.verdict === 'p2p'
                            ? 'Tráfico directo candidato'
                            : analysis.verdict === 'mixed'
                                ? 'Ruta mixta observada'
                                : analysis.verdict === 'relay'
                                    ? 'Conexión mediante infraestructura de WhatsApp'
                                    : 'Ruta no determinada'}
                </span>
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
        dns: 'DNS publico',
        cdn: 'CDN',
        cloud_hosting: 'Cloud/hosting probable',
        consumer_isp_or_unknown: 'ISP/unknown no verificado',
        unknown_public: 'Publica desconocida',
    };
    return category ? labels[category] : 'Publica desconocida';
}

function formatRegistryStatus(status: NonNullable<NonNullable<CandidateIP['networkIntelligence']>['registryEvidence']>['status']): string {
    const labels = {
        fresh: 'vigente',
        stale: 'vencido',
        source_unavailable: 'fuente no disponible',
        unknown: 'sin coincidencia',
        invalid: 'dato invalido',
    } as const;
    return labels[status];
}

function formatDirection(direction: CandidateIP['direction']): string {
    if (direction === 'bidirectional') return '↔ bidirectional';
    if (direction === 'incoming') return '<- incoming';
    return '-> outgoing';
}

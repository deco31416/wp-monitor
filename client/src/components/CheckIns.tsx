import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, MapPin, Pencil, Plus, RefreshCw, Save, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { API_URL, authFetch } from '../auth';
import { CaseRecord } from '../types';
import { socket } from '../App';

interface CheckInItem {
    token: string;
    url: string;
    caseId: string;
    operatorName: string;
    authorizationNote: string;
    label: string;
    targetName: string | null;
    targetJid: string | null;
    content?: {
        pageTitle?: string;
        pageDescription?: string;
        ogImageUrl?: string | null;
        brandName?: string;
        accentColor?: string;
        backgroundColor?: string;
        panelColor?: string;
        textColor?: string;
        layout?: 'classic' | 'hero' | 'compact';
        requestGps?: boolean;
        caseLabel?: string;
        operatorLabel?: string;
        checkInLabel?: string;
        expiresLabel?: string;
        consentText?: string;
        submitButtonText?: string;
        successMessage?: string;
        redirectUrl?: string | null;
    };
    status: 'pending' | 'completed' | 'expired' | 'revoked';
    createdAt: string;
    expiresAt: string | null;
    completedAt: string | null;
    request: {
        ip: string;
        userAgent: string;
        acceptLanguage: string;
        referer: string | null;
    } | null;
    browser: {
        timezone?: string;
        language?: string;
        languages?: string[];
        platform?: string;
        userAgentData?: {
            platform?: string;
            mobile?: boolean;
            brands?: Array<{ brand?: string; version?: string }>;
        };
        device?: {
            type?: 'mobile' | 'tablet' | 'desktop' | 'unknown';
            os?: string;
            browser?: string;
            engine?: string;
            isTouch?: boolean;
            maxTouchPoints?: number;
            hardwareConcurrency?: number;
            deviceMemoryGb?: number;
        };
        viewport?: {
            width: number;
            height: number;
        };
        screen?: {
            width: number;
            height: number;
            pixelRatio: number;
            colorDepth?: number;
            orientation?: string;
        };
        network?: {
            online?: boolean;
            effectiveType?: string;
            downlink?: number;
            rtt?: number;
            saveData?: boolean;
        };
        privacy?: {
            cookiesEnabled?: boolean;
            doNotTrack?: string | null;
        };
    } | null;
    location: {
        permission: 'granted' | 'denied' | 'unavailable' | 'unsupported';
        lat?: number;
        lon?: number;
        accuracy?: number;
    } | null;
    ipEnrichment?: {
        provider?: 'db-ip' | 'db-ip+ip-api' | 'ip-api';
        city?: string;
        regionName?: string;
        country?: string;
        countryCode?: string;
        isp?: string;
        org?: string;
        lat?: number;
        lon?: number;
        mapsUrl?: string;
        accuracyNote?: string;
        status?: string;
    } | null;
    consistency?: {
        score: number;
        level: 'high' | 'medium' | 'low';
        summary: string;
        signals: Array<{
            severity: 'ok' | 'info' | 'warning' | 'danger';
            label: string;
            detail: string;
        }>;
    } | null;
    hash: string;
}

const STATUS_CLASS: Record<CheckInItem['status'], string> = {
    pending: 'badge-warning',
    completed: 'badge-success',
    expired: 'badge-neutral',
    revoked: 'badge-danger',
};

const DEFAULT_CONSENT_GPS = 'Acepto enviar este check-in autorizado. Entiendo que se registrara mi IP publica observada por el servidor, sistema operativo, navegador, tipo de dispositivo, pantalla, idioma, zona horaria, datos basicos de red del navegador y, si doy permiso, mi ubicacion aproximada.';
const DEFAULT_CONSENT_NO_GPS = 'Acepto enviar este check-in autorizado. Entiendo que se registrara mi IP publica observada por el servidor, sistema operativo, navegador, tipo de dispositivo, pantalla, idioma, zona horaria y datos basicos de red del navegador.';

async function readJson<T = any>(response: Response): Promise<T> {
    const text = await response.text();
    try {
        return text ? JSON.parse(text) : {} as T;
    } catch {
        const short = text.replace(/\s+/g, ' ').slice(0, 160);
        throw new Error(`HTTP ${response.status}: respuesta no JSON (${short || 'sin contenido'})`);
    }
}

export function CheckIns() {
    const [items, setItems] = useState<CheckInItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [cases, setCases] = useState<CaseRecord[]>([]);
    const [caseMode, setCaseMode] = useState<'existing' | 'new'>('existing');
    const [createdUrl, setCreatedUrl] = useState('');
    const [copied, setCopied] = useState(false);
    const [uploadingImage, setUploadingImage] = useState(false);
    const [editingToken, setEditingToken] = useState<string | null>(null);
    const [lastRealtimeUpdate, setLastRealtimeUpdate] = useState<string | null>(null);
    const [editForm, setEditForm] = useState({
        label: '',
        targetName: '',
        ttlHours: '24',
        pageTitle: '',
        pageDescription: '',
        ogImageUrl: '',
        brandName: 'WP MONITOR',
        accentColor: '#25d366',
        backgroundColor: '#0b1020',
        panelColor: '#151b31',
        textColor: '#eef4ff',
        layout: 'classic' as 'classic' | 'hero' | 'compact',
        requestGps: true,
        caseLabel: 'Caso',
        operatorLabel: 'Operador',
        checkInLabel: 'Etiqueta',
        expiresLabel: 'Vence',
        consentText: DEFAULT_CONSENT_GPS,
        submitButtonText: 'Aceptar y enviar check-in',
        successMessage: 'Check-in recibido. Hash de evidencia:',
        redirectUrl: '',
    });
    const [form, setForm] = useState({
        caseId: '',
        operatorName: '',
        authorizationNote: '',
        label: '',
        targetName: '',
        targetJid: '',
        ttlHours: '24',
        pageTitle: 'Check-in autorizado',
        pageDescription: 'Verificacion autorizada de identidad tecnica y ubicacion opcional.',
        ogImageUrl: '',
        brandName: 'WP MONITOR',
        accentColor: '#25d366',
        backgroundColor: '#0b1020',
        panelColor: '#151b31',
        textColor: '#eef4ff',
        layout: 'classic' as 'classic' | 'hero' | 'compact',
        requestGps: true,
        caseLabel: 'Caso',
        operatorLabel: 'Operador',
        checkInLabel: 'Etiqueta',
        expiresLabel: 'Vence',
        consentText: DEFAULT_CONSENT_GPS,
        submitButtonText: 'Aceptar y enviar check-in',
        successMessage: 'Check-in recibido. Hash de evidencia:',
        redirectUrl: '',
    });

    const uploadImage = async (file: File): Promise<string> => {
        if (file.size > 2 * 1024 * 1024) throw new Error('La imagen debe pesar maximo 2MB');
        const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
            reader.readAsDataURL(file);
        });
        const res = await authFetch(`${API_URL}/api/checkins/assets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataUrl }),
        });
        const data = await readJson(res);
        if (!res.ok) throw new Error(data.details?.join(', ') || data.error || `HTTP ${res.status}`);
        return data.url;
    };

    const handleImageUpload = async (file: File | null, mode: 'create' | 'edit') => {
        if (!file) return;
        setError(null);
        setUploadingImage(true);
        try {
            const url = await uploadImage(file);
            if (mode === 'create') setForm(prev => ({ ...prev, ogImageUrl: url }));
            else setEditForm(prev => ({ ...prev, ogImageUrl: url }));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo subir la imagen');
        } finally {
            setUploadingImage(false);
        }
    };

    const fetchCases = useCallback(async () => {
        try {
            const res = await authFetch(`${API_URL}/api/cases?limit=100`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await readJson(res);
            const activeCases = Array.isArray(data)
                ? data.filter((item: CaseRecord) => item.status !== 'closed' && item.status !== 'archived')
                : [];
            setCases(activeCases);
            setForm(prev => {
                if (prev.caseId || activeCases.length === 0) return prev;
                const first = activeCases[0] as CaseRecord;
                return {
                    ...prev,
                    caseId: first.caseId,
                    operatorName: first.primaryOperator,
                    authorizationNote: first.authorizationNote,
                };
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudieron cargar casos');
        }
    }, []);

    const fetchItems = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await authFetch(`${API_URL}/api/checkins?limit=50`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await readJson(res);
            setItems(Array.isArray(data) ? data : []);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudieron cargar check-ins');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchCases();
        fetchItems();
    }, [fetchCases, fetchItems]);

    useEffect(() => {
        const refresh = (event?: { action?: string; timestamp?: string }) => {
            setLastRealtimeUpdate(event?.timestamp || new Date().toISOString());
            fetchItems();
        };

        socket.on('checkins-changed', refresh);
        const interval = window.setInterval(() => fetchItems(), 5000);

        return () => {
            socket.off('checkins-changed', refresh);
            window.clearInterval(interval);
        };
    }, [fetchItems]);

    const selectCase = (caseId: string) => {
        const selected = cases.find(item => item.caseId === caseId);
        setForm(prev => ({
            ...prev,
            caseId,
            operatorName: selected?.primaryOperator || prev.operatorName,
            authorizationNote: selected?.authorizationNote || prev.authorizationNote,
        }));
    };

    const createCheckIn = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!form.caseId.trim() || !form.operatorName.trim() || !form.authorizationNote.trim()) return;
        setError(null);
        setCreatedUrl('');
        setCopied(false);

        try {
            const res = await authFetch(`${API_URL}/api/checkins`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    caseId: form.caseId.trim(),
                    operatorName: form.operatorName.trim(),
                    authorizationNote: form.authorizationNote.trim(),
                    label: form.label.trim() || `Check-in ${form.caseId.trim()}`,
                    targetName: form.targetName.trim() || null,
                    targetJid: form.targetJid.trim() || null,
                    ttlHours: Number(form.ttlHours) || 24,
                    pageTitle: form.pageTitle.trim(),
                    pageDescription: form.pageDescription.trim(),
                    ogImageUrl: form.ogImageUrl.trim() || null,
                    brandName: form.brandName.trim(),
                    accentColor: form.accentColor,
                    backgroundColor: form.backgroundColor,
                    panelColor: form.panelColor,
                    textColor: form.textColor,
                    layout: form.layout,
                    requestGps: form.requestGps,
                    caseLabel: form.caseLabel.trim(),
                    operatorLabel: form.operatorLabel.trim(),
                    checkInLabel: form.checkInLabel.trim(),
                    expiresLabel: form.expiresLabel.trim(),
                    consentText: form.consentText.trim() || null,
                    submitButtonText: form.submitButtonText.trim(),
                    successMessage: form.successMessage.trim(),
                    redirectUrl: form.redirectUrl.trim() || null,
                }),
            });
            const data = await readJson(res);
            if (!res.ok) throw new Error(data.details?.join(', ') || data.error || `HTTP ${res.status}`);
            setCreatedUrl(data.url);
            setForm(prev => ({ ...prev, label: '', targetName: '', targetJid: '' }));
            await fetchItems();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo crear el check-in');
        }
    };

    const copyUrl = async () => {
        if (!createdUrl) return;
        await navigator.clipboard.writeText(createdUrl);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
    };

    const startEdit = (item: CheckInItem) => {
        setEditingToken(item.token);
        setEditForm({
            label: item.label,
            targetName: item.targetName || '',
            ttlHours: '24',
            pageTitle: item.content?.pageTitle || 'Check-in autorizado',
            pageDescription: item.content?.pageDescription || '',
            ogImageUrl: item.content?.ogImageUrl || '',
            brandName: item.content?.brandName || 'WP MONITOR',
            accentColor: item.content?.accentColor || '#25d366',
            backgroundColor: item.content?.backgroundColor || '#0b1020',
            panelColor: item.content?.panelColor || '#151b31',
            textColor: item.content?.textColor || '#eef4ff',
            layout: item.content?.layout || 'classic',
            requestGps: item.content?.requestGps !== false,
            caseLabel: item.content?.caseLabel || 'Caso',
            operatorLabel: item.content?.operatorLabel || 'Operador',
            checkInLabel: item.content?.checkInLabel || 'Etiqueta',
            expiresLabel: item.content?.expiresLabel || 'Vence',
            consentText: item.content?.consentText || (item.content?.requestGps === false ? DEFAULT_CONSENT_NO_GPS : DEFAULT_CONSENT_GPS),
            submitButtonText: item.content?.submitButtonText || 'Aceptar y enviar check-in',
            successMessage: item.content?.successMessage || 'Check-in recibido. Hash de evidencia:',
            redirectUrl: item.content?.redirectUrl || '',
        });
    };

    const updateItem = async (token: string) => {
        setError(null);
        try {
            const res = await authFetch(`${API_URL}/api/checkins/${encodeURIComponent(token)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    label: editForm.label.trim(),
                    targetName: editForm.targetName.trim() || null,
                    ttlHours: Number(editForm.ttlHours) || 24,
                    pageTitle: editForm.pageTitle.trim(),
                    pageDescription: editForm.pageDescription.trim(),
                    ogImageUrl: editForm.ogImageUrl.trim() || null,
                    brandName: editForm.brandName.trim(),
                    accentColor: editForm.accentColor,
                    backgroundColor: editForm.backgroundColor,
                    panelColor: editForm.panelColor,
                    textColor: editForm.textColor,
                    layout: editForm.layout,
                    requestGps: editForm.requestGps,
                    caseLabel: editForm.caseLabel.trim(),
                    operatorLabel: editForm.operatorLabel.trim(),
                    checkInLabel: editForm.checkInLabel.trim(),
                    expiresLabel: editForm.expiresLabel.trim(),
                    consentText: editForm.consentText.trim() || null,
                    submitButtonText: editForm.submitButtonText.trim(),
                    successMessage: editForm.successMessage.trim(),
                    redirectUrl: editForm.redirectUrl.trim() || null,
                }),
            });
            const data = await readJson(res);
            if (!res.ok) throw new Error(data.details?.join(', ') || data.error || `HTTP ${res.status}`);
            setEditingToken(null);
            await fetchItems();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo actualizar el check-in');
        }
    };

    const revokeItem = async (item: CheckInItem) => {
        setError(null);
        try {
            const res = await authFetch(`${API_URL}/api/checkins/${encodeURIComponent(item.token)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'revoke' }),
            });
            const data = await readJson(res);
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            await fetchItems();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo revocar el check-in');
        }
    };

    const deleteItem = async (item: CheckInItem) => {
        setError(null);
        try {
            const res = await authFetch(`${API_URL}/api/checkins/${encodeURIComponent(item.token)}`, {
                method: 'DELETE',
            });
            const data = await readJson(res);
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            await fetchItems();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo eliminar el check-in');
        }
    };

    return (
        <div className="space-y-4">
            <div className="card p-5">
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 rounded-xl bg-accent-muted text-accent">
                        <ShieldCheck size={18} />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-txt-primary">Authorized Check-In</h3>
                        <p className="text-xs text-txt-dim">Genera enlaces con consentimiento explicito, IP observada, GPS opcional y hash de evidencia.</p>
                    </div>
                </div>

                <form onSubmit={createCheckIn} className="space-y-3">
                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_96px] gap-2">
                        {caseMode === 'existing' ? (
                            <select value={form.caseId} onChange={event => selectCase(event.target.value)} className="select-field">
                                <option value="">Seleccionar caso</option>
                                {cases.map(item => (
                                    <option key={item.caseId} value={item.caseId}>
                                        {item.caseId} - {item.title || item.status}
                                    </option>
                                ))}
                            </select>
                        ) : (
                            <input value={form.caseId} onChange={event => setForm({ ...form, caseId: event.target.value })} placeholder="Nuevo Case ID" className="input-field" />
                        )}
                        <button
                            onClick={() => setCaseMode(caseMode === 'existing' ? 'new' : 'existing')}
                            className="btn-secondary !px-3 !py-2 !text-xs"
                            type="button"
                        >
                            {caseMode === 'existing' ? 'Nuevo' : 'Lista'}
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[180px_minmax(220px,1fr)_92px] gap-3">
                        <input value={form.operatorName} onChange={event => setForm({ ...form, operatorName: event.target.value })} placeholder="Operador" className="input-field" readOnly={caseMode === 'existing' && !!form.caseId} />
                        <input value={form.authorizationNote} onChange={event => setForm({ ...form, authorizationNote: event.target.value })} placeholder="Autorizacion / motivo" className="input-field" />
                        <input value={form.ttlHours} onChange={event => setForm({ ...form, ttlHours: event.target.value })} placeholder="TTL" className="input-field" type="number" min="1" max="168" />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[minmax(190px,1fr)_minmax(240px,1fr)_minmax(210px,1fr)_128px] gap-3">
                        <input value={form.label} onChange={event => setForm({ ...form, label: event.target.value })} placeholder="Etiqueta" className="input-field" />
                        <input value={form.targetName} onChange={event => setForm({ ...form, targetName: event.target.value })} placeholder="Nombre objetivo autorizado" className="input-field" />
                        <input value={form.targetJid} onChange={event => setForm({ ...form, targetJid: event.target.value })} placeholder="JID WhatsApp opcional" className="input-field" />
                        <button disabled={!form.caseId.trim() || !form.operatorName.trim() || !form.authorizationNote.trim()} className="btn-primary flex items-center justify-center gap-2 min-h-[42px]" type="submit">
                            <Plus size={16} />
                            Crear
                        </button>
                    </div>

                    <div className="rounded-lg border border-surface-border bg-surface-hover/40 p-4 space-y-3">
                        <FormSectionTitle title="Preview publico" subtitle="Contenido que vera el destinatario y las apps al compartir el enlace." />
                        <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(220px,1fr)_minmax(220px,1fr)] gap-3">
                            <label className="btn-secondary flex items-center justify-center gap-2 cursor-pointer min-h-[42px]">
                                <Plus size={15} />
                                {uploadingImage ? 'Subiendo...' : 'Imagen preview'}
                                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={event => handleImageUpload(event.target.files?.[0] || null, 'create')} />
                            </label>
                            <input value={form.pageTitle} onChange={event => setForm({ ...form, pageTitle: event.target.value })} placeholder="Titulo publico" className="input-field" />
                            <input value={form.pageDescription} onChange={event => setForm({ ...form, pageDescription: event.target.value })} placeholder="Descripcion publica" className="input-field" />
                            {form.ogImageUrl && (
                                <input value={form.ogImageUrl} onChange={event => setForm({ ...form, ogImageUrl: event.target.value })} className="input-field lg:col-span-3 font-mono text-xs" placeholder="URL imagen Open Graph" />
                            )}
                        </div>
                    </div>

                    <div className="rounded-lg border border-surface-border bg-surface-hover/40 p-4 space-y-3">
                        <FormSectionTitle title="Identidad visual" subtitle="Apariencia comercial de la landing autorizada." />
                        <div className="grid grid-cols-1 lg:grid-cols-[minmax(220px,1fr)_180px] gap-3">
                            <input value={form.brandName} onChange={event => setForm({ ...form, brandName: event.target.value })} placeholder="Marca / autor visible" className="input-field" />
                            <select value={form.layout} onChange={event => setForm({ ...form, layout: event.target.value as typeof form.layout })} className="select-field">
                                <option value="classic">Classic</option>
                                <option value="hero">Hero imagen</option>
                                <option value="compact">Compact</option>
                            </select>
                        </div>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            <ColorInput label="Acento" value={form.accentColor} onChange={value => setForm({ ...form, accentColor: value })} />
                            <ColorInput label="Fondo" value={form.backgroundColor} onChange={value => setForm({ ...form, backgroundColor: value })} />
                            <ColorInput label="Panel" value={form.panelColor} onChange={value => setForm({ ...form, panelColor: value })} />
                            <ColorInput label="Texto" value={form.textColor} onChange={value => setForm({ ...form, textColor: value })} />
                        </div>
                    </div>

                    <div className="rounded-lg border border-surface-border bg-surface-hover/40 p-4 space-y-3">
                        <FormSectionTitle title="Campos publicos" subtitle="Etiquetas visibles dentro de la pagina de autorizacion." />
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                            <input value={form.caseLabel} onChange={event => setForm({ ...form, caseLabel: event.target.value })} placeholder="Label Caso" className="input-field" />
                            <input value={form.operatorLabel} onChange={event => setForm({ ...form, operatorLabel: event.target.value })} placeholder="Label Operador" className="input-field" />
                            <input value={form.checkInLabel} onChange={event => setForm({ ...form, checkInLabel: event.target.value })} placeholder="Label Etiqueta" className="input-field" />
                            <input value={form.expiresLabel} onChange={event => setForm({ ...form, expiresLabel: event.target.value })} placeholder="Label Vence" className="input-field" />
                        </div>
                    </div>

                    <div className="rounded-lg border border-surface-border bg-surface-hover/40 p-4 space-y-3">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <FormSectionTitle title="Consentimiento" subtitle="Texto legal visible, boton final y redireccion opcional." />
                            <label className="flex items-center gap-2 text-sm text-txt-secondary">
                                <input type="checkbox" checked={form.requestGps} onChange={event => setForm(prev => updateGpsConsent(prev, event.target.checked))} className="accent-accent" />
                                Solicitar GPS
                            </label>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                            <label className="block">
                                <span className="block text-xs text-txt-dim mb-1">Texto del checkbox</span>
                                <textarea value={form.consentText} onChange={event => setForm({ ...form, consentText: event.target.value })} placeholder="Texto que vera el usuario junto al checkbox" className="input-field min-h-[118px] resize-y" />
                            </label>
                            <div className="grid grid-cols-1 gap-3">
                                <input value={form.submitButtonText} onChange={event => setForm({ ...form, submitButtonText: event.target.value })} placeholder="Texto boton enviar" className="input-field" />
                                <input value={form.successMessage} onChange={event => setForm({ ...form, successMessage: event.target.value })} placeholder="Mensaje al completar" className="input-field" />
                                <input value={form.redirectUrl} onChange={event => setForm({ ...form, redirectUrl: event.target.value })} placeholder="URL destino despues de enviar (opcional)" className="input-field" />
                            </div>
                        </div>
                    </div>
                </form>

                {createdUrl && (
                    <div className="mt-4 flex flex-col lg:flex-row gap-2">
                        <input value={createdUrl} readOnly className="input-field flex-1 font-mono text-xs" />
                        <button onClick={copyUrl} className="btn-secondary flex items-center justify-center gap-2" type="button">
                            {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
                            {copied ? 'Copiado' : 'Copiar'}
                        </button>
                        <a href={createdUrl} target="_blank" rel="noreferrer" className="btn-primary flex items-center justify-center gap-2">
                            <ExternalLink size={16} />
                            Abrir
                        </a>
                    </div>
                )}
            </div>

            <div className="card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-txt-secondary">
                    <MapPin size={16} className="text-txt-dim" />
                    <span>{loading ? 'Cargando check-ins...' : `${items.length} check-ins recientes`}</span>
                    <span className="text-xs text-success">
                        {lastRealtimeUpdate ? `Actualizado ${formatTime(lastRealtimeUpdate)}` : 'Tiempo real activo'}
                    </span>
                </div>
                <button onClick={fetchItems} className="btn-secondary flex items-center gap-2" type="button">
                    <RefreshCw size={15} />
                    Refrescar
                </button>
            </div>

            {error && (
                <div className="card p-5 border-danger/30 text-danger text-sm">
                    Error: {error}
                </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {items.map(item => {
                    const gpsMapsUrl = item.location?.permission === 'granted' && typeof item.location.lat === 'number' && typeof item.location.lon === 'number'
                        ? `https://www.google.com/maps?q=${item.location.lat},${item.location.lon}`
                        : null;
                    const ipMapsUrl = item.ipEnrichment?.mapsUrl || (
                        typeof item.ipEnrichment?.lat === 'number' && typeof item.ipEnrichment?.lon === 'number'
                            ? `https://www.google.com/maps?q=${item.ipEnrichment.lat},${item.ipEnrichment.lon}`
                            : null
                    );

                    return (
                        <div key={item.token} className="card p-5 space-y-4">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <h4 className="text-sm font-semibold text-txt-primary truncate">{item.label}</h4>
                                        <span className={STATUS_CLASS[item.status]}>{item.status}</span>
                                    </div>
                                    <p className="text-xs font-mono text-txt-dim">{item.caseId}</p>
                                </div>
                                <a href={item.url} target="_blank" rel="noreferrer" className="btn-secondary !py-1.5 !px-3 !text-xs flex items-center gap-1.5">
                                    <ExternalLink size={12} />
                                    Link
                                </a>
                            </div>

                            {editingToken === item.token ? (
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                                    <input value={editForm.label} onChange={event => setEditForm({ ...editForm, label: event.target.value })} className="input-field !text-xs md:col-span-2" placeholder="Etiqueta" />
                                    <input value={editForm.targetName} onChange={event => setEditForm({ ...editForm, targetName: event.target.value })} className="input-field !text-xs" placeholder="Nombre objetivo" />
                                    <input value={editForm.ttlHours} onChange={event => setEditForm({ ...editForm, ttlHours: event.target.value })} className="input-field !text-xs" type="number" min="1" max="168" placeholder="TTL horas" />
                                    <input value={editForm.pageTitle} onChange={event => setEditForm({ ...editForm, pageTitle: event.target.value })} className="input-field !text-xs md:col-span-2" placeholder="Titulo preview" />
                                    <input value={editForm.pageDescription} onChange={event => setEditForm({ ...editForm, pageDescription: event.target.value })} className="input-field !text-xs md:col-span-2" placeholder="Descripcion preview" />
                                    <input value={editForm.brandName} onChange={event => setEditForm({ ...editForm, brandName: event.target.value })} className="input-field !text-xs md:col-span-2" placeholder="Marca / autor" />
                                    <select value={editForm.layout} onChange={event => setEditForm({ ...editForm, layout: event.target.value as typeof editForm.layout })} className="select-field !text-xs md:col-span-2">
                                        <option value="classic">Classic</option>
                                        <option value="hero">Hero imagen</option>
                                        <option value="compact">Compact</option>
                                    </select>
                                    <ColorInput label="Acento" value={editForm.accentColor} onChange={value => setEditForm({ ...editForm, accentColor: value })} compact />
                                    <ColorInput label="Fondo" value={editForm.backgroundColor} onChange={value => setEditForm({ ...editForm, backgroundColor: value })} compact />
                                    <ColorInput label="Panel" value={editForm.panelColor} onChange={value => setEditForm({ ...editForm, panelColor: value })} compact />
                                    <ColorInput label="Texto" value={editForm.textColor} onChange={value => setEditForm({ ...editForm, textColor: value })} compact />
                                    <input value={editForm.caseLabel} onChange={event => setEditForm({ ...editForm, caseLabel: event.target.value })} className="input-field !text-xs" placeholder="Label Caso" />
                                    <input value={editForm.operatorLabel} onChange={event => setEditForm({ ...editForm, operatorLabel: event.target.value })} className="input-field !text-xs" placeholder="Label Operador" />
                                    <input value={editForm.checkInLabel} onChange={event => setEditForm({ ...editForm, checkInLabel: event.target.value })} className="input-field !text-xs" placeholder="Label Etiqueta" />
                                    <input value={editForm.expiresLabel} onChange={event => setEditForm({ ...editForm, expiresLabel: event.target.value })} className="input-field !text-xs" placeholder="Label Vence" />
                                    <label className="block md:col-span-4">
                                        <span className="block text-[11px] text-txt-dim mb-1">Texto editable del checkbox de consentimiento</span>
                                        <textarea value={editForm.consentText} onChange={event => setEditForm({ ...editForm, consentText: event.target.value })} className="input-field !text-xs min-h-[90px]" placeholder="Texto que vera el usuario junto al checkbox" />
                                    </label>
                                    <input value={editForm.submitButtonText} onChange={event => setEditForm({ ...editForm, submitButtonText: event.target.value })} className="input-field !text-xs md:col-span-2" placeholder="Texto boton enviar" />
                                    <input value={editForm.successMessage} onChange={event => setEditForm({ ...editForm, successMessage: event.target.value })} className="input-field !text-xs md:col-span-2" placeholder="Mensaje al completar" />
                                    <input value={editForm.redirectUrl} onChange={event => setEditForm({ ...editForm, redirectUrl: event.target.value })} className="input-field !text-xs md:col-span-4 font-mono" placeholder="URL destino despues de enviar" />
                                    <label className="flex items-center gap-2 text-xs text-txt-secondary md:col-span-2">
                                        <input type="checkbox" checked={editForm.requestGps} onChange={event => setEditForm(prev => updateGpsConsent(prev, event.target.checked))} className="accent-accent" />
                                        Solicitar GPS
                                    </label>
                                    <label className="btn-secondary !py-1.5 !px-3 !text-xs flex items-center justify-center gap-1.5 cursor-pointer">
                                        <Plus size={12} />
                                        Imagen
                                        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={event => handleImageUpload(event.target.files?.[0] || null, 'edit')} />
                                    </label>
                                    {editForm.ogImageUrl && <input value={editForm.ogImageUrl} onChange={event => setEditForm({ ...editForm, ogImageUrl: event.target.value })} className="input-field !text-xs md:col-span-4 font-mono" placeholder="URL imagen preview" />}
                                    <button onClick={() => updateItem(item.token)} className="btn-primary !py-1.5 !px-3 !text-xs flex items-center justify-center gap-1.5" type="button">
                                        <Save size={12} />
                                        Guardar
                                    </button>
                                    <button onClick={() => setEditingToken(null)} className="btn-secondary !py-1.5 !px-3 !text-xs flex items-center justify-center gap-1.5" type="button">
                                        <XCircle size={12} />
                                        Cancelar
                                    </button>
                                </div>
                            ) : (
                                <div className="flex flex-wrap gap-2">
                                    <button disabled={item.status !== 'pending'} onClick={() => startEdit(item)} className="btn-secondary !py-1.5 !px-3 !text-xs flex items-center gap-1.5 disabled:opacity-40" type="button">
                                        <Pencil size={12} />
                                        Editar
                                    </button>
                                    <button disabled={item.status === 'completed' || item.status === 'revoked'} onClick={() => revokeItem(item)} className="btn-secondary !py-1.5 !px-3 !text-xs flex items-center gap-1.5 disabled:opacity-40" type="button">
                                        <XCircle size={12} />
                                        Revocar
                                    </button>
                                    <button onClick={() => deleteItem(item)} className="btn-ghost !py-1.5 !px-3 !text-xs flex items-center gap-1.5" type="button">
                                        <Trash2 size={12} />
                                        Eliminar
                                    </button>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <Field label="Target" value={item.targetName || item.targetJid || '-'} />
                                <Field label="Creado" value={formatDate(item.createdAt)} />
                                <Field label="Completado" value={item.completedAt ? formatDate(item.completedAt) : '-'} />
                                <Field label="Vence" value={item.expiresAt ? formatDate(item.expiresAt) : '-'} />
                                <Field label="IP observada" value={item.request?.ip || '-'} mono />
                                <Field label="ISP/Org" value={item.ipEnrichment?.isp || item.ipEnrichment?.org || '-'} />
                                <Field label="Geo IP" value={[item.ipEnrichment?.city, item.ipEnrichment?.regionName, item.ipEnrichment?.country].filter(Boolean).join(', ') || '-'} />
                                <Field label="GPS permiso" value={item.location?.permission || '-'} />
                                <Field label="Dispositivo" value={formatDevice(item)} />
                                <Field label="Sistema" value={item.browser?.device?.os || item.browser?.userAgentData?.platform || item.browser?.platform || '-'} />
                                <Field label="Navegador" value={item.browser?.device?.browser || formatBrands(item.browser?.userAgentData?.brands) || '-'} />
                                <Field label="Pantalla" value={formatScreen(item)} />
                                <Field label="Red navegador" value={formatNetwork(item)} />
                                <Field label="Idioma / TZ" value={[item.browser?.language, item.browser?.timezone].filter(Boolean).join(' / ') || '-'} />
                                <Field label="Referer" value={item.request?.referer || '-'} />
                                <Field label="Consistencia" value={formatConsistency(item)} />
                                <Field label="Preview" value={item.content?.pageTitle || '-'} />
                                <Field label="Plantilla" value={formatLayout(item.content?.layout)} />
                                <Field label="Marca publica" value={item.content?.brandName || 'WP MONITOR'} />
                                <Field label="GPS landing" value={item.content?.requestGps === false ? 'No solicitado' : 'Solicitado'} />
                            </div>

                            {item.consistency && (
                                <div className="rounded-xl border border-border bg-bg-panel/60 p-3 space-y-2">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                            <div className="text-xs uppercase tracking-[0.14em] text-txt-dim">Analisis de consistencia</div>
                                            <div className="text-sm text-txt-primary">{item.consistency.summary}</div>
                                        </div>
                                        <span className={consistencyClass(item.consistency.level)}>
                                            {item.consistency.score}/100 · {item.consistency.level}
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                        {item.consistency.signals.slice(0, 8).map((signal, index) => (
                                            <div key={`${signal.label}-${index}`} className={`rounded-lg border px-3 py-2 text-xs ${signalClass(signal.severity)}`}>
                                                <div className="font-semibold">{signal.label}</div>
                                                <div className="opacity-85 mt-0.5">{signal.detail}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="flex flex-wrap gap-2">
                                {gpsMapsUrl && (
                                    <a className="btn-primary !py-1.5 !px-3 !text-xs flex items-center gap-1.5" href={gpsMapsUrl} target="_blank" rel="noreferrer">
                                        <MapPin size={12} />
                                        GPS Maps
                                    </a>
                                )}
                                {ipMapsUrl && (
                                    <a className="btn-secondary !py-1.5 !px-3 !text-xs flex items-center gap-1.5" href={ipMapsUrl} target="_blank" rel="noreferrer">
                                        <MapPin size={12} />
                                        IP Maps
                                    </a>
                                )}
                            </div>

                            {item.hash && (
                                <p className="text-[11px] text-txt-dim font-mono break-all">SHA-256: {item.hash}</p>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="min-w-0">
            <div className="text-xs text-txt-dim mb-1">{label}</div>
            <div className={`text-txt-primary truncate ${mono ? 'font-mono' : ''}`}>{value}</div>
        </div>
    );
}

function ColorInput({ label, value, onChange, compact = false }: { label: string; value: string; onChange: (value: string) => void; compact?: boolean }) {
    return (
        <label className={`input-field flex items-center gap-3 min-w-0 ${compact ? '!text-xs !py-1.5' : ''}`}>
            <span className="text-xs text-txt-dim whitespace-nowrap">{label}</span>
            <input type="color" value={value} onChange={event => onChange(event.target.value)} className="h-7 w-10 shrink-0 bg-transparent border-0 p-0 cursor-pointer" />
            <span className="font-mono text-xs truncate min-w-0">{value}</span>
        </label>
    );
}

function FormSectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
    return (
        <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-txt-secondary">{title}</h4>
            <p className="mt-1 text-[11px] text-txt-dim">{subtitle}</p>
        </div>
    );
}

function updateGpsConsent<T extends { requestGps: boolean; consentText: string }>(state: T, requestGps: boolean): T {
    const previousDefault = state.requestGps ? DEFAULT_CONSENT_GPS : DEFAULT_CONSENT_NO_GPS;
    const nextDefault = requestGps ? DEFAULT_CONSENT_GPS : DEFAULT_CONSENT_NO_GPS;
    const consentText = !state.consentText.trim() || state.consentText === previousDefault
        ? nextDefault
        : state.consentText;
    return { ...state, requestGps, consentText };
}

function formatDate(value: string): string {
    return new Date(value).toLocaleString('es-CO', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function formatTime(value: string): string {
    return new Date(value).toLocaleTimeString('es-CO', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

function formatLayout(value?: 'classic' | 'hero' | 'compact'): string {
    if (value === 'hero') return 'Hero imagen';
    if (value === 'compact') return 'Compact';
    return 'Classic';
}

function formatDevice(item: CheckInItem): string {
    const device = item.browser?.device;
    if (!device) return '-';
    const touch = device.isTouch ? 'touch' : 'no touch';
    const cpu = device.hardwareConcurrency ? `${device.hardwareConcurrency} CPU` : '';
    const memory = device.deviceMemoryGb ? `${device.deviceMemoryGb}GB RAM aprox` : '';
    return [device.type || 'unknown', touch, cpu, memory].filter(Boolean).join(' · ');
}

function formatScreen(item: CheckInItem): string {
    const screen = item.browser?.screen;
    const viewport = item.browser?.viewport;
    if (!screen && !viewport) return '-';
    const screenText = screen ? `${screen.width}x${screen.height}@${screen.pixelRatio || 1}` : '';
    const viewportText = viewport ? `viewport ${viewport.width}x${viewport.height}` : '';
    return [screenText, viewportText, screen?.orientation].filter(Boolean).join(' · ');
}

function formatNetwork(item: CheckInItem): string {
    const network = item.browser?.network;
    if (!network) return '-';
    const parts = [
        network.online === undefined ? null : network.online ? 'online' : 'offline',
        network.effectiveType,
        network.downlink ? `${network.downlink} Mbps` : null,
        network.rtt ? `${network.rtt} ms` : null,
        network.saveData ? 'save-data' : null,
    ];
    return parts.filter(Boolean).join(' · ') || '-';
}

function formatConsistency(item: CheckInItem): string {
    return item.consistency ? `${item.consistency.score}/100 · ${item.consistency.level}` : '-';
}

function consistencyClass(level: 'high' | 'medium' | 'low'): string {
    if (level === 'high') return 'badge-success';
    if (level === 'medium') return 'badge-warning';
    return 'badge-danger';
}

function signalClass(severity: 'ok' | 'info' | 'warning' | 'danger'): string {
    if (severity === 'ok') return 'border-success/25 bg-success/10 text-success';
    if (severity === 'warning') return 'border-warning/25 bg-warning/10 text-warning';
    if (severity === 'danger') return 'border-danger/25 bg-danger/10 text-danger';
    return 'border-border bg-bg-muted/30 text-txt-secondary';
}

function formatBrands(brands?: Array<{ brand?: string; version?: string }>): string {
    if (!brands?.length) return '';
    return brands
        .filter(item => item.brand)
        .map(item => item.version ? `${item.brand} ${item.version}` : item.brand)
        .join(', ');
}

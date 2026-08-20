import { useEffect, useState, useCallback } from 'react';
import { Eye, EyeOff, Plus, Trash2, Zap, Settings, History, RotateCcw, User } from 'lucide-react';
import type { ConnectionState } from '../App';
import { ContactCard } from './ContactCard';
import { Login } from './Login';
import { API_URL, authFetch } from '../auth';
import { selectPrimaryTrackerDevice, type TrackerDeviceInfo } from '../types';
import { socket } from '../socket';

type ProbeMethod = 'delete' | 'reaction';

interface DashboardProps {
    connectionState: ConnectionState;
}

interface SavedContact {
    jid: string;
    number: string;
    contactName: string;
    customName: string | null;
    pushName: string | null;
    profilePic: string | null;
    about: string | null;
    isBusinessAccount: boolean;
    addedAt: string;
    lastSeen: string;
    isActive: boolean;
}

interface TrackerData {
    rtt: number;
    avg: number;
    median: number;
    threshold: number;
    state: string;
    timestamp: number;
}

interface HistoricalTrackerMeasurement {
    rtt?: number;
    avg?: number;
    median?: number;
    threshold?: number;
    state?: string;
    timestamp: string | number;
}

interface TrackerUpdateEvent {
    jid: string;
    sampleKind: 'initial' | 'probe';
    devices: TrackerDeviceInfo[];
    deviceCount: number;
    presence: string | null;
    connectionType: 'wifi' | 'cellular' | 'unknown' | null;
    median: number;
    threshold: number;
}

interface LiveState {
    jid: string;
    state: string;
    label: string;
    source: 'presence' | 'call' | 'message' | 'rtt_probe' | 'system';
    confidence: 'none' | 'low' | 'medium' | 'high';
    lastSignalAt: string | null;
    explanation?: string;
}

interface ContactInfo {
    jid: string;
    displayNumber: string;
    contactName: string;
    customName: string | null;
    pushName: string | null;
    data: TrackerData[];
    devices: TrackerDeviceInfo[];
    deviceCount: number;
    presence: string | null;
    profilePic: string | null;
    connectionType?: 'wifi' | 'cellular' | 'unknown' | undefined;
    typingState?: 'composing' | 'recording' | null | undefined;
    liveState?: LiveState | null | undefined;
    deviceAlerts?: { deviceJid: string; totalDevices: number; timestamp: number }[] | undefined;
}

export function Dashboard({ connectionState }: DashboardProps) {
    const [inputNumber, setInputNumber] = useState('');
    const [inputAlias, setInputAlias] = useState('');
    const [caseId, setCaseId] = useState('');
    const [operatorName, setOperatorName] = useState('');
    const [authorizationNote, setAuthorizationNote] = useState('');
    const [contacts, setContacts] = useState<Map<string, ContactInfo>>(new Map());
    const [error, setError] = useState<string | null>(null);
    const [privacyMode, setPrivacyMode] = useState(false);
    const [probeMethod, setProbeMethod] = useState<ProbeMethod>('delete');
    const [showConnections, setShowConnections] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [savedContacts, setSavedContacts] = useState<SavedContact[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);

    const mergeSavedContacts = useCallback((data: SavedContact[]) => {
        setContacts(prev => {
            const next = new Map(prev);
            data
                .filter(contact => contact.isActive)
                .forEach(contact => {
                    const existing = next.get(contact.jid);
                    next.set(contact.jid, {
                        jid: contact.jid,
                        displayNumber: contact.number,
                        contactName: contact.contactName || contact.number,
                        customName: contact.customName || null,
                        pushName: contact.pushName || null,
                        data: existing?.data || [],
                        devices: existing?.devices || [],
                        deviceCount: existing?.deviceCount || 0,
                        presence: existing?.presence || null,
                        profilePic: contact.profilePic || existing?.profilePic || null,
                        connectionType: existing?.connectionType,
                        typingState: existing?.typingState,
                        liveState: existing?.liveState,
                        deviceAlerts: existing?.deviceAlerts,
                    });
                });
            return next;
        });
    }, []);

    const fetchActiveContacts = useCallback(() => {
        authFetch(`${API_URL}/api/contacts`)
            .then(r => r.json())
            .then((data: SavedContact[]) => mergeSavedContacts(data))
            .catch((err) => {
                console.error('Failed to fetch active contacts:', err);
            });
    }, [mergeSavedContacts]);

    const fetchHistory = useCallback(() => {
        authFetch(`${API_URL}/api/contacts/history`)
            .then(r => r.json())
            .then((data: SavedContact[]) => {
                setSavedContacts(data);
                setHistoryLoading(false);
            })
            .catch((err) => {
                console.error('Failed to fetch contact history:', err);
                setHistoryLoading(false);
            });
    }, []);

    useEffect(() => {
        fetchActiveContacts();
    }, [fetchActiveContacts]);

    useEffect(() => {
        function onTrackerUpdate(update: TrackerUpdateEvent) {
            const { jid, ...data } = update;
            if (!jid) return;

            setContacts(prev => {
                const next = new Map(prev);
                const contact = next.get(jid);

                if (contact) {
                    const updatedContact = { ...contact };

                    if (data.presence !== undefined) {
                        updatedContact.presence = data.presence;
                    }
                    if (data.deviceCount !== undefined) {
                        updatedContact.deviceCount = data.deviceCount;
                    }
                    if (data.devices !== undefined) {
                        updatedContact.devices = data.devices;
                    }
                    if (data.connectionType !== null) {
                        updatedContact.connectionType = data.connectionType;
                    }

                    if (data.median !== undefined && data.devices && data.devices.length > 0) {
                        const primaryDevice = selectPrimaryTrackerDevice(data.devices)!;
                        const newDataPoint: TrackerData = {
                            rtt: primaryDevice.rtt,
                            avg: primaryDevice.avg,
                            median: data.median,
                            threshold: data.threshold,
                            state: primaryDevice.state,
                            timestamp: Date.now(),
                        };
                        updatedContact.data = [...updatedContact.data, newDataPoint];
                    }

                    next.set(jid, updatedContact);
                }

                return next;
            });
        }

        function onProfilePic(data: { jid: string, url: string | null }) {
            setContacts(prev => {
                const next = new Map(prev);
                const contact = next.get(data.jid);
                if (contact) {
                    next.set(data.jid, { ...contact, profilePic: data.url });
                }
                return next;
            });
        }

        function onContactName(data: { jid: string, name: string }) {
            setContacts(prev => {
                const next = new Map(prev);
                const contact = next.get(data.jid);
                if (contact) {
                    next.set(data.jid, { ...contact, contactName: data.name });
                }
                return next;
            });
        }

        function onContactAdded(data: { jid: string, number: string, customName?: string | null, pushName?: string | null }) {
            setContacts(prev => {
                const next = new Map(prev);
                next.set(data.jid, {
                    jid: data.jid,
                    displayNumber: data.number,
                    contactName: data.number,
                    customName: data.customName || null,
                    pushName: data.pushName || null,
                    data: [],
                    devices: [],
                    deviceCount: 0,
                    presence: null,
                    profilePic: null,
                    liveState: null
                });
                return next;
            });
            setInputNumber('');
            setInputAlias('');
        }

        function onContactRemoved(jid: string) {
            setContacts(prev => {
                const next = new Map(prev);
                next.delete(jid);
                return next;
            });
        }

        function onError(data: { jid?: string, message: string }) {
            setError(data.message);
            setTimeout(() => setError(null), 3000);
        }

        function onProbeMethod(method: ProbeMethod) {
            setProbeMethod(method);
        }

        function onTrackedContacts(trackedJids: string[]) {
            setContacts(prev => {
                const next = new Map(prev);
                trackedJids.forEach((id) => {
                    if (!next.has(id)) {
                        const displayNumber = id.split('@')[0] ?? id;
                        next.set(id, {
                            jid: id,
                            displayNumber,
                            contactName: displayNumber,
                            customName: null,
                            pushName: null,
                            data: [],
                            devices: [],
                            deviceCount: 0,
                            presence: null,
                            profilePic: null,
                            liveState: null
                        });
                    }
                });
                return next;
            });

            // Load historical RTT data from MongoDB for each contact
            trackedJids.forEach((id) => {
                authFetch(`${API_URL}/api/history/${encodeURIComponent(id)}?limit=200`)
                    .then(r => r.json())
                    .then((history: HistoricalTrackerMeasurement[]) => {
                        if (history.length === 0) return;
                        const historicalData: TrackerData[] = history.map((measurement) => ({
                            rtt: measurement.rtt ?? 0,
                            avg: measurement.avg ?? 0,
                            median: measurement.median ?? 0,
                            threshold: measurement.threshold ?? 0,
                            state: measurement.state ?? 'Unknown',
                            timestamp: new Date(measurement.timestamp).getTime(),
                        }));
                        setContacts(prev => {
                            const next = new Map(prev);
                            const contact = next.get(id);
                            if (contact) {
                                next.set(id, { ...contact, data: [...historicalData, ...contact.data] });
                            }
                            return next;
                        });
                    })
                    .catch(() => {});
            });
        }

        function onCustomNameUpdated(data: { jid: string; customName: string | null }) {
            setContacts(prev => {
                const next = new Map(prev);
                const contact = next.get(data.jid);
                if (contact) {
                    next.set(data.jid, { ...contact, customName: data.customName });
                }
                return next;
            });
        }

        function onContactProfileUpdate(data: { jid: string; pushName?: string; about?: string }) {
            setContacts(prev => {
                const next = new Map(prev);
                const contact = next.get(data.jid);
                if (contact) {
                    const updated = { ...contact };
                    if (data.pushName !== undefined) updated.pushName = data.pushName;
                    next.set(data.jid, updated);
                }
                return next;
            });
        }

        function onPresenceChange(data: { jid: string; presence: string; timestamp: number }) {
            setContacts(prev => {
                const next = new Map(prev);
                const contact = next.get(data.jid);
                if (contact) {
                    const typing = (data.presence === 'composing' || data.presence === 'recording')
                        ? data.presence as 'composing' | 'recording'
                        : null;
                    next.set(data.jid, {
                        ...contact,
                        typingState: typing,
                        presence: data.presence === 'expired' ? null : data.presence,
                    });
                }
                return next;
            });
        }

        function onContactLiveState(data: LiveState) {
            setContacts(prev => {
                const next = new Map(prev);
                const contact = next.get(data.jid);
                if (contact) {
                    const typing = data.state === 'composing'
                        ? 'composing'
                        : data.state === 'recording'
                            ? 'recording'
                            : null;
                    const presence = data.source === 'presence'
                        ? (data.state === 'unknown' ? null : data.state)
                        : (typing ? contact.presence : contact.presence === 'composing' || contact.presence === 'recording' ? null : contact.presence);
                    next.set(data.jid, {
                        ...contact,
                        liveState: data,
                        typingState: typing,
                        presence,
                    });
                }
                return next;
            });
        }

        function onMessageActivity(data: { jid: string; direction: string; messageType: string; timestamp: string }) {
            setContacts(prev => {
                const next = new Map(prev);
                const contact = next.get(data.jid);
                if (contact) {
                    next.set(data.jid, {
                        ...contact,
                        liveState: {
                            jid: data.jid,
                            state: data.direction,
                            label: data.direction === 'outgoing'
                                ? `Mensaje enviado (${data.messageType})`
                                : `Mensaje recibido (${data.messageType})`,
                            source: 'message',
                            confidence: 'high',
                            lastSignalAt: data.timestamp,
                        },
                    });
                }
                return next;
            });
        }

        function onDeviceAlert(data: { deviceJid: string; targetJid: string; totalDevices: number; timestamp: number }) {
            setContacts(prev => {
                const next = new Map(prev);
                const contact = next.get(data.targetJid);
                if (contact) {
                    const alerts = [...(contact.deviceAlerts || []), { deviceJid: data.deviceJid, totalDevices: data.totalDevices, timestamp: data.timestamp }];
                    next.set(data.targetJid, { ...contact, deviceAlerts: alerts });
                }
                return next;
            });
        }

        socket.on('tracker-update', onTrackerUpdate);
        socket.on('profile-pic', onProfilePic);
        socket.on('contact-name', onContactName);
        socket.on('contact-added', onContactAdded);
        socket.on('contact-removed', onContactRemoved);
        socket.on('error', onError);
        socket.on('probe-method', onProbeMethod);
        socket.on('tracked-contacts', onTrackedContacts);
        socket.on('custom-name-updated', onCustomNameUpdated);
        socket.on('contact-profile-update', onContactProfileUpdate);
        socket.on('presence-change', onPresenceChange);
        socket.on('contact-live-state', onContactLiveState);
        socket.on('message-activity', onMessageActivity);
        socket.on('device-alert', onDeviceAlert);

        socket.emit('get-tracked-contacts');

        return () => {
            socket.off('tracker-update', onTrackerUpdate);
            socket.off('profile-pic', onProfilePic);
            socket.off('contact-name', onContactName);
            socket.off('contact-added', onContactAdded);
            socket.off('contact-removed', onContactRemoved);
            socket.off('error', onError);
            socket.off('probe-method', onProbeMethod);
            socket.off('tracked-contacts', onTrackedContacts);
            socket.off('custom-name-updated', onCustomNameUpdated);
            socket.off('contact-profile-update', onContactProfileUpdate);
            socket.off('presence-change', onPresenceChange);
            socket.off('contact-live-state', onContactLiveState);
            socket.off('message-activity', onMessageActivity);
            socket.off('device-alert', onDeviceAlert);
        };
    }, []);

    const handleAdd = () => {
        if (!inputNumber) return;
        if (!caseId.trim() || !operatorName.trim() || !authorizationNote.trim()) {
            setError('Case ID, operador y autorizacion son requeridos antes de trackear');
            setTimeout(() => setError(null), 3000);
            return;
        }
        socket.emit('add-contact', {
            number: inputNumber,
            customName: inputAlias || undefined,
            caseId: caseId.trim(),
            operatorName: operatorName.trim(),
            authorizationNote: authorizationNote.trim(),
        });
    };

    const handleRemove = (jid: string) => {
        socket.emit('remove-contact', { jid, stopReason: 'Stopped from dashboard' });
    };

    const handleReactivate = (jid: string) => {
        if (!caseId.trim() || !operatorName.trim() || !authorizationNote.trim()) {
            setError('Case ID, operador y autorizacion son requeridos para reactivar');
            setTimeout(() => setError(null), 3000);
            return;
        }
        socket.emit('reactivate-contact', {
            jid,
            caseId: caseId.trim(),
            operatorName: operatorName.trim(),
            authorizationNote: authorizationNote.trim(),
        });
    };

    const handleProbeMethodChange = (method: ProbeMethod) => {
        socket.emit('set-probe-method', method);
    };

    const refreshHistory = () => {
        setHistoryLoading(true);
        fetchHistory();
    };

    const toggleHistory = () => {
        const nextVisible = !showHistory;
        setShowHistory(nextVisible);
        if (nextVisible) refreshHistory();
    };

    return (
        <div className="space-y-6">
            {/* ── Control Panel ─────────────────────── */}
            <div className="card p-5">
                <div className="flex flex-wrap justify-between items-center gap-4 mb-4">
                    <div className="flex items-center gap-3">
                        <h2 className="text-lg font-semibold text-txt-primary">Track Contacts</h2>
                        <button
                            onClick={() => setShowConnections(!showConnections)}
                            className={`btn-ghost flex items-center gap-1.5 !py-1.5 !px-3 !text-xs ${
                                showConnections ? '!bg-accent/15 !text-accent !border-accent/25' : ''
                            }`}
                        >
                            <Settings size={13} />
                            {showConnections ? 'Hide' : 'Connections'}
                        </button>
                        <button
                            onClick={toggleHistory}
                            className={`btn-ghost flex items-center gap-1.5 !py-1.5 !px-3 !text-xs ${
                                showHistory ? '!bg-accent/15 !text-accent !border-accent/25' : ''
                            }`}
                        >
                            <History size={13} />
                            {showHistory ? 'Hide' : 'History'}
                        </button>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Probe Method */}
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-txt-muted">Probe:</span>
                            <div className="flex rounded-xl overflow-hidden border border-surface-border">
                                <button
                                    onClick={() => handleProbeMethodChange('delete')}
                                    className={`px-3 py-1.5 text-xs font-medium transition-all duration-200 flex items-center gap-1.5 ${
                                        probeMethod === 'delete'
                                            ? 'bg-accent/15 text-accent border border-accent/25'
                                            : 'bg-surface-overlay text-txt-muted hover:text-txt-primary'
                                    }`}
                                >
                                    <Trash2 size={12} /> Delete
                                </button>
                                <button
                                    onClick={() => handleProbeMethodChange('reaction')}
                                    className={`px-3 py-1.5 text-xs font-medium transition-all duration-200 flex items-center gap-1.5 ${
                                        probeMethod === 'reaction'
                                            ? 'bg-warning text-surface'
                                            : 'bg-surface-overlay text-txt-muted hover:text-txt-primary'
                                    }`}
                                >
                                    <Zap size={12} /> Reaction
                                </button>
                            </div>
                        </div>

                        {/* Privacy Toggle */}
                        <button
                            onClick={() => setPrivacyMode(!privacyMode)}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium transition-all duration-200 border ${
                                privacyMode
                                    ? 'bg-success/15 text-success border-success/25 glow-success'
                                    : 'bg-surface-overlay text-txt-muted border-surface-border hover:text-txt-primary'
                            }`}
                        >
                            {privacyMode ? <EyeOff size={14} /> : <Eye size={14} />}
                            Privacy {privacyMode ? 'ON' : 'OFF'}
                        </button>
                    </div>
                </div>

                {/* Input row */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                    <input
                        type="text"
                        placeholder="Case ID"
                        className="input-field"
                        value={caseId}
                        onChange={(e) => setCaseId(e.target.value)}
                    />
                    <input
                        type="text"
                        placeholder="Operador"
                        className="input-field"
                        value={operatorName}
                        onChange={(e) => setOperatorName(e.target.value)}
                    />
                    <input
                        type="text"
                        placeholder="Autorizacion / motivo"
                        className="input-field"
                        value={authorizationNote}
                        onChange={(e) => setAuthorizationNote(e.target.value)}
                    />
                </div>
                <div className="flex gap-3">
                    <input
                        type="text"
                        placeholder="Phone number with country code"
                        className="input-field flex-1"
                        value={inputNumber}
                        onChange={(e) => setInputNumber(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleAdd()}
                    />
                    <input
                        type="text"
                        placeholder="Alias (optional)"
                        className="input-field w-44"
                        value={inputAlias}
                        onChange={(e) => setInputAlias(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleAdd()}
                    />
                    <button
                        onClick={handleAdd}
                        disabled={!inputNumber.trim() || !caseId.trim() || !operatorName.trim() || !authorizationNote.trim()}
                        className="btn-primary flex items-center gap-2 disabled:opacity-40"
                    >
                        <Plus size={18} /> Add
                    </button>
                </div>

                {error && (
                    <p className="mt-3 text-danger text-sm flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-danger" />
                        {error}
                    </p>
                )}
            </div>

            {/* Connections Panel */}
            {showConnections && (
                <Login connectionState={connectionState} />
            )}

            {/* ── Contact History Panel ────────────── */}
            {showHistory && (
                <div className="card p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-semibold text-txt-primary flex items-center gap-2">
                            <History size={16} className="text-accent" />
                            Contact History
                            <span className="badge-neutral !text-[10px]">{savedContacts.length}</span>
                        </h3>
                        <button onClick={refreshHistory} className="btn-ghost !text-xs !py-1 !px-2.5 flex items-center gap-1">
                            <RotateCcw size={12} /> Refresh
                        </button>
                    </div>

                    {historyLoading ? (
                        <div className="text-center py-4">
                            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                            <p className="text-xs text-txt-muted">Loading history...</p>
                        </div>
                    ) : savedContacts.length === 0 ? (
                        <p className="text-xs text-txt-dim text-center py-4">No contacts in history</p>
                    ) : (
                        <div className="space-y-2 max-h-[300px] overflow-y-auto">
                            {savedContacts.map(sc => {
                                const isCurrentlyTracked = contacts.has(sc.jid);
                                const timeAgo = (() => {
                                    if (!sc.lastSeen) return '';
                                    const diff = Date.now() - new Date(sc.lastSeen).getTime();
                                    const mins = Math.floor(diff / 60000);
                                    if (mins < 60) return `${mins}m ago`;
                                    const hrs = Math.floor(mins / 60);
                                    if (hrs < 24) return `${hrs}h ago`;
                                    return `${Math.floor(hrs / 24)}d ago`;
                                })();
                                const profilePicSrc = sc.profilePic
                                    ? `${API_URL}/api/contact/${encodeURIComponent(sc.jid)}/profile-picture?cache=${encodeURIComponent(sc.profilePic)}`
                                    : null;

                                return (
                                    <div
                                        key={sc.jid}
                                        className={`flex items-center justify-between px-3 py-2.5 rounded-xl border transition-colors ${
                                            isCurrentlyTracked
                                                ? 'bg-success/5 border-success/20'
                                                : 'bg-surface-overlay border-surface-border hover:border-accent/30'
                                        }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-lg overflow-hidden bg-surface-hover border border-surface-border flex-shrink-0">
                                                {profilePicSrc ? (
                                                    <img src={profilePicSrc} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-txt-dim">
                                                        <User size={14} />
                                                    </div>
                                                )}
                                            </div>
                                            <div>
                                                <p className="text-xs font-medium text-txt-primary">
                                                    {sc.customName || sc.pushName || sc.contactName || sc.number}
                                                    {sc.isBusinessAccount && (
                                                        <span className="ml-1.5 text-[9px] text-accent">● Business</span>
                                                    )}
                                                </p>
                                                <p className="text-[10px] text-txt-dim">
                                                    +{sc.number} · Last seen {timeAgo}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            {isCurrentlyTracked ? (
                                                <span className="badge-success !text-[10px]">Active</span>
                                            ) : (
                                                <button
                                                    onClick={() => handleReactivate(sc.jid)}
                                                    className="btn-primary !text-[10px] !py-1 !px-2.5 flex items-center gap-1"
                                                >
                                                    <RotateCcw size={10} /> Track
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* ── Contact Cards ────────────────────── */}
            {contacts.size === 0 ? (
                <div className="empty-state">
                    <div className="w-14 h-14 rounded-2xl bg-surface-overlay flex items-center justify-center mx-auto mb-4">
                        <Plus size={28} className="text-txt-dim" />
                    </div>
                    <p className="text-txt-secondary text-lg font-medium">No contacts being tracked</p>
                    <p className="text-txt-dim text-sm mt-2">Add a contact above to start tracking</p>
                </div>
            ) : (
                <div className="space-y-6">
                    {Array.from(contacts.values()).map(contact => (
                        <ContactCard
                            key={contact.jid}
                            jid={contact.jid}
                            displayNumber={contact.displayNumber}
                            customName={contact.customName}
                            pushName={contact.pushName}
                            data={contact.data}
                            devices={contact.devices}
                            deviceCount={contact.deviceCount}
                            presence={contact.presence}
                            profilePic={contact.profilePic}
                            connectionType={contact.connectionType}
                            typingState={contact.typingState}
                            liveState={contact.liveState}
                            deviceAlerts={contact.deviceAlerts}
                            onRemove={() => handleRemove(contact.jid)}
                            privacyMode={privacyMode}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

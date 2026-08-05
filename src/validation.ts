import type express from 'express';
import type { CaseStatus } from './db.js';

export interface ValidationResult<T> {
    ok: boolean;
    value?: T;
    errors?: string[];
}

export function cleanText(value: unknown, maxLength = 500): string {
    if (typeof value !== 'string') return '';
    return value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

export function validateRequiredText(value: unknown, field: string, maxLength = 500): ValidationResult<string> {
    const text = cleanText(value, maxLength);
    if (!text) return { ok: false, errors: [`${field} is required`] };
    return { ok: true, value: text };
}

export function validateCaseId(value: unknown): ValidationResult<string> {
    const text = cleanText(value, 80).toUpperCase();
    if (!text) return { ok: false, errors: ['caseId is required'] };
    if (!/^[A-Z0-9][A-Z0-9._:-]{2,79}$/.test(text)) {
        return { ok: false, errors: ['caseId must be 3-80 chars using letters, numbers, dot, underscore, colon, or dash'] };
    }
    return { ok: true, value: text };
}

export function validateJid(value: unknown, field = 'jid'): ValidationResult<string> {
    const text = cleanText(value, 120);
    if (!text) return { ok: false, errors: [`${field} is required`] };
    if (!/^[0-9A-Za-z_.:-]+@(s\.whatsapp\.net|g\.us)$/.test(text)) {
        return { ok: false, errors: [`${field} must be a valid WhatsApp JID`] };
    }
    return { ok: true, value: text };
}

export function normalizeOptionalJid(value: unknown, fallback = 'manual'): ValidationResult<string> {
    if (value === undefined || value === null || value === '') return { ok: true, value: fallback };
    return validateJid(value, 'targetJid');
}

export function parseLimit(value: unknown, fallback: number, max: number): number {
    const parsed = typeof value === 'string' ? parseInt(value, 10) : Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(Math.floor(parsed), max);
}

export function validationError(res: express.Response, errors: string[]): void {
    res.status(400).json({ error: 'Validation failed', details: errors });
}

export function socketValidationError(socket: any, errors: string[]): void {
    socket.emit('error', { message: 'Validation failed', details: errors });
}

export const CASE_STATUSES: CaseStatus[] = ['draft', 'authorized', 'active', 'closed', 'archived'];

export function parseCaseStatus(value: unknown): CaseStatus | null {
    return typeof value === 'string' && CASE_STATUSES.includes(value as CaseStatus)
        ? value as CaseStatus
        : null;
}

export function parseTags(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((tag): tag is string => typeof tag === 'string')
        .map(tag => cleanText(tag, 40))
        .filter(Boolean)
        .slice(0, 20);
}

export function collectErrors(...results: Array<ValidationResult<unknown>>): string[] {
    return results.flatMap(result => result.ok ? [] : result.errors || []);
}

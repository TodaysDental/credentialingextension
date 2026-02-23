// API Configuration for TodaysDental Credentialing Extension
// Aligned with TodaysDentalInsightsFrontend authentication flow

export const API_CONFIG = {
    // Base URL for the credentialing API (matches frontend)
    BASE_URL: 'https://apig.todaysdentalinsights.com/credentialing',

    // Auth URL for login/refresh (matches frontend)
    AUTH_URL: 'https://apig.todaysdentalinsights.com/auth',

    // Endpoints
    ENDPOINTS: {
        // Auth endpoints
        LOGIN: '/login',
        REFRESH: '/refresh',
        LOGOUT: '/logout',

        // Autofill payload endpoint
        AUTOFILL_PAYLOAD: '/autofill/payload',
        // Documents endpoint  
        AUTOFILL_DOCUMENTS: '/autofill/documents',
        // Audit logging endpoint
        AUTOFILL_AUDIT: '/autofill/audit',
        // Portal adapters
        PORTAL_ADAPTERS: '/autofill/portals',
        // Payer requirements
        PAYER_REQUIREMENTS: '/autofill/requirements',
        // Schema metadata
        SCHEMA: '/autofill/schema',
        // Email packet generation
        EMAIL_PACKET: '/autofill/email-packet',
        // Provider list
        PROVIDERS: '/providers',
        // Dashboard
        DASHBOARD: '/dashboard',
    },

    // Request timeout in milliseconds
    TIMEOUT: 30000,

    // Presigned URL expiry check (URLs expire after 1 hour)
    URL_EXPIRY_BUFFER_MS: 5 * 60 * 1000, // 5 minutes buffer
};

// Storage keys - aligned with frontend (accessToken instead of authToken)
export const STORAGE_KEYS = {
    ACCESS_TOKEN: 'accessToken',      // Changed from authToken to match frontend
    REFRESH_TOKEN: 'refreshToken',
    TOKEN_EXPIRES_AT: 'tokenExpiresAt',
    AUTH_USER: 'authUser',
    USER_EMAIL: 'userEmail',
    SELECTED_PROVIDER: 'selectedProvider',
    SELECTED_CLINIC_ID: 'selectedClinicId',
    CACHED_SCHEMA: 'cachedSchema',
    CACHED_ADAPTERS: 'cachedAdapters',
    AUTOFILL_SETTINGS: 'autofillSettings',
    RECENT_PROVIDERS: 'recentProviders',
};

// Default autofill settings
export const DEFAULT_SETTINGS = {
    autoDetectPortal: true,
    showConfidenceIndicators: true,
    highlightFilledFields: true,
    autoScrollToEmpty: true,
    logAuditEvents: true,
    maskSensitiveData: true,
    confirmBeforeFill: true,
    showDocumentUploadHelper: true,
    theme: 'light', // 'light' | 'dark' | 'system'
};

// Confidence thresholds
export const CONFIDENCE = {
    HIGH: 0.9,
    MEDIUM: 0.7,
    LOW: 0.5,
};

// Field types that require masking
export const SENSITIVE_FIELDS = [
    'ssn',
    'taxId',
    'dateOfBirth',
    'malpracticePolicyNumber',
];

// Normalize stored string values (handles JSON-encoded values from Jotai)
export function normalizeStoredString(value) {
    if (value == null) return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return null;

    // Handle JSON-encoded primitives produced by JSON.stringify (e.g. '"token"' or 'null')
    try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === 'string') return parsed;
        if (parsed === null) return null;
    } catch {
        // Not JSON - fall through
    }

    // Fallback: strip wrapping quotes if present
    if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
        return trimmed.slice(1, -1);
    }

    return trimmed;
}

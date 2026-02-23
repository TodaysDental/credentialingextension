// Service Worker for TodaysDental Credentialing Extension
// Handles API communication, authentication, and cross-tab coordination
// Aligned with TodaysDentalInsightsFrontend authentication flow

import { API_CONFIG, STORAGE_KEYS, DEFAULT_SETTINGS, normalizeStoredString } from '../config/api-config.js';
import { PORTAL_ADAPTERS, findAdapterByHostname, findAdapterByUrl } from '../config/portal-adapters.js';

// ============================================
// STATE MANAGEMENT
// ============================================

let accessToken = null;
let refreshToken = null;
let tokenExpiresAt = null;
let isRefreshing = false;
let cachedPayloads = new Map(); // providerId -> { payload, timestamp }
let portalAdapters = new Map(); // portalId -> adapter
let localAdaptersLoaded = false;

// ============================================
// INITIALIZATION
// ============================================

chrome.runtime.onInstalled.addListener(async (details) => {
    console.log('[Credentialing Extension] Installed:', details.reason);

    // Set default settings on first install
    if (details.reason === 'install') {
        await chrome.storage.local.set({
            [STORAGE_KEYS.AUTOFILL_SETTINGS]: DEFAULT_SETTINGS,
        });
    }

    // Load cached auth tokens
    await loadStoredTokens();

    // Pre-fetch portal adapters
    fetchPortalAdapters();
});

// Load tokens from storage on startup
async function loadStoredTokens() {
    const stored = await chrome.storage.local.get([
        STORAGE_KEYS.ACCESS_TOKEN,
        STORAGE_KEYS.REFRESH_TOKEN,
        STORAGE_KEYS.TOKEN_EXPIRES_AT,
    ]);

    if (stored[STORAGE_KEYS.ACCESS_TOKEN]) {
        accessToken = normalizeStoredString(stored[STORAGE_KEYS.ACCESS_TOKEN]);
    }
    if (stored[STORAGE_KEYS.REFRESH_TOKEN]) {
        refreshToken = normalizeStoredString(stored[STORAGE_KEYS.REFRESH_TOKEN]);
    }
    if (stored[STORAGE_KEYS.TOKEN_EXPIRES_AT]) {
        tokenExpiresAt = parseInt(stored[STORAGE_KEYS.TOKEN_EXPIRES_AT], 10);
    }

    console.log('[Service Worker] Loaded stored tokens:', accessToken ? 'Found' : 'None');
}

// ============================================
// MESSAGE HANDLERS
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender).then(sendResponse).catch((error) => {
        console.error('[Service Worker] Message handler error:', error);
        sendResponse({ success: false, error: error.message });
    });
    return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
    const { action, payload } = message;

    switch (action) {
        // Authentication (OTP Flow)
        case 'REQUEST_OTP':
            return handleRequestOtp(payload);
        case 'VERIFY_OTP':
            return handleVerifyOtp(payload);
        case 'LOGIN':
            return handleLogin(payload);
        case 'SET_AUTH_TOKEN':
            return handleSetAuthToken(payload);
        case 'GET_AUTH_STATUS':
            return handleGetAuthStatus();
        case 'LOGOUT':
            return handleLogout();
        case 'REFRESH_TOKEN':
            return handleRefreshToken();

        // Autofill operations
        case 'GET_AUTOFILL_PAYLOAD':
            return handleGetAutofillPayload(payload);
        case 'GET_DOCUMENTS':
            return handleGetDocuments(payload);
        case 'LOG_AUDIT_EVENT':
            return handleLogAuditEvent(payload, sender);

        // PDF proxy fetch (bypasses CORS - service worker has no CORS restrictions)
        case 'FETCH_PDF':
            return handleFetchPdf(payload);

        // Portal detection
        case 'DETECT_PORTAL':
            return handleDetectPortal(payload);
        case 'GET_PORTAL_ADAPTER':
            return handleGetPortalAdapter(payload);

        // Provider management
        case 'GET_PROVIDERS':
            return handleGetProviders(payload);
        case 'GET_PROVIDER_BY_ID':
            return handleGetProviderById(payload);

        // Schema & requirements
        case 'GET_SCHEMA':
            return handleGetSchema();
        case 'GET_PAYER_REQUIREMENTS':
            return handleGetPayerRequirements(payload);

        // Settings
        case 'GET_SETTINGS':
            return handleGetSettings();
        case 'UPDATE_SETTINGS':
            return handleUpdateSettings(payload);

        default:
            throw new Error(`Unknown action: ${action}`);
    }
}

// ============================================
// AUTHENTICATION HANDLERS (OTP Flow)
// ============================================

/**
 * Request OTP - sends verification code to email
 * POST /auth/initiate
 */
async function handleRequestOtp(payload) {
    const { email } = payload;

    if (!email) {
        return { success: false, error: 'Email is required' };
    }

    try {
        console.log('[Service Worker] Requesting OTP for:', email);

        const response = await fetch(`${API_CONFIG.AUTH_URL}/initiate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email }),
        });

        const data = await response.json();

        if (!response.ok) {
            return {
                success: false,
                error: data.message || data.error || `Failed to send code: ${response.status}`
            };
        }

        console.log('[Service Worker] OTP sent successfully');

        return {
            success: true,
            message: data.message || 'Verification code sent to your email',
            email: data.email || email,
            expiresIn: data.expiresIn || 600, // 10 minutes default
        };
    } catch (error) {
        console.error('[Service Worker] Request OTP error:', error);
        return { success: false, error: error.message || 'Failed to send verification code' };
    }
}

/**
 * Verify OTP - validates code and returns tokens
 * POST /auth/verify
 */
async function handleVerifyOtp(payload) {
    const { email, code } = payload;

    if (!email || !code) {
        return { success: false, error: 'Email and code are required' };
    }

    try {
        console.log('[Service Worker] Verifying OTP for:', email);

        const response = await fetch(`${API_CONFIG.AUTH_URL}/verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, code }),
        });

        const data = await response.json();

        if (!response.ok) {
            return {
                success: false,
                error: data.message || data.error || `Verification failed: ${response.status}`
            };
        }

        // Store tokens (matching frontend structure)
        const { accessToken: newAccessToken, refreshToken: newRefreshToken, expiresIn, user } = data;

        if (newAccessToken) {
            accessToken = newAccessToken;
            refreshToken = newRefreshToken || null;
            tokenExpiresAt = expiresIn ? Date.now() + expiresIn * 1000 : null;

            await chrome.storage.local.set({
                [STORAGE_KEYS.ACCESS_TOKEN]: newAccessToken,
                [STORAGE_KEYS.REFRESH_TOKEN]: newRefreshToken || '',
                [STORAGE_KEYS.TOKEN_EXPIRES_AT]: tokenExpiresAt ? String(tokenExpiresAt) : '',
                [STORAGE_KEYS.USER_EMAIL]: user?.email || email,
                [STORAGE_KEYS.AUTH_USER]: user ? JSON.stringify(user) : '',
            });

            console.log('[Service Worker] OTP verified, tokens stored');

            // Refresh portal adapters with new auth
            fetchPortalAdapters();

            return {
                success: true,
                user: user || { email },
                message: 'Login successful'
            };
        }

        return { success: false, error: 'No access token received' };
    } catch (error) {
        console.error('[Service Worker] Verify OTP error:', error);
        return { success: false, error: error.message || 'Verification failed' };
    }
}

// Legacy login handler (password-based, kept for compatibility)
async function handleLogin(payload) {
    const { email, password } = payload;

    if (!email || !password) {
        return { success: false, error: 'Email and password are required' };
    }

    try {
        const response = await fetch(`${API_CONFIG.AUTH_URL}${API_CONFIG.ENDPOINTS.LOGIN}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, password }),
        });

        const data = await response.json();

        if (!response.ok) {
            return {
                success: false,
                error: data.message || data.error || `Login failed: ${response.status}`
            };
        }

        // Store tokens (matching frontend structure)
        const { accessToken: newAccessToken, refreshToken: newRefreshToken, expiresIn, user } = data;

        if (newAccessToken) {
            accessToken = newAccessToken;
            refreshToken = newRefreshToken || null;
            tokenExpiresAt = expiresIn ? Date.now() + expiresIn * 1000 : null;

            await chrome.storage.local.set({
                [STORAGE_KEYS.ACCESS_TOKEN]: newAccessToken,
                [STORAGE_KEYS.REFRESH_TOKEN]: newRefreshToken || '',
                [STORAGE_KEYS.TOKEN_EXPIRES_AT]: tokenExpiresAt ? String(tokenExpiresAt) : '',
                [STORAGE_KEYS.USER_EMAIL]: user?.email || email,
                [STORAGE_KEYS.AUTH_USER]: user ? JSON.stringify(user) : '',
            });

            // Refresh portal adapters with new auth
            fetchPortalAdapters();

            return {
                success: true,
                user: user || { email },
                message: 'Login successful'
            };
        }

        return { success: false, error: 'No access token received' };
    } catch (error) {
        console.error('[Service Worker] Login error:', error);
        return { success: false, error: error.message || 'Login failed' };
    }
}

async function handleSetAuthToken(payload) {
    const { token, refreshToken: newRefreshToken, email, expiresIn, user } = payload;

    accessToken = normalizeStoredString(token) || token;
    refreshToken = normalizeStoredString(newRefreshToken) || newRefreshToken;
    tokenExpiresAt = expiresIn ? Date.now() + expiresIn * 1000 : null;

    await chrome.storage.local.set({
        [STORAGE_KEYS.ACCESS_TOKEN]: accessToken,
        [STORAGE_KEYS.REFRESH_TOKEN]: refreshToken || '',
        [STORAGE_KEYS.TOKEN_EXPIRES_AT]: tokenExpiresAt ? String(tokenExpiresAt) : '',
        [STORAGE_KEYS.USER_EMAIL]: user?.email || email || '',
        [STORAGE_KEYS.AUTH_USER]: user ? JSON.stringify(user) : '',
    });

    // Refresh portal adapters with new auth
    fetchPortalAdapters();

    return { success: true };
}

async function handleGetAuthStatus() {
    // Reload tokens from storage
    await loadStoredTokens();

    const stored = await chrome.storage.local.get([
        STORAGE_KEYS.ACCESS_TOKEN,
        STORAGE_KEYS.USER_EMAIL,
        STORAGE_KEYS.AUTH_USER,
    ]);

    const hasToken = !!normalizeStoredString(stored[STORAGE_KEYS.ACCESS_TOKEN]);

    let user = null;
    if (stored[STORAGE_KEYS.AUTH_USER]) {
        try {
            user = JSON.parse(stored[STORAGE_KEYS.AUTH_USER]);
        } catch {
            // Ignore parse errors
        }
    }

    return {
        success: true,
        isAuthenticated: hasToken,
        email: stored[STORAGE_KEYS.USER_EMAIL] || user?.email || null,
        user: user,
    };
}

async function handleRefreshToken() {
    if (isRefreshing) {
        // Wait for ongoing refresh to complete
        await new Promise(resolve => setTimeout(resolve, 1000));
        return { success: !!accessToken };
    }

    isRefreshing = true;

    try {
        // Get refresh token from storage
        const stored = await chrome.storage.local.get([STORAGE_KEYS.REFRESH_TOKEN]);
        const storedRefreshToken = normalizeStoredString(stored[STORAGE_KEYS.REFRESH_TOKEN]);

        if (!storedRefreshToken) {
            console.log('[Service Worker] No refresh token available');
            return { success: false, error: 'No refresh token' };
        }

        console.log('[Service Worker] Attempting token refresh...');

        const response = await fetch(`${API_CONFIG.AUTH_URL}${API_CONFIG.ENDPOINTS.REFRESH}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ refreshToken: storedRefreshToken }),
        });

        const data = await response.json();

        if (!response.ok) {
            // Refresh token expired - force logout
            if (response.status === 401 || response.status === 403) {
                console.log('[Service Worker] Refresh token expired, logging out');
                await handleLogout();
                return { success: false, error: 'Session expired', shouldLogout: true };
            }
            return { success: false, error: data.message || 'Token refresh failed' };
        }

        const { accessToken: newAccessToken, refreshToken: newRefreshToken, expiresIn, user } = data;

        if (newAccessToken) {
            accessToken = newAccessToken;
            if (newRefreshToken) {
                refreshToken = newRefreshToken;
            }
            tokenExpiresAt = expiresIn ? Date.now() + expiresIn * 1000 : null;

            await chrome.storage.local.set({
                [STORAGE_KEYS.ACCESS_TOKEN]: newAccessToken,
                ...(newRefreshToken && { [STORAGE_KEYS.REFRESH_TOKEN]: newRefreshToken }),
                ...(tokenExpiresAt && { [STORAGE_KEYS.TOKEN_EXPIRES_AT]: String(tokenExpiresAt) }),
                ...(user && { [STORAGE_KEYS.AUTH_USER]: JSON.stringify(user) }),
            });

            console.log('[Service Worker] Token refreshed successfully');
            return { success: true };
        }

        return { success: false, error: 'No access token in refresh response' };
    } catch (error) {
        console.error('[Service Worker] Token refresh error:', error);
        return { success: false, error: error.message };
    } finally {
        isRefreshing = false;
    }
}

async function handleLogout() {
    accessToken = null;
    refreshToken = null;
    tokenExpiresAt = null;
    cachedPayloads.clear();

    await chrome.storage.local.remove([
        STORAGE_KEYS.ACCESS_TOKEN,
        STORAGE_KEYS.REFRESH_TOKEN,
        STORAGE_KEYS.TOKEN_EXPIRES_AT,
        STORAGE_KEYS.USER_EMAIL,
        STORAGE_KEYS.AUTH_USER,
        STORAGE_KEYS.SELECTED_PROVIDER,
        STORAGE_KEYS.SELECTED_CLINIC_ID,
    ]);

    return { success: true };
}

// ============================================
// PDF PROXY FETCH (bypasses content-script CORS)
// ============================================

async function handleFetchPdf(payload) {
    const { url } = payload;
    if (!url) throw new Error('url is required');

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; TodaysDentalExtension/1.0)',
                'Accept': 'application/pdf,*/*',
            }
        });
        if (!response.ok) {
            return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
        }
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('pdf') && !url.toLowerCase().includes('.pdf')) {
            return { success: false, error: 'Response does not appear to be a PDF' };
        }
        const buffer = await response.arrayBuffer();
        // Convert to base64 so it can cross the message channel
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        const base64 = btoa(binary);
        console.log(`[Service Worker] Fetched PDF (${buffer.byteLength} bytes) from ${url}`);
        return { success: true, base64, contentType };
    } catch (err) {
        console.error('[Service Worker] FETCH_PDF error:', err);
        return { success: false, error: err.message };
    }
}

// ============================================
// AUTOFILL HANDLERS
// ============================================


async function handleGetAutofillPayload(payload) {
    const { providerId, portal, forceRefresh } = payload;

    if (!providerId) {
        throw new Error('providerId is required');
    }

    // Check cache (valid for 5 minutes)
    const cacheKey = `${providerId}:${portal || 'generic'}`;
    const cached = cachedPayloads.get(cacheKey);
    if (!forceRefresh && cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
        return { success: true, payload: cached.payload, fromCache: true };
    }

    // Fetch from API
    const params = new URLSearchParams({ providerId });
    if (portal) params.append('portal', portal);

    const response = await apiRequest(
        `${API_CONFIG.ENDPOINTS.AUTOFILL_PAYLOAD}?${params.toString()}`
    );

    if (response.success && response.payload) {
        cachedPayloads.set(cacheKey, {
            payload: response.payload,
            timestamp: Date.now(),
        });
    }

    return response;
}

async function handleGetDocuments(payload) {
    const { providerId, documentTypes } = payload;

    if (!providerId) {
        throw new Error('providerId is required');
    }

    const params = new URLSearchParams({ providerId });
    if (documentTypes) params.append('documentTypes', documentTypes.join(','));

    return apiRequest(
        `${API_CONFIG.ENDPOINTS.AUTOFILL_DOCUMENTS}?${params.toString()}`
    );
}

async function handleLogAuditEvent(payload, sender) {
    const { providerId, portal, action, fieldsChanged, documentsUploaded, confidence, submissionMode } = payload;

    return apiRequest(API_CONFIG.ENDPOINTS.AUTOFILL_AUDIT, 'POST', {
        providerId,
        portal,
        action,
        fieldsChanged: fieldsChanged || [],
        documentsUploaded: documentsUploaded || [],
        confidence: confidence || 0,
        submissionMode: submissionMode || 'PORTAL',
    });
}

// ============================================
// PORTAL DETECTION HANDLERS
// ============================================

async function handleDetectPortal(payload) {
    const { hostname, url, pageTitle } = payload;

    // Load local adapters if not already loaded
    if (!localAdaptersLoaded) {
        loadLocalAdapters();
    }

    // Check cached/loaded adapters first
    for (const [key, adapter] of portalAdapters) {
        // Check hostname match
        if (adapter.match.hostnames.some((h) => hostname.includes(h))) {
            return { success: true, detected: true, adapter };
        }

        // Check URL patterns
        if (adapter.match.urlPatterns?.some((pattern) => {
            try {
                return new RegExp(pattern, 'i').test(url);
            } catch {
                return url.includes(pattern);
            }
        })) {
            return { success: true, detected: true, adapter };
        }
    }

    // Try local adapters directly as final fallback
    const localAdapter = findAdapterByHostname(hostname) || findAdapterByUrl(url);
    if (localAdapter) {
        return { success: true, detected: true, adapter: localAdapter };
    }

    // No specific adapter found - use generic engine
    return {
        success: true,
        detected: false,
        adapter: {
            portalId: 'generic',
            portalName: 'Unknown Portal',
            tier: 0,
            match: { hostnames: [hostname], urlPatterns: [] },
            fieldMap: {},
        },
    };
}

async function handleGetPortalAdapter(payload) {
    const { portalId } = payload;

    // Check in-memory cache
    if (portalAdapters.has(portalId)) {
        return { success: true, adapter: portalAdapters.get(portalId) };
    }

    // Check local adapters
    if (PORTAL_ADAPTERS[portalId]) {
        return { success: true, adapter: PORTAL_ADAPTERS[portalId] };
    }

    // Fetch from API as last resort
    const response = await apiRequest(`${API_CONFIG.ENDPOINTS.PORTAL_ADAPTERS}/${portalId}`);
    if (response.success && response.adapter) {
        portalAdapters.set(portalId, response.adapter);
    }

    return response;
}

// Load local adapters into memory
function loadLocalAdapters() {
    for (const [portalId, adapter] of Object.entries(PORTAL_ADAPTERS)) {
        if (!portalAdapters.has(portalId)) {
            portalAdapters.set(portalId, adapter);
        }
    }
    localAdaptersLoaded = true;
    console.log(`[Service Worker] Loaded ${Object.keys(PORTAL_ADAPTERS).length} local portal adapters`);
}

async function fetchPortalAdapters() {
    // Always load local adapters first
    loadLocalAdapters();

    // Then try to fetch from API to get any updates or custom adapters
    try {
        const response = await apiRequest(API_CONFIG.ENDPOINTS.PORTAL_ADAPTERS);
        if (response.success && response.adapters) {
            // Merge API adapters with local (API takes precedence for same portalId)
            for (const adapter of response.adapters) {
                portalAdapters.set(adapter.portalId, adapter);
            }
            console.log(`[Service Worker] Merged ${response.adapters.length} API portal adapters`);
        }
    } catch (error) {
        console.warn('[Service Worker] Failed to fetch API portal adapters, using local only:', error);
    }
}

// ============================================
// PROVIDER HANDLERS
// ============================================

async function handleGetProviders(payload) {
    const { searchQuery, limit = 20, lastKey } = payload || {};

    const params = new URLSearchParams();
    if (searchQuery) params.append('search', searchQuery);
    if (limit) params.append('limit', String(limit));
    if (lastKey) params.append('lastKey', lastKey);

    return apiRequest(`${API_CONFIG.ENDPOINTS.PROVIDERS}?${params.toString()}`);
}

async function handleGetProviderById(payload) {
    const { providerId } = payload;

    if (!providerId) {
        throw new Error('providerId is required');
    }

    return apiRequest(`${API_CONFIG.ENDPOINTS.PROVIDERS}/${providerId}`);
}

// ============================================
// SCHEMA & REQUIREMENTS HANDLERS
// ============================================

async function handleGetSchema() {
    // Check cache
    const stored = await chrome.storage.local.get([STORAGE_KEYS.CACHED_SCHEMA]);
    const cached = stored[STORAGE_KEYS.CACHED_SCHEMA];

    if (cached && Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
        return { success: true, ...cached.data, fromCache: true };
    }

    // Fetch from API
    const response = await apiRequest(API_CONFIG.ENDPOINTS.SCHEMA);
    if (response.success) {
        await chrome.storage.local.set({
            [STORAGE_KEYS.CACHED_SCHEMA]: {
                data: response,
                timestamp: Date.now(),
            },
        });
    }

    return response;
}

async function handleGetPayerRequirements(payload) {
    const { payerId } = payload;

    if (payerId) {
        return apiRequest(`${API_CONFIG.ENDPOINTS.PAYER_REQUIREMENTS}/${payerId}`);
    }

    return apiRequest(API_CONFIG.ENDPOINTS.PAYER_REQUIREMENTS);
}

// ============================================
// SETTINGS HANDLERS
// ============================================

async function handleGetSettings() {
    const stored = await chrome.storage.local.get([STORAGE_KEYS.AUTOFILL_SETTINGS]);
    return {
        success: true,
        settings: stored[STORAGE_KEYS.AUTOFILL_SETTINGS] || DEFAULT_SETTINGS,
    };
}

async function handleUpdateSettings(payload) {
    const current = await handleGetSettings();
    const updated = { ...current.settings, ...payload };

    await chrome.storage.local.set({
        [STORAGE_KEYS.AUTOFILL_SETTINGS]: updated,
    });

    return { success: true, settings: updated };
}

// ============================================
// API REQUEST UTILITY (with token refresh)
// ============================================

async function apiRequest(endpoint, method = 'GET', body = null, retryCount = 0) {
    // Load tokens if not in memory
    if (!accessToken) {
        await loadStoredTokens();
    }

    if (!accessToken) {
        return { success: false, error: 'Not authenticated. Please log in.' };
    }

    // Check if token is about to expire (5 min buffer)
    if (tokenExpiresAt && Date.now() > tokenExpiresAt - 5 * 60 * 1000) {
        console.log('[Service Worker] Token expiring soon, refreshing...');
        const refreshResult = await handleRefreshToken();
        if (!refreshResult.success) {
            return { success: false, error: 'Session expired. Please log in again.' };
        }
    }

    const url = endpoint.startsWith('http') ? endpoint : `${API_CONFIG.BASE_URL}${endpoint}`;

    // Add clinic ID header if available
    const stored = await chrome.storage.local.get([STORAGE_KEYS.SELECTED_CLINIC_ID]);
    let clinicId = normalizeStoredString(stored[STORAGE_KEYS.SELECTED_CLINIC_ID]);

    const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
    };

    if (clinicId && clinicId !== 'all' && clinicId !== '') {
        headers['x-clinic-id'] = clinicId;
    }

    const options = {
        method,
        headers,
    };

    if (body && method !== 'GET') {
        options.body = JSON.stringify(body);
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT);

        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);

        const data = await response.json();

        if (!response.ok) {
            // Handle token expiry - try refresh once
            if (response.status === 401 && retryCount === 0) {
                console.log('[Service Worker] Got 401, attempting token refresh...');
                const refreshResult = await handleRefreshToken();
                if (refreshResult.success) {
                    // Retry the request with new token
                    return apiRequest(endpoint, method, body, retryCount + 1);
                } else if (refreshResult.shouldLogout) {
                    return { success: false, error: 'Session expired. Please log in again.' };
                }
            }
            return { success: false, error: data.message || `Request failed: ${response.status}` };
        }

        return data;
    } catch (error) {
        if (error.name === 'AbortError') {
            return { success: false, error: 'Request timeout' };
        }
        console.error('[Service Worker] API request error:', error);
        return { success: false, error: error.message };
    }
}

// ============================================
// BADGE UPDATE
// ============================================

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        try {
            const url = new URL(tab.url);
            const detected = await handleDetectPortal({
                hostname: url.hostname,
                url: tab.url,
                pageTitle: tab.title,
            });

            if (detected.detected) {
                // Show badge indicating portal detected
                await chrome.action.setBadgeText({ tabId, text: '✓' });
                await chrome.action.setBadgeBackgroundColor({ tabId, color: '#10B981' });
            } else {
                await chrome.action.setBadgeText({ tabId, text: '' });
            }
        } catch (error) {
            // Ignore errors for non-http URLs
        }
    }
});

console.log('[Service Worker] TodaysDental Credentialing Extension loaded');

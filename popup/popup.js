// Popup Script for TodaysDental Credentialing Extension
// OTP Authentication Flow (matching TodaysDentalInsightsFrontend)

import { STORAGE_KEYS } from '../config/api-config.js';

// ============================================
// DOM ELEMENTS
// ============================================
const elements = {
    loadingState: document.getElementById('loading-state'),
    loginState: document.getElementById('login-state'),
    otpState: document.getElementById('otp-state'),
    mainState: document.getElementById('main-state'),

    // Login form
    loginForm: document.getElementById('login-form'),
    emailInput: document.getElementById('email'),
    requestOtpBtn: document.getElementById('request-otp-btn'),

    // OTP form
    otpForm: document.getElementById('otp-form'),
    otpCodeInput: document.getElementById('otp-code'),
    verifyOtpBtn: document.getElementById('verify-otp-btn'),
    otpEmailDisplay: document.getElementById('otp-email-display'),
    resendOtpBtn: document.getElementById('resend-otp-btn'),
    changeEmailBtn: document.getElementById('change-email-btn'),
    otpTimer: document.getElementById('otp-timer'),

    // Main state
    userAvatar: document.getElementById('user-avatar'),
    userEmail: document.getElementById('user-email'),
    logoutBtn: document.getElementById('logout-btn'),
    providerSearch: document.getElementById('provider-search'),
    stateFilter: document.getElementById('clinic-filter'),
    stateSummary: document.getElementById('state-summary'),
    providerList: document.getElementById('provider-list'),
    selectedProvider: document.getElementById('selected-provider'),
    selectedName: document.getElementById('selected-name'),
    selectedNpi: document.getElementById('selected-npi'),
    selectedState: document.getElementById('selected-state'),
    clearProvider: document.getElementById('clear-provider'),
    portalName: document.getElementById('portal-name'),
    portalUrl: document.getElementById('portal-url'),
    triggerAutofill: document.getElementById('trigger-autofill'),
    rescanPage: document.getElementById('rescan-page'),
    openSettings: document.getElementById('open-settings'),
};

// ============================================
// STATE
// ============================================
let currentEmail = '';
let currentProvider = null;
let searchTimeout = null;
let otpExpiresAt = null;
let timerInterval = null;
let selectedClinicFilter = ''; // current clinic filter value
let lastProviderResults = []; // cache last search results for client-side filtering

// ============================================
// INITIALIZATION
// ============================================
async function initialize() {
    showState('loading');

    // Check auth status
    const authStatus = await sendMessage({ action: 'GET_AUTH_STATUS' });

    if (authStatus.isAuthenticated) {
        await loadMainState(authStatus.email || authStatus.user?.email);
        showState('main');
    } else {
        showState('login');
    }

    setupEventListeners();
}

function showState(state) {
    elements.loadingState.classList.toggle('hidden', state !== 'loading');
    elements.loginState.classList.toggle('hidden', state !== 'login');
    elements.otpState.classList.toggle('hidden', state !== 'otp');
    elements.mainState.classList.toggle('hidden', state !== 'main');

    // Clear timer when leaving OTP state
    if (state !== 'otp' && timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

// ============================================
// EVENT LISTENERS
// ============================================
function setupEventListeners() {
    // Email form - request OTP
    elements.loginForm?.addEventListener('submit', handleRequestOtp);

    // OTP form - verify OTP
    elements.otpForm?.addEventListener('submit', handleVerifyOtp);

    // Resend OTP
    elements.resendOtpBtn?.addEventListener('click', handleResendOtp);

    // Change email (go back)
    elements.changeEmailBtn?.addEventListener('click', () => {
        showState('login');
    });

    // Auto-format OTP input (only digits)
    elements.otpCodeInput?.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
    });

    // Logout
    elements.logoutBtn?.addEventListener('click', handleLogout);

    // Provider search
    elements.providerSearch?.addEventListener('input', handleProviderSearch);

    // Clinic filter
    elements.stateFilter?.addEventListener('change', handleClinicFilterChange);

    // Clear provider
    elements.clearProvider?.addEventListener('click', handleClearProvider);

    // Action buttons
    elements.triggerAutofill?.addEventListener('click', handleTriggerAutofill);
    elements.rescanPage?.addEventListener('click', handleRescanPage);

    // Settings
    elements.openSettings?.addEventListener('click', () => {
        chrome.runtime.openOptionsPage?.() || chrome.tabs.create({ url: 'options/options.html' });
    });
}

// ============================================
// OTP AUTH HANDLERS
// ============================================
async function handleRequestOtp(e) {
    e.preventDefault();

    const email = elements.emailInput.value.trim();
    if (!email) return;

    currentEmail = email;

    // Show loading state on button
    const btn = elements.requestOtpBtn;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span>Sending code...</span>';
    btn.disabled = true;

    try {
        const response = await sendMessage({
            action: 'REQUEST_OTP',
            payload: { email },
        });

        if (!response.success) {
            throw new Error(response.error || 'Failed to send verification code');
        }

        // Start OTP timer
        otpExpiresAt = Date.now() + (response.expiresIn || 600) * 1000;
        startOtpTimer();

        // Show OTP state
        elements.otpEmailDisplay.textContent = `Code sent to ${email}`;
        elements.otpCodeInput.value = '';
        showState('otp');
        elements.otpCodeInput.focus();

    } catch (error) {
        alert(`Error: ${error.message}`);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function handleVerifyOtp(e) {
    e.preventDefault();

    const code = elements.otpCodeInput.value.trim();
    if (!code || code.length !== 6) {
        alert('Please enter a 6-digit code');
        return;
    }

    // Show loading state on button
    const btn = elements.verifyOtpBtn;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span>Verifying...</span>';
    btn.disabled = true;

    try {
        const response = await sendMessage({
            action: 'VERIFY_OTP',
            payload: { email: currentEmail, code },
        });

        if (!response.success) {
            throw new Error(response.error || 'Invalid verification code');
        }

        // Success - load main state
        await loadMainState(response.user?.email || currentEmail);
        showState('main');

    } catch (error) {
        alert(`Verification failed: ${error.message}`);
        elements.otpCodeInput.value = '';
        elements.otpCodeInput.focus();
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function handleResendOtp() {
    const btn = elements.resendOtpBtn;
    const originalText = btn.textContent;
    btn.textContent = 'Sending...';
    btn.disabled = true;

    try {
        const response = await sendMessage({
            action: 'REQUEST_OTP',
            payload: { email: currentEmail },
        });

        if (!response.success) {
            throw new Error(response.error || 'Failed to resend code');
        }

        // Restart timer
        otpExpiresAt = Date.now() + (response.expiresIn || 600) * 1000;
        startOtpTimer();

        alert('New code sent to your email');
    } catch (error) {
        alert(`Error: ${error.message}`);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

function startOtpTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
    }

    function updateTimer() {
        const remaining = Math.max(0, Math.floor((otpExpiresAt - Date.now()) / 1000));
        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;

        if (remaining > 0) {
            elements.otpTimer.textContent = `Code expires in ${minutes}:${seconds.toString().padStart(2, '0')}`;
            elements.otpTimer.style.color = remaining < 60 ? '#ef4444' : '#6b7280';
        } else {
            elements.otpTimer.textContent = 'Code expired. Please request a new one.';
            elements.otpTimer.style.color = '#ef4444';
            clearInterval(timerInterval);
        }
    }

    updateTimer();
    timerInterval = setInterval(updateTimer, 1000);
}

// ============================================
// LOGOUT HANDLER
// ============================================
async function handleLogout() {
    await sendMessage({ action: 'LOGOUT' });
    currentProvider = null;
    currentEmail = '';
    elements.emailInput.value = '';
    elements.otpCodeInput.value = '';
    showState('login');
}

// ============================================
// MAIN STATE
// ============================================
async function loadMainState(email) {
    // Set user info
    if (email) {
        elements.userEmail.textContent = email;
        elements.userAvatar.textContent = email.substring(0, 2).toUpperCase();
    }

    // Clinic filter populated dynamically when providers load

    // Load selected provider from storage
    const stored = await chrome.storage.local.get([STORAGE_KEYS.SELECTED_PROVIDER]);
    if (stored[STORAGE_KEYS.SELECTED_PROVIDER]) {
        currentProvider = stored[STORAGE_KEYS.SELECTED_PROVIDER];
        showSelectedProvider(currentProvider);
    }

    // Detect current portal
    await detectCurrentPortal();
    updateButtonStates();
}

async function detectCurrentPortal() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.url) return;

        const url = new URL(tab.url);
        const portalResult = await sendMessage({
            action: 'DETECT_PORTAL',
            payload: { hostname: url.hostname, url: tab.url, pageTitle: tab.title },
        });

        const portalIcon = document.querySelector('.portal-icon');

        if (portalResult.detected) {
            elements.portalName.textContent = portalResult.adapter.portalName;
            elements.portalUrl.textContent = url.hostname;
            portalIcon.classList.remove('portal-unknown');
            portalIcon.classList.add('portal-detected');
            portalIcon.textContent = '✓';
        } else {
            elements.portalName.textContent = 'Unknown Portal';
            elements.portalUrl.textContent = url.hostname;
            portalIcon.classList.add('portal-unknown');
            portalIcon.classList.remove('portal-detected');
            portalIcon.textContent = '?';
        }
    } catch (error) {
        console.error('Portal detection failed:', error);
        elements.portalName.textContent = 'Unable to detect';
        elements.portalUrl.textContent = 'Check page access';
    }
}

// ============================================
// PROVIDER HANDLERS
// ============================================
function handleClinicFilterChange(e) {
    selectedClinicFilter = e.target.value;
    if (lastProviderResults.length > 0) {
        const filtered = applyClinicFilter(lastProviderResults);
        renderProviderList(filtered);
    } else {
        loadAllProvidersAndFilter();
    }
}

function applyClinicFilter(providers) {
    if (!selectedClinicFilter) return providers;
    return providers.filter(p => (p.primaryClinicId || '') === selectedClinicFilter);
}

function populateClinicFilterFromProviders(providers) {
    if (!elements.stateFilter) return;
    const seen = new Set();
    const options = ['<option value="">All Clinics</option>'];
    providers.forEach(p => {
        if (p.primaryClinicId && !seen.has(p.primaryClinicId)) {
            seen.add(p.primaryClinicId);
            options.push(`<option value="${p.primaryClinicId}">${formatClinicName(p.primaryClinicId)}</option>`);
        }
    });
    elements.stateFilter.innerHTML = options.join('');
    if (selectedClinicFilter) elements.stateFilter.value = selectedClinicFilter;
}

// Convert clinicId like 'todaysdentallexington' → 'Todays Dental Lexington'
function formatClinicName(clinicId) {
    if (!clinicId) return '';
    // Split on known words to get readable name
    return clinicId
        .replace(/([a-z])([A-Z])/g, '$1 $2')  // camelCase split
        .replace(/-/g, ' ')                     // hyphen to space
        .split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

async function loadAllProvidersAndFilter() {
    elements.providerList.classList.remove('hidden');
    elements.selectedProvider.classList.add('hidden');
    elements.providerList.innerHTML = '<div class="provider-list-empty">Loading providers...</div>';

    const response = await sendMessage({
        action: 'GET_PROVIDERS',
        payload: { limit: 50 },
    });

    const providers = response.success
        ? (response.providers || response.data || [])
        : [];

    if (providers.length > 0) {
        lastProviderResults = providers;
        populateClinicFilterFromProviders(providers);
        const filtered = applyClinicFilter(providers);
        renderProviderList(filtered);
    } else {
        lastProviderResults = [];
        elements.stateSummary?.classList.add('hidden');
        elements.providerList.innerHTML = '<div class="provider-list-empty">No providers found</div>';
    }
}

async function handleProviderSearch(e) {
    const query = e.target.value.trim();

    clearTimeout(searchTimeout);

    if (query.length < 2) {
        // If a clinic filter is active, load all providers and filter
        if (selectedClinicFilter) {
            lastProviderResults = [];
            await loadAllProvidersAndFilter();
        } else {
            lastProviderResults = [];
            elements.providerList.innerHTML = '<div class="provider-list-empty">Type to search providers...</div>';
            elements.providerList.classList.remove('hidden');
            elements.selectedProvider.classList.add('hidden');
            elements.stateSummary?.classList.add('hidden');
        }
        return;
    }

    searchTimeout = setTimeout(async () => {
        elements.providerList.innerHTML = '<div class="provider-list-empty">Searching...</div>';

        const response = await sendMessage({
            action: 'GET_PROVIDERS',
            payload: { searchQuery: query, limit: 50 },
        });

        const providers = response.success
            ? (response.providers || response.data || [])
            : [];

        if (providers.length > 0) {
            lastProviderResults = providers;
            populateClinicFilterFromProviders(providers);
            const filtered = applyClinicFilter(providers);
            renderProviderList(filtered);
        } else {
            lastProviderResults = [];
            elements.stateSummary?.classList.add('hidden');
            elements.providerList.innerHTML = '<div class="provider-list-empty">No providers found</div>';
        }
    }, 300);
}


function renderProviderList(providers) {
    if (providers.length === 0) {
        elements.providerList.innerHTML = '<div class="provider-list-empty">No providers match the selected filter</div>';
        return;
    }

    elements.providerList.innerHTML = providers
        .map(p => {
            const name = p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim();
            const clinicName = formatClinicName(p.primaryClinicId);
            return `
      <div class="provider-card" data-provider-id="${p.providerId}" data-provider='${JSON.stringify(p).replace(/'/g, "&#39;")}'>
        <div class="provider-info">
          <span class="provider-name">${name}</span>
          <span class="provider-detail-row">
            <span class="provider-npi">NPI: ${p.npi || 'N/A'}</span>
            ${clinicName ? `<span class="provider-clinic">· ${clinicName}</span>` : ''}
          </span>
        </div>
      </div>
    `;
        })
        .join('');

    // Add click handlers
    elements.providerList.querySelectorAll('.provider-card').forEach(card => {
        card.addEventListener('click', () => {
            const provider = JSON.parse(card.dataset.provider.replace(/&#39;/g, "'"));
            selectProvider(provider);
        });
    });
}

async function selectProvider(provider) {
    currentProvider = provider;
    await chrome.storage.local.set({ [STORAGE_KEYS.SELECTED_PROVIDER]: provider });
    showSelectedProvider(provider);

    // Notify content script
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
            chrome.tabs.sendMessage(tab.id, { action: 'PROVIDER_SELECTED' });
        }
    } catch (e) { /* ignore */ }

    updateButtonStates();
}

function showSelectedProvider(provider) {
    const name = provider.name || `${provider.firstName || ''} ${provider.lastName || ''}`.trim();
    elements.selectedName.textContent = name;
    const clinicName = formatClinicName(provider.primaryClinicId);
    elements.selectedNpi.textContent = `NPI: ${provider.npi || 'N/A'}${clinicName ? ' · ' + clinicName : ''}`;

    elements.selectedProvider.classList.remove('hidden');
    elements.providerList.classList.add('hidden');
    elements.stateSummary?.classList.add('hidden');
    elements.providerSearch.value = '';
}

async function handleClearProvider() {
    currentProvider = null;
    await chrome.storage.local.remove([STORAGE_KEYS.SELECTED_PROVIDER]);
    elements.selectedProvider.classList.add('hidden');
    elements.providerList.classList.remove('hidden');
    elements.providerList.innerHTML = '<div class="provider-list-empty">Type to search providers...</div>';
    updateButtonStates();
}

// ============================================
// ACTION HANDLERS
// ============================================
async function handleTriggerAutofill() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return;

        await chrome.tabs.sendMessage(tab.id, { action: 'TRIGGER_AUTOFILL' });
        window.close();
    } catch (error) {
        alert('Unable to communicate with the page. Please refresh and try again.');
    }
}

async function handleRescanPage() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return;

        const result = await chrome.tabs.sendMessage(tab.id, { action: 'RESCAN_PAGE' });
        if (result?.success) {
            elements.rescanPage.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"></path></svg> Found ${result.fieldCount} fields`;
            setTimeout(() => {
                elements.rescanPage.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"></path></svg> Re-scan Page`;
            }, 2000);
        }
    } catch (error) {
        console.error('Rescan failed:', error);
    }
}

function updateButtonStates() {
    const hasProvider = !!currentProvider;
    elements.triggerAutofill.disabled = !hasProvider;
    elements.rescanPage.disabled = false;
}

// ============================================
// MESSAGING
// ============================================
function sendMessage(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(response || {});
            }
        });
    });
}

// ============================================
// BOOTSTRAP
// ============================================
initialize();

// adobe-sign-prefill.js
// Handles autofill for Adobe Sign web forms.
// Strategy A: iFrame-embedded → URL hash params (#Field=Value) — text fields only
// Strategy B: Direct tab — DOM injection with React-compatible filling (all field types)
//
// Loaded as a regular content script (not ES module). All globals.

// ============================================
// Domain detection
// ============================================
var ADOBE_SIGN_DOMAINS = ['adobesign.com', 'echosign.com', 'adobesigncentral.com'];

function isAdobeSignDomain(hostname) {
    return ADOBE_SIGN_DOMAINS.some(function(d) { return hostname.includes(d); });
}

function isDirectAdobeSignPage() {
    return isAdobeSignDomain(window.location.hostname);
}

// ============================================
// React-compatible DOM fill
// Adobe Sign uses React. Setting element.value directly won't trigger React state.
// We must use the native property descriptor setter, then fire a React-compatible event.
// ============================================
function reactSet(element, value) {
    try {
        var proto = Object.getPrototypeOf(element);
        var descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
        if (descriptor && descriptor.set) {
            descriptor.set.call(element, value);
        } else {
            element.value = value;
        }
    } catch (e) {
        element.value = value;
    }
    // Fire all the events React/Angular/plain JS might listen to
    ['input', 'change', 'blur', 'keyup'].forEach(function(type) {
        element.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
    });
}

// ============================================
// STRATEGY A: iFrame detection + URL hash prefill
// ============================================
function detectAdobeSignIframes() {
    return Array.from(document.querySelectorAll('iframe')).filter(function(iframe) {
        var src = iframe.src || iframe.getAttribute('data-src') || '';
        if (!src) return false;
        try { return isAdobeSignDomain(new URL(src, window.location.href).hostname); }
        catch (e) { return false; }
    });
}

function buildPrefillHash(providerFields, fieldNameMap) {
    var pairs = [];
    Object.keys(fieldNameMap).forEach(function(schemaKey) {
        var paramName = fieldNameMap[schemaKey];
        var field = providerFields.find(function(f) { return f.schemaKey === schemaKey; });
        if (field && field.value) {
            pairs.push(encodeURIComponent(paramName) + '=' + encodeURIComponent(field.value));
        }
    });
    return pairs.length > 0 ? '#' + pairs.join('&') : '';
}

function rewriteIframeSrc(iframe, hash) {
    if (!hash) return;
    try {
        var url = new URL(iframe.src);
        iframe.src = url.origin + url.pathname + url.search + hash;
        console.log('[TodaysDental] Adobe Sign iframe prefilled');
    } catch (e) {
        console.error('[TodaysDental] iframe rewrite failed:', e);
    }
}

function prefillAdobeSignIframes(providerFields, fieldNameMap) {
    var iframes = detectAdobeSignIframes();
    if (!iframes.length) return 0;
    var hash = buildPrefillHash(providerFields, fieldNameMap);
    if (!hash) return 0;
    iframes.forEach(function(iframe) { rewriteIframeSrc(iframe, hash); });
    return iframes.length;
}

// ============================================
// STRATEGY B: DOM injection for direct Adobe Sign tab
// ============================================

// Adobe Sign renders many different versions. We use broad selectors to catch all.
// The key insight: Adobe Sign's input fields all have a data-automation-id or aria-label
// that contains the field name. We match on that.
function getAllAdobeSignInputs() {
    // Cast the net wide — any visible input/select/textarea in the document
    var elements = Array.from(document.querySelectorAll(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]),' +
        'select,' +
        'textarea'
    ));
    return elements.filter(function(el) {
        // Exclude the Adobe Sign toolbar/header Chrome (search etc.)
        var rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0; // only visible elements
    });
}

function getFieldLabel(element) {
    // 1. aria-label
    var label = element.getAttribute('aria-label');
    if (label) return label.toLowerCase().trim();

    // 2. aria-labelledby → fetch the label element's text
    var labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
        var labelEl = document.getElementById(labelledBy);
        if (labelEl) return labelEl.textContent.toLowerCase().trim();
    }

    // 3. data-automation-id (Adobe Sign uses this extensively)
    var automationId = element.getAttribute('data-automation-id') || '';
    if (automationId) return automationId.toLowerCase().replace(/[-_]/g, ' ').trim();

    // 4. Enclosing <label>
    var id = element.id;
    if (id) {
        var labelForEl = document.querySelector('label[for="' + id + '"]');
        if (labelForEl) return labelForEl.textContent.toLowerCase().trim();
    }

    // 5. Parent label
    var parentLabel = element.closest('label');
    if (parentLabel) {
        var clone = parentLabel.cloneNode(true);
        clone.querySelectorAll('input,select,textarea').forEach(function(el) { el.remove(); });
        return clone.textContent.toLowerCase().trim();
    }

    // 6. Sibling/nearby label in the field container
    var container = element.closest('[class*="field"], [class*="widget"], [class*="esign"], [data-field-id]');
    if (container) {
        var sibLabel = container.querySelector('label, [class*="label"], [class*="title"]');
        if (sibLabel) return sibLabel.textContent.toLowerCase().trim();
    }

    // 7. name / placeholder fallback
    return (element.name || element.placeholder || '').toLowerCase().trim();
}

function fillElement(element, value) {
    var tag  = element.tagName.toLowerCase();
    var type = (element.getAttribute('type') || '').toLowerCase();

    if (tag === 'select') {
        var opts = Array.from(element.options);
        var match = opts.find(function(o) {
            return o.value.toLowerCase() === value.toLowerCase() ||
                   o.text.toLowerCase() === value.toLowerCase() ||
                   o.text.toLowerCase().includes(value.toLowerCase());
        });
        if (match) {
            element.value = match.value;
            element.dispatchEvent(new Event('change', { bubbles: true }));
        }
    } else if (type === 'checkbox') {
        var truthy = ['true','yes','1','x','checked'].includes(value.toLowerCase());
        element.checked = truthy;
        element.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (type === 'radio') {
        document.querySelectorAll('input[type="radio"][name="' + element.name + '"]').forEach(function(r) {
            if (r.value.toLowerCase() === value.toLowerCase()) {
                r.checked = true;
                r.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
    } else {
        // Text, email, tel, date → React-compatible fill
        reactSet(element, value);
    }
}

function fillAdobeSignDom(providerFields, fieldPatterns) {
    var inputs = getAllAdobeSignInputs();
    var filledCount = 0;
    var seen = new Set(); // avoid double-filling same element

    inputs.forEach(function(input) {
        if (seen.has(input)) return;
        var labelText = getFieldLabel(input);
        if (!labelText) return;

        var schemaKeys = Object.keys(fieldPatterns);
        for (var i = 0; i < schemaKeys.length; i++) {
            var schemaKey = schemaKeys[i];
            var patterns  = fieldPatterns[schemaKey];
            var matches   = patterns.some(function(p) {
                return labelText === p || labelText.includes(p);
            });
            if (matches) {
                var provField = providerFields.find(function(f) { return f.schemaKey === schemaKey; });
                if (provField && provField.value) {
                    try {
                        fillElement(input, String(provField.value));
                        seen.add(input);
                        filledCount++;
                    } catch (e) {
                        console.warn('[TodaysDental] fill error on "' + labelText + '":', e.message);
                    }
                }
                break;
            }
        }
    });

    console.log('[TodaysDental] Adobe Sign DOM: tried ' + inputs.length + ' inputs, filled ' + filledCount);
    return filledCount;
}

function waitForAdobeSignForm(timeoutMs) {
    timeoutMs = timeoutMs || 10000;
    return new Promise(function(resolve, reject) {
        // Check immediately
        var inputs = getAllAdobeSignInputs();
        if (inputs.length > 0) return resolve();

        var observer = new MutationObserver(function() {
            if (getAllAdobeSignInputs().length > 0) {
                observer.disconnect();
                // Extra wait for React to finish rendering
                setTimeout(resolve, 1000);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(function() {
            observer.disconnect();
            reject(new Error('Adobe Sign form did not render in ' + (timeoutMs / 1000) + 's'));
        }, timeoutMs);
    });
}

// ============================================
// Prefill banner (for iFrame embed scenario)
// ============================================
function injectAdobeSignBanner(onPrefillClick) {
    if (document.getElementById('td-adobe-sign-banner')) return;

    var banner = document.createElement('div');
    banner.id = 'td-adobe-sign-banner';
    banner.style.cssText = [
        'position:fixed','bottom:80px','right:20px','z-index:2147483646',
        'background:linear-gradient(135deg,#1a73e8,#0d47a1)',
        'color:white','padding:12px 18px','border-radius:10px',
        'box-shadow:0 4px 16px rgba(0,0,0,0.3)','cursor:pointer',
        'display:flex','align-items:center','gap:10px',
        'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
        'font-size:13px','font-weight:600','max-width:260px',
        'animation:td-slide-in 0.3s ease'
    ].join(';');
    banner.innerHTML = [
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="white">',
        '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
        '</svg><span>Prefill Adobe Sign Form</span>',
        '<button id="td-adobe-banner-close" style="background:none;border:none;color:rgba(255,255,255,0.7);',
        'cursor:pointer;font-size:18px;padding:0;margin-left:4px;line-height:1">&times;</button>'
    ].join('');

    banner.addEventListener('click', function(e) {
        if (e.target.id === 'td-adobe-banner-close') { banner.remove(); return; }
        onPrefillClick();
    });
    document.body.appendChild(banner);

    if (!document.getElementById('td-adobe-styles')) {
        var style = document.createElement('style');
        style.id = 'td-adobe-styles';
        style.textContent = '@keyframes td-slide-in{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}';
        document.head.appendChild(style);
    }
}

// ============================================
// Field name maps (URL hash prefill for iFrames)
// ============================================
var GENERIC_ADOBE_SIGN_FIELD_MAP = {
    firstName:'FirstName', lastName:'LastName', middleName:'MiddleName',
    npi:'NPI', taxId:'TaxID', ssn:'SSN', email:'Email', phone:'Phone',
    stateLicenseNumber:'LicenseNumber', stateLicenseState:'LicenseState', stateLicenseExpiry:'LicenseExpiration',
    deaNumber:'DEANumber', practiceName:'PracticeName', practiceNpi:'GroupNPI',
    practiceAddress1:'Address', practiceCity:'City', practiceState:'State', practiceZip:'ZipCode',
    practicePhone:'OfficePhone', practiceFax:'OfficeFax',
    primarySpecialty:'Specialty', gender:'Gender',
    malpracticeInsurer:'InsuranceCarrier', malpracticePolicyNumber:'PolicyNumber', malpracticeExpiry:'PolicyExpiration',
};

var PAYER_ADOBE_FIELD_MAPS = {
    centene:  { firstName:'ProviderFirstName', lastName:'ProviderLastName', npi:'ProviderNPI', taxId:'TaxID', ssn:'ProviderSSN', email:'ProviderEmail', phone:'ProviderPhone', stateLicenseNumber:'LicenseNumber', deaNumber:'DEANumber', practiceName:'PracticeName', practiceAddress1:'PracticeAddress', practiceCity:'PracticeCity', practiceState:'PracticeState', practiceZip:'PracticeZip', malpracticeInsurer:'MalpracticeCarrier', primarySpecialty:'Specialty' },
    uhc:      { firstName:'First_Name', lastName:'Last_Name', npi:'NPI', taxId:'TIN', email:'Email_Address', phone:'Phone_Number', stateLicenseNumber:'License_Number', practiceName:'Group_Name', practiceAddress1:'Office_Address', practiceCity:'Office_City', practiceState:'Office_State', practiceZip:'Office_Zip' },
    cigna:    { firstName:'providerFirstName', lastName:'providerLastName', npi:'NPI_Number', taxId:'TaxIdentification', email:'providerEmail', stateLicenseNumber:'licenseNumber', practiceAddress1:'practiceAddress', practiceCity:'practiceCity', practiceState:'practiceState', practiceZip:'practiceZip' },
};

function getFieldMapForCurrentPage() {
    var hostname = window.location.hostname.toLowerCase();
    var keys = Object.keys(PAYER_ADOBE_FIELD_MAPS);
    for (var i = 0; i < keys.length; i++) {
        if (hostname.includes(keys[i])) return PAYER_ADOBE_FIELD_MAPS[keys[i]];
    }
    return GENERIC_ADOBE_SIGN_FIELD_MAP;
}

console.log('[TodaysDental] adobe-sign-prefill.js loaded (v2 - React-compatible)');

// pdf-filler.js
// Handles autofill for PDF AcroForms on payer credentialing pages.
// Detects PDF links, injects "Autofill & Download" buttons, fetches PDFs
// via background service worker (bypasses CORS), fills fields, downloads.
//
// Loaded as a regular content script (not ES module). All functions are globals.
// pdf-lib is loaded lazily from web_accessible_resources.

'use strict';

var TD_PDF_LIB = null;

// ─── Load pdf-lib lazily from extension bundle ────────────────────────────────
function loadPdfLib() {
    if (TD_PDF_LIB) return Promise.resolve(TD_PDF_LIB);
    if (window.PDFLib) { TD_PDF_LIB = window.PDFLib; return Promise.resolve(TD_PDF_LIB); }
    return new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = chrome.runtime.getURL('vendor/pdf-lib.min.js');
        script.onload = function () { TD_PDF_LIB = window.PDFLib; resolve(TD_PDF_LIB); };
        script.onerror = function () { reject(new Error('pdf-lib failed to load')); };
        (document.head || document.body).appendChild(script);
    });
}

// ─── Fetch PDF via background SW (no CORS restriction in SW) ─────────────────
function fetchPdfViaBackground(url) {
    return new Promise(function (resolve, reject) {
        chrome.runtime.sendMessage({ action: 'FETCH_PDF', payload: { url: url } }, function (response) {
            if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
            if (!response || !response.success) { reject(new Error(response ? response.error : 'No response')); return; }
            // Decode base64 → Uint8Array
            try {
                var binary = atob(response.base64);
                var bytes = new Uint8Array(binary.length);
                for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                resolve(bytes.buffer);
            } catch (e) { reject(e); }
        });
    });
}

// ─── AcroForm field name → schema key mapping ─────────────────────────────────
// Keys are schema keys; values are arrays of patterns that can appear in
// PDF field names (case-insensitive substring match).
var ACROFORM_FIELD_PATTERNS = {
    firstName:               ['first name','firstname','first_name','fname','given name','f_name','provider first'],
    lastName:                ['last name','lastname','last_name','lname','family name','l_name','provider last','surname'],
    middleName:              ['middle name','middle initial','middlename','middle_name',' mi '],
    suffix:                  ['suffix','jr','sr','ii','iii'],
    npi:                     ['npi','national provider','type1 npi','individual npi','provider npi','dentist npi'],
    taxId:                   ['tax id','taxid','ein','tin','federal tax','fein','employer id','f1_7','f1_2[0]'],
    ssn:                     ['ssn','social security','social sec','ss#'],
    dateOfBirth:             ['date of birth','dob','birth date','birthdate','birth_date'],
    gender:                  ['gender','sex'],
    email:                   ['email','e-mail','emailaddress','email address','provider email'],
    phone:                   ['phone','telephone','phone number'],
    fax:                     ['fax','fax number'],
    stateLicenseNumber:      ['license number','lic number','lic#','lic no','dental license','state license','license no','licensenumber'],
    stateLicenseState:       ['license state','state of license','licensing state','lic state'],
    stateLicenseExpiry:      ['license exp','lic exp','license expir','lic expir'],
    deaNumber:               ['dea number','dea#','dea reg','dea cert',' dea '],
    deaExpiry:               ['dea exp','dea expir'],
    caqhId:                  ['caqh','proview','caqh id','caqh number'],
    practiceName:            ['practice name','clinic name','office name','facility name','business name',
                              'legal name','group name','dba','doing business as','provider name',
                              'topmostsubform[0].page1[0].f1_1[0]','f1_1[0]'],
    practiceNpi:             ['group npi','practice npi','organization npi','type2','billing npi','business npi'],
    practiceAddress1:        ['practice address','office address','street address','address line 1','location address',
                              'mailing address','new address','address 1','addr1',
                              'topmostsubform[0].page1[0].f1_6[0]','f1_6'],
    practiceAddress2:        ['address line 2','suite','unit','address 2','apt','addr2'],
    practiceCity:            ['city','practice city','office city','new city'],
    practiceState:           ['state','practice state','office state','new state'],
    practiceZip:             ['zip','postal code','zip code','zipcode','practice zip','new zip'],
    practicePhone:           ['office phone','practice phone','business phone','main phone','new phone'],
    practiceFax:             ['office fax','practice fax','business fax','new fax'],
    practiceCounty:          ['county'],
    primarySpecialty:        ['specialty','primary specialty','dental specialty','specialization','type of practice'],
    malpracticeInsurer:      ['malpractice carrier','insurance carrier','malpractice insurer','liability carrier',
                              'insurance company','coi carrier','carrier name'],
    malpracticePolicyNumber: ['policy number','policy #','policy no','malpractice policy','insurance policy#'],
    malpracticeLimitPerClaim:['per claim','per occurrence','coverage limit','malpractice limit'],
    malpracticeLimitAggregate:['aggregate','total coverage','annual aggregate'],
    malpracticeExpiry:       ['policy exp','coi exp','insurance exp','malpractice exp','policy effective'],
    malpracticeEffectiveDate:['effective date','policy effective','coverage date'],
    dentalSchoolName:        ['dental school','school name','college','university','institution'],
    graduationYear:          ['graduation year','year graduated','grad year','graduation date'],
    boardCertifyingBody:     ['board cert','certifying board','specialty board'],
};

// Build flat lookup: lowercase pattern → schemaKey
var TD_ACRO_LOOKUP = (function () {
    var lookup = {};
    Object.keys(ACROFORM_FIELD_PATTERNS).forEach(function (key) {
        ACROFORM_FIELD_PATTERNS[key].forEach(function (pattern) {
            lookup[pattern.toLowerCase().trim()] = key;
        });
    });
    return lookup;
})();

/**
 * Resolve a PDF AcroForm field name to a schema key.
 * Uses: exact match → substring match → word-overlap scoring.
 */
function resolveSchemaKey(pdfFieldName) {
    var normalized = pdfFieldName.toLowerCase().trim();

    // 1. Exact match
    if (TD_ACRO_LOOKUP[normalized]) return TD_ACRO_LOOKUP[normalized];

    // 2. Substring match (pattern inside field name, or field name inside pattern)
    var keys = Object.keys(TD_ACRO_LOOKUP);
    for (var i = 0; i < keys.length; i++) {
        if (normalized.includes(keys[i]) || keys[i].includes(normalized)) {
            return TD_ACRO_LOOKUP[keys[i]];
        }
    }

    // 3. Word-overlap scoring (≥0.5 threshold for PDFs — slightly looser than HTML)
    var normalizedWords = normalized.replace(/[_\-[\]().]/g, ' ').split(/\s+/).filter(function (w) { return w.length > 1; });
    var bestKey = null;
    var bestScore = 0.5; // minimum threshold
    Object.keys(ACROFORM_FIELD_PATTERNS).forEach(function (schemaKey) {
        ACROFORM_FIELD_PATTERNS[schemaKey].forEach(function (pattern) {
            var patternWords = pattern.toLowerCase().split(/\s+/).filter(function (w) { return w.length > 1; });
            if (patternWords.length === 0) return;
            var matched = patternWords.filter(function (pw) {
                return normalizedWords.some(function (nw) { return nw.includes(pw) || pw.includes(nw); });
            });
            var score = matched.length / patternWords.length;
            if (score > bestScore) { bestScore = score; bestKey = schemaKey; }
        });
    });
    return bestKey;
}

// ─── PDF link detection ───────────────────────────────────────────────────────
function detectPdfLinks() {
    var links = Array.from(document.querySelectorAll('a[href]'));
    return links.filter(function (a) {
        var href = (a.href || '').toLowerCase();
        var text = (a.textContent || '').toLowerCase();
        return href.includes('.pdf') || href.includes('?format=pdf') ||
            text.includes('enrollment form') ||
            text.includes('credentialing form') ||
            text.includes('application form') ||
            text.includes('download form') ||
            text.includes('provider form') ||
            text.includes('address change') ||
            text.includes('w-9') ||
            text.includes('w9');
    });
}

// ─── Button injection (on-demand payload fetch, no pre-selected provider needed) ─
function injectPdfFillButtons(providerPayload) {
    var pdfLinks = detectPdfLinks();
    if (pdfLinks.length === 0) return 0;

    pdfLinks.forEach(function (link) {
        if (link.dataset.tdPdfInjected === 'true') return;
        link.dataset.tdPdfInjected = 'true';

        var btn = document.createElement('button');
        btn.className = 'td-pdf-fill-btn';
        btn.setAttribute('title', 'Autofill this PDF form with provider data and download it');
        btn.innerHTML = [
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">',
            '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
            '</svg>&nbsp;Autofill PDF'
        ].join('');
        btn.style.cssText = [
            'display:inline-flex', 'align-items:center', 'gap:5px', 'margin-left:8px',
            'padding:4px 12px', 'border-radius:6px', 'border:none', 'cursor:pointer',
            'background:linear-gradient(135deg,#1a73e8,#0d47a1)',
            'color:#fff', 'font-size:12px', 'font-weight:600',
            'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
            'box-shadow:0 2px 6px rgba(0,0,0,0.2)', 'transition:opacity .2s,background .2s',
            'vertical-align:middle', 'line-height:1.4'
        ].join(';');

        btn.addEventListener('mouseover', function () { btn.style.opacity = '0.85'; });
        btn.addEventListener('mouseout', function () { btn.style.opacity = '1'; });

        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            btn.textContent = 'Loading\u2026';
            btn.disabled = true;

            // If payload was pre-loaded, use it; otherwise fetch on demand
            var payloadPromise = (providerPayload && providerPayload.fields)
                ? Promise.resolve(providerPayload)
                : getProviderPayloadOnDemand();

            payloadPromise.then(function (payload) {
                if (!payload || !payload.fields) throw new Error('No provider selected. Please open the extension popup and select a provider first.');
                var fieldsArr = normalizePayloadFields(payload.fields);
                btn.textContent = 'Filling\u2026';
                return fetchAndFillPdf(link.href, fieldsArr);
            }).then(function (result) {
                btn.innerHTML = '\u2713 Downloaded (' + (result || 0) + ' fields)';
                btn.style.background = 'linear-gradient(135deg,#34a853,#1e7e34)';
                btn.disabled = false;
            }).catch(function (err) {
                console.error('[TodaysDental] PDF fill error:', err);
                btn.textContent = '\u26a0 Error: ' + (err.message || 'Failed');
                btn.style.background = '#d32f2f';
                btn.disabled = false;
                setTimeout(function () {
                    btn.innerHTML = 'Retry Autofill PDF';
                    btn.style.background = 'linear-gradient(135deg,#1a73e8,#0d47a1)';
                    btn.disabled = false;
                }, 4000);
            });
        });

        link.insertAdjacentElement('afterend', btn);
    });

    console.log('[TodaysDental] Injected PDF fill buttons for ' + pdfLinks.length + ' PDF link(s)');
    return pdfLinks.length;
}

// Fetch payload on-demand (when button clicked without pre-loaded payload)
function getProviderPayloadOnDemand() {
    return new Promise(function (resolve, reject) {
        chrome.storage.local.get(['selectedProvider'], function (stored) {
            if (!stored.selectedProvider) { reject(new Error('No provider selected')); return; }
            chrome.runtime.sendMessage(
                { action: 'GET_AUTOFILL_PAYLOAD', payload: { providerId: stored.selectedProvider.providerId } },
                function (response) {
                    if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
                    if (!response || !response.success) { reject(new Error((response && response.error) || 'Failed to load provider data')); return; }
                    resolve(response.payload);
                }
            );
        });
    });
}

// Normalize payload.fields to [{schemaKey, value}] regardless of format
function normalizePayloadFields(fields) {
    if (Array.isArray(fields)) return fields;
    if (fields && typeof fields === 'object') {
        return Object.entries(fields).map(function (kv) { return { schemaKey: kv[0], value: String(kv[1] || '') }; });
    }
    return [];
}

// ─── Fetch + fill + download ──────────────────────────────────────────────────
function fetchAndFillPdf(pdfUrl, providerFields) {
    return loadPdfLib().then(function (lib) {
        if (!lib) throw new Error('pdf-lib did not load');
        console.log('[TodaysDental] Fetching PDF via background SW:', pdfUrl);
        return fetchPdfViaBackground(pdfUrl);
    }).then(function (pdfBuffer) {
        return fillAcroForm(TD_PDF_LIB, pdfBuffer, providerFields);
    }).then(function (result) {
        var fileName = pdfUrl.split('/').pop().replace(/\?.*/, '') || 'form.pdf';
        var filledName = fileName.replace(/\.pdf$/i, '-autofilled.pdf');
        downloadFilledPdf(result.bytes, filledName);
        return result.count;
    });
}

function fillAcroForm(lib, pdfBytes, providerFields) {
    return lib.PDFDocument.load(pdfBytes, { ignoreEncryption: true }).then(function (pdfDoc) {
        var form;
        try { form = pdfDoc.getForm(); } catch (e) {
            throw new Error('This PDF has no fillable AcroForm fields. It may be a flat (image-only) PDF.');
        }

        var allFields = form.getFields();
        if (allFields.length === 0) throw new Error('No AcroForm fields found in PDF.');

        // Build a lookup of payload values (schemaKey → value)
        var payloadMap = {};
        providerFields.forEach(function (f) {
            if (f.schemaKey && f.value) payloadMap[f.schemaKey] = String(f.value);
        });

        var filledCount = 0;

        allFields.forEach(function (field) {
            var pdfFieldName = field.getName();
            var schemaKey = resolveSchemaKey(pdfFieldName);

            if (!schemaKey) {
                console.log('[TodaysDental PDF] Unmatched field: "' + pdfFieldName + '"');
                return;
            }
            var value = payloadMap[schemaKey];
            if (!value) {
                console.log('[TodaysDental PDF] No value for "' + pdfFieldName + '" (key: ' + schemaKey + ')');
                return;
            }

            try {
                var typeName = field.constructor && field.constructor.name;
                if (typeName === 'PDFTextField') {
                    field.setText(value);
                    filledCount++;
                    console.log('[TodaysDental PDF] \u2713 TextField "' + pdfFieldName + '" = "' + value.slice(0,30) + '"');
                } else if (typeName === 'PDFDropdown') {
                    var options = field.getOptions();
                    var match = options.find(function (o) {
                        return o.toLowerCase() === value.toLowerCase() ||
                               o.toLowerCase().includes(value.toLowerCase()) ||
                               value.toLowerCase().includes(o.toLowerCase());
                    });
                    if (match) { field.select(match); filledCount++; }
                } else if (typeName === 'PDFCheckBox') {
                    var truthy = ['true','yes','1','x','checked'].includes(value.toLowerCase());
                    truthy ? field.check() : field.uncheck();
                    filledCount++;
                } else if (typeName === 'PDFRadioGroup') {
                    var opts = field.getOptions();
                    var m = opts.find(function (o) { return o.toLowerCase() === value.toLowerCase(); });
                    if (m) { field.select(m); filledCount++; }
                }
            } catch (e) {
                console.warn('[TodaysDental PDF] Could not fill "' + pdfFieldName + '":', e.message);
            }
        });

        // Flatten form so values are permanently visible in PDF viewers
        form.flatten();

        console.log('[TodaysDental PDF] Filled ' + filledCount + '/' + allFields.length + ' fields');
        return pdfDoc.save().then(function (bytes) { return { bytes: bytes, count: filledCount }; });
    });
}

function downloadFilledPdf(pdfBytes, filename) {
    var blob = new Blob([pdfBytes], { type: 'application/pdf' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 2000);
}

// ─── Auto re-scan DOM for new PDF links ──────────────────────────────────────
function observePdfLinks(getPayload) {
    var debounceTimer = null;
    var observer = new MutationObserver(function () {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
            var payload = (typeof getPayload === 'function') ? getPayload() : null;
            injectPdfFillButtons(payload);
        }, 600);
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

// ─── Scan on page-visible PDF URLs (browser is on a direct .pdf URL) ──────────
// If the user navigates directly to a PDF URL, Chrome renders it inline.
// In that case we cannot inject buttons into the PDF viewer — but we can
// attempt to auto-download a filled version if a provider is selected.
function handleDirectPdfPage() {
    if (!window.location.href.toLowerCase().includes('.pdf')) return;
    console.log('[TodaysDental] Direct PDF page detected:', window.location.href);
    // Will be handled via the FAB button in the parent tab if the user navigated
    // to the PDF from a payer page. Nothing to inject here.
}

handleDirectPdfPage();

console.log('[TodaysDental] pdf-filler.js loaded');

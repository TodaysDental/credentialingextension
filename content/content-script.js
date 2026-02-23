// Content Script for TodaysDental Credentialing Extension
// Runs on insurance portal pages to detect forms and fill fields

const EXTENSION_ID = 'todaysdental-credentialing';
let currentAdapter = null;
let autofillPayload = null;
let settings = null;
let isReviewPanelOpen = false;

// ============================================================
// UNIVERSAL FIELD PATTERN LIBRARY
// Covers all 90+ canonical credentialing schema keys.
// Each key maps to an array of synonyms/patterns used across
// all payer portals (CAQH, Availity, Cigna, UHC, Delta, etc.)
// Matching uses word-overlap fuzzy scoring — not exact substring.
// ============================================================
const FIELD_PATTERNS = {
    // ── A) IDENTITY ──────────────────────────────────────────────────────
    providerName:     ['provider name', 'dentist name', 'doctor name', 'physician name', 'applicant name', 'practitioner name', 'provider full name', 'full name', 'dr name', 'name of provider', 'name of dentist'],
    firstName:        ['first name', 'firstname', 'given name', 'forename', 'fname', 'provider first', 'dentist first', 'applicant first', 'dr first', 'legal first'],
    lastName:         ['last name', 'lastname', 'surname', 'family name', 'lname', 'provider last', 'dentist last', 'applicant last', 'legal last'],
    middleName:       ['middle name', 'middlename', 'middle initial', 'mi', 'mname', 'provider middle'],
    suffix:           ['suffix', 'name suffix', 'credentials', 'designation'],
    maidenName:       ['maiden name', 'birth name', 'previous name', 'former name', 'name at birth', 'other name'],
    dateOfBirth:      ['date of birth', 'dob', 'birth date', 'birthdate', 'born', 'birth day', 'provider dob', 'applicant dob'],
    ssn:              ['ssn', 'social security', 'social security number', 'ss#', 'ssn#', 'last 4 ssn', 'last four'],
    gender:           ['gender', 'sex', 'male female', 'provider gender'],
    birthCity:        ['city of birth', 'birth city', 'place of birth', 'born in city', 'birthplace city'],
    birthState:       ['state of birth', 'birth state', 'place of birth state', 'born in state'],
    birthCountry:     ['country of birth', 'birth country', 'country born', 'place of birth country', 'citizenship country'],
    citizenship:      ['citizenship', 'citizen', 'us citizen', 'citizenship status', 'nationality'],

    // ── B) CONTACT ───────────────────────────────────────────────────────
    email:            ['email', 'e-mail', 'email address', 'electronic mail', 'provider email', 'contact email', 'work email'],
    phone:            ['phone', 'telephone', 'phone number', 'contact number', 'provider phone', 'direct phone', 'work phone', 'office telephone'],
    cellPhone:        ['cell phone', 'mobile phone', 'cell number', 'mobile number', 'cellular'],
    fax:              ['fax', 'facsimile', 'fax number', 'fax no'],
    homeAddress1:     ['home address', 'residential address', 'personal address', 'home street', 'home address line 1', 'current address'],
    homeAddress2:     ['home address 2', 'home apt', 'home suite', 'residential address 2'],
    homeCity:         ['home city', 'residential city', 'personal city', 'city of residence'],
    homeState:        ['home state', 'residential state', 'personal state', 'state of residence'],
    homeZip:          ['home zip', 'residential zip', 'home postal', 'personal postal code'],
    mailingAddress1:  ['mailing address', 'correspondence address', 'mail address', 'mailing street', 'po box', 'mailing address line 1'],
    mailingCity:      ['mailing city', 'correspondence city'],
    mailingState:     ['mailing state', 'correspondence state'],
    mailingZip:       ['mailing zip', 'mailing postal', 'correspondence postal'],

    // ── C) LEGAL / TAX ───────────────────────────────────────────────────
    taxId:            ['tax id', 'ein', 'employer identification', 'tax identification', 'fein', 'federal ein', 'tin', 'federal tax', 'irs number', 'employer id number', 'tax id number', 'federal id'],
    taxIdType:        ['tax id type', 'ein or ssn', 'id type', 'tax type'],
    ownerName:        ['owner name', 'business owner', 'sole proprietor', 'principal name'],
    authorizedSignerName: ['authorized signer', 'authorized representative', 'signing authority', 'authorized signatory'],
    authorizedSignerTitle: ['signer title', 'representative title', 'authorized title', 'position title'],

    // ── D) PROFESSIONAL IDs ──────────────────────────────────────────────
    npi:              ['npi', 'national provider identifier', 'npi number', 'provider npi', 'type 1 npi', 'individual npi', 'dentist npi', 'nppes'],
    practiceNpi:      ['group npi', 'practice npi', 'organization npi', 'type 2 npi', 'billing npi', 'facility npi', 'entity npi'],
    caqhId:           ['caqh', 'caqh id', 'caqh number', 'caqh provider id', 'proview', 'caqh proview', 'caqh profile', 'caqh#'],
    caqhUsername:     ['caqh username', 'caqh login', 'proview username'],
    medicaidId:       ['medicaid id', 'medicaid number', 'medicaid provider id', 'state medicaid', 'medicaid pin'],
    medicareId:       ['medicare id', 'medicare number', 'ptan', 'medicare ptan', 'medicare provider', 'medicare pin'],

    // ── E) LICENSURE ─────────────────────────────────────────────────────
    stateLicenseNumber: ['license number', 'license #', 'dental license', 'state license', 'lic number', 'license no', 'license id', 'professional license number', 'lic #', 'license num', 'dental license number'],
    stateLicenseState:  ['license state', 'state of license', 'licensing state', 'lic state', 'licensed state', 'license issued by'],
    stateLicenseIssueDate: ['license issue date', 'license issued', 'license grant date', 'date issued'],
    stateLicenseExpiry: ['license expiration', 'license exp', 'license expires', 'lic exp date', 'license exp date', 'license renewal', 'expiration date'],
    deaNumber:        ['dea number', 'dea #', 'dea registration', 'dea certificate', 'dea reg number', 'drug enforcement', 'dea reg'],
    deaExpiry:        ['dea expiration', 'dea exp', 'dea expires', 'dea exp date', 'dea renewal'],
    deaState:         ['dea state', 'dea issued state', 'state of dea'],
    cdsNumber:        ['cds number', 'cds #', 'controlled substance', 'controlled dangerous substance', 'cds certificate', 'state cs number'],
    cdsExpiry:        ['cds expiration', 'cds exp', 'cds expires'],
    cdsState:         ['cds state', 'cds issued state'],

    // ── F) PRACTICE ──────────────────────────────────────────────────────
    practiceName:     ['practice name', 'clinic name', 'office name', 'facility name', 'group name', 'business name', 'legal name', 'entity name', 'practice legal name', 'organization name', 'doing business as', 'dba', 'practice dba'],
    practiceLegalName: ['legal business name', 'legal entity name', 'registered name', 'legal practice name'],
    practiceDoingBusinessAs: ['doing business as', 'dba', 'trade name', 'practice trade name'],
    practiceType:     ['practice type', 'office type', 'practice setting', 'type of practice', 'group or solo', 'clinic type'],
    practiceAddress1: ['practice address', 'office address', 'practice street', 'office street', 'service address', 'practice location', 'location address', 'primary office address', 'address line 1'],
    practiceAddress2: ['practice address 2', 'office address 2', 'suite', 'unit', 'floor', 'apt', 'address line 2'],
    practiceCity:     ['practice city', 'office city', 'city of practice', 'location city'],
    practiceState:    ['practice state', 'office state', 'state of practice', 'location state'],
    practiceZip:      ['practice zip', 'office zip', 'practice postal', 'office postal code', 'location zip'],
    practicePhone:    ['office phone', 'practice phone', 'business phone', 'main phone', 'office telephone', 'clinic phone', 'location phone'],
    practiceFax:      ['office fax', 'practice fax', 'business fax', 'fax number', 'clinic fax'],
    practiceEmail:    ['practice email', 'office email', 'clinic email', 'business email'],
    practiceWebsite:  ['website', 'web address', 'practice website', 'office website', 'url', 'www'],
    practiceTaxId:    ['practice tax id', 'group tax id', 'practice ein', 'group ein', 'entity tin', 'practice tin'],
    acceptingNewPatients: ['accepting new patients', 'new patients', 'accepting patients', 'open to new patients'],
    handicapAccessible: ['handicap accessible', 'ada accessible', 'wheelchair accessible', 'disability access'],
    languagesSpoken:  ['languages spoken', 'languages', 'second language', 'other languages', 'languages offered'],

    // ── G) MALPRACTICE / LIABILITY ───────────────────────────────────────
    malpracticeInsurer: ['malpractice carrier', 'malpractice insurer', 'insurance carrier', 'insurance company', 'professional liability carrier', 'liability insurer', 'coi issuer', 'malpractice company', 'insurance provider name'],
    malpracticeInsurerPhone: ['carrier phone', 'insurance phone', 'insurer phone', 'carrier contact phone'],
    malpracticePolicyNumber: ['policy number', 'policy #', 'malpractice policy', 'insurance policy number', 'policy no', 'policy id', 'coverage number'],
    malpracticePolicyType:   ['policy type', 'coverage type', 'claims made', 'occurrence', 'claims based'],
    malpracticeLimitPerClaim: ['per claim', 'per occurrence', 'each claim', 'each occurrence', 'limit per claim', 'per claim limit', 'coverage per claim', 'individual limit'],
    malpracticeLimitAggregate: ['aggregate', 'total coverage', 'aggregate limit', 'total limit', 'annual aggregate', 'combined limit'],
    malpracticeEffectiveDate: ['policy effective', 'effective date', 'coverage effective', 'insurance effective', 'policy start'],
    malpracticeExpiry:   ['policy expiration', 'policy exp', 'malpractice exp', 'insurance expires', 'coi expiration', 'coverage expiration', 'policy end date'],
    tailCoverageRequired: ['tail coverage', 'extended reporting', 'erp', 'tail required'],

    // ── H) EDUCATION ─────────────────────────────────────────────────────
    dentalSchoolName: ['dental school', 'school of dentistry', 'college of dentistry', 'dental college', 'dental university', 'dds school', 'dmd school', 'graduate school', 'school name'],
    dentalSchoolCity: ['dental school city', 'school city', 'college city'],
    dentalSchoolState: ['dental school state', 'school state', 'college state'],
    degreeType:       ['degree type', 'degree earned', 'dental degree', 'dds', 'dmd', 'degree awarded', 'type of degree'],
    graduationDate:   ['graduation date', 'date of graduation', 'degree date', 'date degree conferred', 'awarded date'],
    graduationYear:   ['graduation year', 'year graduated', 'grad year', 'year of graduation', 'class of'],
    residencyProgram: ['residency', 'residency program', 'residency training', 'advanced training', 'postgraduate training', 'gpr', 'general practice residency'],
    residencyHospital: ['residency hospital', 'residency institution', 'training hospital', 'training institution', 'residency site'],
    residencyStartDate: ['residency start', 'training start', 'residency from', 'residency begin'],
    residencyEndDate:  ['residency end', 'training end', 'residency to', 'residency complete'],
    internshipProgram: ['internship', 'internship program', 'clinical internship'],

    // ── I) CERTIFICATIONS ────────────────────────────────────────────────
    boardCertification: ['board certified', 'board certification', 'specialty board', 'specialty certification', 'abo', 'abos', 'board status'],
    boardCertifyingBody: ['certifying board', 'certifying body', 'board name', 'specialty board name'],
    boardCertDate:    ['certification date', 'board cert date', 'certified date', 'certification issued'],
    boardCertExpiry:  ['certification expiry', 'board cert expiry', 'certified expires', 'certification expires'],
    cprCertDate:      ['cpr date', 'cpr certification date', 'cpr issued', 'bls date', 'bls issued'],
    cprExpiry:        ['cpr expiry', 'cpr expires', 'bls expiry', 'bls expires', 'cpr exp'],
    cprProvider:      ['cpr provider', 'cpr issuer', 'bls provider', 'cpr training organization'],
    aclsCertDate:     ['acls date', 'acls certification date', 'acls issued'],
    aclsExpiry:       ['acls expiry', 'acls expires', 'acls exp'],

    // ── J) WORK HISTORY ──────────────────────────────────────────────────
    currentEmployer:  ['current employer', 'current practice', 'present employer', 'place of employment', 'employer name', 'current workplace'],
    currentEmployerAddress: ['current employer address', 'employer address', 'current practice address', 'workplace address'],
    currentEmployerPhone: ['employer phone', 'workplace phone', 'employer telephone'],
    currentEmployerStartDate: ['start date', 'employment start', 'date started', 'date of hire', 'employment begin', 'joined date'],
    previousEmployer1: ['previous employer', 'former employer', 'past employer', 'prior employer', 'employer 1', 'previous practice'],
    previousEmployer1Address: ['previous employer address', 'former employer address', 'prior employer address'],
    previousEmployer1Dates: ['previous employer dates', 'employment dates', 'from to', 'dates of employment'],
    previousEmployer1Reason: ['reason for leaving', 'reason left', 'leaving reason', 'departure reason'],
    gapsExplanation:  ['gap explanation', 'gaps in employment', 'explain gap', 'employment gap', 'gap in work history'],

    // ── K) SPECIALTY ─────────────────────────────────────────────────────
    primarySpecialty: ['primary specialty', 'dental specialty', 'specialty', 'specialization', 'field of practice', 'area of specialty', 'provider specialty', 'type of dentistry'],
    secondarySpecialty: ['secondary specialty', 'additional specialty', 'other specialty', 'subspecialty'],

    // ── L) HOSPITAL AFFILIATIONS ─────────────────────────────────────────
    hospital1Name:    ['hospital name', 'hospital affiliation', 'affiliated hospital', 'name of hospital', 'hospital 1', 'facility name'],
    hospital1Address: ['hospital address', 'hospital street', 'affiliated hospital address'],
    hospital1PrivilegeType: ['privilege type', 'hospital privileges', 'admitting privileges', 'privilege status'],
    hospital1StartDate: ['hospital start date', 'privileges since', 'affiliation date', 'hospital from'],

    // ── M) CLAIMS / HISTORY ──────────────────────────────────────────────
    hasPendingClaims: ['pending claims', 'malpractice claims', 'any claims', 'claims history', 'pending litigation', 'lawsuits pending'],
    hasSettledClaims: ['settled claims', 'prior claims', 'resolved claims', 'past claims', 'settled lawsuits'],
    hasDisciplinaryActions: ['disciplinary action', 'board action', 'sanction', 'reprimand', 'disciplinary history'],
    hasLicenseRevocations: ['license revocation', 'license suspended', 'license action', 'license restriction', 'license history'],
    hasCriminalHistory: ['criminal history', 'felony', 'misdemeanor', 'criminal conviction', 'criminal record'],
    hasHospitalPrivilegesDenied: ['hospital privileges denied', 'privileges revoked', 'denied privileges', 'hospital action'],

    // ── N) PORTAL / ATTESTATION ──────────────────────────────────────────
    attestationDate:  ['attestation date', 'signed date', 'signature date', 'date signed', 'today date', 'current date'],
    effectiveDate:    ['effective date', 'enrollment effective', 'start date', 'contract effective'],
    credentialingContactName: ['credentialing contact', 'contact person', 'contact name', 'office manager', 'coordinator name'],
    credentialingContactEmail: ['credentialing contact email', 'contact email', 'office manager email', 'coordinator email'],
    credentialingContactPhone: ['credentialing contact phone', 'contact phone', 'coordinator phone', 'office manager phone'],
};

// ============================================================
// FIELD_PATTERNS_REGEX  — Tier 2 matcher (runs after string miss)
// One compiled RegExp per schema key. Handles abbreviations,
// punctuation variants, optional words, and common misspellings
// that can't be caught by simple substring arrays.
// ============================================================
const FIELD_PATTERNS_REGEX = {
    // ── IDENTITY ──────────────────────────────────────────────
    providerName:     /\b(provider|dentist|doctor|physician|applicant|practitioner)\s*(full\s*)?name\b|\bname\s*of\s*(provider|dentist|physician)\b|\bfull\s*name\b/i,
    firstName:        /\b(first\s*name|1st\s*name|fname|given\s*name|f\.\s*name|forename)\b/i,
    lastName:         /\b(last\s*name|surname|family\s*name|lname|l\.\s*name)\b/i,
    middleName:       /\b(middle\s*(name|initial)|mid\.?\s*name|m\.i\.?)\b/i,
    suffix:           /\b(name\s*suffix|suffix|jr\.?|sr\.?|i{1,3}|title\s*suffix)\b/i,
    maidenName:       /\b(maiden|birth\s*name|prior\s*name|former\s*name|name\s*at\s*birth)\b/i,
    dateOfBirth:      /\b(d\.?o\.?b\.?|date\s+of\s+birth|birth\s*[-\/]?\s*date|born)\b/i,
    ssn:              /\b(s\.?s\.?n\.?|social\s*sec(urity)?\s*(no\.?|#|num(ber)?)?)\b/i,
    gender:           /\b(gender|sex(?!ual))\b/i,

    // ── CONTACT ────────────────────────────────────────────────
    email:            /\b(e[-.]?mail(\s*address)?)\b/i,
    phone:            /\b(ph(one)?|tel(ephone)?)(\s*(no\.?|#|num(ber)?))?\b/i,
    cellPhone:        /\b(cell|mobile|cellular)(\s*(ph(one)?|no\.?|#))?\b/i,
    fax:              /\b(fax)(\s*(no\.?|#|num(ber)?))?\b/i,
    homeAddress1:     /\b(home|personal|residential)\s*(address|street|addr)\.?(\s*line\s*1)?\b/i,
    homeCity:         /\b(home|residential|personal)\s*city\b/i,
    homeState:        /\b(home|residential|personal)\s*state\b/i,
    homeZip:          /\b(home|residential|personal)\s*(zip|postal)\b/i,
    mailingAddress1:  /\b(mailing|mail|correspondence|po\s*box)\s*(address|street|addr)\.?(\s*line\s*1)?\b/i,
    mailingCity:      /\bmailing\s*city\b/i,
    mailingState:     /\bmailing\s*state\b/i,
    mailingZip:       /\bmailing\s*(zip|postal)\b/i,

    // ── LEGAL / TAX ────────────────────────────────────────────
    taxId:            /\b(e\.?i\.?n\.?|f\.?e\.?i\.?n\.?|t\.?i\.?n\.?|tax\s*[-\/]?\s*i\.?d\.?|federal\s+(id|tax|ein)|irs\s*(no\.?|#)?)\b/i,
    taxIdType:        /\btax\s*(id\s*)?type\b|\bein\s*or\s*ssn\b/i,

    // ── PROFESSIONAL IDs ───────────────────────────────────────
    npi:              /\b(npi|national\s+provider\s+ident(ifier)?)(\s*(no\.?|#|num(ber)?))?\b/i,
    practiceNpi:      /\b(group|practice|org(anization)?|type\s*2|billing|facility)\s*npi\b/i,
    caqhId:           /\b(caqh|proview)(\s*(id|#|no\.?|num(ber)?))?\b/i,
    medicaidId:       /\b(medicaid)(\s*(id|#|no\.?|provider\s*id|pin))?\b/i,
    medicareId:       /\b(medicare|ptan)(\s*(id|#|no\.?|provider\s*id|pin))?\b/i,

    // ── LICENSURE ──────────────────────────────────────────────
    stateLicenseNumber: /\b(lic(ense)?)(\s*(no\.?|#|num(ber)?|id))?\b/i,
    stateLicenseState:  /\b(lic(ense)?|licensed?)\s*state\b|\bstate\s*of\s*lic(ense)?\b/i,
    stateLicenseExpiry: /\blic(ense)?\s*(exp(ir(y|ation|es|ed))?|renewal)\b/i,
    deaNumber:          /\b(dea)(\s*(no\.?|#|num(ber)?|reg(istration)?))?\b/i,
    deaExpiry:          /\bdea\s*(exp(ir(y|ation|es|ed))?)\b/i,
    cdsNumber:          /\b(cds|controlled\s*(dangerous)?\s*substance)(\s*(no\.?|#|cert(ificate)?))?\b/i,
    cdsExpiry:          /\bcds\s*(exp(ir(y|ation|es|ed))?)\b/i,

    // ── PRACTICE ───────────────────────────────────────────────
    practiceName:       /\b(practice|clinic|office|facility|group|business|entity|organization)\s*(legal\s+)?name\b|\bdba\b|\bdoing\s+business\s+as\b/i,
    practiceNpi:        /\b(group|practice|org|type\s*2|billing)\s*npi\b/i,
    practiceAddress1:   /\b(practice|office|clinic|facility|service|primary)\s*(address|addr|street|location)(\s*line\s*1)?\b/i,
    practiceAddress2:   /\b(practice|office)?\s*(address|addr)\s*(line\s*2|2)\b|\b(suite|ste|apt|unit|floor|bldg)\.?\b/i,
    practiceCity:       /\b(practice|office|clinic|location)?\s*city\b/i,
    practiceState:      /\b(practice|office|clinic|location)?\s*state\b/i,
    practiceZip:        /\b(practice|office|location)?\s*(zip|postal)(\s*code)?\b/i,
    practicePhone:      /\b(office|practice|clinic|business|main|location)\s*(ph(one)?|tel(ephone)?)(\s*(no\.?|#))?\b/i,
    practiceFax:        /\b(office|practice|clinic|business)\s*(fax)(\s*(no\.?|#))?\b/i,

    // ── MALPRACTICE ────────────────────────────────────────────
    malpracticeInsurer:     /\b(malpractice|professional\s*liability|liability)\s*(carrier|insurer|company|provider|insurance)\b/i,
    malpracticePolicyNumber:/\b(policy)(\s*(no\.?|#|num(ber)?|id))?\b/i,
    malpracticeLimitPerClaim: /\b(per\s*(claim|occurrence)|each\s*(claim|occurrence)|individual\s*limit)\b/i,
    malpracticeLimitAggregate:/\b(aggregate|annual\s*limit|total\s*(coverage|limit)|combined\s*limit)\b/i,
    malpracticeEffectiveDate: /\b(policy|coverage|insurance)\s*effective\b|\beffective\s*date\b/i,
    malpracticeExpiry:       /\b(policy|malpractice|coi|insurance|coverage)\s*(exp(ir(y|ation|es|ed))?|end)\b/i,

    // ── EDUCATION ──────────────────────────────────────────────
    dentalSchoolName:   /\b(dental\s*)?(school|college|university)\s*(of\s*dentistry|name)?\b|\b(dds|dmd)\s*school\b/i,
    graduationYear:     /\b(grad(uation)?\s*year|year\s*(grad(uated)?|of\s*grad)|class\s*of)\b/i,
    graduationDate:     /\b(grad(uation)?\s*date|date\s*(of\s*)?grad(uation)?|degree\s*date)\b/i,
    degreeType:         /\b(degree|dds|dmd)(\s*(type|awarded|earned|conferred))?\b/i,

    // ── SPECIALTY ──────────────────────────────────────────────
    primarySpecialty:   /\b(primary\s*)?(specialty|specialization|speciality|type\s*of\s*(dentistry|practice))\b/i,

    // ── CERTIFICATIONS ─────────────────────────────────────────
    boardCertification: /\bboard\s*(cert(ified|ification)?)\b/i,
    cprExpiry:          /\b(cpr|bls)\s*(exp(ir(y|ation|es))?|renewal)\b/i,
    cprCertDate:        /\b(cpr|bls)\s*(cert(ification)?\s*)?(date|issued)\b/i,
};

// ── GENERIC sub-field labels that need group-label context to resolve ──
// If a field's signal text matches only these words, we need to climb
// the DOM to find the parent group header (e.g. "PROVIDER NAME").
const GENERIC_SIGNAL_WORDS = new Set([
    'last', 'first', 'middle', 'mi', 'name', 'city', 'state', 'zip', 'county',
    'phone', 'fax', 'no', '#', 'number', 'date', 'year', 'address', 'street',
    'country', 'email', 'suffix', 'code', 'type', 'id', 'from', 'to',
]);

// Initialize
// NOTE: adobe-sign-prefill.js and pdf-filler.js are loaded AFTER this script by the manifest.
// The async initialize() IIFE suspends on its first `await`, which lets Chrome inject the other
// two scripts and define their globals BEFORE the await resolves. So by the time we check
// `typeof isDirectAdobeSignPage`, it is already defined.
(async function initialize() {
    console.log('[TodaysDental] Content script initializing...');

    try {
        const settingsResponse = await sendMessage({ action: 'GET_SETTINGS' });
        settings = settingsResponse.settings || {};
    } catch (e) {
        console.warn('[TodaysDental] GET_SETTINGS failed:', e.message);
        settings = {};
    }

    try {
        const portalResponse = await sendMessage({
            action: 'DETECT_PORTAL',
            payload: { hostname: window.location.hostname, url: window.location.href, pageTitle: document.title }
        });
        if (portalResponse && portalResponse.success) {
            currentAdapter = portalResponse.adapter;
            console.log('[TodaysDental] Portal detected:', currentAdapter.portalName);
            injectFloatingButton();
            observeFormChanges();
        }
    } catch (e) {
        console.warn('[TodaysDental] DETECT_PORTAL failed:', e.message);
    }

    // ── Adobe Sign: direct tab ──────────────────────────────────────────────
    // (globals from adobe-sign-prefill.js are now loaded because the first awaits above
    //  yielded control, allowing Chrome to inject and execute the next scripts)
    if (typeof isDirectAdobeSignPage === 'function' && isDirectAdobeSignPage()) {
        console.log('[TodaysDental] Direct Adobe Sign page — waiting for form render');
        injectFloatingButton(); // make button available even before form fully renders
        try {
            await waitForAdobeSignForm();
            showNotification('Adobe Sign form ready. Click the TodaysDental button to autofill all fields.', 'info');
        } catch (e) {
            console.warn('[TodaysDental] Adobe Sign form did not render:', e.message);
            showNotification('Adobe Sign form detected. Try clicking the button to autofill.', 'info');
        }
        return; // fillAllFields() handles the rest when user clicks the FAB
    }

    // ── Adobe Sign: iFrame embedded on payer page ───────────────────────────
    if (typeof detectAdobeSignIframes === 'function') {
        const iframes = detectAdobeSignIframes();
        if (iframes.length > 0) {
            console.log('[TodaysDental] Found ' + iframes.length + ' Adobe Sign iFrame(s)');
            injectAdobeSignBanner(async function() {
                try {
                    const stored = await chrome.storage.local.get(['selectedProvider']);
                    if (!stored.selectedProvider) { showNotification('Please select a provider first.', 'warning'); return; }
                    const pr = await sendMessage({ action: 'GET_AUTOFILL_PAYLOAD', payload: { providerId: stored.selectedProvider.providerId } });
                    if (!pr || !pr.success) { showNotification('Failed to load provider data.', 'error'); return; }
                    const fieldMap = (typeof getFieldMapForCurrentPage === 'function') ? getFieldMapForCurrentPage() : {};
                    const count = prefillAdobeSignIframes(pr.payload.fields, fieldMap);
                    showNotification(count > 0 ? 'Prefilled ' + count + ' Adobe Sign iFrame(s).' : 'No iFrames prefilled.', count > 0 ? 'success' : 'warning');
                } catch (e) { console.error('[TodaysDental] Adobe Sign prefill error:', e); }
            });
        }
    }

    // ── PDF fillable form links ─────────────────────────────────────────────
    if (typeof detectPdfLinks === 'function') {
        try {
            const stored = await chrome.storage.local.get(['selectedProvider']);
            if (stored.selectedProvider) {
                const pr = await sendMessage({ action: 'GET_AUTOFILL_PAYLOAD', payload: { providerId: stored.selectedProvider.providerId } });
                if (pr && pr.success) {
                    injectPdfFillButtons(pr.payload);
                    if (typeof observePdfLinks === 'function') observePdfLinks(function() { return pr.payload; });
                }
            }
        } catch (e) { console.warn('[TodaysDental] PDF filler init error:', e.message); }
    }
})();

function sendMessage(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(response);
        });
    });
}

function injectFloatingButton() {
    const existing = document.getElementById(`${EXTENSION_ID}-fab`);
    if (existing) existing.remove();

    const fab = document.createElement('div');
    fab.id = `${EXTENSION_ID}-fab`;
    fab.className = 'td-credentialing-fab';
    fab.innerHTML = `
    <div class="td-fab-main"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg></div>
    <div class="td-fab-badge td-hidden">0</div>
    <div class="td-fab-tooltip">TodaysDental Autofill</div>
  `;
    fab.addEventListener('click', toggleReviewPanel);
    document.body.appendChild(fab);
    scanPageForForms();
}

function toggleReviewPanel() {
    isReviewPanelOpen ? closeReviewPanel() : openReviewPanel();
}

async function openReviewPanel() {
    const authStatus = await sendMessage({ action: 'GET_AUTH_STATUS' });
    if (!authStatus.isAuthenticated) { showNotification('Please log in via the extension popup first.', 'warning'); return; }

    const stored = await chrome.storage.local.get(['selectedProvider']);
    if (!stored.selectedProvider) { showNotification('Please select a provider from the extension popup first.', 'warning'); return; }

    const payloadResponse = await sendMessage({ action: 'GET_AUTOFILL_PAYLOAD', payload: { providerId: stored.selectedProvider.providerId, portal: currentAdapter?.portalId } });
    if (!payloadResponse.success) { showNotification(payloadResponse.error || 'Failed to fetch provider data', 'error'); return; }

    autofillPayload = payloadResponse.payload;
    createReviewPanel();
    isReviewPanelOpen = true;
}

function closeReviewPanel() {
    const panel = document.getElementById(`${EXTENSION_ID}-panel`);
    if (panel) { panel.classList.add('td-panel-closing'); setTimeout(() => panel.remove(), 300); }
    isReviewPanelOpen = false;
}

function createReviewPanel() {
    const existing = document.getElementById(`${EXTENSION_ID}-panel`);
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = `${EXTENSION_ID}-panel`;
    panel.className = 'td-credentialing-panel';
    const { fields, documents, requirements } = autofillPayload;

    panel.innerHTML = `
    <div class="td-panel-header"><div class="td-panel-title"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg> TodaysDental Autofill</div><button class="td-panel-close">&times;</button></div>
    <div class="td-panel-content">
      <div class="td-panel-section"><strong>${getFieldValue(fields, 'firstName')} ${getFieldValue(fields, 'lastName')}</strong><span>NPI: ${getFieldValue(fields, 'npi') || 'N/A'}</span></div>
      <div class="td-panel-section"><span class="td-badge td-badge-${requirements.readiness}">${requirements.readiness}</span><span>${fields.length} fields, ${documents.length} documents ready</span></div>
    </div>
    <div class="td-panel-footer"><button class="td-btn td-btn-secondary" data-action="scan">Re-scan</button><button class="td-btn td-btn-primary" data-action="fill">Fill All Fields</button></div>
  `;
    panel.querySelector('.td-panel-close').addEventListener('click', closeReviewPanel);
    panel.querySelector('[data-action="scan"]').addEventListener('click', () => scanPageForForms());
    panel.querySelector('[data-action="fill"]').addEventListener('click', () => fillAllFields());
    document.body.appendChild(panel);
}

function showNotification(message, type = 'info') {
    const existing = document.querySelector('.td-notification');
    if (existing) existing.remove();
    const notification = document.createElement('div');
    notification.className = `td-notification td-notification-${type}`;
    notification.innerHTML = `<span>${message}</span><button class="td-notification-close">&times;</button>`;
    notification.querySelector('.td-notification-close').addEventListener('click', () => notification.remove());
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 5000);
}

// ──────────────────────────────────────────────────────────────────────────
// UNIVERSAL FIELD SCANNER — 5-Signal Multi-Source Match + Fuzzy Scoring
// ──────────────────────────────────────────────────────────────────────────

/**
 * Collects all meaningful text signals for a given form element.
 * Returns a single lowercase string combining:
 *   1) aria-label / aria-labelledby resolved text
 *   2) <label for="id"> text
 *   3) Parent element text (up to 3 levels, stripping child input text)
 *   4) name attribute (camelCase split → spaces)
 *   5) id attribute (camelCase/hyphen split → spaces)
 *   6) placeholder
 */
function getFieldSignals(el) {
    const parts = [];

    // 1. aria-label (highest confidence)
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) parts.push(ariaLabel);

    // 2. aria-labelledby resolved
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
        const labelEl = document.getElementById(labelledBy);
        if (labelEl) parts.push(labelEl.textContent);
    }

    // 3. <label for="id">
    if (el.id) {
        const labelEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (labelEl) { const c = labelEl.cloneNode(true); c.querySelectorAll('input,select,textarea').forEach(x => x.remove()); parts.push(c.textContent); }
    }

    // 4. Closest <label> ancestor
    const closestLabel = el.closest('label');
    if (closestLabel) { const c = closestLabel.cloneNode(true); c.querySelectorAll('input,select,textarea').forEach(x => x.remove()); parts.push(c.textContent); }

    // 5. Parent context text (climb 3 levels, grab direct text nodes only — avoids sibling input values)
    let node = el.parentElement;
    for (let i = 0; i < 3 && node; i++, node = node.parentElement) {
        const directText = [...node.childNodes]
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent.trim())
            .join(' ');
        if (directText.length > 1) { parts.push(directText); break; } // stop at first level with real text
    }

    // 6. name attribute — split camelCase and hyphens into words
    if (el.name) parts.push(el.name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' '));

    // 7. id attribute — same splitting
    if (el.id) parts.push(el.id.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' '));

    // 8. placeholder (lowest confidence)
    if (el.placeholder) parts.push(el.placeholder);

    // 9. data-automation-id (Adobe Sign, Availity, etc.)
    const automationId = el.getAttribute('data-automation-id') || el.getAttribute('data-field-name') || el.getAttribute('data-label');
    if (automationId) parts.push(automationId.replace(/[-_]/g, ' '));

    return parts.join(' ').toLowerCase().trim();
}

/**
 * Group label signal resolver.
 * When a field's own signals reduce to only generic words ("last", "first",
 * "city", "zip", etc.), this function climbs up to 8 DOM levels looking for
 * a section header (<legend>, <th>, <label>, or any element with class/id
 * containing "label", "heading", "title", "group", "section", "header").
 * Returns "<groupHeader> <ownSignal>" so downstream matchers get full context.
 *
 * Example: "PROVIDER NAME" header + "LAST" field → "provider name last" → lastName ✓
 */
function getGroupLabelSignal(el, ownSignal) {
    // Check if ownSignal is only generic words
    const ownWords = ownSignal.replace(/[^a-z\s]/g, '').trim().split(/\s+/).filter(Boolean);
    const allGeneric = ownWords.length > 0 && ownWords.every(w => GENERIC_SIGNAL_WORDS.has(w));
    if (!allGeneric) return ownSignal; // not generic — no climbing needed

    // Climb up to 8 ancestor levels looking for a group label
    const HEADER_TAGS = new Set(['legend', 'th', 'caption']);
    const LABEL_CLASS_PATTERN = /label|heading|title|group|section|header|caption|question/i;
    let node = el.parentElement;
    for (let depth = 0; depth < 8 && node; depth++, node = node.parentElement) {
        // Check all direct children of this ancestor for header-like text nodes
        const children = [...(node.children || [])];
        for (const child of children) {
            if (child === el || child.contains(el)) continue; // don't read sibling inputs
            const tag = child.tagName && child.tagName.toLowerCase();
            const cls = (typeof child.className === 'string' ? child.className : '');
            const isHeader = HEADER_TAGS.has(tag) ||
                             LABEL_CLASS_PATTERN.test(cls) ||
                             LABEL_CLASS_PATTERN.test(child.id || '') ||
                             ['strong', 'b', 'label', 'span', 'p', 'div', 'td'].includes(tag);
            if (!isHeader) continue;
            // Skip if child contains any form input (it's a field wrapper, not a header)
            if (child.querySelector('input, select, textarea')) continue;
            const text = child.textContent.replace(/[*:\r\n]+/g, ' ').trim().toLowerCase();
            if (text.length > 2 && text.length < 80) {
                const combined = (text + ' ' + ownSignal).trim();
                console.log(`[TodaysDental] Group label resolved: "${ownSignal}" → "${combined}"`);
                return combined;
            }
        }
        // Also check the node tag itself (e.g. <legend>)
        if (HEADER_TAGS.has(node.tagName && node.tagName.toLowerCase())) {
            if (!node.querySelector('input, select, textarea')) {
                const text = node.textContent.replace(/[*:\r\n]+/g, ' ').trim().toLowerCase();
                if (text.length > 2 && text.length < 80) {
                    return (text + ' ' + ownSignal).trim();
                }
            }
        }
    }
    return ownSignal; // no group label found
}

/**
 * Tries to match a signal string against FIELD_PATTERNS string arrays.
 * Returns matched schemaKey and score (1.0 = exact, 0.7 = substring) or null.
 */
function tryStringMatch(signals) {
    for (const [schemaKey, patterns] of Object.entries(FIELD_PATTERNS)) {
        for (const pattern of patterns) {
            // Exact substring — signal contains the full pattern string
            if (signals.includes(pattern.toLowerCase())) {
                return { schemaKey, score: 1.0, method: 'string' };
            }
        }
    }
    return null;
}

/**
 * Tries to match a signal string against FIELD_PATTERNS_REGEX.
 * Returns matched schemaKey and score (0.9 fixed) or null.
 */
function tryRegexMatch(signals) {
    for (const [schemaKey, regex] of Object.entries(FIELD_PATTERNS_REGEX)) {
        if (regex.test(signals)) {
            return { schemaKey, score: 0.9, method: 'regex' };
        }
    }
    return null;
}

/**
 * Tries fuzzy word-overlap against FIELD_PATTERNS string arrays.
 * Returns best match above threshold, or null.
 */
function tryFuzzyMatch(signals, threshold = 0.6) {
    let bestScore = threshold - 0.001; // must beat threshold
    let bestCandidates = [];
    for (const [schemaKey, patterns] of Object.entries(FIELD_PATTERNS)) {
        let keyBest = 0;
        for (const pattern of patterns) {
            const s = wordOverlapScore(pattern, signals);
            if (s > keyBest) keyBest = s;
        }
        if (keyBest > bestScore) { bestScore = keyBest; bestCandidates = [{ schemaKey, score: keyBest }]; }
        else if (keyBest === bestScore && keyBest > (threshold - 0.001)) bestCandidates.push({ schemaKey, score: keyBest });
    }
    return bestCandidates.length > 0 ? bestCandidates : null;
}

/**
 * Computes a word-overlap score between a dictionary pattern and a field's signal text.
 * Score = (# matching words) / (# words in pattern).
 * Returns 0–1. Threshold 0.6 recommended to avoid false positives.
 */
function wordOverlapScore(pattern, signalText) {
    const patternWords = pattern.toLowerCase().split(/\s+/).filter(w => w.length > 1);
    if (patternWords.length === 0) return 0;
    const signalWords = signalText.split(/\s+/);
    const matched = patternWords.filter(pw => signalWords.some(sw => sw.includes(pw) || pw.includes(sw)));
    return matched.length / patternWords.length;
}

/**
 * Returns the surrounding context text of an element (class names + id of parent chain)
 * Used for disambiguation when two schema keys score the same.
 */
function getParentContext(el) {
    const ctx = [];
    let node = el.parentElement;
    for (let i = 0; i < 5 && node; i++, node = node.parentElement) {
        if (node.className && typeof node.className === 'string') ctx.push(node.className);
        if (node.id) ctx.push(node.id);
    }
    return ctx.join(' ').toLowerCase();
}

/**
 * Context prefix hints: when signal text is ambiguous (e.g. just "city"),
 * check if parent context matches a prefix to disambiguate.
 * Maps schema key prefix → contextual keywords that suggest that prefix.
 */
const CONTEXT_PREFIX_HINTS = {
    practice:  ['practice', 'office', 'clinic', 'facility', 'location', 'provider location'],
    home:      ['home', 'personal', 'residential', 'provider home', 'individual'],
    mailing:   ['mailing', 'mail', 'correspondence', 'po box'],
    malpractice: ['malpractice', 'liability', 'insurance', 'coi'],
    dental:    ['dental', 'school', 'education', 'graduate'],
    hospital:  ['hospital', 'affiliation', 'privilege'],
};

function disambiguateByContext(candidates, el) {
    if (candidates.length <= 1) return candidates[0] || null;
    const ctx = getParentContext(el);
    for (const [prefix, hints] of Object.entries(CONTEXT_PREFIX_HINTS)) {
        if (hints.some(h => ctx.includes(h))) {
            const prefixed = candidates.find(c => c.schemaKey.toLowerCase().startsWith(prefix));
            if (prefixed) return prefixed;
        }
    }
    return candidates[0]; // default: highest scoring
}

/**
 * Main scanner — replaces the old single-signal substring scanner.
 * Priority: adapter fieldMap exact → fuzzy multi-signal match
 */
function scanPageForForms() {
    const SCORE_THRESHOLD = 0.6;

    // Only scan visible, interactive elements
    const inputs = [...document.querySelectorAll('input, select, textarea')].filter(el => {
        if (el.type === 'hidden' || el.disabled || el.readOnly) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    });

    const matchedFields = [];

    // ── Pass 1: Adapter fieldMap — exact ID/name selectors (highest confidence) ──
    if (currentAdapter && currentAdapter.tier >= 1 && currentAdapter.fieldMap) {
        for (const [selector, mapping] of Object.entries(currentAdapter.fieldMap)) {
            const element =
                document.getElementById(selector) ||
                document.querySelector(`[name="${selector}"]`) ||
                document.querySelector(`[name*="${selector}"]`) ||
                document.querySelector(`[id*="${selector}"]`) ||
                document.querySelector(`[data-automation-id="${selector}"]`) ||
                document.querySelector(`[data-field-name="${selector}"]`);

            if (element && !matchedFields.some(m => m.element === element)) {
                matchedFields.push({ element, schemaKey: mapping.schemaKey, fieldType: mapping.type, labelText: selector, source: 'adapter' });
            }
        }
        console.log(`[TodaysDental] Adapter matched ${matchedFields.length} fields`);
    }

    // ── Pass 2: Fuzzy multi-signal heuristic for remaining fields ──
    for (const input of inputs) {
        if (matchedFields.some(m => m.element === input)) continue; // already matched

        const rawSignals = getFieldSignals(input);
        if (!rawSignals) continue;

        // ── Group-label resolution: climb DOM if signal is only generic words ──
        const signals = getGroupLabelSignal(input, rawSignals);

        // ── 4-step cascade: string → regex → fuzzy → give up ──
        let bestCandidates = [];
        let matchMethod = 'none';

        // Step 1: String array exact/substring match (fastest, highest confidence)
        const strMatch = tryStringMatch(signals);
        if (strMatch) {
            bestCandidates = [strMatch];
            matchMethod = 'string';
        }

        // Step 2: Regex match (handles abbreviations, punctuation, spacing variants)
        if (bestCandidates.length === 0) {
            const rxMatch = tryRegexMatch(signals);
            if (rxMatch) {
                bestCandidates = [rxMatch];
                matchMethod = 'regex';
            }
        }

        // Step 3: Fuzzy word-overlap (catches everything else)
        if (bestCandidates.length === 0) {
            const fuzzy = tryFuzzyMatch(signals, SCORE_THRESHOLD);
            if (fuzzy) {
                bestCandidates = fuzzy;
                matchMethod = 'fuzzy';
            }
        }

        if (bestCandidates.length > 0) {
            const winner = disambiguateByContext(bestCandidates, input);
            const displayLabel = signals.split(' ').slice(0, 5).join(' ');
            matchedFields.push({
                element: input,
                schemaKey: winner.schemaKey,
                labelText: displayLabel,
                score: winner.score,
                source: 'heuristic'
            });
            console.log(`[TodaysDental] Matched "${displayLabel}" → ${winner.schemaKey} (score: ${winner.score.toFixed(2)})`);
        }
    }

    // ── Update FAB badge ──
    const fab = document.getElementById(`${EXTENSION_ID}-fab`);
    if (fab) {
        const badge = fab.querySelector('.td-fab-badge');
        if (matchedFields.length > 0) { badge.textContent = matchedFields.length; badge.classList.remove('td-hidden'); }
        else { badge.classList.add('td-hidden'); }
    }

    const adapterCount = matchedFields.filter(m => m.source === 'adapter').length;
    const heuristicCount = matchedFields.filter(m => m.source === 'heuristic').length;
    console.log(`[TodaysDental] Scan complete: ${matchedFields.length} fields (${adapterCount} adapter, ${heuristicCount} heuristic)`);
    return matchedFields;
}

/**
 * Parses a date string in any common format and returns a Date object.
 * Handles: ISO (2024-06-15), ISO-Z (2024-06-15T00:00:00Z),
 *          MM/DD/YYYY, MM-DD-YYYY, DD/MM/YYYY (heuristic), YYYY/MM/DD,
 *          and partial formats (MM/YYYY, YYYY).
 * Returns null if unparseable.
 */
function parseAnyDate(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    // Already a valid Date string passed as ISO
    let d = new Date(s);
    if (!isNaN(d.getTime())) return d;
    // MM/DD/YYYY or MM-DD-YYYY
    const mdy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (mdy) {
        d = new Date(+mdy[3], +mdy[1] - 1, +mdy[2]);
        if (!isNaN(d.getTime())) return d;
    }
    // YYYY/MM/DD
    const ymd = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (ymd) {
        d = new Date(+ymd[1], +ymd[2] - 1, +ymd[3]);
        if (!isNaN(d.getTime())) return d;
    }
    return null;
}

/**
 * Formats a Date object into the string format expected by the input.
 *  - type="date"  → YYYY-MM-DD  (required by browser date pickers)
 *  - type="month" → YYYY-MM
 *  - type="year"  → YYYY
 *  - everything else → MM/DD/YYYY  (most common US masked text format)
 */
function formatDateForInput(d, inputType) {
    const pad = n => String(n).padStart(2, '0');
    const yyyy = d.getFullYear();
    const mm   = pad(d.getMonth() + 1);
    const dd   = pad(d.getDate());
    switch (inputType) {
        case 'date':  return `${yyyy}-${mm}-${dd}`;
        case 'month': return `${yyyy}-${mm}`;
        default:      return `${mm}/${dd}/${yyyy}`; // text, tel, etc.
    }
}

/**
 * React/framework-compatible field fill.
 * Handles date inputs specially — detects type="date" and masked text date fields,
 * normalises the value to the required format, then fires all framework events.
 */
function fillField(element, value) {
    const tag  = element.tagName.toLowerCase();
    const type = (element.type || '').toLowerCase();

    // ── SELECT ──────────────────────────────────────────────────────────────
    if (tag === 'select') {
        const v = String(value).toLowerCase();
        for (const option of element.options) {
            if (option.value.toLowerCase() === v ||
                option.text.toLowerCase()  === v ||
                option.text.toLowerCase().includes(v) ||
                v.includes(option.text.toLowerCase())) {
                element.value = option.value;
                break;
            }
        }
    }

    // ── CHECKBOX / RADIO ────────────────────────────────────────────────────
    else if (type === 'checkbox' || type === 'radio') {
        const truthy = ['true', 'yes', '1', 'on', 'checked'].includes(String(value).toLowerCase());
        if (element.checked === truthy) return;
        element.checked = truthy;
    }

    // ── DATE INPUT (type="date") ─────────────────────────────────────────────
    // Browser date pickers ONLY accept YYYY-MM-DD. Any other format silently fails.
    else if (type === 'date' || type === 'month') {
        const parsed = parseAnyDate(value);
        if (!parsed) {
            console.warn(`[TodaysDental] Cannot parse date value: "${value}" for`, element);
            return;
        }
        const formatted = formatDateForInput(parsed, type);
        console.log(`[TodaysDental] Date field: "${value}" → "${formatted}" (type=${type})`);
        setNativeValue(element, formatted);
    }

    // ── TEXT / TEL / OTHER — detect MM/DD/YYYY masked date fields ────────────
    else {
        let fillValue = String(value);
        // Detect if this is a date field expecting MM/DD/YYYY format
        // Heuristic: placeholder contains slashes or "mm" or "yyyy"
        const ph = (element.placeholder || '').toLowerCase();
        const isDateMask = ph.includes('mm/dd') || ph.includes('dd/mm') ||
                           ph.includes('mm-dd') || ph.includes('yyyy') ||
                           ph.match(/[\d_]{2}[\/\-][\d_]{2}[\/\-][\d_]{4}/);
        if (isDateMask) {
            const parsed = parseAnyDate(value);
            if (parsed) {
                fillValue = formatDateForInput(parsed, 'text'); // → MM/DD/YYYY
                console.log(`[TodaysDental] Masked date: "${value}" → "${fillValue}"`);
            }
        }
        setNativeValue(element, fillValue);
    }

    // ── Fire all framework events ────────────────────────────────────────────
    ['focus', 'input', 'change', 'blur', 'keyup'].forEach(evtType => {
        element.dispatchEvent(new Event(evtType, { bubbles: true, cancelable: true }));
    });
    try {
        element.dispatchEvent(new InputEvent('input', {
            bubbles: true, cancelable: true,
            inputType: 'insertText',
            data: String(value)
        }));
    } catch (_) { /* older browsers */ }
}

/** Uses the native HTMLInputElement value setter to bypass React's event system. */
function setNativeValue(element, value) {
    const proto = Object.getPrototypeOf(element);
    const desc  = Object.getOwnPropertyDescriptor(proto, 'value') ||
                  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (desc && desc.set) {
        desc.set.call(element, value);
    } else {
        element.value = value;
    }
}


async function fillAllFields() {
    if (!autofillPayload) { showNotification('No autofill data available.', 'error'); return; }

    // ── Normalize payload fields to always be an array of {schemaKey, value} ──
    // The API returns: { fields: [{schemaKey, value, confidence, source}] }
    // But also handle the case where payload itself IS the flat fields object
    let payloadFields = [];
    if (Array.isArray(autofillPayload.fields)) {
        payloadFields = autofillPayload.fields;
    } else if (autofillPayload.fields && typeof autofillPayload.fields === 'object') {
        // Flat map: { firstName: 'John', lastName: 'Doe' }
        payloadFields = Object.entries(autofillPayload.fields).map(([k, v]) => ({ schemaKey: k, value: String(v ?? '') }));
    } else if (typeof autofillPayload === 'object') {
        // Payload IS the flat map
        payloadFields = Object.entries(autofillPayload)
            .filter(([k]) => !['providerId','portal','documents','requirements'].includes(k))
            .map(([k, v]) => ({ schemaKey: k, value: String(v ?? '') }));
    }

    // ── Virtual composite fields ─────────────────────────────────────────────
    // Derive combined name fields so single-input "PROVIDER NAME" forms get filled.
    const _getV = (k) => (payloadFields.find(f => f.schemaKey === k)?.value || '').trim();
    const _fn = _getV('firstName'), _ln = _getV('lastName'), _mn = _getV('middleName');
    if ((_fn || _ln) && !payloadFields.find(f => f.schemaKey === 'providerName')) {
        const fullFwd = [_fn, _mn ? _mn[0] + '.' : '', _ln].filter(Boolean).join(' ');
        const fullRev = _ln && _fn ? `${_ln}, ${_fn}` : (_ln || _fn);
        payloadFields.push({ schemaKey: 'providerName', value: fullFwd });
        payloadFields.push({ schemaKey: 'providerNameReversed', value: fullRev });
        console.log(`[TodaysDental] Virtual: providerName="${fullFwd}" / reversed="${fullRev}"`);
    }

    console.log(`[TodaysDental] fillAllFields — payload contains ${payloadFields.length} fields:`);
    console.log('[TodaysDental] Payload schemaKeys:', payloadFields.map(f => f.schemaKey));

    // ── Strategy B: Direct Adobe Sign tab — DOM injection (ALL field types) ──
    if (typeof isDirectAdobeSignPage === 'function' && isDirectAdobeSignPage() &&
        typeof fillAdobeSignDom === 'function') {
        const filledCount = fillAdobeSignDom(payloadFields, FIELD_PATTERNS);
        if (settings?.logAuditEvents && filledCount > 0) {
            await sendMessage({ action: 'LOG_AUDIT_EVENT', payload: { providerId: autofillPayload.providerId, portal: 'adobe-sign', action: 'fill', fieldsChanged: [], confidence: 0.85 } });
        }
        showNotification(`Filled ${filledCount} Adobe Sign fields (text, dropdowns, checkboxes)`, filledCount > 0 ? 'success' : 'warning');
        return;
    }

    // ── Standard HTML form fill ──
    const matchedFields = scanPageForForms();
    console.log(`[TodaysDental] scanPageForForms returned ${matchedFields.length} matched elements`);

    // Build a fast lookup map (schemaKey → value), case-insensitive
    const payloadMap = new Map();
    for (const f of payloadFields) {
        payloadMap.set(f.schemaKey.toLowerCase(), f.value);
        payloadMap.set(f.schemaKey, f.value); // also keep exact case
    }

    let filledCount = 0;
    for (const match of matchedFields) {
        const value = payloadMap.get(match.schemaKey) ?? payloadMap.get(match.schemaKey.toLowerCase());
        if (value !== undefined && value !== '') {
            console.log(`[TodaysDental] Filling "${match.schemaKey}" → "${String(value).slice(0, 40)}" in`, match.element);
            try {
                fillField(match.element, value);
                // Visual confirmation: brief orange outline on filled fields
                match.element.style.outline = '2px solid #f97316';
                setTimeout(() => { if (match.element) match.element.style.outline = ''; }, 2000);
                filledCount++;
            } catch (e) {
                console.error(`[TodaysDental] fillField failed for ${match.schemaKey}:`, e);
            }
        } else {
            console.log(`[TodaysDental] No payload value for schemaKey "${match.schemaKey}" (label: "${match.labelText}")`);
        }
    }

    console.log(`[TodaysDental] Fill complete: ${filledCount}/${matchedFields.length} fields filled`);

    if (settings?.logAuditEvents && filledCount > 0) {
        await sendMessage({ action: 'LOG_AUDIT_EVENT', payload: { providerId: autofillPayload.providerId, portal: currentAdapter?.portalId || window.location.hostname, action: 'fill', fieldsChanged: [], confidence: 0.8 } });
    }
    showNotification(`Filled ${filledCount} of ${matchedFields.length} matched fields`, filledCount > 0 ? 'success' : 'warning');
}


function observeFormChanges() {
    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) { if (m.addedNodes.length && [...m.addedNodes].some(n => n.querySelector?.('input, select, textarea'))) { clearTimeout(window.tdRescanTimeout); window.tdRescanTimeout = setTimeout(() => scanPageForForms(), 500); break; } }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

function getFieldValue(fields, key) { return fields.find(f => f.schemaKey === key)?.value || ''; }

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'TRIGGER_AUTOFILL') { openReviewPanel().then(() => sendResponse({ success: true })); return true; }
    if (message.action === 'RESCAN_PAGE') { sendResponse({ success: true, fieldCount: scanPageForForms().length }); return true; }
    if (message.action === 'PROVIDER_SELECTED') { autofillPayload = null; sendResponse({ success: true }); return true; }
});

console.log('[TodaysDental] Content script loaded');

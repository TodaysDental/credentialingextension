/**
 * TodaysDental Credentialing Extension - Validation Test Script
 * Run this script to validate the extension structure before deployment
 * 
 * Usage: node validate-extension.js
 */

const fs = require('fs');
const path = require('path');

const EXTENSION_DIR = __dirname;

// Console colors
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
};

const log = {
    success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
    error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
    warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
    info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
    header: (msg) => console.log(`\n${colors.cyan}═══ ${msg} ═══${colors.reset}`),
};

let errors = 0;
let warnings = 0;

// Required files for the extension
const REQUIRED_FILES = [
    'manifest.json',
    'popup/popup.html',
    'popup/popup.js',
    'popup/popup.css',
    'background/service-worker.js',
    'content/content-script.js',
    'content/content-styles.css',
    'content/review-panel.html',
    'config/api-config.js',
    'config/portal-adapters.js',
    'icons/icon16.png',
    'icons/icon32.png',
    'icons/icon48.png',
    'icons/icon128.png',
];

// Validate file exists
function checkFileExists(filePath) {
    const fullPath = path.join(EXTENSION_DIR, filePath);
    if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath);
        log.success(`${filePath} (${formatBytes(stats.size)})`);
        return true;
    } else {
        log.error(`Missing: ${filePath}`);
        errors++;
        return false;
    }
}

// Format bytes to human readable
function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// Validate manifest.json
function validateManifest() {
    log.header('Validating manifest.json');

    const manifestPath = path.join(EXTENSION_DIR, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        log.error('manifest.json not found!');
        errors++;
        return;
    }

    try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

        // Check manifest version
        if (manifest.manifest_version === 3) {
            log.success('Manifest version: 3 (MV3)');
        } else {
            log.error(`Invalid manifest version: ${manifest.manifest_version} (should be 3)`);
            errors++;
        }

        // Check required fields
        if (manifest.name) {
            log.success(`Name: ${manifest.name}`);
        } else {
            log.error('Missing: name');
            errors++;
        }

        if (manifest.version) {
            log.success(`Version: ${manifest.version}`);
        } else {
            log.error('Missing: version');
            errors++;
        }

        if (manifest.description) {
            log.success(`Description: ${manifest.description.substring(0, 50)}...`);
        } else {
            log.warn('Missing: description');
            warnings++;
        }

        // Check icons
        if (manifest.icons) {
            const iconSizes = ['16', '32', '48', '128'];
            iconSizes.forEach(size => {
                if (manifest.icons[size]) {
                    log.success(`Icon ${size}x${size}: ${manifest.icons[size]}`);
                } else {
                    log.warn(`Missing icon size: ${size}x${size}`);
                    warnings++;
                }
            });
        } else {
            log.warn('No icons defined');
            warnings++;
        }

        // Check permissions
        if (manifest.permissions && manifest.permissions.length > 0) {
            log.success(`Permissions: ${manifest.permissions.join(', ')}`);
        } else {
            log.warn('No permissions defined');
            warnings++;
        }

        // Check host_permissions
        if (manifest.host_permissions && manifest.host_permissions.length > 0) {
            log.success(`Host permissions: ${manifest.host_permissions.length} domains`);
        } else {
            log.warn('No host permissions defined');
            warnings++;
        }

        // Check background service worker
        if (manifest.background && manifest.background.service_worker) {
            log.success(`Service worker: ${manifest.background.service_worker}`);
            if (manifest.background.type === 'module') {
                log.success('Service worker type: module (ES modules supported)');
            }
        } else {
            log.error('Missing: background service worker');
            errors++;
        }

        // Check content scripts
        if (manifest.content_scripts && manifest.content_scripts.length > 0) {
            log.success(`Content scripts: ${manifest.content_scripts.length} rule(s)`);
            manifest.content_scripts.forEach((script, i) => {
                log.info(`  Rule ${i + 1}: ${script.matches.length} URL patterns`);
            });
        } else {
            log.warn('No content scripts defined');
            warnings++;
        }

        // Check popup
        if (manifest.action && manifest.action.default_popup) {
            log.success(`Popup: ${manifest.action.default_popup}`);
        } else {
            log.warn('No popup defined');
            warnings++;
        }

    } catch (e) {
        log.error(`Failed to parse manifest.json: ${e.message}`);
        errors++;
    }
}

// Validate JavaScript files for syntax
function validateJavaScript(filePath) {
    const fullPath = path.join(EXTENSION_DIR, filePath);
    if (!fs.existsSync(fullPath)) return;

    try {
        const content = fs.readFileSync(fullPath, 'utf8');

        // Check for common issues
        const issues = [];

        // Check for console.log in production (warning only)
        const consoleMatches = content.match(/console\.(log|debug|info)/g);
        if (consoleMatches && consoleMatches.length > 5) {
            issues.push(`${consoleMatches.length} console statements (consider removing for production)`);
        }

        // Check for TODO comments
        const todoMatches = content.match(/\/\/ TODO|\/\/ FIXME|\/\/ XXX/gi);
        if (todoMatches) {
            issues.push(`${todoMatches.length} TODO/FIXME comments`);
        }

        if (issues.length > 0) {
            log.warn(`${filePath}: ${issues.join(', ')}`);
            warnings += issues.length;
        }
    } catch (e) {
        log.error(`Failed to read ${filePath}: ${e.message}`);
        errors++;
    }
}

// Validate HTML files
function validateHTML(filePath) {
    const fullPath = path.join(EXTENSION_DIR, filePath);
    if (!fs.existsSync(fullPath)) return;

    try {
        const content = fs.readFileSync(fullPath, 'utf8');

        // Check for DOCTYPE
        if (!content.includes('<!DOCTYPE html>') && !content.includes('<!doctype html>')) {
            // Skip check for template files
            if (!filePath.includes('review-panel')) {
                log.warn(`${filePath}: Missing DOCTYPE declaration`);
                warnings++;
            }
        }

        // Check for inline scripts (CSP violation in MV3)
        if (content.match(/<script[^>]*>[^<]+<\/script>/)) {
            log.warn(`${filePath}: Contains inline scripts (may violate CSP)`);
            warnings++;
        }

    } catch (e) {
        log.error(`Failed to read ${filePath}: ${e.message}`);
        errors++;
    }
}

// Validate portal adapters
function validatePortalAdapters() {
    log.header('Validating Portal Adapters');

    const adaptersPath = path.join(EXTENSION_DIR, 'config/portal-adapters.js');
    if (!fs.existsSync(adaptersPath)) {
        log.error('portal-adapters.js not found!');
        errors++;
        return;
    }

    try {
        const content = fs.readFileSync(adaptersPath, 'utf8');
        const stats = fs.statSync(adaptersPath);

        // Count portal entries
        const portalMatches = content.match(/portalId:\s*['"][^'"]+['"]/g);
        const portalCount = portalMatches ? portalMatches.length : 0;

        log.success(`File size: ${formatBytes(stats.size)}`);
        log.success(`Portal adapters found: ${portalCount}`);

        if (portalCount < 100) {
            log.warn('Low portal count - expected 1000+');
            warnings++;
        } else if (portalCount >= 1000) {
            log.success('Excellent portal coverage!');
        }

        // Check for required tier 1 portals
        const tier1Portals = ['caqh', 'delta-dental', 'cigna', 'aetna', 'uhc', 'bcbs'];
        tier1Portals.forEach(portal => {
            if (content.includes(`'${portal}'`) || content.includes(`"${portal}"`)) {
                log.success(`Tier 1 portal present: ${portal}`);
            } else {
                log.warn(`Tier 1 portal may be missing: ${portal}`);
                warnings++;
            }
        });

    } catch (e) {
        log.error(`Failed to validate portal-adapters.js: ${e.message}`);
        errors++;
    }
}

// Main validation
function runValidation() {
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║  TodaysDental Credentialing Extension - Validation Report  ║');
    console.log('╚════════════════════════════════════════════════════════════╝');

    // Check required files
    log.header('Checking Required Files');
    REQUIRED_FILES.forEach(file => checkFileExists(file));

    // Validate manifest
    validateManifest();

    // Validate JavaScript files
    log.header('Validating JavaScript Files');
    validateJavaScript('popup/popup.js');
    validateJavaScript('background/service-worker.js');
    validateJavaScript('content/content-script.js');
    validateJavaScript('config/api-config.js');

    // Validate HTML files
    log.header('Validating HTML Files');
    validateHTML('popup/popup.html');
    validateHTML('content/review-panel.html');

    // Validate portal adapters
    validatePortalAdapters();

    // Summary
    log.header('Validation Summary');
    console.log('');

    if (errors === 0 && warnings === 0) {
        console.log(`${colors.green}🎉 All validations passed! Extension is ready for deployment.${colors.reset}`);
    } else if (errors === 0) {
        console.log(`${colors.yellow}⚡ Validation complete with ${warnings} warning(s).${colors.reset}`);
        console.log('   Extension can be deployed but review warnings first.');
    } else {
        console.log(`${colors.red}❌ Validation failed with ${errors} error(s) and ${warnings} warning(s).${colors.reset}`);
        console.log('   Fix errors before deploying.');
    }

    console.log('');
    console.log(`   Errors:   ${errors}`);
    console.log(`   Warnings: ${warnings}`);
    console.log('');

    // Return exit code
    process.exit(errors > 0 ? 1 : 0);
}

// Run
runValidation();

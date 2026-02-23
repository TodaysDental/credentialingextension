# TodaysDental Credentialing Chrome Extension

A powerful Chrome extension for automating provider credentialing form filling across insurance portals. Built to integrate with the TodaysDental Credentialing Stack.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Manifest](https://img.shields.io/badge/manifest-v3-green)

## Features

### 🎯 Universal Portal Autofill
- **Generic Fill Engine**: Intelligently detects form fields on any insurance portal using label → input mapping
- **Portal-Specific Adapters**: Optimized configurations for major portals (CAQH, Delta Dental, Availity, etc.)
- **Confidence Scoring**: Fields are matched with high/medium/low confidence indicators

### 📄 Document Management
- Download credentialing documents with one click
- Section hints help you find the right upload area
- Presigned S3 URLs ensure secure document access

### 🔒 Security & Compliance
- **No Local Storage of Sensitive Data**: Provider data is fetched on-demand via API
- **Audit Logging**: Every autofill action is logged for compliance
- **Session-Based Authentication**: Uses your TodaysDental credentials

### ⚡ Smart Detection
- Automatic portal detection when navigating to supported insurance sites
- Badge indicator shows when extension is ready to use
- Real-time form scanning as pages load

## Installation

### Development Installation

1. Clone this repository:
   ```bash
   cd D:\TodaysDental\TodaysDentalCredentialingExtension
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable **Developer mode** (toggle in top-right)

4. Click **Load unpacked** and select the extension directory

5. The extension icon should appear in your toolbar

### Production Deployment

For Chrome Web Store deployment:
1. Package the extension as a `.zip` file
2. Submit to the Chrome Web Store Developer Dashboard

## Configuration

### API Endpoint

Update the API base URL in `config/api-config.js`:

```javascript
export const API_CONFIG = {
  BASE_URL: 'https://your-api-endpoint.com/credentialing',
  // ...
};
```

### Supported Portals

The extension is configured to work with these insurance portals:
- CAQH ProView
- Availity
- Delta Dental / DDS Enroll
- Cigna
- Aetna
- UnitedHealthcare
- BCBS
- MetLife
- Guardian
- Humana
- Anthem

Add more portals by updating `host_permissions` in `manifest.json`.

## Usage

### Getting Started

1. **Login**: Click the extension icon and sign in with your TodaysDental credentials

2. **Select Provider**: Search and select the provider whose credentials you want to use

3. **Navigate to Portal**: Go to any supported insurance credentialing portal

4. **Autofill**: Click the floating button (✓) on the page to open the review panel

5. **Review & Fill**: Review the matched fields and click "Fill All Fields"

### Review Panel Features

- **Provider Info**: Shows selected provider name and NPI
- **Readiness Status**: Indicates if all required fields/documents are available
- **Field Groups**: Fields organized by confidence level
- **Document Downloads**: Quick access to credentialing documents

## Architecture

```
TodaysDentalCredentialingExtension/
├── manifest.json              # Extension configuration
├── config/
│   └── api-config.js          # API endpoints and constants
├── background/
│   └── service-worker.js      # Background service for API calls
├── content/
│   ├── content-script.js      # Form detection and filling logic
│   └── content-styles.css     # UI styles for injected elements
├── popup/
│   ├── popup.html             # Extension popup UI
│   ├── popup.css              # Popup styles
│   └── popup.js               # Popup logic
└── icons/                     # Extension icons
```

### Key Components

1. **Service Worker** (`background/service-worker.js`)
   - Handles all API communication
   - Manages authentication tokens
   - Caches portal adapters and provider data

2. **Content Script** (`content/content-script.js`)
   - Injects into insurance portal pages
   - Scans for form fields using heuristic matching
   - Fills fields and handles document downloads

3. **Popup** (`popup/`)
   - Login interface
   - Provider selection
   - Portal status display

## API Integration

The extension integrates with these backend endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/autofill/payload` | GET | Get provider data for autofill |
| `/autofill/documents` | GET | Get document download URLs |
| `/autofill/audit` | POST | Log autofill events |
| `/autofill/portals` | GET | List portal adapters |
| `/autofill/requirements` | GET | Get payer requirements |
| `/autofill/schema` | GET | Get canonical field schema |

## Development

### Adding New Field Patterns

Edit `FIELD_PATTERNS` in `content/content-script.js`:

```javascript
const FIELD_PATTERNS = {
  newField: ['pattern1', 'pattern2', 'pattern3'],
  // ...
};
```

### Creating Portal Adapters

Portal adapters can be created via the backend API or directly in the database:

```javascript
{
  "portalId": "new-portal",
  "portalName": "New Portal Name",
  "tier": 1,
  "match": {
    "hostnames": ["portal.example.com"],
    "urlPatterns": ["/credentialing/.*"]
  },
  "fieldMap": {
    "first_name_input": { "schemaKey": "firstName", "type": "text" }
  }
}
```

## Troubleshooting

### Extension Not Working on Portal
- Ensure the portal URL is in `host_permissions` in `manifest.json`
- Check the browser console for errors
- Verify you're logged in and have a provider selected

### Fields Not Filling
- Some portals use shadow DOM or iframes - these may require Tier 2/3 adapters
- Check if the field labels match the patterns in `FIELD_PATTERNS`
- Review the console log for matching results

### Authentication Issues
- Tokens expire after some time - try logging out and back in
- Verify the API endpoint is correct in `api-config.js`

## License

Proprietary - TodaysDental © 2024

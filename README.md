# HealthLOQ Document Verification Tool

## Overview

The HealthLOQ Document Verification Tool is a locally-installed Node.js application that enables organizations to protect and verify documents using the HealthLOQ blockchain network. It runs on your own infrastructure and operates in two modes:

- **Publisher (Document Protection)** — Watches a folder for documents, generates cryptographic hashes, and registers those hashes with the HealthLOQ blockchain. This creates a tamper-evident record proving a document existed in its current form at a specific point in time.
- **Verifier** — Scans a folder of documents and checks each file's hash against the HealthLOQ blockchain to confirm authenticity and detect any modifications.

---

## Security and Privacy Architecture

**Your documents never leave your network.**

The tool is designed with a zero-document-export model. Here is how it preserves privacy while still enabling blockchain-backed verification:

1. **Local hashing only.** When a document is processed, the application reads the file on your local machine or server, computes a SHA-256 cryptographic hash of its contents, and discards the file buffer. The hash is a fixed-length fingerprint — it is mathematically impossible to reconstruct the original document from it.

2. **Outbound API calls only.** The tool communicates with the HealthLOQ API (`api.healthloq.com`) exclusively through outbound HTTPS requests originating from your machine. HealthLOQ never connects inbound to your environment, never requests file transfers, and never receives file contents.

3. **Only hashes are transmitted.** The payload sent to HealthLOQ contains document hashes, optional metadata (organization, product, location, effective/expiration dates), and your organization's authentication token. No file bytes, filenames as searchable identifiers, or document contents are included.

4. **Local storage is minimal.** A local SQLite database tracks processing history and metadata cache entries to support the dashboard and reduce redundant API calls. It stores hashes and metadata — not document contents.

5. **CORS restricted to localhost.** The local API server enforces CORS rules that restrict browser access to localhost only, preventing external web pages from querying your local tool.

This architecture allows Document Protection subscribers to meet strict data residency and confidentiality requirements while still publishing verifiable proof of document integrity to the blockchain.

---

## How Hashing Works

The tool uses the Node.js built-in `crypto` module with the SHA-256 algorithm, producing a lowercase hexadecimal digest:

```javascript
const crypto = require("crypto");
const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
```

### PDF Stability

Print drivers embed a creation timestamp inside PDF files. Without special handling, printing the same document twice would produce two different hashes even though the content is identical. The tool strips the `/CreationDate` and `/ModDate` fields from PDF buffers before hashing, supporting both literal string format (`D:20240811...`) and hex-encoded format. This ensures that the hash reflects document content, not print metadata.

### Supported File Types

| Category | Extensions |
|---|---|
| Documents | PDF, DOC, DOCX, TXT, ONE |
| Spreadsheets | CSV, XLS, XLSX |
| Presentations | PPT, PPTX |
| Images | JPG, JPEG, PNG, GIF, SVG, WEBP, TIFF, BMP, ICO, APNG, AVIF, JFIF |
| Video | MP4, MOV, AVI, WMV, MKV, FLV, WEBM |

Files are also validated by MIME type to prevent extension spoofing.

---

## Modes of Operation

### Publisher Mode (Document Protection)

Available to Document Protection subscribers. The tool watches a configured root folder using a filesystem watcher (`chokidar`). When a supported document is added, modified, or removed:

1. The file is read and its SHA-256 hash is computed locally.
2. The hash is stored in the local SQLite database.
3. Hashes are batched and synced to the HealthLOQ API (up to 500 per call, with a 6-second debounce and a 5-minute periodic fallback).
4. If a file is deleted, the deletion is reported so the corresponding hash record on HealthLOQ is marked inactive.

The dashboard displays real-time sync status, per-file metadata, processing logs, and subscription usage against your plan's hash limits.

### Verifier Mode

Used to audit a folder of documents against HealthLOQ records. The tool:

1. Scans the specified folder recursively for all supported file types.
2. Computes a hash for each file locally.
3. Sends the hashes to the HealthLOQ API for verification.
4. Groups results by organization and verification status (verified, expired, not found, error).
5. Exports a CSV report summarizing verification results.

---

## AI-Powered Metadata Auto-Population

When the Anthropic API key is configured, the tool can analyze document content and suggest metadata (organization, location, product, batch, effective/expiration dates) using Claude. Suggestions with confidence below 50% are discarded. File size limits apply: 100 KB for text, 20 MB for PDF, 5 MB for images. This feature is optional and only runs on-demand.

---

## Architecture

```
hash-generator/
├── healthloqdocverify.js   # Express server entry point (port 8003)
├── db.js                   # SQLite initialization (scratch/ directory)
├── logger.js               # Logging configuration
├── routes/                 # Express route definitions
├── controllers/            # Route handler implementations
├── services/
│   ├── hasher.js           # SHA-256 hashing with PDF timestamp stripping
│   ├── healthloq.js        # HealthLOQ API client (outbound only, retry logic)
│   ├── fileScanner.js      # Recursive folder scanner for verifier mode
│   ├── metadataAi.js       # Claude-powered metadata extraction
│   └── alerts.js           # Email alert engine
├── utils/                  # Hash orchestration and sync scheduling
├── constants/              # Allowed file types and MIME types
├── client/                 # React + Redux frontend (SPA)
└── public/                 # Static assets and CSV export output
```

The server embeds a React SPA served at the root path. Real-time progress (sync status, verification results) is delivered to the browser via Socket.IO without polling.

---

## Prerequisites

- Node.js 18+
- A HealthLOQ organization account with Document Protection or Verifier subscription
- A valid HealthLOQ API JWT token

---

## Installation

```bash
git clone <repository-url>
cd hash-generator
npm install
cd client && npm install && npm run build
cd ..
```

---

## Configuration

Copy `.env.example` to `.env` and fill in the required values:

```env
# Local server port
PORT=8003

# Absolute path to the folder to watch (publisher mode) or scan (verifier mode)
ROOT_FOLDER_PATH="./documents"

# Local API base URL (used by the frontend)
REACT_APP_API_BASE_URL="http://localhost:8003"

# HealthLOQ authentication token (from your HealthLOQ organization account)
REACT_APP_JWT_TOKEN=<your-jwt-token>

# HealthLOQ API endpoint — all outbound calls go here
REACT_APP_HEALTHLOQ_API_BASE_URL="https://api.healthloq.com"

# HealthLOQ partner and consumer app URLs (used for blockchain proof links)
REACT_APP_HEALTHLOQ_ORGANIZATION_APP_BASE_URL="https://partner.healthloq.com"
REACT_APP_HEALTHLOQ_CONSUMER_APP_BASE_URL="https://www.healthloq.com"

# Optional: Email alerts (nodemailer-compatible SMTP settings)
SMTP_HOST=
SMTP_PORT=
SMTP_SECURE=
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# Optional: AI metadata extraction
ANTHROPIC_API_KEY=<your-anthropic-key>

# Optional: Log verbosity (debug | info | warn | error)
LOG_LEVEL=info
```

---

## Running the Tool

```bash
node --max-old-space-size=8192 --expose-gc healthloqdocverify.js
```

Or with the npm start script:

```bash
npm start
```

The dashboard is available at `http://localhost:8003` (or the configured `PORT`).

---

## HealthLOQ API Endpoints Called

The following outbound endpoints are used. No inbound connections from HealthLOQ are required.

| Endpoint | Purpose |
|---|---|
| `POST /document-hash/createOrDelete` | Register or deregister document hashes |
| `POST /document-hash/verify-document` | Verify hashes against blockchain records |
| `POST /document-hash/update` | Update effective/expiration dates on existing hashes |
| `GET /document-hash/get-subscription-details` | Retrieve subscription tier and hash limits |
| `POST /document-hash/sync-doc-tool-logs` | Report sync errors for monitoring |
| `POST /document-hash/publisher-script-is-running-or-not` | Heartbeat / liveness signal |
| `POST /integrant-doc-tool/product-list` | Fetch product metadata for the dropdown |
| `POST /integrant-doc-tool/search` | Search products by batch number |
| `POST /organization/get-org` | Fetch organization list |
| `POST /location/location-suggestions` | Fetch location options |
| `POST /client-app/verify` | Retrieve blockchain proof for a hash |

---

## Monitoring and Alerts

The Health tab in the dashboard provides:

- Real-time processing counts (success, failed, skipped)
- Histograms by day, week, month, or year
- A list of files that failed hashing with error codes
- Controls to reprocess failed files or force an immediate sync

Optional email alerts can be configured for:
- Service going offline (no heartbeat)
- No documents processed within a configured window

Alert rules support per-rule cooldown periods to prevent notification fatigue.

---

## Data Retention

The local SQLite database (stored in `scratch/`) retains processing logs and metadata cache entries. Document content is never written to disk by this tool. You can clear the database at any time without affecting the records already registered on the HealthLOQ blockchain.

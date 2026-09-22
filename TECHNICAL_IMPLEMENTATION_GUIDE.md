# Technical Implementation Guide
## Document Protection and Verification Applications

**Prepared by:** HealthLOQ, LLC

---

## Contents

1. [Introduction](#1-introduction)
2. [Components](#2-components)
3. [System Requirements](#3-system-requirements)
4. [Installation and Configuration](#4-installation-and-configuration)
5. [User Access Control](#5-user-access-control)
6. [Data Encryption and Ledger Anchoring](#6-data-encryption-and-ledger-anchoring)
7. [Auditing and Logging](#7-auditing-and-logging)
8. [Disaster Recovery and Backup](#8-disaster-recovery-and-backup)
9. [Integration with Existing Systems](#9-integration-with-existing-systems)
10. [Security](#10-security)
11. [Training and Support](#11-training-and-support)
12. [Maintenance and Updates](#12-maintenance-and-updates)
13. [Risk Management](#13-risk-management)
14. [Conclusion](#14-conclusion)

---

## 1. Introduction

**Purpose of the Document:** This document serves as a comprehensive guide for the technical overview and implementation of the Document Protection and Document Verification applications from HealthLOQ.

**Overview of the Document Protection Application:** Counterfeit and manipulated documents exchanged between business partners in supply chains, particularly health-related supply chains, pose grave risks. Falsified certifications and misleading reports can lead to physical harm to consumers, reputational damage to companies, legal liabilities, and financial losses. Such fraudulent activities undermine trust, jeopardizing product safety and industry integrity. Implementing stringent document authentication measures is crucial to mitigate these risks effectively.

HealthLOQ's Document Protection and Document Verification tools enable organizations to share first-party, verifiable documentation without changing existing business processes or legal relationships, all with a lightweight solution that can be deployed in a matter of hours.

**Industry Integrity Protocol:** The Global Retailer and Manufacturer Alliance ("GRMA") has developed a single, voluntary standard for dietary supplement products that minimizes multiple and redundant testing requirements for manufacturers and streamlines the product verification process for retailers. This dietary supplement product integrity ("DSPI") standard has been officially launched. The HealthLOQ document protection technology is a key component of the DSPI standard, and participating laboratories are required to utilize the HealthLOQ authentication protocol in order to be compliant.

---

## 2. Components

**Open API:** At its heart, HealthLOQ Document Protection and Verification is a protocol defining a method for business partners to certify and verify documentation shared between parties. The protocol is accessed via an open API. The API and its documentation are available at:

> https://api.healthloq.com/api/

API functions interact with the HealthLOQ identity management system, transactional database, and immutable ledger data store. The API is the only method for interacting with the backend data store, protecting the integrity of the back-end system.

**Immutable Ledger — Azure Confidential Ledger:** The immutable data store for HealthLOQ is Microsoft Azure Confidential Ledger, a hardware-backed, tamper-proof append-only service built on Intel SGX (Software Guard Extensions) trusted execution environments. Key properties of Azure Confidential Ledger relevant to HealthLOQ's implementation:

- **Hardware-enforced integrity:** All ledger operations run inside SGX enclaves, meaning even Microsoft's own cloud operators cannot tamper with or read ledger entries. The trust anchor is hardware, not organizational policy.
- **Cryptographic receipts:** Every write transaction returns a cryptographic receipt that can be independently verified by any third party without access to HealthLOQ's systems. Receipts serve as irrefutable proof that a specific hash was anchored at a specific point in time.
- **Immutable append-only storage:** Once a hash is written to the ledger, it cannot be altered or deleted. Any attempt to modify historical records is cryptographically detectable.
- **Regulatory-grade audit chain:** The ledger provides a continuous, verifiable audit trail suitable for compliance and legal proceedings.
- **Merkle tree checkpointing:** To maximize efficiency and reduce cost, HealthLOQ groups document hashes into Merkle tree checkpoints of up to 10,000 hashes. Only the Merkle root of each batch is written to the ledger, while each individual hash retains its Merkle proof — a compact set of sibling hashes that allows any third party to independently verify that a specific document hash is included in a given checkpoint. This approach provides the same cryptographic guarantees as anchoring each hash individually, at a fraction of the ledger write volume.

**Front-End Applications:** The most visible but least essential components of the Document Protection and Verification products are the front-end applications. Although partner organizations are free to write their own applications using the API to interact with HealthLOQ, the Document Protection and Document Verification applications are offered for rapid deployment and adoption. The key objectives HealthLOQ pursued in creating the front-end applications were:

- Deploying quickly and easily with basic IT competencies
- Providing code transparency for auditing
- Minimizing or eliminating any security concerns for IT departments
- Creating a zero-knowledge-proof mechanism for document protection and verification

The front-end applications are JavaScript modules that can be installed inside a partner organization's security perimeter. The code is open and available for review at:

> https://github.com/healthloq/hash-generator

Each Node.js module runs as a background service and is designed to monitor a document repository root folder and all its subfolders, watching for document changes and additions. Any document that changes is recognized by the application and is hashed using the SHA-256 algorithm. The hashing algorithm is a one-way process and creates a statistically unique digest that represents the document. The module then makes a one-way, outbound API call to the HealthLOQ API passing just the organization's JWT token and the hash or digest of the processed document. **Documents never leave the organization's repository and are not passed to HealthLOQ.**

---

## 3. System Requirements

**Hardware Requirements:** HealthLOQ's API and ledger are hosted services that do not require local installation or maintenance. Any organization that wants to run the Document Protection or Document Verification modules can install those applications on company-controlled Windows or Linux servers. The applications are small and require less than 100 MB of disk space. For large document repositories with tens of thousands of files, 4 GB or more of RAM is recommended, as the `--max-old-space-size=8192` Node.js flag may be used to allocate additional heap memory.

**Software Requirements:** Both the Document Protection and Document Verification applications are written in Node.js 18 or later and require the Node.js runtime environment to be installed so that the JavaScript can run outside and independent of a browser.

During installation of Node.js on Windows, there is a checkbox to install components required for compiling native modules (C++ build tools via Chocolatey). This checkbox should be selected, as certain Node.js dependencies require native compilation.

**Network Requirements:** Since all API calls are outbound only, no inbound network or firewall changes are required as part of the setup process. If outbound traffic is restricted by a firewall, the following endpoint must be allowed:

> https://api.healthloq.com

No additional ports, inbound rules, or VPN configurations are necessary.

---

## 4. Installation and Configuration

**Pre-installation Steps:** Prior to running the Document Protection and Document Verification applications, the Node.js 18+ runtime environment must be installed on the host system. Downloads and instructions are available at:

> https://nodejs.org

**Installation Process:** Step-by-step instructions for installing the Document Protection and Document Verification applications are available through the HealthLOQ partner portal:

> https://producer.healthloq.com/doc-tool-guide

When a user logs in via the partner portal to either the Document Protection or Document Verification landing page, a "Setup Guide" button provides detailed installation instructions. A Windows installer is also available for download through the partner portal for simplified deployment.

**Configuration Steps:** Three critical parameters are required to complete the installation:

1. **Port** — The default port is `8003`. Any available port on the host machine may be used. Each instance of the application must run on a unique port.

2. **Root Directory for Document Repository** — The absolute path to the folder that will be monitored for documents to protect or verify. The application recursively monitors all subdirectories of the root folder for new, modified, or deleted documents.

3. **HealthLOQ JWT Token** — Each organization has a unique JWT token used to authenticate all API calls. The token is generated from the HealthLOQ Partner Portal by clicking the "Generate Doc Tool JWT Token" button. This token must be copied into the installer or placed in the `.env` file for manual installations.

**Multiple Instances:** If an organization needs to monitor multiple root directories on the same server, additional instances of the application can be installed side by side. Each instance must run on a unique port. The same JWT token is used for all instances within the same organization. Instances can also be distributed across multiple servers. HealthLOQ's subscription limits apply to the total number of documents processed across all instances for the organization, regardless of how many instances or servers are running.

**Environment Configuration:** For manual or advanced installations, copy `.env.example` to `.env` and populate the following values:

```
PORT=8003
ROOT_FOLDER_PATH="./documents"
REACT_APP_API_BASE_URL="http://localhost:8003"
REACT_APP_JWT_TOKEN=<your-jwt-token>
REACT_APP_HEALTHLOQ_API_BASE_URL="https://api.healthloq.com"
REACT_APP_HEALTHLOQ_ORGANIZATION_APP_BASE_URL="https://producer.healthloq.com"
REACT_APP_HEALTHLOQ_CONSUMER_APP_BASE_URL="https://www.healthloq.com"

# Optional: Email alerts
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

**Starting the Service:** The Windows installer creates a background Windows service named "HealthLOQ Document Hash" that starts automatically on server reboot. For manual installations, start the service with:

```bash
node --max-old-space-size=8192 --expose-gc healthloqdocverify.js
```

Once the service is running, the dashboard is accessible at:

> http://localhost:8003/

**Post-Installation:** After the service starts, it will immediately begin scanning the configured root folder and syncing document hashes to HealthLOQ. Real-time progress is visible in the browser dashboard without any page refresh.

---

## 5. User Access Control

**Role-Based Access Control (RBAC):** The user who registers the organization for a HealthLOQ subscription is automatically set up as the organization administrator. Additional users can be added by navigating to "Your Organization" in the partner portal navigation menu.

**User Authentication Mechanisms:** To protect the privacy and security of the organization's HealthLOQ account, two-factor authentication (2FA) is automatically configured for each user at registration. The second factor code is sent to the user's associated email address. Users can reset their own passwords from the login page.

**Permissions Management:** Users can be added, removed, or set to active/inactive status from the "Your Organization" management page in the partner portal.

**Local Application Access:** The Document Protection and Document Verification applications run on localhost and are restricted to browser access from the local machine only. CORS rules in the application enforce this restriction, preventing external web pages from querying the local tool.

---

## 6. Data Encryption and Ledger Anchoring

### Hashing Algorithm

HealthLOQ's document protection technology uses the SHA-256 cryptographic hash function to produce a unique, fixed-size fingerprint for each document. SHA-256 is a member of the SHA-2 family, designed by the National Security Agency (NSA) and published by the National Institute of Standards and Technology (NIST).

**How SHA-256 Works:**

- **Message Padding:** The input message is padded to ensure its length is a multiple of 512 bits.
- **Initial Hash Values:** SHA-256 uses eight initial hash values (H0 to H7) derived from the fractional parts of the square roots of the first eight prime numbers.
- **Block Processing:** The padded message is divided into 512-bit blocks, each processed sequentially through 64 rounds of logical and bitwise operations (rotations, shifts, AND, OR, XOR, and modular addition).
- **Final Hash Value:** The output is a 256-bit value that uniquely represents the input. Any change to even a single bit of the source document produces a completely different hash.

**One-Way Hash Properties:**

- **One-way:** Given a hash value, it is computationally infeasible to reconstruct the original document.
- **Deterministic:** The same document always produces the same hash, enabling reliable re-verification.
- **Collision-resistant:** It is infeasible to find two different documents that produce the same hash.

### PDF Timestamp Normalization

PDF files generated by print drivers embed a creation timestamp (`/CreationDate` and `/ModDate`) inside the file. Without special handling, printing the same document twice would produce two different hashes even though the content is identical. The HealthLOQ Document Tool automatically strips these timestamp fields from PDF buffers before hashing, handling both literal string format (`D:20240811...`) and hex-encoded format. This ensures the hash reflects document content, not incidental print metadata.

### Two-Tier Ledger Anchoring

Once a SHA-256 hash is computed locally, it is transmitted to the HealthLOQ API, which anchors it to Azure Confidential Ledger using a two-tier strategy:

**Tier 1 — Individual Anchoring:** For time-sensitive or high-priority registrations, a hash can be written directly to Azure Confidential Ledger as an individual transaction. The ledger returns a cryptographic receipt immediately confirming the write.

**Tier 2 — Merkle Checkpoint Batching:** For standard volume processing, hashes are grouped into batches of up to 10,000. The HealthLOQ backend constructs a Merkle tree from each batch and writes only the Merkle root to Azure Confidential Ledger. Each individual hash in the batch is assigned a Merkle proof — the minimal set of sibling hash values needed to reconstruct the path from that hash to the anchored root. This proof can be independently verified by any third party:

1. Obtain the document's SHA-256 hash.
2. Apply the stored Merkle proof steps.
3. Confirm the resulting root matches the value anchored in Azure Confidential Ledger.
4. Validate the ledger receipt to confirm the root was written at a specific time.

This approach is equivalent in cryptographic strength to individual anchoring while dramatically reducing ledger write volume and cost.

### Verification

The HealthLOQ API exposes verification endpoints that return the full anchoring record for any document hash, including:

- `acl_transaction_id` — The Azure Confidential Ledger transaction ID
- `acl_receipt` — The cryptographic receipt from Azure Confidential Ledger
- `merkle_root` — The Merkle tree root written to the ledger (for checkpointed hashes)
- `merkle_proof` — The proof steps linking the document's hash to the Merkle root
- `hash_count` — The number of hashes included in the checkpoint

These records are sufficient for any third party to independently verify document authenticity without any access to HealthLOQ's systems.

---

## 7. Auditing and Logging

**Local Processing Logs:** The application maintains a local SQLite database (stored in the `scratch/` directory) recording every file hashing attempt with its result (success, failed, skipped), timestamp, and error detail if applicable. This log is viewable from the Health tab in the dashboard and supports filtering by status and time range.

**Audit Trail:** Audit trail creation is an inherent property of Azure Confidential Ledger. Every write to the ledger is permanently recorded with a transaction ID and timestamp. Because the ledger is append-only and hardware-enforced, this audit trail cannot be altered after the fact.

**Health Dashboard:** The application dashboard provides:

- Real-time processing counts (documents hashed, synced, failed, skipped)
- Histograms of processing activity by day, week, month, and year
- A list of files that failed hashing with specific error codes
- Controls to reprocess failed files or trigger an immediate sync
- Current subscription usage against plan limits

**Email Alerts:** Configurable email alert rules can notify administrators when:

- The service has been offline for a defined period
- No documents have been processed within a configured time window

Alert rules support per-rule cooldown periods to prevent duplicate notifications.

---

## 8. Disaster Recovery and Backup

**Disaster Recovery Plan:** In the event the server hosting the Document Protection or Document Verification application experiences a catastrophic failure and must be rebuilt, the applications can simply be reinstalled and reconfigured with the same JWT token and root folder path. Document repositories may optionally be restored, or the repository can begin again from scratch.

Because Azure Confidential Ledger is an immutable data store, all previously registered document hashes remain permanently available for verification by business partners in possession of the original documents. If documents that had already been processed are re-added to the repository after a reinstall, the deterministic nature of SHA-256 will reproduce the identical hash. The HealthLOQ API recognizes existing hashes and will not create duplicate ledger entries.

**Local Database:** The local SQLite database contains processing logs and metadata cache. It does not contain document content and is not required for document verification. It can be regenerated by reprocessing the document repository.

---

## 9. Integration with Existing Systems

**Integration Requirements:** HealthLOQ's solution is specifically designed to co-exist with existing business processes and systems without requiring adaptation or integration. HealthLOQ's applications facilitate ecosystem-level communication and collaboration without requiring participating entities to conform to or adopt new procedures.

All interaction can be accomplished through a web browser, API calls, or the lightweight JavaScript application deployable in just a few hours. Organizations desiring tighter integrations are welcome to use the open API for system-level interactions, but this is not required.

**Supported File Types:** The application supports the following document types for hashing and verification:

| Category | Formats |
|---|---|
| Documents | PDF, DOC, DOCX, TXT, ONE |
| Spreadsheets | CSV, XLS, XLSX |
| Presentations | PPT, PPTX |
| Images | JPG, JPEG, PNG, GIF, SVG, WEBP, TIFF, BMP, ICO, APNG, AVIF, JFIF |
| Video | MP4, MOV, AVI, WMV, MKV, FLV, WEBM |

Files are validated by both extension and MIME type to prevent spoofing.

**AI-Powered Metadata Auto-Population:** When an Anthropic API key is configured, the application can analyze document content using the Claude AI model and suggest metadata including organization, location, product, batch, and effective and expiration dates. Suggestions are only applied when confidence reaches 50% or higher. This feature is optional and runs on-demand. No document content is transmitted to HealthLOQ — AI analysis runs locally through the Anthropic API and only metadata suggestions (not document content) are used.

**API Documentation:** The HealthLOQ API and its documentation are available at:

> https://api.healthloq.com/api/

**Outbound API Endpoints:** The following HealthLOQ API endpoints are called by the Document Tool. All calls are outbound HTTPS. No inbound connections from HealthLOQ to the local environment are required.

| Endpoint | Purpose |
|---|---|
| `POST /document-hash/createOrDelete` | Register or deregister document hashes |
| `POST /document-hash/verify-document` | Verify document hashes against ledger records |
| `POST /document-hash/update` | Update effective/expiration date metadata |
| `GET /document-hash/get-subscription-details` | Retrieve subscription tier and hash limits |
| `POST /document-hash/sync-doc-tool-logs` | Report sync errors for platform monitoring |
| `POST /document-hash/publisher-script-is-running-or-not` | Heartbeat / liveness signal |
| `POST /integrant-doc-tool/product-list` | Fetch product metadata for dropdowns |
| `POST /integrant-doc-tool/search` | Search products by batch number |
| `POST /organization/get-org` | Fetch organization list |
| `POST /location/location-suggestions` | Fetch location options |
| `POST /client-app/verify` | Retrieve Azure Confidential Ledger proof for a hash |

---

## 10. Security

**Know Your Customer:** The mission of HealthLOQ is to promote trust and transparency across the ecosystem between business partners and consumers. A key component of that trust relationship is proof that organizations making claims are who they profess to be. Upon registering with HealthLOQ, each organization is required to specify and verify their internet domain. Verification is accomplished using DNS TXT records on the domain registration. Once the domain has been verified, all claims made by that organization are cryptographically linked to and reference the verified domain, preventing bad actors from registering fraudulently and making claims on behalf of another organization.

**Zero-Document-Export Architecture:** The Document Protection and Document Verification applications were specifically designed so that documents never leave the organization's security perimeter. Only SHA-256 hashes — which are mathematically irreversible fingerprints of documents — are transmitted to HealthLOQ. This design:

- Eliminates any requirement to evaluate or update data sharing agreements with HealthLOQ
- Removes all risk of document content exposure through the HealthLOQ channel
- Requires no changes to existing document handling policies or procedures
- Allows organizations with strict data residency requirements to participate fully

**Open Source Code:** The code for the Document Protection and Document Verification applications is available as open-source through the HealthLOQ GitHub repository, allowing IT security departments to audit the implementation directly:

> https://github.com/healthloq/hash-generator

**Hardware-Backed Ledger Security:** Azure Confidential Ledger runs exclusively inside Intel SGX trusted execution environments. This means:

- Ledger data is encrypted and processed in hardware-isolated memory enclaves
- Even the cloud infrastructure operator cannot access or tamper with ledger contents
- The trust model is hardware-enforced, not dependent on any organizational policy or access controls
- Cryptographic receipts for each ledger write can be verified by third parties independently of HealthLOQ

**Transport Security:** All communication between the Document Tool and the HealthLOQ API occurs over HTTPS (TLS 1.2+). The local dashboard is accessible only via localhost; CORS rules in the application server reject requests from any external origin.

**Authentication:** The JWT token used to authenticate API calls is organization-specific. It should be treated as a secret and stored securely in the `.env` file or Windows service environment variables. New tokens can be generated at any time from the partner portal, immediately invalidating the previous token.

---

## 11. Training and Support

**Technical Support Channels:** HealthLOQ support teams are available to provide assistance to subscribing organizations. Support may be accessed through the partner portal at:

> https://producer.healthloq.com

**Knowledge Base and Documentation:** Comprehensive documentation, installation guides, and setup walkthroughs are available through the partner portal. The open-source repository also contains a detailed README covering architecture, configuration, and API reference.

---

## 12. Maintenance and Updates

**Version Control:** Periodic updates to the Document Protection and Document Verification applications are made available through the HealthLOQ GitHub repository. The Windows installation application may be used to update the installed software, or updates can be applied manually by pulling the latest code from the repository and restarting the service.

**Subscription Limits:** HealthLOQ subscription plans define the number of document hashes that can be registered per month. Current usage is visible in the dashboard. The application automatically enforces subscription limits and will pause syncing new hashes if the limit is reached until the subscription renews or is upgraded.

---

## 13. Risk Management

**Identification of Risks:** Organizations within a supply chain often share documents and information that is both proprietary and confidential. Standard document sharing workflows create exposure: if a document passes through an intermediary system, that system gains access to the document's contents.

**Risk Assessment:** Legal agreements and frameworks exist to protect intellectual property between organizations conducting business operations. However, those agreements require ongoing management, create friction in business relationships, and cannot eliminate the risk of breach.

**Risk Mitigation Strategies:** To eliminate the need to evaluate legal relationships and to protect proprietary information, HealthLOQ's Document Protection and Document Verification applications were specifically designed to exclude all proprietary information from the HealthLOQ channel. No documents from a participating organization are required to pass outside the existing security perimeter of that organization. No change to current business processes, data security policies, or technical infrastructure is required.

All documents shared between business partners can continue to be shared and processed using existing workflows. HealthLOQ provides a zero-knowledge-proof mechanism to verify document authenticity claims from first-party originators to all business partners and consumers that receive those documents in the normal course of business. The proof is anchored in Azure Confidential Ledger — hardware-enforced, independently verifiable, and permanent.

---

## 14. Conclusion

**Summary of Key Points:** This document provides a comprehensive guide for implementing HealthLOQ's Document Protection and Document Verification applications. The system addresses the significant risks of counterfeit or manipulated documents in supply chains, particularly in health-related sectors.

The solution enables secure document authentication without altering existing business processes, leveraging an open API and Azure Confidential Ledger for immutable, hardware-backed data integrity. Documents never leave the organization's network — only SHA-256 hashes are transmitted. The Merkle tree checkpointing architecture provides cryptographic proof for every registered document that is independently verifiable by any third party.

With a focus on ease of deployment (hours, not weeks), minimal system requirements (Node.js, a folder path, and a JWT token), and a zero-document-export security model, organizations can adopt document verification without legal, technical, or operational friction.

**Next Steps:** The first step to participating in the HealthLOQ ecosystem is to register your organization via the HealthLOQ Partner Portal and subscribe to one of the HealthLOQ offerings. A JWT token for the Document Tool can be generated immediately upon subscription.

> https://producer.healthloq.com

---

*This technical implementation guide provides a structured approach for deploying and securing the Document Protection and Document Verification applications within a participating organization's internal IT environment. By following the outlined recommendations and best practices, IT and security teams can effectively protect sensitive documents, mitigate security risks, and ensure compliance with regulatory requirements.*

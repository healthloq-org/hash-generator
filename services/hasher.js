/**
 * Pure hashing helpers — no side-effects, no external dependencies.
 *
 * hashFile runs inside a worker thread so the main event loop is never
 * blocked by slow reads (e.g. OneDrive cloud-backed files that hang on
 * open/read while the ProjFS filter driver attempts hydration).
 * If the read does not complete within HASH_TIMEOUT_MS the worker is
 * terminated and the caller receives a HASH_TIMEOUT error.
 */
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const { Worker, workerData, parentPort } = require("worker_threads");

const PDF_MAGIC = Buffer.from("%PDF");

// "Microsoft Print To PDF" (and similar drivers) embed the print timestamp in
// /CreationDate and /ModDate inside the PDF document-info dictionary.  Only
// those bytes differ across multiple prints of an identical document, so we
// zero them out before hashing to produce a stable fingerprint.
const PDF_DATE_LITERAL_RE = /\/(CreationDate|ModDate)\s*\(([^)]*)\)/g;
const PDF_DATE_HEX_RE     = /\/(CreationDate|ModDate)\s*<([0-9a-fA-F]*)>/g;

function stripPdfTimestamps(buffer) {
  if (buffer.length < 4 || !buffer.slice(0, 4).equals(PDF_MAGIC)) {
    return buffer;
  }
  let content = buffer.toString("binary");
  content = content.replace(PDF_DATE_LITERAL_RE, (_match, key, dateVal) =>
    `/${key} (${ "\x00".repeat(dateVal.length) })`
  );
  content = content.replace(PDF_DATE_HEX_RE, (_match, key, hexVal) =>
    `/${key} <${ "0".repeat(hexVal.length) }>`
  );
  return Buffer.from(content, "binary");
}

// ── Worker execution path ──────────────────────────────────────────────────
// When this module is loaded as a worker thread workerData is populated.
// Read the file, compute the hash, and post the result to the parent.
if (workerData) {
  try {
    const buffer = fs.readFileSync(workerData.filePath);
    const normalized = stripPdfTimestamps(buffer);
    const hash = crypto.createHash("sha256").update(normalized).digest("hex");
    parentPort.postMessage({ hash });
  } catch (err) {
    parentPort.postMessage({ error: err.message });
  }
}

// ── Main-thread exports ────────────────────────────────────────────────────

const HASH_TIMEOUT_MS = 15 * 1000; // 15 s — cloud placeholder reads time out cleanly

/**
 * Compute the SHA-256 hex digest of a file.
 * Runs in a worker thread; rejects with code HASH_TIMEOUT if the file
 * cannot be read within HASH_TIMEOUT_MS (e.g. OneDrive cloud placeholder).
 */
function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { filePath } });

    const timer = setTimeout(() => {
      worker.terminate();
      const err = new Error(
        `HASH_TIMEOUT: file read blocked after ${HASH_TIMEOUT_MS / 1000}s — "${path.basename(filePath)}"`
      );
      err.code = "HASH_TIMEOUT";
      reject(err);
    }, HASH_TIMEOUT_MS);

    worker.once("message", ({ hash, error }) => {
      clearTimeout(timer);
      if (error) reject(new Error(error));
      else resolve(hash);
    });

    worker.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Synchronous hash — for callers that cannot await (e.g. single-file upload).
 * Does NOT protect against blocking on cloud-backed files.
 */
function hashFileSync(filePath) {
  const buffer = fs.readFileSync(filePath);
  const normalized = stripPdfTimestamps(buffer);
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

module.exports = { hashFile, hashFileSync };

#!/usr/bin/env node
/**
 * HealthLOQ Pre-Installation Checker
 *
 * Usage:
 *   node healthloq-precheck.js [app-root-path]
 *
 * Normally invoked by healthloq-precheck.cmd (Windows) or healthloq-precheck.sh
 * (Mac/Linux), which validate the Node.js environment before calling this script.
 * Can also be run directly: node tools/precheck/healthloq-precheck.js
 *
 * Generates a self-contained HTML report safe to email to support.
 * Sensitive values (JWT, API keys) are masked in the report.
 * Exit code 0 = all checks passed, 1 = one or more FAILs, 2 = fatal script error.
 */

"use strict";

const dnsModule = require("dns");
const https     = require("https");
const net       = require("net");
const fs        = require("fs");
const os        = require("os");
const path      = require("path");

// ── Constants ─────────────────────────────────────────────────────────────────

const APP_ROOT        = path.resolve(process.argv[2] || path.join(__dirname, "..", ".."));
const MIN_NODE_MAJOR  = 18;
const TCP_TIMEOUT_MS  = 8_000;
const HTTP_TIMEOUT_MS = 15_000;

// ── Result tracking ───────────────────────────────────────────────────────────

const results = [];
let failCount = 0;
let warnCount = 0;

const ICONS  = { PASS: "✓", FAIL: "✗", WARN: "⚠", SKIP: "─" };
const COLORS = { PASS: "\x1b[32m", FAIL: "\x1b[31m", WARN: "\x1b[33m", SKIP: "\x1b[90m" };
const RESET  = "\x1b[0m";

function record(category, name, status, message, fix) {
  if (status === "FAIL") failCount++;
  if (status === "WARN") warnCount++;
  results.push({ category, name, status, message, fix: fix || null });
  const icon  = ICONS[status]  || " ";
  const color = COLORS[status] || "";
  console.log(`  ${color}${icon} ${status.padEnd(4)}${RESET}  ${name.padEnd(40)} ${message}`);
}

function section(title) {
  const line = "─".repeat(Math.max(2, 52 - title.length));
  console.log(`\n  ── ${title} ${line}`);
}

// ── .env file parser (zero external dependencies) ────────────────────────────

function loadDotEnv(envPath) {
  const vars = {};
  if (!fs.existsSync(envPath)) return vars;
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let   val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    vars[key] = val;
  }
  return vars;
}

// ── Network helpers ───────────────────────────────────────────────────────────

function dnsLookup(hostname) {
  return new Promise((resolve, reject) =>
    dnsModule.lookup(hostname, (err, addr) => (err ? reject(err) : resolve(addr)))
  );
}

function tcpConnect(hostname, port) {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    sock.setTimeout(TCP_TIMEOUT_MS);
    sock.connect(port, hostname, () => { sock.destroy(); resolve(true); });
    sock.on("error",   (e) => { sock.destroy(); reject(e); });
    sock.on("timeout", ()  => { sock.destroy(); reject(new Error("TCP connection timed out")); });
  });
}

function httpsGet(hostname, urlPath, headers) {
  return new Promise((resolve, reject) => {
    const t0  = Date.now();
    const req = https.request(
      { hostname, path: urlPath, method: "GET", headers, timeout: HTTP_TIMEOUT_MS },
      (res) => {
        let body = "";
        res.on("data", (c) => { body += c; });
        res.on("end",  ()  => resolve({ status: res.statusCode, body, ms: Date.now() - t0 }));
      }
    );
    req.on("error",   reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("HTTPS request timed out")); });
    req.end();
  });
}

function checkPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error",     () => { srv.close(); resolve(false); });
    srv.once("listening", () => { srv.close(() => resolve(true)); });
    srv.listen(port, "127.0.0.1");
  });
}

// ── Mask sensitive values for display / report ────────────────────────────────

function mask(val) {
  if (!val || val.length < 10) return "***";
  return val.slice(0, 6) + "•••" + val.slice(-4) + "  [masked for sharing]";
}

function isPlaceholder(val) {
  if (!val) return true;
  const lc = val.toLowerCase();
  return lc.startsWith("replace-with") || lc === "your-token" || lc.includes("example.com");
}

// ─────────────────────────────────────────────────────────────────────────────
//  CHECK SECTIONS
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. Node.js environment ────────────────────────────────────────────────────

function checkNodeEnvironment() {
  section("Node.js Environment");

  // Version
  const ver   = process.versions.node;
  const major = parseInt(ver.split(".")[0], 10);
  if (major >= MIN_NODE_MAJOR) {
    record("Node.js", "Node.js version", "PASS", `v${ver}  (minimum: v${MIN_NODE_MAJOR})`);
  } else {
    record("Node.js", "Node.js version", "FAIL",
      `v${ver} — too old`,
      `Minimum required is v${MIN_NODE_MAJOR}. Download the latest LTS:\nhttps://nodejs.org/en/download/\nThen open a new terminal and run this check again.`);
  }

  // node_modules
  const nmDir = path.join(APP_ROOT, "node_modules");
  if (fs.existsSync(nmDir)) {
    record("Node.js", "node_modules installed", "PASS", nmDir);
  } else {
    record("Node.js", "node_modules installed", "FAIL",
      "directory not found",
      `Open a terminal in the app folder and run:\n  cd "${APP_ROOT}"\n  npm install`);
  }

  // better-sqlite3 native module — the most common post-install breakage
  try {
    require(path.join(APP_ROOT, "node_modules", "better-sqlite3"));
    record("Node.js", "Native module (better-sqlite3)", "PASS", "loads correctly");
  } catch (e) {
    const msg   = (e.message || String(e)).split("\n")[0];
    const isAbi = /NODE_MODULE_VERSION|was compiled against|invalid ELF|not a valid Win32/i.test(msg);
    record("Node.js", "Native module (better-sqlite3)", "FAIL",
      msg,
      isAbi
        ? `Node.js was updated after the app was installed. Run:\n  cd "${APP_ROOT}"\n  npm rebuild better-sqlite3\n\nIf that fails:\n  npm install\n\nWindows: if you see "MSBuild not found", install the Visual C++ Redistributable:\n  https://aka.ms/vs/17/release/vc_redist.x64.exe\nthen retry npm rebuild.\n\nmacOS: if you see xcrun errors:\n  xcode-select --install\nthen retry npm rebuild.`
        : `Run:\n  cd "${APP_ROOT}"\n  npm rebuild better-sqlite3\n\nIf that fails:\n  npm install`);
  }
}

// ── 2. Configuration ──────────────────────────────────────────────────────────

function checkConfiguration(env) {
  section("Configuration (.env)");

  const envPath = path.join(APP_ROOT, ".env");
  if (fs.existsSync(envPath)) {
    record("Config", ".env file present", "PASS", envPath);
  } else {
    record("Config", ".env file present", "WARN",
      ".env not found — using system environment variables only",
      `Copy .env.example to .env in:\n  ${APP_ROOT}\nthen fill in the values.`);
  }

  // Required
  const required = [
    ["REACT_APP_HEALTHLOQ_API_BASE_URL", "HealthLOQ API base URL"],
    ["REACT_APP_JWT_TOKEN",              "HealthLOQ JWT token"],
    ["ROOT_FOLDER_PATH",                 "Document watch folder (ROOT_FOLDER_PATH)"],
  ];
  for (const [key, label] of required) {
    const val = env[key];
    if (!val || isPlaceholder(val)) {
      record("Config", label, "FAIL",
        `${key} is not set`,
        `Set ${key} in .env.\nObtain the JWT token from your HealthLOQ partner portal.`);
    } else {
      const display = (key.includes("TOKEN") || key.includes("KEY")) ? mask(val) : val;
      record("Config", label, "PASS", display);
    }
  }

  // Optional — SMTP
  if (env.SMTP_HOST && !isPlaceholder(env.SMTP_HOST)) {
    record("Config", "SMTP (email alerts)", "PASS",
      `${env.SMTP_HOST}:${env.SMTP_PORT || 587}`);
  } else {
    record("Config", "SMTP (email alerts)", "SKIP",
      "not configured — alert emails will be disabled");
  }

  // Optional — Anthropic AI
  if (env.ANTHROPIC_API_KEY && !isPlaceholder(env.ANTHROPIC_API_KEY)) {
    record("Config", "Anthropic API key (AI features)", "PASS",
      mask(env.ANTHROPIC_API_KEY));
  } else {
    record("Config", "Anthropic API key (AI features)", "SKIP",
      "not set — AI metadata auto-populate will be disabled");
  }
}

// ── 3. Local resources ────────────────────────────────────────────────────────

async function checkLocalResources(env) {
  section("Local Resources");

  // Port
  const port = parseInt(env.PORT || "8003", 10);
  const free = await checkPortFree(port);
  if (free) {
    record("Local", `Port ${port} available`, "PASS", "not in use");
  } else {
    record("Local", `Port ${port} available`, "FAIL",
      `port ${port} is already bound by another process`,
      `Windows: netstat -ano | findstr :${port}   then taskkill /PID <pid> /F\nMac/Linux: lsof -i :${port}   then kill <pid>\nOr set PORT= to a different number in .env.`);
  }

  // ROOT_FOLDER_PATH
  const rootDir = env.ROOT_FOLDER_PATH;
  if (!rootDir || isPlaceholder(rootDir)) {
    record("Local", "Watch folder readable", "SKIP",
      "ROOT_FOLDER_PATH not configured — see Config section");
  } else if (!fs.existsSync(rootDir)) {
    record("Local", "Watch folder exists", "FAIL",
      `"${rootDir}" does not exist`,
      `Create the directory or update ROOT_FOLDER_PATH in .env to a path that exists.`);
  } else {
    try {
      fs.accessSync(rootDir, fs.constants.R_OK);
      let count = 0;
      try { count = fs.readdirSync(rootDir).length; } catch (_) { /* non-fatal */ }
      record("Local", "Watch folder readable", "PASS",
        `${rootDir}  (${count} top-level entries)`);
    } catch {
      record("Local", "Watch folder readable", "FAIL",
        `"${rootDir}" is not readable by the current user`,
        `Grant read access to this directory for the user running the app.`);
    }
  }

  // scratch/ writable (SQLite database lives here)
  const scratchDir = path.join(APP_ROOT, "scratch");
  const scratchTmp = path.join(scratchDir, ".precheck-tmp");
  try {
    if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
    fs.writeFileSync(scratchTmp, "ok");
    fs.unlinkSync(scratchTmp);
    record("Local", "scratch/ directory writable", "PASS", scratchDir);
  } catch (e) {
    record("Local", "scratch/ directory writable", "FAIL",
      e.message,
      `The app stores its SQLite database in scratch/.\nGrant write permission to:\n  ${scratchDir}`);
  }

  // public/exports/ writable (CSV export)
  const exportsDir = path.join(APP_ROOT, "public", "exports");
  const exportsTmp = path.join(exportsDir, ".precheck-tmp");
  try {
    if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
    fs.writeFileSync(exportsTmp, "ok");
    fs.unlinkSync(exportsTmp);
    record("Local", "public/exports/ writable", "PASS", exportsDir);
  } catch (e) {
    record("Local", "public/exports/ writable", "FAIL",
      e.message,
      `Verification CSV exports are written to public/exports/.\nGrant write permission to:\n  ${exportsDir}`);
  }
}

// ── 4. HealthLOQ API ──────────────────────────────────────────────────────────

async function checkHealthloqApi(env) {
  section("HealthLOQ API Connectivity");

  const apiBase = env.REACT_APP_HEALTHLOQ_API_BASE_URL;
  if (!apiBase || isPlaceholder(apiBase)) {
    record("API", "API checks", "SKIP", "REACT_APP_HEALTHLOQ_API_BASE_URL not configured");
    return;
  }

  let hostname;
  try {
    hostname = new URL(apiBase).hostname;
  } catch {
    record("API", "API URL parseable", "FAIL",
      `Cannot parse "${apiBase}" as a URL`,
      `Set REACT_APP_HEALTHLOQ_API_BASE_URL to a valid URL, e.g.:\n  https://api.healthloq.com`);
    return;
  }

  // DNS
  let resolved = false;
  try {
    const addr = await dnsLookup(hostname);
    record("API", `DNS: ${hostname}`, "PASS", `→ ${addr}`);
    resolved = true;
  } catch (e) {
    record("API", `DNS: ${hostname}`, "FAIL",
      e.message,
      `The hostname cannot be resolved. Common causes:\n` +
      `  • No internet access from this machine\n` +
      `  • Corporate DNS does not forward external names\n` +
      `  • Firewall blocking DNS (UDP/TCP 53)\n\n` +
      `Test manually:  nslookup ${hostname}\n\n` +
      `IT firewall rule required:\n` +
      `  Allow outbound DNS (UDP 53) to your DNS server\n` +
      `  Allow outbound HTTPS (TCP 443) to ${hostname}`);
    return;
  }

  // TCP 443
  if (resolved) {
    try {
      await tcpConnect(hostname, 443);
      record("API", `TCP ${hostname}:443`, "PASS", "connection established");
    } catch (e) {
      record("API", `TCP ${hostname}:443`, "FAIL",
        e.message,
        `Outbound HTTPS is blocked. Provide this to your IT/network team:\n\n` +
        `  Allow outbound TCP port 443 (HTTPS) to: ${hostname}\n\n` +
        `This is the only outbound port the HealthLOQ app requires.`);
      return;
    }
  }

  // API authentication
  const jwt = env.REACT_APP_JWT_TOKEN;
  if (!jwt || isPlaceholder(jwt)) {
    record("API", "API authentication (JWT)", "SKIP", "JWT token not configured");
    return;
  }

  try {
    const res = await httpsGet(hostname, "/document-hash/get-subscription-details", {
      Authorization:  `Bearer ${jwt}`,
      "Content-Type": "application/json",
      Accept:         "application/json",
    });

    if (res.status === 200) {
      let detail = "";
      try {
        const body  = JSON.parse(res.body);
        const types = (body.data || []).map((s) => s.subscription_type).filter(Boolean).join(", ");
        if (types) detail = `subscription: ${types}`;
      } catch (_) { /* non-fatal */ }
      record("API", "API authentication (JWT)", "PASS",
        `HTTP 200  ${res.ms}ms${detail ? "  —  " + detail : ""}`);
    } else if (res.status === 401 || res.status === 403) {
      record("API", "API authentication (JWT)", "FAIL",
        `HTTP ${res.status} — token rejected`,
        `The JWT token in .env is invalid or expired.\nObtain a fresh token from the HealthLOQ partner portal and update REACT_APP_JWT_TOKEN in .env.`);
    } else {
      record("API", "API authentication (JWT)", "WARN",
        `HTTP ${res.status} — unexpected response code`);
    }
  } catch (e) {
    record("API", "API authentication (JWT)", "FAIL",
      e.message,
      `Could not complete the API request. Check the API URL and network connectivity.`);
  }
}

// ── 5. SMTP ───────────────────────────────────────────────────────────────────

async function checkSmtp(env) {
  if (!env.SMTP_HOST || isPlaceholder(env.SMTP_HOST)) return;

  section("SMTP (Email Alerts)");
  const smtpHost = env.SMTP_HOST;
  const smtpPort = parseInt(env.SMTP_PORT || "587", 10);

  try {
    const addr = await dnsLookup(smtpHost);
    record("SMTP", `DNS: ${smtpHost}`, "PASS", `→ ${addr}`);
  } catch (e) {
    record("SMTP", `DNS: ${smtpHost}`, "FAIL",
      e.message,
      `SMTP_HOST "${smtpHost}" cannot be resolved. Verify the hostname in .env.`);
    return;
  }

  try {
    await tcpConnect(smtpHost, smtpPort);
    record("SMTP", `TCP ${smtpHost}:${smtpPort}`, "PASS", "connection established");
  } catch (e) {
    record("SMTP", `TCP ${smtpHost}:${smtpPort}`, "FAIL",
      e.message,
      `Outbound TCP port ${smtpPort} to ${smtpHost} is blocked.\n` +
      `IT firewall rule required:\n  Allow outbound TCP ${smtpPort} to ${smtpHost}\n\n` +
      `Alternatively, update SMTP_PORT in .env if your relay uses a different port (e.g. 465 or 25).`);
  }
}

// ── 6. Anthropic AI ───────────────────────────────────────────────────────────

async function checkAnthropicApi(env) {
  if (!env.ANTHROPIC_API_KEY || isPlaceholder(env.ANTHROPIC_API_KEY)) return;

  section("Anthropic AI (Metadata Features)");
  const aiHost = "api.anthropic.com";

  try {
    const addr = await dnsLookup(aiHost);
    record("AI", `DNS: ${aiHost}`, "PASS", `→ ${addr}`);
  } catch (e) {
    record("AI", `DNS: ${aiHost}`, "FAIL",
      e.message,
      `Cannot reach ${aiHost}. Outbound HTTPS (TCP 443) to api.anthropic.com\nis required for AI metadata features.`);
    return;
  }

  try {
    await tcpConnect(aiHost, 443);
    record("AI", `TCP ${aiHost}:443`, "PASS", "connection established");
  } catch (e) {
    record("AI", `TCP ${aiHost}:443`, "FAIL",
      e.message,
      `IT firewall rule required:\n  Allow outbound TCP 443 to api.anthropic.com`);
    return;
  }

  // Lightweight key validation
  try {
    const res = await httpsGet(aiHost, "/v1/models", {
      "x-api-key":         env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    });
    if (res.status === 200) {
      record("AI", "Anthropic API key valid", "PASS", `authenticated  ${res.ms}ms`);
    } else if (res.status === 401) {
      record("AI", "Anthropic API key valid", "FAIL",
        "HTTP 401 — key rejected",
        `The ANTHROPIC_API_KEY in .env is invalid or revoked.\nCheck the key in your Anthropic console: https://console.anthropic.com/`);
    } else {
      record("AI", "Anthropic API key valid", "WARN", `HTTP ${res.status}`);
    }
  } catch (e) {
    record("AI", "Anthropic API key valid", "WARN",
      `Could not verify: ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  HTML REPORT
// ─────────────────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br>");
}

function buildHtmlReport(env) {
  const now     = new Date();
  const overall = failCount > 0 ? "fail" : warnCount > 0 ? "warn" : "pass";
  const summaryText =
    failCount === 0 && warnCount === 0 ? "✓  All checks passed — ready to install"
    : failCount === 0 ? `⚠  ${warnCount} warning(s) — review before installing`
    : `✗  ${failCount} failure(s), ${warnCount} warning(s) — resolve failures before installing`;

  const categories = [...new Set(results.map((r) => r.category))];

  const tableRows = categories.map((cat) => {
    const header = `<tr class="sec"><td colspan="3">${esc(cat)}</td></tr>`;
    const rows = results
      .filter((r) => r.category === cat)
      .map((r) => `<tr>
        <td><span class="badge ${r.status}">${r.status}</span></td>
        <td>${esc(r.name)}</td>
        <td>${esc(r.message)}${r.fix ? `<div class="fix">${esc(r.fix)}</div>` : ""}</td>
      </tr>`)
      .join("");
    return header + rows;
  }).join("");

  const sysRows = [
    ["Machine",   os.hostname()],
    ["Platform",  `${os.platform()} ${os.arch()} (${os.release()})`],
    ["Node.js",   `v${process.versions.node}`],
    ["App root",  APP_ROOT],
    ["API URL",   env.REACT_APP_HEALTHLOQ_API_BASE_URL || "(not set)"],
    ["Generated", now.toString()],
  ].map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HealthLOQ Pre-Install Check — ${esc(now.toLocaleDateString())}</title>
<style>
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:980px;margin:40px auto;padding:0 24px;color:#1a202c;background:#f7fafc}
h1{color:#2b6cb0;margin-bottom:4px}
.sub{color:#718096;margin-bottom:20px;font-size:.9em}
.summary{padding:13px 18px;border-radius:8px;margin-bottom:22px;font-size:1.05em;font-weight:600}
.summary.pass{background:#c6f6d5;color:#22543d;border-left:5px solid #38a169}
.summary.fail{background:#fed7d7;color:#742a2a;border-left:5px solid #e53e3e}
.summary.warn{background:#fefcbf;color:#744210;border-left:5px solid #d69e2e}
dl{display:grid;grid-template-columns:max-content 1fr;gap:5px 16px;background:#fff;padding:14px 20px;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1);margin-bottom:22px;font-size:.85em}
dt{color:#718096;font-weight:600;white-space:nowrap}
dd{margin:0;word-break:break-all}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);margin-bottom:28px}
th{background:#2b6cb0;color:#fff;padding:10px 16px;text-align:left;font-size:.82em;font-weight:600}
td{padding:8px 16px;border-bottom:1px solid #e2e8f0;vertical-align:top;font-size:.83em}
tr:last-child td{border-bottom:none}
.sec td{background:#ebf4ff;color:#2c5282;font-weight:700;font-size:.75em;text-transform:uppercase;letter-spacing:.6px;padding:6px 16px}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:.74em;font-weight:700;letter-spacing:.3px;white-space:nowrap}
.badge.PASS{background:#c6f6d5;color:#22543d}
.badge.FAIL{background:#fed7d7;color:#742a2a}
.badge.WARN{background:#fefcbf;color:#744210}
.badge.SKIP{background:#e2e8f0;color:#718096}
.fix{margin-top:6px;padding:7px 10px;background:#f7fafc;border-left:3px solid #a0aec0;font-family:'SFMono-Regular',Consolas,monospace;font-size:.8em;white-space:pre-wrap;color:#4a5568}
footer{text-align:center;color:#a0aec0;font-size:.75em;margin:36px 0 16px}
@media print{body{background:#fff}table{box-shadow:none;border:1px solid #e2e8f0}}
</style>
</head>
<body>
<h1>HealthLOQ Pre-Installation Check</h1>
<p class="sub">Generated: ${esc(now.toLocaleString())} &nbsp;|&nbsp; Safe to share — all sensitive values are masked</p>
<div class="summary ${overall}">${esc(summaryText)}</div>
<dl>${sysRows}</dl>
<table>
  <thead><tr>
    <th style="width:68px">Status</th>
    <th style="width:240px">Check</th>
    <th>Result / Remediation</th>
  </tr></thead>
  <tbody>${tableRows}</tbody>
</table>
<footer>HealthLOQ Document Protection &nbsp;|&nbsp; Pre-installation diagnostic report</footer>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n  HealthLOQ Pre-Installation Check`);
  console.log(`  ${"═".repeat(52)}`);
  console.log(`  App root : ${APP_ROOT}`);
  console.log(`  Platform : ${os.platform()} ${os.arch()} (${os.release()})`);
  console.log(`  Node.js  : v${process.versions.node}`);
  console.log(`  Date     : ${new Date().toLocaleString()}\n`);

  // Load .env — values from the file take precedence over system env for display
  const dotenv = loadDotEnv(path.join(APP_ROOT, ".env"));
  const env    = { ...process.env, ...dotenv };

  // Run all checks
  checkNodeEnvironment();
  checkConfiguration(env);
  await checkLocalResources(env);
  await checkHealthloqApi(env);
  await checkSmtp(env);
  await checkAnthropicApi(env);

  // Save HTML report
  const stamp      = new Date().toISOString().slice(0, 10);
  const reportFile = `healthloq-precheck-${stamp}.html`;
  const reportPath = path.join(__dirname, reportFile);
  try {
    fs.writeFileSync(reportPath, buildHtmlReport(env), "utf8");
    console.log(`\n  Report saved: ${reportPath}`);
    console.log(`  Email this file to HealthLOQ support if you need assistance.`);
  } catch (e) {
    console.warn(`\n  Could not save report: ${e.message}`);
  }

  // Summary
  console.log("");
  if (failCount === 0 && warnCount === 0) {
    console.log(`  \x1b[32m✓  All checks passed — ready to install.\x1b[0m`);
  } else if (failCount === 0) {
    console.log(`  \x1b[33m⚠  ${warnCount} warning(s) — review the report before installing.\x1b[0m`);
  } else {
    console.log(`  \x1b[31m✗  ${failCount} failure(s), ${warnCount} warning(s).`);
    console.log(`     Resolve the failures above, then run this check again.\x1b[0m`);
  }
  console.log("");

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`\n  \x1b[31mFatal script error:\x1b[0m ${err.message}`);
  process.exit(2);
});

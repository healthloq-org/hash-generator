/**
 * Health metrics queries — powers the /api/health/* endpoints.
 * All date arithmetic done in JS using date-fns so there are no
 * SQLite strftime / locale mismatches.
 */
const fs = require("fs");
const path = require("path");
const {
  subDays, subWeeks, subMonths, subYears,
  startOfWeek, format,
} = require("date-fns");
const { db } = require("../db");

// ── Log helpers (called from utils/index.js) ───────────────────────────────

const stmtLogSuccess = db.prepare(
  `INSERT INTO processing_log (file_path, file_name, hash, status, processed_at)
   VALUES (?, ?, ?, 'success', ?)`
);
const stmtLogFailure = db.prepare(
  `INSERT INTO processing_log (file_path, file_name, hash, status, error_code, error_message, processed_at)
   VALUES (?, ?, ?, 'failed', ?, ?, ?)`
);

exports.logSuccess = (fileData) => {
  try {
    stmtLogSuccess.run(
      fileData.path,
      fileData.fileName || path.basename(fileData.path),
      fileData.hash || null,
      fileData.processedAt || new Date().toISOString()
    );
  } catch (_) {}
};

exports.logFailure = (fileData) => {
  try {
    stmtLogFailure.run(
      fileData.path,
      fileData.fileName || path.basename(fileData.path),
      fileData.hash || null,
      fileData.errorCode || "UNKNOWN",
      fileData.errorMessage || null,
      new Date().toISOString()
    );
  } catch (_) {}
};

// ── Summary counts ─────────────────────────────────────────────────────────

exports.getSummary = () => {
  const now = new Date();
  const cutoffs = {
    hour:  subDays(now, 0),   // overridden below
    day:   subDays(now, 1),
    week:  subDays(now, 7),
    month: subDays(now, 30),
  };
  // Fix hour — subHours isn't imported; just use Date arithmetic
  cutoffs.hour = new Date(now.getTime() - 60 * 60 * 1000);

  const stmt = db.prepare(
    `SELECT status, COUNT(*) AS count
     FROM processing_log
     WHERE processed_at >= ?
     GROUP BY status`
  );

  const result = {};
  for (const [label, since] of Object.entries(cutoffs)) {
    const rows = stmt.all(since.toISOString());
    const success = rows.find((r) => r.status === "success")?.count || 0;
    const failed  = rows.find((r) => r.status === "failed")?.count  || 0;
    result[label] = { success, failed, total: success + failed };
  }
  return result;
};

// ── Histogram ──────────────────────────────────────────────────────────────

/**
 * Returns { categories: string[], series: [{name, data}] }
 * groupBy: "day" | "week" | "month" | "year"
 */
exports.getHistogram = (groupBy = "day") => {
  const now = new Date();

  // Build the array of period keys and a formatter function
  let periods = [];
  let formatPeriod;

  if (groupBy === "week") {
    // Last 12 weeks — key = Monday date string "YYYY-MM-DD"
    for (let i = 11; i >= 0; i--) {
      const weekStart = startOfWeek(subWeeks(now, i), { weekStartsOn: 1 });
      periods.push(format(weekStart, "yyyy-MM-dd"));
    }
    formatPeriod = (isoStr) =>
      format(startOfWeek(new Date(isoStr), { weekStartsOn: 1 }), "yyyy-MM-dd");
  } else if (groupBy === "month") {
    // Last 12 months — key = "YYYY-MM"
    for (let i = 11; i >= 0; i--) {
      periods.push(format(subMonths(now, i), "yyyy-MM"));
    }
    formatPeriod = (isoStr) => format(new Date(isoStr), "yyyy-MM");
  } else if (groupBy === "year") {
    // Last 5 years — key = "YYYY"
    for (let i = 4; i >= 0; i--) {
      periods.push(format(subYears(now, i), "yyyy"));
    }
    formatPeriod = (isoStr) => format(new Date(isoStr), "yyyy");
  } else {
    // Default: day — last 30 days, key = "YYYY-MM-DD"
    for (let i = 29; i >= 0; i--) {
      periods.push(format(subDays(now, i), "yyyy-MM-dd"));
    }
    formatPeriod = (isoStr) => format(new Date(isoStr), "yyyy-MM-dd");
  }

  const since = periods[0]; // earliest period key (already formatted)
  // Pad to full datetime for the SQL comparison
  const sinceISO = new Date(since + (since.length === 4 ? "-01-01" : since.length === 7 ? "-01" : ""))
    .toISOString();

  const rows = db
    .prepare(`SELECT status, processed_at FROM processing_log WHERE processed_at >= ? ORDER BY processed_at`)
    .all(sinceISO);

  const successMap = {};
  const failedMap  = {};
  for (const row of rows) {
    try {
      const key = formatPeriod(row.processed_at);
      if (row.status === "success") successMap[key] = (successMap[key] || 0) + 1;
      else                          failedMap[key]  = (failedMap[key]  || 0) + 1;
    } catch (_) {}
  }

  // Build human-readable category labels
  const categories = periods.map((p) => {
    if (groupBy === "month") {
      const [y, m] = p.split("-").map(Number);
      return format(new Date(y, m - 1, 1), "MMM yyyy");
    }
    if (groupBy === "week") {
      return `Wk ${format(new Date(p), "MMM d")}`;
    }
    return p;
  });

  return {
    categories,
    series: [
      { name: "Success", data: periods.map((p) => successMap[p] || 0) },
      { name: "Failed",  data: periods.map((p) => failedMap[p]  || 0) },
    ],
  };
};

// ── Failed files (most recent attempt per file was a failure) ──────────────

exports.getFailedFiles = () =>
  db
    .prepare(
      `SELECT pl.id, pl.file_path, pl.file_name, pl.hash,
              pl.error_code, pl.error_message, pl.processed_at
       FROM processing_log pl
       WHERE pl.status = 'failed'
         AND pl.processed_at = (
               SELECT MAX(pl2.processed_at)
               FROM processing_log pl2
               WHERE pl2.file_path = pl.file_path
             )
       ORDER BY pl.processed_at DESC
       LIMIT 200`
    )
    .all()
    .filter((row) => fs.existsSync(row.file_path));

// ── Reprocess: remove files from publisher cache so next sync picks them up ─

exports.clearCacheForFiles = (filePaths) => {
  if (!filePaths?.length) return;
  try {
    const stmtGet = db.prepare("SELECT value FROM store WHERE key = 'data'");
    const raw = stmtGet.get();
    if (!raw) return;
    const cache = JSON.parse(raw.value);
    let changed = false;
    for (const key of Object.keys(cache)) {
      if (filePaths.includes(cache[key]?.path)) {
        delete cache[key];
        changed = true;
      }
    }
    if (changed) {
      db.prepare("INSERT OR REPLACE INTO store (key, value) VALUES ('data', ?)").run(
        JSON.stringify(cache)
      );
    }
  } catch (_) {}
};

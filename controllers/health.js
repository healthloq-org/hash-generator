const {
  getSummary,
  getHistogram,
  getFailedFiles,
  clearCacheForFiles,
} = require("../services/healthMetrics");
const {
  getCacheSummary,
  getCacheEntries,
  isRefreshing,
  refreshMetadataCache,
} = require("../services/metadataCache");
const { getSyncData, stopService, startService, restartService, setDocumentSyncInterval } = require("../utils");
const alertSvc = require("../services/alertService");
const logger = require("../logger");

exports.getSummary = (req, res) => {
  try {
    res.json({ status: "1", data: getSummary() });
  } catch (err) {
    logger.error({ err }, "health/getSummary failed");
    res.status(500).json({ status: "0", message: err.message });
  }
};

exports.getHistogram = (req, res) => {
  try {
    const groupBy = ["day", "week", "month", "year"].includes(req.query.groupBy)
      ? req.query.groupBy
      : "day";
    res.json({ status: "1", data: getHistogram(groupBy) });
  } catch (err) {
    logger.error({ err }, "health/getHistogram failed");
    res.status(500).json({ status: "0", message: err.message });
  }
};

exports.getFailedFiles = (req, res) => {
  try {
    res.json({ status: "1", data: getFailedFiles() });
  } catch (err) {
    logger.error({ err }, "health/getFailedFiles failed");
    res.status(500).json({ status: "0", message: err.message });
  }
};

exports.reprocess = (req, res) => {
  try {
    const { filePaths } = req.body;
    if (!Array.isArray(filePaths) || !filePaths.length) {
      return res.status(400).json({ status: "0", message: "filePaths array is required" });
    }
    clearCacheForFiles(filePaths);
    // Trigger an immediate sync if one isn't already running
    if (!global.isGetSyncDataProcessStart) {
      getSyncData();
    }
    res.json({
      status: "1",
      message: `Reprocessing started for ${filePaths.length} file(s)`,
    });
  } catch (err) {
    logger.error({ err }, "health/reprocess failed");
    res.status(500).json({ status: "0", message: err.message });
  }
};

exports.forceSync = (req, res) => {
  try {
    if (global.isGetSyncDataProcessStart) {
      return res.json({ status: "1", message: "Sync already in progress" });
    }
    getSyncData();
    if (!global.documentSyncInterval) {
      setDocumentSyncInterval();
    }
    res.json({ status: "1", message: "Sync started" });
  } catch (err) {
    logger.error({ err }, "health/forceSync failed");
    res.status(500).json({ status: "0", message: err.message });
  }
};

exports.getStatus = (req, res) => {
  try {
    const staticData = (() => {
      try { return JSON.parse(global.localStorage.getItem("staticData") || "{}"); }
      catch { return {}; }
    })();
    const serviceEnabled = global.serviceEnabled !== false;
    const syncRunning    = global.isGetSyncDataProcessStart || false;
    res.json({
      status: "ok",
      version: require("../package.json").version,
      lastSyncedDate: staticData?.lastSyncedDate || null,
      serviceEnabled,
      // "running" = enabled AND actively syncing right now
      // "idle"    = enabled AND waiting for next trigger
      // "stopped" = manually stopped
      serviceState: !serviceEnabled ? "stopped" : syncRunning ? "running" : "idle",
      syncRunning,
      verifierRunning: global.isVerifierScriptRunning || false,
      subscriptionTypes: (global.subscriptionDetail || []).map((s) => s.subscription_type),
      rootFolderPath: process.env.ROOT_FOLDER_PATH || null,
      nextScheduledSync: global.nextScheduledSync || null,
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};

exports.serviceStop = (req, res) => {
  try {
    stopService();
    res.json({ status: "1", message: "Hashing service stopped" });
  } catch (err) {
    logger.error({ err }, "health/serviceStop failed");
    res.status(500).json({ status: "0", message: err.message });
  }
};

exports.serviceStart = (req, res) => {
  try {
    startService();
    res.json({ status: "1", message: "Hashing service started" });
  } catch (err) {
    logger.error({ err }, "health/serviceStart failed");
    res.status(500).json({ status: "0", message: err.message });
  }
};

exports.serviceRestart = (req, res) => {
  try {
    restartService();
    res.json({ status: "1", message: "Hashing service restarting" });
  } catch (err) {
    logger.error({ err }, "health/serviceRestart failed");
    res.status(500).json({ status: "0", message: err.message });
  }
};

exports.getMetadataCache = (req, res) => {
  try {
    const { counts, lastUpdated } = getCacheSummary();
    res.json({
      status: "1",
      counts,
      // Normalise SQLite's "YYYY-MM-DD HH:MM:SS" to a proper ISO string
      lastUpdated: lastUpdated
        ? new Date(lastUpdated.replace(" ", "T") + "Z").toISOString()
        : null,
      refreshing: isRefreshing(),
    });
  } catch (err) {
    logger.error({ err }, "health/getMetadataCache failed");
    res.status(500).json({ status: "0", message: err.message });
  }
};

exports.getMetadataCacheEntries = (req, res) => {
  try {
    const { entityType } = req.params;
    const rows = getCacheEntries(entityType);
    res.json({ status: "1", data: rows });
  } catch (err) {
    logger.error({ err }, "health/getMetadataCacheEntries failed");
    const status = err.message === "Invalid entity type" ? 400 : 500;
    res.status(status).json({ status: "0", message: err.message });
  }
};

exports.refreshMetadataCache = (req, res) => {
  if (isRefreshing()) {
    return res.json({ status: "1", message: "Refresh already in progress" });
  }
  // Fire-and-forget — client polls GET /metadata-cache for updated counts
  refreshMetadataCache().catch((err) =>
    logger.error({ err }, "metadata cache background refresh failed")
  );
  res.json({ status: "1", message: "Metadata cache refresh started" });
};

// ── Alert rules ────────────────────────────────────────────────────────────

exports.listAlertRules = (req, res) => {
  try {
    res.json({ status: "1", data: alertSvc.listRules() });
  } catch (err) {
    logger.error({ err }, "listAlertRules failed");
    res.status(500).json({ status: "0", message: err.message });
  }
};

exports.createAlertRule = (req, res) => {
  try {
    const { alert_type, email, threshold_minutes, enabled } = req.body;
    if (!["service_offline", "no_documents"].includes(alert_type)) {
      return res.status(400).json({ status: "0", message: "Invalid alert_type" });
    }
    if (!email || !email.includes("@")) {
      return res.status(400).json({ status: "0", message: "Valid email is required" });
    }
    if (!threshold_minutes || threshold_minutes < 1) {
      return res.status(400).json({ status: "0", message: "threshold_minutes must be >= 1" });
    }
    const rule = alertSvc.createRule({ alert_type, email, threshold_minutes, enabled });
    res.json({ status: "1", data: rule });
  } catch (err) {
    logger.error({ err }, "createAlertRule failed");
    res.status(500).json({ status: "0", message: err.message });
  }
};

exports.updateAlertRule = (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const rule = alertSvc.updateRule(id, req.body);
    if (!rule) return res.status(404).json({ status: "0", message: "Rule not found" });
    res.json({ status: "1", data: rule });
  } catch (err) {
    logger.error({ err }, "updateAlertRule failed");
    res.status(500).json({ status: "0", message: err.message });
  }
};

exports.deleteAlertRule = (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    alertSvc.deleteRule(id);
    res.json({ status: "1", message: "Alert rule deleted" });
  } catch (err) {
    logger.error({ err }, "deleteAlertRule failed");
    res.status(500).json({ status: "0", message: err.message });
  }
};

exports.testAlertEmail = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes("@")) {
      return res.status(400).json({ status: "0", message: "Valid email is required" });
    }
    await alertSvc.sendTestEmail(email);
    res.json({ status: "1", message: `Test email sent to ${email}` });
  } catch (err) {
    logger.error({ err }, "testAlertEmail failed");
    res.status(500).json({ status: "0", message: err.message });
  }
};

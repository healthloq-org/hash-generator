const fs = require("fs");
const path = require("path");
const { syncHash, getSubscriptionDetail, syncDocToolLogs, publisherScriptIsRunningOrNot } = require("../services/healthloq");
const { scanDirectory } = require("../services/fileScanner");
const { hashFile } = require("../services/hasher");
const { logSuccess, logFailure } = require("../services/healthMetrics");
const { isEqual } = require("date-fns");
const logger = require("../logger");
const packageJson = require("../package.json");

// ---------------------------------------------------------------------------
// Storage helpers (backed by SQLite via global.localStorage)
// ---------------------------------------------------------------------------

/**
 * Return stored publisher hash data as an array.
 */
exports.getData = async (fileName) => {
  let data = [];
  try {
    const raw = localStorage.getItem(fileName || "data");
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed) data = Object.values(parsed);
  } catch (_) {}
  return data;
};

/**
 * Return stored publisher hash data as an object keyed by inode.
 */
exports.getDataInObjectFormat = async (fileName) => {
  let data = {};
  try {
    const raw = localStorage.getItem(fileName || "data");
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed) data = parsed;
  } catch (_) {}
  return data;
};

/**
 * Persist an array of file records, keyed by inode.
 */
exports.setData = (data, fileName) =>
  localStorage.setItem(
    fileName || "data",
    JSON.stringify(
      Object.fromEntries(data?.map((item) => [item?.state?.ino, item]))
    )
  );

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

exports.sort = (prop, arr) => {
  const keys = prop.split(".");
  arr.sort((a, b) => {
    let av = a;
    let bv = b;
    for (const k of keys) { av = av?.[k]; bv = bv?.[k]; }
    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  });
  return arr;
};

exports.filterObj = (obj, keys) =>
  Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));

exports.setFolderPathToArray = (folderPath) => {
  let array = JSON.parse(localStorage.getItem("folderPath") || "[]");
  if (!array.includes(folderPath.trim())) {
    array.push(folderPath);
    localStorage.setItem("folderPath", JSON.stringify(array));
  }
};

// ---------------------------------------------------------------------------
// Hash generation — verifier mode
// ---------------------------------------------------------------------------

exports.generateHashForVerifier = async (
  rootFolderPath = process.env.ROOT_FOLDER_PATH
) => {
  const arr = [];
  const unreadFiles = [];
  const unreadFolders = [];

  try {
    const oldData = await this.getDataInObjectFormat("documentVerificationData");

    for await (const entry of scanDirectory(rootFolderPath)) {
      // Collect any unreadable folders the scanner found
      if (entry._unreadFolders?.length) {
        unreadFolders.push(...entry._unreadFolders.splice(0));
      }

      let state;
      try {
        state = fs.statSync(entry.filePath);
      } catch (err) {
        unreadFiles.push(entry.filePath);
        logFailure({ path: entry.filePath, fileName: entry.name, errorCode: "FILE_STAT_ERROR", errorMessage: err.message });
        continue;
      }

      // Skip unchanged files (same inode + same mtime)
      const cached = oldData?.[state.ino];
      if (cached && isEqual(new Date(cached.state.mtime), new Date(state.mtime))) {
        continue;
      }

      let hash;
      try {
        hash = hashFile(entry.filePath);
      } catch (err) {
        unreadFiles.push(entry.filePath);
        logFailure({ path: entry.filePath, fileName: entry.name, errorCode: "FILE_READ_ERROR", errorMessage: err.message });
        continue;
      }

      arr.push({ fileName: entry.name, hash, path: entry.filePath, state, createdAt: new Date() });
    }
  } catch (err) {
    logger.error({ err }, "generateHashForVerifier: unexpected error");
    syncDocToolLogs({
      message: "generateHashForVerifier => unexpected error",
      error_message: err?.message,
      error: err,
    });
  }

  return { data: arr, unreadFiles, unreadFolders };
};

// ---------------------------------------------------------------------------
// Hash generation — publisher mode
// ---------------------------------------------------------------------------

exports.generateHashForPublisher = async (
  rootFolderPath = process.env.ROOT_FOLDER_PATH
) => {
  const arr = [];
  let hasMoreFiles = false;
  let count = 0;

  try {
    const oldData = await this.getDataInObjectFormat();

    for await (const entry of scanDirectory(rootFolderPath)) {
      if (arr.length >= 500) {
        hasMoreFiles = true;
        break;
      }

      count++;

      let state;
      try {
        state = fs.statSync(entry.filePath);
      } catch (err) {
        logger.warn({ filePath: entry.filePath, err }, "generateHashForPublisher: cannot stat file");
        logFailure({ path: entry.filePath, fileName: entry.name, errorCode: "FILE_STAT_ERROR", errorMessage: err.message });
        continue;
      }

      // Skip unchanged files
      const cached = oldData?.[state.ino];
      if (cached && isEqual(new Date(cached.state.mtime), new Date(state.mtime))) {
        continue;
      }

      let hash;
      try {
        hash = hashFile(entry.filePath);
      } catch (err) {
        logger.warn({ filePath: entry.filePath, err }, "generateHashForPublisher: cannot read file");
        logFailure({ path: entry.filePath, fileName: entry.name, errorCode: "FILE_READ_ERROR", errorMessage: err.message });
        continue;
      }

      arr.push({
        fileName: entry.name,
        hash,
        path: entry.filePath,
        state,
        createdAt: new Date(),
        effective_date: "9999-12-31",
        expiration_date: "9999-12-31",
        organization_id: "",
        location_id: "",
        product_id: "",
        product_batch_id: "",
        organization_name: null,
        location_name: null,
        product_name: null,
        product_batch_name: null,
      });
    }
  } catch (err) {
    logger.error({ err }, "generateHashForPublisher: unexpected error");
    syncDocToolLogs({
      message: "generateHashForPublisher => unexpected error",
      error_message: err?.message,
      error: err,
    });
  }

  return { data: arr, hasMoreFiles, count };
};

// ---------------------------------------------------------------------------
// Single-file hash (used by controllers directly)
// ---------------------------------------------------------------------------

exports.generateHashFromFileName = (filePath = "", file) => {
  const state = fs.statSync(filePath);
  const hash = hashFile(filePath);
  return { fileName: file.name, hash, path: filePath, state, createdAt: new Date() };
};

// ---------------------------------------------------------------------------
// Folder overview (used by verifier dashboard)
// ---------------------------------------------------------------------------

exports.getFolderOverview = async (rootFolderPath) => {
  let filesCount = 0;
  let newFilesCount = 0;
  const unreadFiles = [];
  const unreadFolders = [];

  try {
    const oldData = await this.getDataInObjectFormat("documentVerificationData");

    for await (const entry of scanDirectory(rootFolderPath)) {
      if (entry._unreadFolders?.length) {
        unreadFolders.push(...entry._unreadFolders.splice(0));
      }

      filesCount++;

      let state;
      try {
        state = fs.statSync(entry.filePath);
      } catch {
        continue;
      }

      const cached = oldData?.[state.ino];
      if (!cached || !isEqual(new Date(cached.state.mtime), new Date(state.mtime))) {
        newFilesCount++;
      }
    }
  } catch (err) {
    logger.error({ err }, "getFolderOverview: unexpected error");
  }

  return { errorMsg: "", filesCount, newFilesCount, unreadFiles, unreadFolders };
};

// ---------------------------------------------------------------------------
// Sync orchestration
// ---------------------------------------------------------------------------

exports.getSyncData = async (syncedData = null) => {
  try {
    global.isGetSyncDataProcessStart = true;
    const subscriptionData =
      global.subscriptionDetail?.find((item) => item?.subscription_type === "publisher") || null;

    if (!subscriptionData || !Object.keys(subscriptionData).length) {
      global.isGetSyncDataProcessStart = false;
      logger.warn("getSyncData: publisher subscription not found");
      syncDocToolLogs({
        message: "getSyncData => Publisher subscription not found.",
        error_message: "Publisher subscription not found.",
        error: null,
      });
      return;
    }

    const ignoreThreshold = subscriptionData?.organization?.ignore_threshold;
    let hashLimit = parseInt(subscriptionData?.num_monthly_hashes || "0");
    let todayHashLimit = parseInt(subscriptionData?.current_num_monthly_hashes || "0");

    if (!ignoreThreshold) {
      if (!hashLimit) {
        global.isGetSyncDataProcessStart = false;
        logger.warn("getSyncData: invalid subscription information");
        syncDocToolLogs({
          message: "getSyncData => Invalid subscription information.",
          error_message: "Invalid subscription information.",
          error: null,
        });
        return;
      }
      if (hashLimit <= todayHashLimit) {
        global.isGetSyncDataProcessStart = false;
        logger.warn("getSyncData: monthly hash limit exceeded");
        syncDocToolLogs({
          message: "getSyncData => Monthly document upload limit exceeded.",
          error_message: "Monthly document upload limit exceeded.",
          error: null,
        });
        return;
      }
    }

    if (!syncedData) {
      syncedData = await this.getData();
    }

    const { data: latestData, hasMoreFiles, count } = await this.generateHashForPublisher(
      process.env.ROOT_FOLDER_PATH
    );

    const syncedHashes = new Set(syncedData.map((item) => item?.hash));
    const latestHashes = new Set(latestData.map((item) => item?.hash));
    // Hashes whose file no longer exists on disk should be removed from HealthLOQ
    const deletedHashList = syncedData
      .filter((item) => item?.hash && item?.path && !fs.existsSync(item.path))
      .map((item) => item.hash);
    const deletedHashSet = new Set(deletedHashList);
    let hashList = latestData
      .filter((item) => !syncedHashes.has(item.hash))
      .map((item) => item.hash);

    if (!ignoreThreshold) {
      if (todayHashLimit + hashList.length > hashLimit) {
        hashList = hashList.slice(0, hashLimit - todayHashLimit);
      }
    }

    const updateData = latestData.filter((d) => !syncedHashes.has(d.hash));
    let newData = syncedData.filter((item) => !deletedHashSet.has(item?.hash)).concat(updateData);
    let syncStatus = null;

    if (hashList.length || deletedHashList.length) {
      syncStatus = await syncHash({
        deletedHashList,
        hashList,
        hashCount: todayHashLimit + hashList.length,
        organization_id: subscriptionData?.organization?.id || null,
      });
      if (syncStatus === "1") {
        const now = new Date().toISOString();
        for (const item of latestData) {
          if (hashList.includes(item.hash)) {
            logger.info({ fileName: item.fileName }, "hash generated and synced");
            logSuccess({ path: item.path, fileName: item.fileName, hash: item.hash, processedAt: now });
          }
        }
        this.setData(newData);
        global.subscriptionDetail = global.subscriptionDetail?.map((item) =>
          item?.subscription_type === "publisher"
            ? { ...item, current_num_monthly_hashes: String(todayHashLimit + hashList.length) }
            : item
        );
      }
    }

    if (syncStatus === "0" && hashList.length) {
      const now = new Date().toISOString();
      for (const item of latestData) {
        if (hashList.includes(item.hash)) {
          logFailure({ path: item.path, fileName: item.fileName, hash: item.hash, errorCode: "SYNC_API_ERROR", errorMessage: "Blockchain API call failed", processedAt: now });
        }
      }
    }

    publisherScriptIsRunningOrNot({
      is_running: hasMoreFiles,
      todayHashLimit,
      syncedData: syncedData.length,
      hashList: hashList.length,
      newData: newData.length,
      deletedHashList: deletedHashList.length,
      latestData: latestData.length,
      lastSyncedFile: latestData?.[latestData.length - 1]?.fileName,
      count,
    });

    if (hasMoreFiles && syncStatus !== "0") {
      localStorage.setItem("lastSyncedFile", latestData?.[latestData.length - 1]?.fileName);
      await this.getSyncData(newData);
    } else {
      localStorage.removeItem("lastSyncedFile");
      global.isGetSyncDataProcessStart = false;
      localStorage.setItem("staticData", JSON.stringify({ lastSyncedDate: new Date() }));
    }
  } catch (err) {
    logger.error({ err }, "getSyncData: unexpected error");
    syncDocToolLogs({
      message: "getSyncData => unexpected error",
      error_message: err?.message,
      error: err,
    });
  }
};

// ---------------------------------------------------------------------------
// Watcher debounce / interval
// ---------------------------------------------------------------------------

exports.setDocumentSyncTimeout = () => {
  if (global.documentSyncTimeout) {
    clearTimeout(global.documentSyncTimeout);
    if (global.documentSyncInterval) clearInterval(global.documentSyncInterval);
  }
  global.documentSyncTimeout = setTimeout(async () => {
    if (!global.isGetSyncDataProcessStart) this.getSyncData();
    this.setDocumentSyncInterval();
  }, 6 * 1000); // 6 seconds debounce
};

exports.setDocumentSyncInterval = () => {
  if (global.documentSyncInterval) clearInterval(global.documentSyncInterval);
  global.documentSyncInterval = setInterval(async () => {
    if (global.serviceEnabled === false) return;
    if (!global.isGetSyncDataProcessStart) {
      const subscriptionInfo = await getSubscriptionDetail();
      global.subscriptionDetail = subscriptionInfo?.data;
      this.getSyncData();
    }
    publisherScriptIsRunningOrNot({
      is_running: global.isGetSyncDataProcessStart,
      doc_tool_version: packageJson.version,
    });
  }, 5 * 60 * 1000); // 5-minute fallback heartbeat
};

// ---------------------------------------------------------------------------
// Service lifecycle control
// ---------------------------------------------------------------------------

exports.stopService = () => {
  global.serviceEnabled = false;
  if (global.documentSyncInterval) {
    clearInterval(global.documentSyncInterval);
    global.documentSyncInterval = null;
  }
  if (global.documentSyncTimeout) {
    clearTimeout(global.documentSyncTimeout);
    global.documentSyncTimeout = null;
  }
  // Record the time the service went offline so alert rules can measure duration
  try {
    global.localStorage.setItem("service_offline_since", new Date().toISOString());
  } catch (_) {}
  logger.info("Hashing service stopped");
};

exports.startService = () => {
  global.serviceEnabled = true;
  // Clear the offline timestamp so alert cooldowns reset correctly
  try {
    global.localStorage.removeItem("service_offline_since");
  } catch (_) {}
  this.setDocumentSyncInterval();
  if (!global.isGetSyncDataProcessStart) {
    this.getSyncData();
  }
  logger.info("Hashing service started");
};

exports.restartService = () => {
  this.stopService();
  // Brief pause so any in-flight sync can record its final state
  setTimeout(() => this.startService(), 500);
  logger.info("Hashing service restarting");
};

const {
  sort,
  getData,
  getFolderOverview,
  generateHashForVerifier,
  filterObj,
  setData,
  setFolderPathToArray,
} = require("../utils");
const {
  verifyDocument,
  getSubscriptionDetail,
  verifyDocumentOrganizations,
  updateDocumentEffectiveDateIntoHealthLOQ,
  verifyDocumentNew,
  productListForMetaData,
  organizationListForMetaData,
  locationListForMetaData,
  productBatchListForMetaData,
  verifyBlockchainProof,
  verifyCoaDocumentProof,
} = require("../services/healthloq");
const { analyzeFileForMetadata } = require("../services/metadataAI");
const logger = require("../logger");
const fs = require("fs");
const path = require("path");
const { format: formatDate } = require("date-fns");
const { Parser } = require("json2csv");

/**
 * Resolve and validate a user-supplied path so it cannot escape rootDir.
 * Returns the resolved absolute path, or null if it escapes the root.
 */
function safePath(userPath, rootDir) {
  if (!userPath || typeof userPath !== "string") return null;
  const resolved = path.resolve(rootDir, userPath);
  // Ensure the resolved path starts with rootDir (plus a separator) or IS rootDir
  if (resolved !== rootDir && !resolved.startsWith(rootDir + path.sep)) {
    return null;
  }
  return resolved;
}

exports.getDashboardData = async (req, res) => {
  const data = await getData();
  let staticData = localStorage.getItem("staticData");
  if (staticData) {
    staticData = JSON.parse(staticData);
  }
  res.status(200).json({
    status: "1",
    data: {
      lastSyncedDate:
        staticData?.lastSyncedDate ||
        sort("createdAt", data).reverse()[0]?.createdAt,
      totalFiles: data.length,
      files: sort("createdAt", data).reverse() || [],
    },
  });
};

exports.getFolderOverviewData = async (req, res) => {
  const rawFolderPath = req.body?.folderPath;
  const folderPath = rawFolderPath ? path.resolve(rawFolderPath) : null;
  if (!folderPath) {
    return res.status(400).json({ status: "0", message: "Invalid folder path" });
  }
  const docData = await getData("documentVerificationData");
  let newData = [];
  if (folderPath) {
    docData.forEach((doc) => {
      if (doc.path.includes(folderPath)) {
        const lastSlashIndex = doc.path.lastIndexOf("/");
        const normalizedPath =
          lastSlashIndex !== -1
            ? doc.path.substring(0, lastSlashIndex)
            : doc.path;
        if (
          normalizedPath === (folderPath.endsWith("/")
            ? folderPath.slice(0, -1)
            : folderPath)
        ) {
          newData.push(doc);
        }
      }
    });
  }

  const dataCount = {};
  const previousData = newData.map((doc) => ({
    "Organization Name": doc?.org_name,
    Message: doc?.message,
    "Error Message": doc?.err_message,
    "Is Verified Organization": doc.is_vrf_org,
    "File Name": doc.fileName,
    "File Path": doc.path,
    "Is Verified Document": doc.is_vrf_doc,
    Created: doc.createdAt,
    labDocumentHashId: doc.labDocumentHashId,
    documentHashId: doc.documentHashId,
    OrganizationExhibitId: doc.OrganizationExhibitId,
    integrantId: doc.integrantId,
    labOrgName: doc.labOrgName,
    hash: doc.hash,
  }));

  dataCount["noOfVerifiedDocumentsWithVerifiedOrg"] = newData?.filter(
    (item) => item["is_vrf_org"] === "Yes" && item["is_vrf_doc"] === "Yes"
  )?.length;

  dataCount["noOfVerifiedDocumentsWithUnVerifiedOrg"] = newData?.filter(
    (item) =>
      (item["is_vrf_org"] === "No" || item["is_vrf_org"] === "") &&
      item["is_vrf_doc"] === "Yes"
  )?.length;

  dataCount["noOfUnverifiedDocuments"] = newData?.filter(
    (item) => item["is_vrf_doc"] === "No"
  )?.length;

  const folderOverview = await getFolderOverview(folderPath);
  res.status(200).json({
    status: "1",
    data: folderOverview,
    count: dataCount,
    doc: previousData,
  });
};

exports.getSubscriptionOverview = async (req, res) => {
  try {
    const subscriptionDetails = await getSubscriptionDetail();
    res.status(200).json({
      ...subscriptionDetails,
    });
  } catch (error) {
    res.status(422).json({
      status: "0",
      message: error.message,
    });
  }
};

exports.verifyDocuments = async (req, res) => {
  try {
    const { folderPath: rawFolderPath, selectedOrganizations } = req.body;
    const folderPath = rawFolderPath ? path.resolve(rawFolderPath) : null;

    if (!folderPath) {
      return res.status(400).json({ status: "0", message: "Invalid folder path" });
    }

    // Send immediate response to client
    res.status(200).json({ status: "1", data: [] });

    global.isVerifierScriptRunning = true;
    const organizationIds = selectedOrganizations?.map((item) => item?.id);

    // 1. Verify document organizations
    let docOrgVerificationData = [];
    try {
      const response = await verifyDocumentOrganizations({ organizationIds });
      if (response?.data?.length) docOrgVerificationData = response.data;
    } catch (error) {
      console.log(error);
    }

    // 2. Generate hashes
    const docVerificationLimit = 100;
    let finalResult = [];
    let errorMsg = "";

    const {
      data: documentHashData,
      unreadFiles,
      unreadFolders,
    } = await generateHashForVerifier(folderPath);

    for (let i = 0; i < documentHashData?.length; i += docVerificationLimit) {
      if (!global.isVerifierScriptRunning) {
        break;
      }
      const arr = documentHashData?.slice(i, i + docVerificationLimit);
      if (arr?.length) {
        // verify documents in blockchain
        const response = await verifyDocumentNew({
          hashList: arr?.map((item) => item?.hash),
          organizationIds,
        });
        if (response?.status === "0") {
          errorMsg = response?.message;
          break;
        }

        if (response?.status === "1") {
          finalResult = [
            ...finalResult,
            ...response?.data?.data?.map((item) => {
              const fileInfo = documentHashData?.filter(
                (a) => a?.hash === item?.hash
              )[0];
              const orgInfo = item?.organization_id
                ? selectedOrganizations?.filter(
                    (a) => a?.id === item?.organization_id
                  )[0]
                : null;
              const orgVerificationInfo =
                docOrgVerificationData?.filter(
                  (a) => a?.organization_id === item?.organization_id
                )[0] || null;
              return {
                "Organization Name": orgInfo?.name || "",
                "Is Verified Organization": item?.isOrganizationVerified,
                "File Name": fileInfo?.fileName,
                "File Path": fileInfo?.path,
                "Is Verified Document": item?.isVerifiedDocument,
                Created: item?.created_on
                  ? formatDate(new Date(item?.created_on), "dd MMMM, yyyy hh:mm a")
                  : null,
                Message: item?.message,
                "Error Message": "",
                integrantId: item?.integrantId,
                OrganizationExhibitId: item?.OrganizationExhibitId,
                documentHashId: item?.documentHashId,
                labDocumentHashId: item?.labDocumentHashId,
                labOrgName: item.labOrgName,
              };
            }),
          ];
          io.sockets.emit("documentVerificationUpdate", {
            verifiedFilesCount: finalResult?.length,
          });
          // Stop document verification if subscription limit
          if (!response?.data?.userHaveDocVerificationLimit) {
            errorMsg = response?.data?.errorMsg;
            break;
          }
        } else if (response?.status === "2") {
          errorMsg = response?.message;
          if (response?.data?.data) {
            finalResult = [
              ...finalResult,
              ...response?.data?.data?.map((item) => {
                const fileInfo = documentHashData?.filter(
                  (a) => a?.hash === item?.hash
                )[0];
                const orgInfo = item?.organization_id
                  ? selectedOrganizations?.filter(
                      (a) => a?.id === item?.organization_id
                    )[0]
                  : null;
                const orgVerificationInfo =
                  docOrgVerificationData?.filter(
                    (a) => a?.organization_id === item?.organization_id
                  )[0] || null;
                return {
                  "Organization Name": orgInfo?.name || "",
                  "Is Verified Organization": item?.isOrganizationVerified,
                  "File Name": fileInfo?.fileName,
                  "File Path": fileInfo?.path,
                  "Is Verified Document": item?.isVerifiedDocument,
                  Created: item?.created_on
                    ? formatDate(new Date(item?.created_on), "dd MMMM, yyyy hh:mm a")
                    : null,
                  Message: item?.message,
                  "Error Message": "",
                  integrantId: item?.integrantId,
                  OrganizationExhibitId: item?.OrganizationExhibitId,
                  documentHashId: item?.documentHashId,
                  labDocumentHashId: item?.labDocumentHashId,
                  labOrgName: item.labOrgName,
                };
              }),
            ];
          }
          io.sockets.emit("documentVerificationUpdate", {
            verifiedFilesCount: finalResult?.length,
          });
          break;
        } else {
          finalResult = [
            ...finalResult,
            ...arr?.map((item) => {
              return {
                "Organization Name": "",
                "Is Verified Organization": "",
                "File Name": item?.fileName,
                "File Path": item?.path,
                "Is Verified Document": null,
                Created: null,
                Message: "",
                "Error Message": `Something went wrong! We are not able to verify the file which located in this location ${item?.path}.`,
                integrantId: null,
                OrganizationExhibitId: null,
                documentHashId: null,
                labDocumentHashId: null,
                labOrgName: null,
              };
            }),
          ];
          io.sockets.emit("documentVerificationUpdate", {
            verifiedFilesCount: finalResult?.length,
          });
        }
      }
    }

    // 3. Merge Data Efficiently
    if (global.isVerifierScriptRunning) {
      const pathMap = new Map(documentHashData.map((d) => [d.path, d]));

      const mergeData = finalResult
        .map((item) => {
          const doc = pathMap.get(item["File Path"]);
          if (!doc) return null;
          return {
            fileName: doc.fileName,
            org_name: item["Organization Name"],
            err_message: item["Error Message"],
            message: item["Message"],
            path: doc.path,
            hash: doc.hash,
            state: doc.state,
            createdAt: doc.createdAt,
            is_vrf_org: item["Is Verified Organization"],
            is_vrf_doc: item["Is Verified Document"],
            labDocumentHashId: item.labDocumentHashId,
            documentHashId: item.documentHashId,
            OrganizationExhibitId: item.OrganizationExhibitId,
            integrantId: item.integrantId,
            labOrgName: item.labOrgName,
          };
        })
        .filter(Boolean);

      const oldData = await getData("documentVerificationData");
      // Replace old entries for re-verified files rather than appending unconditionally
      const mergePathSet = new Set(mergeData.map((d) => d.path));
      await setData([...oldData.filter((d) => !mergePathSet.has(d.path)), ...mergeData], "documentVerificationData");
    }

    // 4. Stream CSV to File
    if (global.isVerifierScriptRunning && finalResult.length) {
      try {
        const csvParser = new Parser();
        const csv = csvParser.parse(
          finalResult.map((item) =>
            filterObj(item, [
              "documentHashId",
              "OrganizationExhibitId",
              "integrantId",
            ])
          )
        );
        const filePath = path.join(
          __dirname,
          "../public/exports/document-verification-overview.csv"
        );
        fs.writeFileSync(filePath, csv); // Optional: convert this to stream if file size is very large
      } catch (error) {
        console.log("CSV write failed", error);
      }
    }

    // 5. Final Socket Emit
    if (global.isVerifierScriptRunning) {
      io.sockets.emit("documentVerificationResult", {
        noOfVerifiedDocumentsWithVerifiedOrg: finalResult.filter(
          (item) =>
            item["Is Verified Organization"] === "Yes" &&
            item["Is Verified Document"] === "Yes"
        ).length,
        noOfVerifiedDocumentsWithUnVerifiedOrg: finalResult.filter(
          (item) =>
            item["Is Verified Organization"] === "No" &&
            item["Is Verified Document"] === "Yes"
        ).length,
        noOfUnverifiedDocuments: finalResult.filter(
          (item) => item["Is Verified Document"] === "No"
        ).length,
        verificationData: finalResult,
        errorMsg,
        url: finalResult.length
          ? `${process.env.REACT_APP_API_BASE_URL}/public/exports/document-verification-overview.csv`
          : null,
        isDocVerificationFinalOverview: true,
        unreadFiles,
        unreadFolders,
      });
    }

    if (global.isVerifierScriptRunning) {
      setFolderPathToArray(folderPath);
    }

    // 6. Clean up memory
    documentHashData.length = 0;
    finalResult.length = 0;
    global.isVerifierScriptRunning = false;
    console.log("🔍 Memory usage:", process.memoryUsage());
    if (global.gc) global.gc();
  } catch (error) {
    console.log("💥 Fatal Error:", error);
    global.isVerifierScriptRunning = false;
  }
};

exports.updateDocumentEffectiveDate = async (req, res) => {
  try {
    const healthloqRes = await updateDocumentEffectiveDateIntoHealthLOQ(
      req.body
    );
    if (healthloqRes.status !== "1") {
      return res.status(200).json({
        status: "0",
        message: healthloqRes?.message,
      });
    }
    let data = await getData();
    data = data?.map((item) =>
      req.body?.hashList?.includes(item?.hash)
        ? {
            ...item,
            effective_date: req.body?.effective_date,
            organization_id: req.body?.meta_data_org_id,
            location_id: req.body?.meta_data_org_location_id,
            product_id: req.body?.meta_data_product_id,
            product_batch_id: req.body?.meta_data_product_batch_id,
            expiration_date: req.body?.expiration_date,
            organization_name:
              req.body?.organization_name !== ""
                ? req.body?.organization_name
                : null,
            location_name:
              req.body?.location_name !== "" ? req.body?.location_name : null,
            product_name:
              req.body?.product_name !== "" ? req.body?.product_name : null,
            product_batch_name:
              req.body?.product_batch_name !== ""
                ? req.body?.product_batch_name
                : null,
          }
        : item
    );
    setData(data);
    res.status(200).json(healthloqRes);
  } catch (error) {
    res.status(422).json({
      status: "0",
      message: error.message,
    });
  }
};

exports.getFolderPath = async (req, res) => {
  try {
    let data = localStorage.getItem("folderPath")
      ? JSON.parse(localStorage.getItem("folderPath"))
      : [];
    res.status(200).json({
      status: "1",
      data,
    });
  } catch (error) {
    res.status(422).json({
      status: "0",
      message: error.message,
    });
  }
};

exports.getVerifyDocumentCount = async (req, res) => {
  try {
    const data = {};
    const docData = await getData("documentVerificationData");
    const { path } = req?.query;

    let newData = [];

    if (path) {
      docData.forEach((doc) => {
        if (doc.path.includes(path)) {
          const lastSlashIndex = doc.path.lastIndexOf("/");
          const normalizedPath =
            lastSlashIndex !== -1
              ? doc.path.substring(0, lastSlashIndex)
              : doc.path;
          if (
            normalizedPath === (path.endsWith("/") ? path.slice(0, -1) : path)
          ) {
            newData.push(doc);
          }
        }
      });
    }

    const previousData = newData.map((doc) => ({
      "Organization Name": doc?.org_name,
      Message: doc?.message,
      hash: doc.hash,
      "Error Message": doc?.err_message,
      "Is Verified Organization": doc.is_vrf_org,
      "File Name": doc.fileName,
      "File Path": doc.path,
      "Is Verified Document": doc.is_vrf_doc,
      Created: doc.createdAt,
      labDocumentHashId: doc.labDocumentHashId,
      documentHashId: doc.documentHashId,
      OrganizationExhibitId: doc.OrganizationExhibitId,
      integrantId: doc.integrantId,
      labOrgName: doc.labOrgName,
    }));

    data["noOfVerifiedDocumentsWithVerifiedOrg"] = newData?.filter(
      (item) => item["is_vrf_org"] === "Yes" && item["is_vrf_doc"] === "Yes"
    )?.length;

    data["noOfVerifiedDocumentsWithUnVerifiedOrg"] = newData?.filter(
      (item) =>
        (item["is_vrf_org"] === "No" || item["is_vrf_org"] === "") &&
        item["is_vrf_doc"] === "Yes"
    )?.length;

    data["noOfUnverifiedDocuments"] = newData?.filter(
      (item) => item["is_vrf_doc"] === "No"
    )?.length;

    res.status(200).json({
      status: "1",
      data,
      doc: previousData,
    });
  } catch (error) {
    res.status(422).json({
      status: "0",
      message: error.message,
    });
  }
};

// View document — restricted to ROOT_FOLDER_PATH to prevent traversal
exports.viewFile = (req, res) => {
  try {
    const rawPath = req.query.path;
    if (!rawPath) {
      return res.status(400).send("File path is required");
    }

    const rootDir = path.resolve(process.env.ROOT_FOLDER_PATH || ".");
    const filePath = safePath(rawPath, rootDir);
    if (!filePath) {
      return res.status(403).send("Access denied: path is outside the document root");
    }

    fs.access(filePath, fs.constants.F_OK, (err) => {
      if (err) {
        return res.status(404).send("File not found");
      }
      res.sendFile(filePath);
    });
  } catch (error) {
    res.status(500).json({
      status: "0",
      message: error.message,
    });
  }
};

exports.getAllOrganization = async (req, res) => {
  try {
    const healthloqRes = await organizationListForMetaData(req.body);
    if (healthloqRes.status === "1") {
      return res.status(200).json(healthloqRes);
    }

    return res.status(422).json({
      status: "0",
      message: "Something went wrong",
    });
  } catch (error) {
    res.status(422).json({
      status: "0",
      message: error.message,
    });
  }
};

exports.getOrgLocation = async (req, res) => {
  try {
    const healthloqRes = await locationListForMetaData(req.body);
    if (healthloqRes.status === "1") {
      return res.status(200).json(healthloqRes);
    }

    return res.status(422).json({
      status: "0",
      message: "Something went wrong",
    });
  } catch (error) {
    res.status(422).json({
      status: "0",
      message: error.message,
    });
  }
};

exports.getProduct = async (req, res) => {
  try {
    const healthloqRes = await productListForMetaData(req.body);
    if (healthloqRes.status === "1") {
      return res.status(200).json(healthloqRes);
    }

    return res.status(422).json({
      status: "0",
      message: "Something went wrong",
    });
  } catch (error) {
    res.status(422).json({
      status: "0",
      message: error.message,
    });
  }
};

exports.getProductBatch = async (req, res) => {
  try {
    const healthloqRes = await productBatchListForMetaData(req.body);

    if (healthloqRes.status === "1") {
      return res.status(200).json(healthloqRes);
    }

    return res.status(422).json({
      status: "0",
      message: "Something went wrong",
    });
  } catch (error) {
    res.status(422).json({
      status: "0",
      message: error.message,
    });
  }
};

// Proxy: blockchain proof verification (keeps JWT server-side)
exports.getBlockchainProof = async (req, res) => {
  try {
    const result = await verifyBlockchainProof(req.body);
    res.status(200).json(result);
  } catch (error) {
    res.status(422).json({ status: "0", message: error.message });
  }
};

// Proxy: COA document blockchain proof verification (keeps JWT server-side)
exports.getCoaBlockchainProof = async (req, res) => {
  try {
    const result = await verifyCoaDocumentProof(req.body);
    res.status(200).json(result);
  } catch (error) {
    res.status(422).json({ status: "0", message: error.message });
  }
};

/**
 * POST /api/client/auto-populate-metadata
 * Body: { hash: string }
 *
 * Analyses a single file with Claude and applies any metadata fields where
 * confidence >= 50%.  The frontend calls this once per selected file so it
 * can display per-file progress.
 */
exports.autoPopulateMetadata = async (req, res) => {
  try {
    const { hash } = req.body;
    if (!hash || typeof hash !== "string") {
      return res.status(400).json({ status: "0", message: "hash is required" });
    }

    const allFiles = await getData();
    const fileRecord = allFiles.find((f) => f.hash === hash);
    if (!fileRecord) {
      return res.status(404).json({ status: "0", message: "File not found" });
    }

    // Validate the file path stays within the configured root
    const rootDir = path.resolve(process.env.ROOT_FOLDER_PATH || ".");
    const filePath = safePath(fileRecord.path, rootDir);
    if (!filePath) {
      return res.status(403).json({ status: "0", message: "Access denied: file is outside the document root" });
    }

    logger.info({ hash, filePath }, "autoPopulateMetadata: analysing file");
    const suggestion = await analyzeFileForMetadata(filePath);

    // Build payload for HealthLOQ — prefer AI-suggested dates, fall back to existing
    const payload = {
      hashList:                    [hash],
      effective_date:              suggestion.effective_date?.value  || fileRecord.effective_date  || null,
      expiration_date:             suggestion.expiration_date?.value || fileRecord.expiration_date || null,
      meta_data_org_id:            suggestion.organization?.id   || null,
      meta_data_org_location_id:   suggestion.location?.id       || null,
      meta_data_product_id:        suggestion.product?.id        || null,
      meta_data_product_batch_id:  suggestion.batch?.id          || null,
      organization_name:           suggestion.organization?.name || "",
      location_name:               suggestion.location?.name     || "",
      product_name:                suggestion.product?.name      || "",
      product_batch_name:          suggestion.batch?.name        || "",
    };

    let applied = false;
    let applyMessage = "";

    // Only call HealthLOQ if at least one field was determined by AI
    const hasAnyMetadata = payload.meta_data_org_id || payload.meta_data_org_location_id ||
      payload.meta_data_product_id || payload.meta_data_product_batch_id ||
      suggestion.effective_date || suggestion.expiration_date;

    if (hasAnyMetadata) {
      const healthloqRes = await updateDocumentEffectiveDateIntoHealthLOQ(payload);
      if (healthloqRes.status === "1") {
        applied = true;
        // Update local data store
        let data = await getData();
        data = data.map((item) =>
          item.hash === hash
            ? {
                ...item,
                organization_id:    payload.meta_data_org_id,
                location_id:        payload.meta_data_org_location_id,
                product_id:         payload.meta_data_product_id,
                product_batch_id:   payload.meta_data_product_batch_id,
                organization_name:  payload.organization_name  || null,
                location_name:      payload.location_name      || null,
                product_name:       payload.product_name       || null,
                product_batch_name: payload.product_batch_name || null,
                effective_date:     payload.effective_date     || item.effective_date,
                expiration_date:    payload.expiration_date    || item.expiration_date,
              }
            : item
        );
        setData(data);
      } else {
        applyMessage = healthloqRes.message || "HealthLOQ update failed";
        logger.warn({ hash, msg: applyMessage }, "autoPopulateMetadata: HealthLOQ update failed");
      }
    }

    res.status(200).json({
      status: "1",
      fileName: fileRecord.fileName,
      suggestion,
      applied,
      applyMessage,
    });
  } catch (error) {
    logger.error({ err: error }, "autoPopulateMetadata: failed");
    res.status(422).json({ status: "0", message: error.message });
  }
};

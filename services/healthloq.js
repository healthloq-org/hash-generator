const axios = require("axios");
const axiosRetry = require("axios-retry").default;
const logger = require("../logger");

// Retry up to 3 times on network errors or 5xx responses with exponential backoff
axiosRetry(axios, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) =>
    axiosRetry.isNetworkOrIdempotentRequestError(error) ||
    (error.response && error.response.status >= 500),
});

exports.syncHash = async (data) => {
  let response = null;
  try {
    if (data.hashList.length || data.deletedHashList.length) {
      logger.info("syncHash: starting sync with HealthLOQ");
      response = await axios.post(
        `${process.env.REACT_APP_HEALTHLOQ_API_BASE_URL}/document-hash/createOrDelete`,
        data,
        {
          headers: {
            Authorization: `Bearer ${process.env.REACT_APP_JWT_TOKEN}`,
          },
        }
      );
      if (response?.data.status === "1")
        logger.info("syncHash: hashes synced successfully");
      else logger.warn({ message: response?.data.message }, "syncHash: API returned non-success status");
      if (response?.data?.status === "2") {
        io.sockets.emit("docUploadLimitExceededError", {
          errorMsg: response?.data?.message,
        });
      }
      if (response?.data?.message === "0") {
        this.publisherScriptIsRunningOrNot({
          is_running: false,
          error_msg: response?.data?.message,
        });
      }
    }
  } catch (error) {
    if (error.response) {
      logger.error({ status: error.response.status, statusText: error.response.statusText }, "syncHash: API error");
    } else {
      logger.error({ err: error }, "syncHash: unexpected error");
    }
  }
  return response?.data?.status || "0";
};

exports.verifyDocument = async (params) => {
  try {
    const response = await axios.post(
      `${process.env.REACT_APP_HEALTHLOQ_API_BASE_URL}/document-hash/verify-document`,
      params,
      {
        headers: {
          Authorization: `Bearer ${process.env.REACT_APP_JWT_TOKEN}`,
        },
      }
    );
    return response?.data;
  } catch (error) {
    console.log(error);
    if (error.response) {
      return {
        status: "0",
        message: `API Error: ${error.response.status} - ${error.response.statusText}`,
        details: error.response.data.message,
      };
    }
    return {
      status: "0",
      message: error.message,
    };
  }
};

exports.verifyDocumentNew = async (params) => {
  try {
    const response = await axios.post(
      `${process.env.REACT_APP_HEALTHLOQ_API_BASE_URL}/document-hash/verify-document-doc-tool`,
      params,
      {
        headers: {
          Authorization: `Bearer ${process.env.REACT_APP_JWT_TOKEN}`,
        },
      }
    );
    return response?.data;
  } catch (error) {
    console.log(error);
    if (error.response) {
      return {
        status: "0",
        message: `API Error: ${error.response.status} - ${error.response.statusText}`,
        details: error.response.data.message,
      };
    }
    return {
      status: "0",
      message: error.message,
    };
  }
};
exports.verifyDocumentOrganizations = async (params) => {
  try {
    const response = await axios.post(
      `${process.env.REACT_APP_HEALTHLOQ_API_BASE_URL}/document-hash/verify-document-organizations`,
      params,
      {
        headers: {
          Authorization: `Bearer ${process.env.REACT_APP_JWT_TOKEN}`,
        },
      }
    );
    return response?.data;
  } catch (error) {
    console.log(error);
    if (error.response) {
      return {
        status: "0",
        message: `API Error: ${error.response.status} - ${error.response.statusText}`,
        details: error.response.data.message,
      };
    }
    return {
      status: "0",
      message: error.message,
    };
  }
};

exports.getSubscriptionDetail = async () => {
  try {
    const response = await axios.get(
      `${process.env.REACT_APP_HEALTHLOQ_API_BASE_URL}/document-hash/get-subscription-details`,
      {
        headers: {
          Authorization: `Bearer ${process.env.REACT_APP_JWT_TOKEN}`,
        },
      }
    );
    return response?.data;
  } catch (error) {
    console.log(error);
    if (error.response) {
      return {
        status: "0",
        message: `API Error: ${error.response.status} - ${error.response.statusText}`,
        details: error.response.data.message,
      };
    }
    return {
      status: "0",
      message: error.message,
    };
  }
};

exports.syncDocToolLogs = async (data = {}) => {
  try {
    if (data?.error) {
      data.error = JSON.stringify(data?.error);
    }
    const response = await axios.post(
      `${process.env.REACT_APP_HEALTHLOQ_API_BASE_URL}/document-hash/sync-doc-tool-logs`,
      data,
      {
        headers: {
          Authorization: `Bearer ${process.env.REACT_APP_JWT_TOKEN}`,
        },
      }
    );
    return response?.data;
  } catch (error) {
    console.log("syncDocToolLogs => ", error);
    if (error.response) {
      return {
        status: "0",
        message: `API Error: ${error.response.status} - ${error.response.statusText}`,
        details: error.response.data.message,
      };
    }
    return {
      status: "0",
      message: error.message,
    };
  }
};

exports.publisherScriptIsRunningOrNot = async (data = {}) => {
  try {
    const response = await axios.post(
      `${process.env.REACT_APP_HEALTHLOQ_API_BASE_URL}/document-hash/publisher-script-is-running-or-not`,
      data,
      {
        headers: {
          Authorization: `Bearer ${process.env.REACT_APP_JWT_TOKEN}`,
        },
      }
    );
    return response?.data;
  } catch (error) {
    console.log("publisherScriptIsRunningOrNot => ", error);
    if (error.response) {
      return {
        status: "0",
        message: `API Error: ${error.response.status} - ${error.response.statusText}`,
        details: error.response.data.message,
      };
    }
    return {
      status: "0",
      message: error.message,
    };
  }
};

exports.updateDocumentEffectiveDateIntoHealthLOQ = async (data = {}) => {
  try {
    const response = await axios.post(
      `${process.env.REACT_APP_HEALTHLOQ_API_BASE_URL}/document-hash/update`,
      data,
      {
        headers: {
          Authorization: `Bearer ${process.env.REACT_APP_JWT_TOKEN}`,
        },
      }
    );
    return response?.data;
  } catch (error) {
    console.log("updateDocumentEffectiveDateIntoHealthLOQ => ", error);
    if (error.response) {
      return {
        status: "0",
        message: `API Error: ${error.response.status} - ${error.response.statusText}`,
        details: error.response.data.message,
      };
    }
    return {
      status: "0",
      message: error.message,
    };
  }
};

exports.productListForMetaData = async (data = {}) => {
  try {
    const response = await axios.post(
      `${process.env.REACT_APP_HEALTHLOQ_API_BASE_URL}/integrant-doc-tool/product-list`,
      data,
      {
        headers: {
          Authorization: `Bearer ${process.env.REACT_APP_JWT_TOKEN}`,
        },
      }
    );
    return {
      status: "1",
      data: response.data,
    };
  } catch (error) {
    if (error.response) {
      return {
        status: "0",
        message: `API Error: ${error.response.status} - ${error.response.statusText}`,
        details: error.response.data.message,
      };
    }
    return {
      status: "0",
      message: error.message,
    };
  }
};

exports.organizationListForMetaData = async (data = {}) => {
  try {
    const response = await axios.post(
      `${process.env.REACT_APP_HEALTHLOQ_API_BASE_URL}/organization/get-org`,
      data,
      {
        headers: {
          Authorization: `Bearer ${process.env.REACT_APP_JWT_TOKEN}`,
        },
      }
    );

    return response?.data;
  } catch (error) {
    if (error.response) {
      return {
        status: "0",
        message: `API Error: ${error.response.status} - ${error.response.statusText}`,
        details: error.response.data.message,
      };
    }
    return {
      status: "0",
      message: error.message,
    };
  }
};

exports.locationListForMetaData = async (data = {}) => {
  try {
    const response = await axios.post(
      `${process.env.REACT_APP_HEALTHLOQ_API_BASE_URL}/location/location-suggestions`,
      data,
      {
        headers: {
          Authorization: `Bearer ${process.env.REACT_APP_JWT_TOKEN}`,
        },
      }
    );

    return {
      status: "1",
      data: response.data,
    };
  } catch (error) {
    if (error.response) {
      return {
        status: "0",
        message: `API Error: ${error.response.status} - ${error.response.statusText}`,
        details: error.response.data.message,
      };
    }
    return {
      status: "0",
      message: error.message,
    };
  }
};

exports.verifyBlockchainProof = async (params = {}) => {
  try {
    const response = await axios.post(
      `${process.env.REACT_APP_HEALTHLOQ_API_BASE_URL}/client-app/verify`,
      params,
      {
        headers: {
          Authorization: `Bearer ${process.env.REACT_APP_JWT_TOKEN}`,
        },
      }
    );
    return response?.data;
  } catch (error) {
    if (error.response) {
      return {
        status: "0",
        message: `API Error: ${error.response.status} - ${error.response.statusText}`,
        details: error.response.data?.message,
      };
    }
    return { status: "0", message: error.message };
  }
};

exports.verifyCoaDocumentProof = async (params = {}) => {
  try {
    const response = await axios.post(
      `${process.env.REACT_APP_HEALTHLOQ_API_BASE_URL}/client-app/verify-coa-document-doc-tool`,
      params,
      {
        headers: {
          Authorization: `Bearer ${process.env.REACT_APP_JWT_TOKEN}`,
        },
      }
    );
    return response?.data;
  } catch (error) {
    if (error.response) {
      return {
        status: "0",
        message: `API Error: ${error.response.status} - ${error.response.statusText}`,
        details: error.response.data?.message,
      };
    }
    return { status: "0", message: error.message };
  }
};

exports.productBatchListForMetaData = async (data = {}) => {
  try {
    const response = await axios.post(
      `${process.env.REACT_APP_HEALTHLOQ_API_BASE_URL}/integrant-doc-tool/search`,
      data,
      {
        headers: {
          Authorization: `Bearer ${process.env.REACT_APP_JWT_TOKEN}`,
        },
      }
    );

    return {
      status: "1",
      data: response.data,
    };
  } catch (error) {
    if (error.response) {
      return {
        status: "0",
        message: `API Error: ${error.response.status} - ${error.response.statusText}`,
        details: error.response.data.message,
      };
    }
    return {
      status: "0",
      message: error.message,
    };
  }
};

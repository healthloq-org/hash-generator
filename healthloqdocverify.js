require("dotenv").config();
const express = require("express");
const { execSync } = require("child_process");
const port = process.env.PORT || 7001;
const app = express();
const cors = require("cors");
const path = require("path");
const chokidar = require("chokidar");
const rateLimit = require("express-rate-limit");
const logger = require("./logger");

global.localStorage = require("./db");
const server = require("http").createServer(app);

const {
  getSyncData,
  setDocumentSyncTimeout,
  setDocumentSyncInterval,
} = require("./utils");

// Service-enabled flag — true by default, toggled via /api/health/service/*
global.serviceEnabled = true;
const { getSubscriptionDetail } = require("./services/healthloq");
const { startAlertChecker } = require("./services/alertService");

module.exports = io = require("socket.io")(server);

io.on("connection", (socket) => {
  app.socket = socket;

  socket.on("disconnect", () => {
    global.isVerifierScriptRunning = false;
  });
});

(async () => {
  const subscriptionDetail = await getSubscriptionDetail();
  global.subscriptionDetail = subscriptionDetail?.data;
  const isPublisher = subscriptionDetail?.data?.filter(
    (item) => item?.subscription_type === "publisher"
  )?.length;

  if (isPublisher) {
    getSyncData();
    setDocumentSyncInterval();

    const rootPath = process.env.ROOT_FOLDER_PATH;
    if (rootPath) {
      const watcher = chokidar.watch(rootPath, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 200 },
      });
      watcher.on("all", (eventName) => {
        if (["add", "unlink", "change"].includes(eventName) && global.serviceEnabled !== false) {
          setDocumentSyncTimeout();
        }
      });
      watcher.on("error", (err) => logger.error({ err }, "chokidar watcher error"));
    }
  }
})();

// Restrict CORS to localhost only — this app is local-only
const allowedOrigin = `http://localhost:${port}`;
app.use(cors({ origin: allowedOrigin }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting: max 200 requests per minute per IP
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", limiter);

app.use("/public", express.static(path.join(__dirname, "./public")));
app.use("/api/client", require("./routes/client"));
app.use("/api/health", require("./routes/health"));

// /health is handled by React Router client-side — do NOT add an Express
// route here or it will intercept the request before the SPA loads.
// The JSON status endpoint is at /api/health/status.

app.use(express.static(path.join(__dirname, "client/build")));
app.get("*", (req, res) => {
  res.sendFile(path.resolve(__dirname, "client/build/index.html"));
});

function killProcessOnPort(targetPort) {
  try {
    if (process.platform === "win32") {
      const output = execSync("netstat -ano", { encoding: "utf8" });
      const pids = new Set();
      for (const line of output.split("\n")) {
        if (line.includes(`:${targetPort}`) && line.includes("LISTENING")) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && /^\d+$/.test(pid) && pid !== "0" && pid !== String(process.pid)) {
            pids.add(pid);
          }
        }
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { encoding: "utf8" });
          logger.info(`Killed orphaned process PID ${pid} on port ${targetPort}`);
        } catch (killErr) {
          logger.warn(`Failed to kill PID ${pid}: ${killErr.message}`);
        }
      }
    } else {
      try {
        execSync(`lsof -ti :${targetPort} | xargs kill -9`, { shell: true, encoding: "utf8" });
        logger.info(`Killed orphaned processes on port ${targetPort}`);
      } catch (_) {}
    }
  } catch (err) {
    logger.warn({ err }, "killProcessOnPort error");
  }
}

let portRetryCount = 0;

server.on("error", (err) => {
  if (err.code === "EADDRINUSE" && portRetryCount < 1) {
    portRetryCount++;
    logger.warn(`Port ${port} already in use — killing orphaned process and retrying...`);
    killProcessOnPort(port);
    setTimeout(() => {
      server.listen(port, () => {
        logger.info(`Server running at http://localhost:${port}`);
        startAlertChecker();
      });
    }, 2000);
  } else {
    logger.error({ err }, "Fatal server error — port unavailable");
    process.exit(1);
  }
});

server.listen(port, () => {
  logger.info(`Server running at http://localhost:${port}`);
  startAlertChecker();
});

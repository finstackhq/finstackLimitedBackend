require("dotenv").config();

require("./instrument");

const express = require("express");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const cors = require("cors");

const webhookRoutes = require("./routes/webhookRoutes");
const connectDataBase = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const adminRoutes = require("./routes/adminRoutes");
const kycRoutes = require("./routes/kycRoutes");
const walletRoutes = require("./routes/walletRoutes");
const transactionRoutes = require("./routes/transactionRoute");
const transferRoutes = require("./routes/transferRoute");
const p2pRoutes = require("./routes/p2pRoute");
const merchantRoutes = require("./routes/merchantRoutes");

const { cancelExpiredTrades } = require("./services/p2pExpirationService");
const logger = require("./utilities/logger");
const p2pService = require("./services/p2pService");

/**
 * Import Sentry ONLY where you need to manually capture errors
 */
const Sentry = require("@sentry/node");

const app = express();

/* ---------------- WORKERS ---------------- */
if (process.env.RUN_WORKER === "true") {
  require("./workers/announcementWorker");
}

/* ---------------- APP CONFIG ---------------- */
app.set("trust proxy", 1);

const allowedOrigins = [
  "https://finstack-vert.vercel.app",
  "http://localhost:3000",
];

app.use(helmet());

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      console.warn("Blocked by CORS:", origin);
      callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
  }),
);

/* ---------------- MIDDLEWARES ---------------- */
app.use(express.json());
app.use(cookieParser());

/* ---------------- DATABASE ---------------- */
connectDataBase();

/* ---------------- ROUTES ---------------- */
app.get("/", (req, res) => {
  res.send("API is running 🚀");
});

app.use("/api", authRoutes);
app.use("/api", userRoutes);
app.use("/api", adminRoutes);
app.use("/api", kycRoutes);
app.use("/api", walletRoutes);
app.use("/api", transactionRoutes);
app.use("/api", transferRoutes);
app.use("/api", p2pRoutes);
app.use("/api", merchantRoutes);
app.use("/api", webhookRoutes);

/* ---------------- FINAL ERROR HANDLER ---------------- */
app.use((err, req, res, next) => {
  // Manually capture uncaught errors
  Sentry.captureException(err);

  console.error(err);
  res.status(500).json({
    success: false,
    message: "Internal Server Error",
  });
});

/* ---------------- SERVER START ---------------- */
const PORT = process.env.PORT || 8000;

async function startServer() {
  try {
    logger.info("External services ready. Starting server.");

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    logger.error("FATAL: Failed to start server.", error);
    process.exit(1);
  }
}

startServer();

/* ---------------- BACKGROUND JOBS ---------------- */
setInterval(() => {
  cancelExpiredTrades().catch((err) => {
    Sentry.captureException(err);
    console.error("Expiration error:", err);
  });
}, 60 * 1000);

setInterval(
  async () => {
    try {
      const result = await p2pService.autoOpenDisputesForSilentBuyers();
      if (result.processed > 0) {
        console.log(`[DISPUTE-JOB] Opened ${result.processed} disputes`);
      }
    } catch (err) {
      Sentry.captureException(err);
      console.error("[DISPUTE-JOB] Failed", err);
    }
  },
  5 * 60 * 1000,
);

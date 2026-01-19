require("dotenv").config();
// require("./instrument");
const Sentry = require("./instrument");
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
const { redisClient } = require("./utilities/redis");
const logger = require("./utilities/logger");
const p2pService = require("./services/p2pService");

// const Sentry = require("@sentry/node");
const app = express();

// Request handler — must be first middleware
app.use(Sentry.Handlers.requestHandler());

// 🔑 START WORKER ONLY IF ENABLED
if (process.env.RUN_WORKER === "true") {
  require("./workers/announcementWorker");
}

app.set("trust proxy", 1);
const allowedOrigins = [
  "https://finstack-vert.vercel.app",
  "http://localhost:3000",
];

app.use(helmet());

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or Postman)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn("Blocked by CORS:", origin);
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
  }),
);

// Middlewares
app.use(express.json());
app.use(cookieParser());

// Database connection
connectDataBase();

// Testing and must be deleted
app.get("/sentry-test", (req, res) => {
  throw new Error("🔥 Sentry test error — ignore");
});

app.get("/", (req, res) => {
  res.send("API is running 🚀");
});

// Routes
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

// Sentry error handler
app.use(Sentry.Handlers.errorHandler());

// Final fallback error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({
    success: false,
    message: "Internal Server Error",
  });
});

const PORT = process.env.PORT || 8000;

// Add Redis connection check and start server only after success
async function startServer() {
  try {
    logger.info("External services (DB, Redis) ready. Starting server.");

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    logger.error("FATAL: Failed to connect to Redis or other service.", error);
    process.exit(1);
  }
}
// Call the new async function
startServer();

// Background jobs (monitored by Sentry)
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

// // Call the new async function
// startServer();
// setInterval(() => {
//   cancelExpiredTrades().catch((err) => console.error("Expiration error:", err));
// }, 60 * 1000); // runs every 1 minute

// setInterval(
//   async () => {
//     try {
//       const result = await p2pService.autoOpenDisputesForSilentBuyers();
//       if (result.processed > 0) {
//         console.log(`[DISPUTE-JOB] Opened ${result.processed} disputes`);
//       }
//     } catch (err) {
//       console.error("[DISPUTE-JOB] Failed", err);
//     }
//   },
//   5 * 60 * 1000,
// ); // every 5 minutes
// console.log("Prembly API ID:", process.env.PREMBLY_API_ID);
// console.log("Prembly API Key:", process.env.PREMBLY_API_KEY ? "✅ Loaded" : "❌ Missing");

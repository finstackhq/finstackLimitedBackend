const Sentry = require("@sentry/node");
const { nodeProfilingIntegration } = require("@sentry/profiling-node");

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || "development",

  integrations: [nodeProfilingIntegration()],

  /* 🔐 FINTECH SAFE DEFAULTS */
  sendDefaultPii: false, // DO NOT collect IPs, emails, etc.

  /* 📈 Performance & tracing */
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.3 : 1.0,

  /* 🧠 Profiling */
  profileSessionSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  profileLifecycle: "trace",

  /* 🪵 Logs */
  enableLogs: true,

  /* 🏷️ Global tags */
  initialScope: {
    tags: {
      service: "finstack-backend",
    },
  },
});

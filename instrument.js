const Sentry = require("@sentry/node");
const { nodeProfilingIntegration } = require("@sentry/profiling-node");

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || "development",

  integrations: [nodeProfilingIntegration()],

  enableLogs: true,

  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.3 : 1.0,

  profileSessionSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  profileLifecycle: "trace",

  sendDefaultPii: false,

  initialScope: {
    tags: {
      service: "finstack-backend",
    },
  },
});

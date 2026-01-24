const express = require("express");
const {
  handleBlockradarWebhook,
  handlePaycrestWebhook,
} = require("../controllers/webhookController");

const router = express.Router();

// Blockradar PUSH notifications
router.post("/blockradar", handleBlockradarWebhook);
// Paycrest PUSH notifications
router.post("/webhooks/paycrest", handlePaycrestWebhook);

module.exports = router;

const Wallet = require("../models/walletModel.js");
const logger = require("../utilities/logger");
const Transaction = require("../models/transactionModel");
const {
  handleDepositConfirmed,
  handleWithdrawSuccess,
} = require("../services/transactionHandlers");

//  📡 Handle incoming Blockradar webhooks (PUSH NOTIFICATIONS)
const handleBlockradarWebhook = async (req, res) => {
  try {
    const payload = req.body;

    if (!payload?.event) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    switch (payload.event) {
      case "deposit.success":
        await handleDepositConfirmed(payload);
        break;

      case "withdraw.success":
        await handleWithdrawSuccess(payload);
        break;

      default:
        console.log(`ℹ️ Unhandled Blockradar event: ${payload.event}`);
    }

    // ALWAYS acknowledge Blockradar
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Blockradar webhook error:", error.message);

    // Still return 200 to prevent retries
    return res.status(200).json({ received: true });
  }
};

const handlePaycrestWebhook = async (req, res) => {
  try {
    const { event, orderId, status, data } = req.body;

    logger.info(`Paycrest Webhook: Event ${event} for Order ${orderId}`);

    // Find the transaction using the Paycrest Order ID you saved in withdrawalInterService.js
    const tx = await Transaction.findOne({
      "metadata.paycrestOrderId": orderId,
    });

    if (!tx) {
      logger.warn(`No transaction found for Paycrest Order ID: ${orderId}`);
      return res.status(200).json({ message: "Order not tracked locally" });
    }

    switch (event) {
      case "order.fulfilled":
      case "order.processing":
        await Transaction.findByIdAndUpdate(tx._id, {
          status: "FIAT_PROCESSING",
        });
        break;

      case "order.settled":
        // This means Paycrest has successfully paid the bank account
        await Transaction.findByIdAndUpdate(tx._id, {
          status: "COMPLETED",
          "metadata.fiatTxHash": data?.txHash,
        });
        logger.info(`✅ Withdrawal fully completed for ref: ${tx.reference}`);
        break;

      case "order.refunded":
        await Wallet.updateOne(
          { _id: tx.walletId },
          { $inc: { balance: tx.amount + tx.feeDetails.totalFee } },
        );

        await Transaction.findByIdAndUpdate(tx._id, {
          status: "REFUNDED",
          "metadata.reason": "Paycrest refund issued",
        });
        break;

      default:
        logger.info(`Received unhandled Paycrest event: ${event}`);
    }

    // Always return 200 to acknowledge receipt
    res.status(200).json({ success: true });
  } catch (error) {
    logger.error("Paycrest webhook processing error:", error.message);
    res.status(500).json({ error: "Internal processing error" });
  }
};
module.exports = {
  handleBlockradarWebhook,
  handlePaycrestWebhook,
};

const sendMail = require("./sendMail");
const User = require("../models/userModel");
const P2PTrade = require("../models/p2pModel");
const {
  generateTradeAlertMail,
  generateBuyerPaidMail,
  generateMerchantPaidMail,
  generateAdminResolutionMail,
} = require("./mailGenerator");
const logger = require("./logger");

const notifyMerchantOfTrade = async (tradeId) => {
  const trade = await P2PTrade.findById(tradeId).lean();
  if (!trade) return;

  if (trade.notifications?.merchantNotified === true) return;

  const merchant = await User.findById(trade.merchantId)
    .select("firstName email")
    .lean();

  if (!merchant?.email) return;

  const mail = generateTradeAlertMail({
    firstName: merchant.firstName,
    amount: trade.amountFiat,
    currency: trade.currencySource,
    reference: trade.reference,
    side: trade.side,
  });

  await sendMail(merchant.email, mail.subject, mail.html, mail.text);

  await P2PTrade.updateOne(
    { _id: tradeId },
    { $set: { "notifications.merchantNotified": true } },
  );

  global.io?.to(trade.merchantId.toString()).emit("trade:new", {
    tradeId: trade._id,
    reference: trade.reference,
  });

  logger.info("Merchant notified of trade", {
    tradeRef: trade.reference,
    merchantId: trade.merchantId,
  });
};

const notifyMerchantBuyerPaid = async (tradeId) => {
  const trade = await P2PTrade.findById(tradeId).lean();
  if (!trade) return;

  // ✅ JS-level guard (SAFE)
  if (trade.notifications?.buyerPaidNotified === true) return;

  const merchant = await User.findById(trade.merchantId)
    .select("firstName email")
    .lean();

  if (!merchant?.email) return;

  const mail = generateBuyerPaidMail({
    firstName: merchant.firstName,
    reference: trade.reference,
    amount: trade.amountFiat,
  });

  await sendMail(merchant.email, mail.subject, mail.html, mail.text);

  await P2PTrade.updateOne(
    { _id: tradeId },
    { $set: { "notifications.buyerPaidNotified": true } },
  );

  global.io?.to(trade.merchantId.toString()).emit("trade:buyer_paid", {
    tradeId: trade._id,
    reference: trade.reference,
  });

  logger.info("Merchant notified: buyer paid", {
    tradeId,
    reference: trade.reference,
  });
};

const notifyBuyerOfMerchantPayment = async (tradeId) => {
  const trade = await P2PTrade.findById(tradeId).populate("userId").lean();
  if (!trade || !trade.userId?.email) return;

  const mail = generateMerchantPaidMail({
    firstName: trade.userId.firstName,
    reference: trade.reference,
    amount: trade.amountFiat,
    currency: trade.currencySource,
  });

  await sendMail(trade.userId.email, mail.subject, mail.html, mail.text);

  // Notify via Socket for real-time UI updates
  global.io?.to(trade.userId._id.toString()).emit("trade:merchant_paid", {
    reference: trade.reference,
    message: "The merchant has marked the fiat payment as sent.",
  });
};

const notifyUserOfAdminResolution = async (tradeId, outcome) => {
  const trade = await P2PTrade.findById(tradeId)
    .populate("userId", "firstName email")
    .lean();

  if (!trade?.userId?.email) return;

  const mail = generateAdminResolutionMail({
    firstName: trade.userId.firstName,
    reference: trade.reference,
    outcome,
    role: "user",
  });

  await sendMail(trade.userId.email, mail.subject, mail.html, mail.text);

  global.io?.to(trade.userId._id.toString()).emit("trade:admin_resolved", {
    reference: trade.reference,
    status: trade.status,
  });
};

const notifyMerchantOfAdminResolution = async (tradeId, outcome) => {
  const trade = await P2PTrade.findById(tradeId)
    .populate("merchantId", "firstName email")
    .lean();

  if (!trade?.merchantId?.email) return;

  const mail = generateAdminResolutionMail({
    firstName: trade.merchantId.firstName,
    reference: trade.reference,
    outcome,
    role: "merchant",
  });

  await sendMail(trade.merchantId.email, mail.subject, mail.html, mail.text);

  global.io?.to(trade.merchantId._id.toString()).emit("trade:admin_resolved", {
    reference: trade.reference,
    status: trade.status,
  });
};
const notifyUserOfCryptoRelease = async (tradeId) => {
  const trade = await P2PTrade.findById(tradeId)
    .populate("userId", "firstName email")
    .lean();

  if (!trade?.userId?.email) return;

  const mail = generateCryptoReleaseMail({
    firstName: trade.userId.firstName,
    amount: trade.netCryptoAmount,
    currency: trade.currencyTarget,
    reference: trade.reference,
  });

  await sendMail(trade.userId.email, mail.subject, mail.html, mail.text);
};

module.exports = {
  notifyMerchantOfTrade,
  notifyMerchantBuyerPaid,
  notifyBuyerOfMerchantPayment,
  notifyUserOfAdminResolution,
  notifyMerchantOfAdminResolution,
  notifyUserOfCryptoRelease,
};

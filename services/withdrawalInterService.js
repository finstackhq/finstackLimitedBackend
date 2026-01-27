const mongoose = require("mongoose");
const Wallet = require("../models/walletModel");
const Transaction = require("../models/transactionModel");
const FeeLog = require("../models/feeLogModel");
const { getFlatFee } = require("./adminFeeService");
const Decimal = require("decimal.js");
// 1. IMPORT PAYCREST UTILITIES
const fetchPaycrestRate = require("./paycrest/fetchRate");
const createPaycrestOrder = require("./paycrest/createOrder");
// --- GLOBAL CONSTANTS --- (Must be defined or imported from config)
const CRYPTO_NETWORK = process.env.PAYCREST_CRYPTO_NETWORK || "Base";

/**
 * Creates a Paycrest withdrawal order (off-chain commitment) and deducts funds atomically.
 * @param {string} userId - ID of the user.
 * @param {string} currency - The token (e.g., "USDC").
 * @param {number} amount - The gross crypto amount to deduct (user requested amount).
 * @param {string} externalAddress - The recipient's fiat account identifier (e.g., account number).
 * @param {string} institutionCode - The recipient's bank/institution code.
 * @param {string} accountName - The recipient's account name.
 * @param {string} idempotencyKey - Unique reference to prevent double processing.
 * @returns {Promise<Object>} Object containing the created transaction and Paycrest transfer details.
 */
async function createWithdrawalRequest({
  userId,
  currency, // The Crypto (cNGN)
  fiatCurrency, // 👈 NEW: The Fiat (GHS, USD, NGN)
  amount,
  externalAddress,
  idempotencyKey,
  institutionCode,
  accountName,
}) {
  if (
    !userId ||
    !amount ||
    new Decimal(amount).lte(0) ||
    !externalAddress ||
    !idempotencyKey ||
    !institutionCode ||
    !accountName
  ) {
    throw new Error(
      "All required withdrawal and recipient details must be provided.",
    );
  }

  // --- Idempotency Check ---
  const existingTx = await Transaction.findOne({ reference: idempotencyKey });
  if (existingTx) {
    return {
      transaction: existingTx,
      alreadyExists: true,
      paycrestOrderId: existingTx.metadata?.paycrestOrderId,
      paycrestReceiveAddress: existingTx.metadata?.paycrestReceiveAddress,
      cryptoAmountToSend: existingTx.amount,
    };
  }

  const wallet = await Wallet.findOne({
    user_id: userId,
    currency,
    status: "ACTIVE",
  });
  if (!wallet) throw new Error("User wallet not found");

  // --- Fee Calculation and Balance Check ---
  const flatFeeValue = await getFlatFee("WITHDRAWAL", currency);
  const feeAmount = new Decimal(flatFeeValue);
  const amtDecimal = new Decimal(amount);
  const totalDeduct = amtDecimal.plus(feeAmount).toDecimalPlaces(8);

  const walletBalance = new Decimal(wallet.balance || 0);
  if (walletBalance.lt(totalDeduct)) {
    throw new Error("Insufficient balance for withdrawal including fee");
  }

  // --- PAYCREST STEP 1: Get Rate ---
  const rateData = await fetchPaycrestRate({
    token: currency,
    amount: Number(amount),
    currency: fiatCurrency, // 👈 USE THE USER'S CHOSEN CURRENCY HERE
    network: CRYPTO_NETWORK,
  });

  // --- PAYCREST STEP 2: Create Order ---
  const recipient = {
    institution: institutionCode,
    accountIdentifier: externalAddress,
    accountName: accountName,
    currency: fiatCurrency,
  };

  const orderPayload = {
    amount: Number(amount),
    token: currency,
    rate: rateData.rate,
    recipient: recipient,
    returnAddress: process.env.PAYCREST_REFUND_ADDRESS,
    network: CRYPTO_NETWORK,
    reference: idempotencyKey,
  };

  const paycrestOrder = await createPaycrestOrder(orderPayload);
  const { id: paycrestOrderId, receiveAddress } = paycrestOrder;

  // --- BEGIN ATOMIC DATABASE TRANSACTION (Critical Section) ---
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const decTotal = Number(totalDeduct.toString());
    await Wallet.updateOne(
      { _id: wallet._id },
      { $inc: { balance: -decTotal } },
      { session },
    );

    const txDocs = await Transaction.create(
      [
        {
          walletId: wallet._id,
          userId,
          type: "WITHDRAWAL",
          amount: Number(amount),
          currency,
          status: "PENDING_CRYPTO_TRANSFER", // Funds are locked, awaiting on-chain proof
          reference: idempotencyKey,
          metadata: {
            destination: externalAddress,
            provider: "Paycrest",
            paycrestOrderId,
            paycrestReceiveAddress: receiveAddress,
            paycrestValidUntil: paycrestOrder.validUntil,
            orderRate: rateData.rate,
            recipient: recipient,
          },
          feeDetails: {
            totalFee: Number(feeAmount.toString()),
            currency,
            platformFee: Number(feeAmount.toString()),
            networkFee: 0,
            isDeductedFromAmount: true,
          },
        },
      ],
      { session },
    );

    const tx = txDocs[0];

    await FeeLog.create(
      [
        {
          userId,
          transactionId: tx._id,
          type: "WITHDRAWAL",
          currency,
          grossAmount: Number(amount),
          feeAmount: Number(feeAmount.toString()),
          platformFee: Number(feeAmount.toString()),
          networkFee: 0,
          reference: idempotencyKey,
          metadata: { destination: externalAddress },
        },
      ],
      { session },
    );

    await session.commitTransaction();
    session.endSession();

    return {
      transaction: tx,
      paycrestOrderId,
      paycrestReceiveAddress: receiveAddress,
      cryptoAmountToSend: Number(amount),
    };
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
}

module.exports = { createWithdrawalRequest };

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
  currency,
  fiatCurrency,
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

  // --- 1. Idempotency Check ---
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

  // --- 2. Fee Calculation ---
  const flatFeeValue = await getFlatFee("WITHDRAWAL", currency);
  const feeAmount = new Decimal(flatFeeValue);
  const amtDecimal = new Decimal(amount);
  // We calculate this for the logs, but we DON'T check it against the local DB balance anymore
  const totalDeduct = amtDecimal.plus(feeAmount).toDecimalPlaces(8);

  // --- 3. PAYCREST STEP: Get Rate ---
  const rateData = await fetchPaycrestRate({
    token: currency,
    amount: Number(amount),
    currency: fiatCurrency,
    network: CRYPTO_NETWORK,
  });

  // --- 4. PAYCREST STEP: Create Order ---
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

  // --- 5. DATABASE TRANSACTION ---
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // ❌ REMOVED: Wallet.updateOne ($inc balance)
    // We don't deduct from local DB because the real money is moved via Blockradar API in the next step.

    const txDocs = await Transaction.create(
      [
        {
          walletId: wallet._id,
          userId,
          type: "WITHDRAWAL",
          amount: Number(amount),
          currency,
          status: "PENDING_CRYPTO_TRANSFER",
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

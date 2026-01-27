const mongoose = require("mongoose");
const P2PTrade = require("../models/p2pModel");
const Transaction = require("../models/transactionModel");
const User = require("../models/userModel");
const Wallet = require("../models/walletModel");
const blockrader = require("./providers/blockrader");
const { generateAndSendOtp, verifyOtp } = require("../utilities/otpUtils");
const { updateTradeStatusAndLogSafe } = require("../utilities/tradeUpdater");
const MerchantAd = require("../models/merchantModel");
const logger = require("../utilities/logger");
const { getCache, setCache, redisClient } = require("../utilities/redis");
const FeeLog = require("../models/feeLogModel");
const FeeConfig = require("../models/feeConfigModel");
const CACHE_TTL = Number(process.env.BALANCE_CACHE_TTL_SECONDS || 30);
const {
  notifyMerchantOfTrade,
  notifyMerchantBuyerPaid,
  notifyBuyerOfMerchantPayment,
  notifyUserOfAdminResolution,
  notifyMerchantOfAdminResolution,
  notifyUserOfCryptoRelease,
} = require("../utilities/notificationService");

const { getFlatFee } = require("./adminFeeService");
const UserBankAccount = require("../models/userBankAccountModel");

// 🔑 Inline currency normalizer
const normalize = (v) => v?.trim().toUpperCase();
// Custom Error Class for clearer API responses
class TradeError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "TradeError";
    this.status = status;
  }
}
// Basic state machine allowed transitions
const ALLOWED_STATES = {
  INIT: "PENDING_PAYMENT",
  MERCHANT_PAID: "MERCHANT_PAID",
  PAYMENT_CONFIRMED_BY_BUYER: "PAYMENT_CONFIRMED_BY_BUYER",
  DISPUTE_PENDING: "DISPUTE_PENDING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  CANCELLED_REVERSED: "CANCELLED_REVERSED",
};
// --------- Helpers ----------
// async function checkUser(userId) {
//   // Fetches user role for authorization checks and validates existence.
//   const user = await User.findById(userId).select("role").lean();
//   if (!user) {
//     throw new TradeError("User not found.", 404);
//   }
//   return user;
// }
/** Helper to fetch a user and enforce KYC rules */
async function checkUser(userId) {
  const user = await User.findById(userId).select("role kycStatus").lean();

  if (!user) {
    throw new TradeError("User not found.", 404);
  }

  // Explicit failure reasons (good UX)
  if (user.kycStatus === "PENDING") {
    throw new TradeError(
      "Your KYC verification is still pending. Please wait for approval before trading.",
      403,
    );
  }

  if (user.kycStatus === "REJECTED") {
    throw new TradeError(
      "Your KYC verification was rejected. Please update your documents in settings.",
      403,
    );
  }

  // Single allow condition
  if (user.kycStatus !== "VERIFIED") {
    throw new TradeError(
      "You must complete KYC verification before initiating a trade.",
      403,
    );
  }

  return user;
}

/** Helper to log trade events. (This is now redundant but kept for initial trade creation)*/
function safeLog(trade, logEntry) {
  console.log(`[TRADE_LOG] Ref: ${trade.reference} - ${logEntry.message}`);
}

/** Helper to resolve the provider-specific Wallet ID for a user and currency. */
async function resolveUserWalletId(userId, currency) {
  // 1. Keep the ObjectId explicit cast for stability
  const userObjectId = new mongoose.Types.ObjectId(userId);
  // 2. Normalize the currency string to match the Mongoose Model enum (e.g., "CNGN" or "USDC")
  const currencyValue = normalize(currency);

  const wallet = await Wallet.findOne({
    user_id: userObjectId,
    currency: currencyValue,
    walletType: "USER", // 3. Ensure it's a user wallet
    provider: "BLOCKRADAR", // 3. Ensure it's the Blockrader provider
    status: "ACTIVE", // 3. Ensure the wallet is active
  }).lean();

  if (!wallet || !wallet.externalWalletId) {
    throw new TradeError(
      `Wallet not found or missing provider ID for user ${userId} and currency ${currency}.`,
      404,
    );
  }
  return wallet.externalWalletId;
}
/* Helper to resolve the external crypto address for a user and currency. */
async function resolveUserCryptoAddress(userId, currency) {
  // 1. Keep the ObjectId explicit cast for stability
  const userObjectId = new mongoose.Types.ObjectId(userId);
  // 2. Normalize the currency string to match the Mongoose Model enum
  const currencyValue = normalize(currency);

  const wallet = await Wallet.findOne({
    user_id: userObjectId,
    currency: currencyValue,
    walletType: "USER", // 3. Ensure it's a user wallet
    provider: "BLOCKRADAR", // 3. Ensure it's the Blockrader provider
    status: "ACTIVE", // 3. Ensure the wallet is active
  }).lean();

  if (!wallet || !wallet.walletAddress) {
    throw new TradeError(
      `Missing destination crypto address for user ${userId} and target currency ${currency}.`,
      400,
    );
  }
  return wallet.walletAddress;
}

// --------- Ledger Helpers ----------

// Resolve MongoDB wallet _id (NOT externalWalletId)
async function resolveWalletObjectId(userId, currency) {
  const wallet = await Wallet.findOne({
    user_id: new mongoose.Types.ObjectId(userId),
    currency: normalize(currency),
    walletType: "USER",
    provider: "BLOCKRADAR",
    status: "ACTIVE",
  })
    .select("_id")
    .lean();

  if (!wallet) {
    throw new TradeError(`Local wallet not found for ${currency}`, 404);
  }
  return wallet._id;
}

// Idempotent ledger writer (NO upsert, safe for finance)
async function createIdempotentTransaction(data, session) {
  try {
    await Transaction.create([data], { session });
  } catch (err) {
    if (err.code === 11000) {
      // Duplicate idempotencyKey → safe retry
      return;
    }
    throw err;
  }
}

// --------- Service functions ----------
module.exports = {
  async countActiveTradesForAd(adId) {
    return await P2PTrade.countDocuments({
      merchantAdId: adId,
      status: { $in: ["PENDING", "PAYMENT_CONFIRMED_BY_BUYER", "RELEASING"] },
    });
  },

  async getAllUserWalletBalances(userId) {
    const cacheKey = `balances:${userId}`;

    // 1. Try to load from cache
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    // 2. Load wallets from DB
    const wallets = await Wallet.find({
      user_id: userId,
      provider: "BLOCKRADAR",
      status: "ACTIVE",
      walletType: "USER",
    }).lean();

    if (!wallets || wallets.length === 0) {
      await setCache(cacheKey, [], CACHE_TTL);
      return [];
    }

    const results = [];

    for (const w of wallets) {
      logger.info(
        `Fetching balance for wallet: ${w.currency} / ID: ${w.externalWalletId}`,
      );
      try {
        const bal = await blockrader.getWalletBalance(
          w.externalWalletId,
          w.currency,
        );
        logger.info(`Successfully fetched balance for ${w.currency}.`);
        results.push({
          currency: w.currency,
          walletAddress: w.walletAddress,
          externalWalletId: w.externalWalletId,
          balance: {
            available: bal?.available ?? 0,
            locked: bal?.locked ?? 0,
            total: bal?.total ?? 0,
          },
        });
      } catch (err) {
        logger.error(
          `❌ Blockrader balance fetch failed for ${w.currency}: ${err.message}`,
        );
        results.push({
          currency: w.currency,
          error: true,
          balance: { available: 0, locked: 0, total: 0 },
        });
      }
    }
    // 3. Save into Redis cache
    await setCache(cacheKey, results, CACHE_TTL);
    return results;
  },

  // countTrades here
  async countTrades(filter = {}) {
    return await P2PTrade.countDocuments(filter);
  },

  // SECURE MERCHANT ASSET BEFORE FIAT IS SENT WHEN MERCHANT IS BUYING CRYPTO
  async initiateTrade(buyerId, merchantAd, data, ip = null) {
    await checkUser(buyerId);
    await checkUser(merchantAd.userId);

    const currencySource = normalize(data.currencySource);
    const currencyTarget = normalize(data.currencyTarget);

    // Validate time limit
    if (!data.timeLimit || isNaN(data.timeLimit)) {
      throw new TradeError("Merchant ad timeLimit is missing or invalid");
    }
    const expiresAt = new Date(Date.now() + Number(data.timeLimit) * 60 * 1000);

    const fiatAmount = Number(data.amountSource);
    if (fiatAmount < merchantAd.minLimit)
      throw new TradeError("Amount below minimum trade limit");
    if (fiatAmount > merchantAd.maxLimit)
      throw new TradeError("Amount exceeds maximum trade limit");

    // Convert fiat → crypto
    const cryptoAmount = fiatAmount / merchantAd.price;

    // Liquidity check
    if (cryptoAmount > merchantAd.availableAmount)
      throw new TradeError("Insufficient ad liquidity");

    // 1. Get and normalize the currencies
    const asset = normalize(currencyTarget); // e.g., 'CNGN'
    const localCurrency = normalize(currencySource); // e.g., 'RMB'

    const feePerUnit = Number(await getFlatFee("P2P", asset, localCurrency));

    // Total fee = crypto amount × fee per unit
    const platformFeeCrypto = Number((cryptoAmount * feePerUnit).toFixed(8));

    if (platformFeeCrypto < 0 || platformFeeCrypto >= cryptoAmount) {
      throw new TradeError("Invalid platform fee configuration.");
    }

    const reference = data.reference || `P2P-${Date.now()}`;

    // 🏦 1. FETCH BANK DETAILS (SNAPSHOT) BEFORE STARTING TRANSACTION
    // Side SELL means the user is selling to a BUY ad (Merchant is buying)
    const isUserSelling = merchantAd.type === "BUY";
    let paymentSnapshot = null;

    if (isUserSelling) {
      // User is the one receiving Fiat, we need their primary bank
      const primaryBank = await UserBankAccount.findOne({
        userId: buyerId,
        isPrimary: true,
        deletedAt: null,
      }).lean();

      if (!primaryBank) {
        throw new TradeError(
          "Please add and set a primary bank account in settings before selling.",
        );
      }

      paymentSnapshot = {
        bankName: primaryBank.bankName,
        accountNumber: primaryBank.accountNumber,
        accountName: primaryBank.accountName,
        bankCode: primaryBank.bankCode,
      };
    } else {
      // Merchant is the one receiving Fiat (Merchant is selling crypto)
      const merchantBank = await UserBankAccount.findOne({
        userId: merchantAd.userId,
        isPrimary: true,
        deletedAt: null,
      }).lean();

      paymentSnapshot = {
        bankName: merchantBank?.bankName,
        accountNumber: merchantBank?.accountNumber,
        accountName: merchantBank?.accountName,
        bankCode: merchantBank?.bankCode,
      };
    }
    const session = await mongoose.startSession();
    session.startTransaction();
    let trade;
    try {
      // Deduct ad liquidity atomically
      const adUpdateResult = await MerchantAd.findOneAndUpdate(
        { _id: merchantAd._id, availableAmount: { $gte: cryptoAmount } },
        { $inc: { availableAmount: -cryptoAmount } },
        { new: true, session },
      );
      if (!adUpdateResult)
        throw new TradeError("Insufficient liquidity or merchant ad not found");

      // Determine if merchant is buying → pre-escrow buyer crypto
      const shouldPreEscrow = merchantAd.type === "BUY";
      let escrowTxId = null;

      if (shouldPreEscrow) {
        const escrowSourceUserId = buyerId; // Buyer owns crypto
        const sourceWalletId = await resolveUserWalletId(
          escrowSourceUserId,
          currencyTarget,
        );
        const escrowAmount = cryptoAmount;

        const transferResult = await blockrader.withdrawExternal(
          sourceWalletId,
          blockrader.ESCROW_DESTINATION_ADDRESS,
          escrowAmount,
          currencyTarget,
          `${reference}-ESCROW`,
        );

        if (!transferResult)
          throw new TradeError("Pre-escrow transfer failed at provider");

        escrowTxId = transferResult?.data?.id || transferResult?.txId || "n/a";
      }

      const initialStatus = ALLOWED_STATES.INIT;
      console.log("merchantAd fields:", {
        price: merchantAd.price,
        rawPrice: merchantAd.price,
      });

      // Create the trade
      // 🏦 2. ATTACH THE SNAPSHOT TO THE TRADE CREATION
      const tradeDoc = await P2PTrade.create(
        [
          {
            reference,
            userId: buyerId,
            merchantId: merchantAd.userId,
            merchantAdId: merchantAd._id,
            side: merchantAd.type === "SELL" ? "BUY" : "SELL",
            amountFiat: fiatAmount,
            amountCrypto: cryptoAmount,
            platformFeeCrypto,
            netCryptoAmount: cryptoAmount - platformFeeCrypto,
            marketRate: merchantAd.price,
            listingRate: merchantAd.price,
            currencySource,
            currencyTarget,
            provider: "BLOCKRADAR",
            status: initialStatus,
            expiresAt,
            escrowTxId,
            // Pass the snapshot here
            paymentDetails: paymentSnapshot,
          },
        ],
        { session },
      );

      trade = tradeDoc[0];

      safeLog(trade, {
        message: shouldPreEscrow
          ? `Trade created with pre-escrow. Crypto secured for merchant-buying trade. Tx: ${escrowTxId}`
          : "Trade created. Awaiting buyer payment.",
        actor: buyerId,
        role: "buyer",
        ip,
        time: new Date(),
      });

      await session.commitTransaction();

      // Notify merchant asynchronously
      setImmediate(() => {
        notifyMerchantOfTrade(trade._id).catch((err) => {
          logger.error("Merchant trade notification failed", {
            tradeId: trade._id,
            error: err.stack || err.message,
          });
        });
      });
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }

    return await P2PTrade.findById(trade._id).lean();
  },

  // async confirmBuyerPayment(reference, buyerId, ip = null) {
  //   if (!reference) throw new TradeError("Reference required");

  //   const trade = await P2PTrade.findOne({ reference });
  //   if (!trade) throw new TradeError("Trade not found", 404);

  //   if (trade.userId.toString() !== buyerId.toString()) {
  //     throw new TradeError("Only the buyer can confirm payment", 403);
  //   }

  //   // If it failed before, you might need to manually reset it in the DB to test again,
  //   // but here we check for the valid starting states.
  //   const validStatuses = [ALLOWED_STATES.INIT, ALLOWED_STATES.MERCHANT_PAID];
  //   if (!validStatuses.includes(trade.status)) {
  //     throw new TradeError(
  //       `Cannot confirm payment in status: ${trade.status}`,
  //       409,
  //     );
  //   }

  //   const escrowSourceUserId =
  //     trade.side === "BUY" ? trade.merchantId : trade.userId;
  //   const sourceWalletId = await resolveUserWalletId(
  //     escrowSourceUserId,
  //     trade.currencyTarget,
  //   );
  //   const escrowAmount = trade.amountCrypto;

  //   // Create the exact reference string used for the withdrawal
  //   const escrowRef = `${trade.reference}-ESCROW`;

  //   const session = await mongoose.startSession();
  //   session.startTransaction();

  //   try {
  //     // 1️⃣ SAVE TO DB FIRST
  //     // Added idempotencyKey to satisfy your Schema requirement
  //     await Transaction.create(
  //       [
  //         {
  //           idempotencyKey: `P2P-ESCROW-${trade._id}-${Date.now()}`,
  //           reference: escrowRef,
  //           userId: escrowSourceUserId,
  //           walletId: await resolveWalletObjectId(
  //             escrowSourceUserId,
  //             trade.currencyTarget,
  //           ),
  //           amount: trade.amountCrypto,
  //           currency: trade.currencyTarget,
  //           type: "WITHDRAWAL",
  //           status: "PENDING",
  //           source: "BLOCKRADAR",
  //           metadata: { p2pTradeId: trade._id },
  //         },
  //       ],
  //       { session },
  //     );

  //     // Update trade status
  //     const updatedTrade = await updateTradeStatusAndLogSafe(
  //       trade._id,
  //       ALLOWED_STATES.PAYMENT_CONFIRMED_BY_BUYER,
  //       {
  //         message: `Buyer confirmed payment. Initiating escrow.`,
  //         actor: buyerId,
  //         role: "buyer",
  //         ip,
  //       },
  //       trade.status,
  //       session,
  //     );

  //     // Commit local DB changes before hitting the external API
  //     await session.commitTransaction();
  //     session.endSession();

  //     // 2️⃣ THEN CALL BLOCKRADAR
  //     const transferResult = await blockrader.withdrawExternal(
  //       sourceWalletId,
  //       blockrader.ESCROW_DESTINATION_ADDRESS,
  //       escrowAmount,
  //       trade.currencyTarget,
  //       escrowRef,
  //     );

  //     if (!transferResult) {
  //       throw new TradeError("Escrow transfer failed at provider");
  //     }

  //     const tradeId = trade._id;
  //     setImmediate(() => {
  //       notifyMerchantBuyerPaid(tradeId).catch((err) =>
  //         logger.error("Merchant notification failed", err),
  //       );
  //     });

  //     await redisClient.del(`balances:${escrowSourceUserId}`);
  //     return updatedTrade;
  //   } catch (error) {
  //     if (session && !session.hasEnded) {
  //       await session.abortTransaction();
  //     }
  //     session.endSession();

  //     // Log the failure so we know why it failed
  //     await updateTradeStatusAndLogSafe(trade._id, ALLOWED_STATES.FAILED, {
  //       message: `confirmBuyerPayment failed: ${error.message}`,
  //       role: "system",
  //       ip,
  //     });
  //     throw error;
  //   }
  // },

  async confirmBuyerPayment(reference, buyerId, ip = null) {
    if (!reference) throw new TradeError("Reference required");

    const trade = await P2PTrade.findOne({ reference });
    if (!trade) throw new TradeError("Trade not found", 404);

    if (trade.userId.toString() !== buyerId.toString()) {
      throw new TradeError("Only the buyer can confirm payment", 403);
    }

    const validStatuses = ["INIT", "MERCHANT_PAID", "PENDING_PAYMENT"];
    if (!validStatuses.includes(trade.status)) {
      throw new TradeError(
        `Cannot confirm payment in status: ${trade.status}`,
        409,
      );
    }

    const escrowSourceUserId =
      trade.side === "BUY" ? trade.merchantId : trade.userId;
    const sourceWalletId = await resolveUserWalletId(
      escrowSourceUserId,
      trade.currencyTarget,
    );
    const escrowAmount = trade.amountCrypto;

    const escrowRef = `${trade.reference}-ESCROW`;

    // ✅ STABLE KEY: This prevents double-charging if the user clicks twice
    const escrowIdempotencyKey = `P2P-ESCROW-INIT-${trade._id}`;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // 1️⃣ Create "PENDING" Withdrawal record locally
      await Transaction.create(
        [
          {
            idempotencyKey: escrowIdempotencyKey,
            reference: escrowRef,
            userId: escrowSourceUserId,
            walletId: await resolveWalletObjectId(
              escrowSourceUserId,
              trade.currencyTarget,
            ),
            amount: trade.amountCrypto,
            currency: trade.currencyTarget,
            type: "WITHDRAWAL",
            status: "PENDING",
            metadata: { p2pTradeId: trade._id },
          },
        ],
        { session },
      );

      // 2️⃣ Update trade status
      const updatedTrade = await updateTradeStatusAndLogSafe(
        trade._id,
        "PAYMENT_CONFIRMED_BY_BUYER",
        {
          message: `Buyer confirmed payment. Initiating escrow.`,
          actor: buyerId,
          role: "buyer",
          ip,
        },
        trade.status,
        session,
      );

      await session.commitTransaction();
      session.endSession();

      // 3️⃣ Call Blockradar with the SAME idempotency key
      const transferResult = await blockrader.withdrawExternal(
        sourceWalletId,
        blockrader.ESCROW_DESTINATION_ADDRESS,
        escrowAmount,
        trade.currencyTarget,
        escrowRef,
        escrowIdempotencyKey, // 🔑 Vital for preventing double withdrawals
      );

      if (!transferResult) {
        throw new TradeError("Escrow transfer failed at provider");
      }

      // 4️⃣ Async notification
      setImmediate(() => {
        notifyMerchantBuyerPaid(trade._id).catch((err) =>
          console.error("Merchant notification failed", err),
        );
      });

      await redisClient.del(`balances:${escrowSourceUserId}`);

      return updatedTrade;
    } catch (error) {
      if (session.inTransaction()) await session.abortTransaction();
      session.endSession();

      // Update trade status as failed so merchant/buyer knows why it stopped
      await updateTradeStatusAndLogSafe(trade._id, "FAILED", {
        message: `confirmBuyerPayment failed: ${error.message}`,
        role: "system",
        ip,
      });
      throw error;
    }
  },

  async merchantMarksFiatSent(reference, merchantId, ip = null) {
    if (!reference) throw new TradeError("Reference required");

    const trade = await P2PTrade.findOne({ reference });
    if (!trade) throw new TradeError("Trade not found", 404);

    // Only merchant
    if (trade.merchantId.toString() !== merchantId.toString()) {
      throw new TradeError("Unauthorized", 403);
    }

    /** This applies ONLY when merchant is BUYING crypto * merchantAd.type === BUY → trade.side === SELL  */
    if (trade.side !== "SELL") {
      throw new TradeError(
        "Merchant payment confirmation is only allowed when merchant is buying crypto",
        409,
      );
    }

    if (trade.status !== ALLOWED_STATES.INIT) {
      throw new TradeError(
        `Cannot mark payment sent in status: ${trade.status}`,
        409,
      );
    }

    // 1. Execute the status update and store the result
    const updatedTrade = await updateTradeStatusAndLogSafe(
      trade._id,
      ALLOWED_STATES.MERCHANT_PAID,
      {
        message: "Merchant marked fiat as sent. Awaiting buyer confirmation.",
        actor: merchantId,
        role: "merchant",
        ip,
      },
      trade.status,
    );

    // 2. 🔔 ADD THIS: Notify the User (Buyer) that the Merchant has sent the money
    // We use updatedTrade._id to ensure we are referencing the valid, updated record
    await notifyBuyerOfMerchantPayment(updatedTrade._id);

    // 3. Return the updated trade object to the controller
    return updatedTrade;
  },

  async initiateSettlementOTP(reference, requesterId) {
    if (!reference) throw new TradeError("Reference required");
    const trade = await P2PTrade.findOne({ reference });
    if (!trade) throw new TradeError("Trade not found", 404);

    const sellerId = trade.side === "BUY" ? trade.merchantId : trade.userId;

    if (requesterId.toString() !== sellerId.toString()) {
      throw new TradeError(
        "Unauthorized: Only the seller can release crypto.",
        403,
      );
    }

    // ✅ FIX: Allow both statuses depending on the trade flow
    const validStatuses = [
      ALLOWED_STATES.PAYMENT_CONFIRMED_BY_BUYER,
      ALLOWED_STATES.MERCHANT_PAID,
    ];

    if (!validStatuses.includes(trade.status)) {
      throw new TradeError(
        `Cannot release. Trade is in status: ${trade.status}.`,
        409,
      );
    }

    const sellerUser = await User.findById(sellerId).select("email").lean();
    await generateAndSendOtp(sellerId, "P2P_SETTLEMENT", sellerUser.email);

    return {
      message:
        "Verification code sent to your email. Enter OTP to release crypto.",
    };
  },

  // async confirmAndReleaseCrypto(params = {}) {
  //   const tradeReference = params.tradeId || params.reference;
  //   const confirmerUserId = params.confirmerUserId || params.requesterId;
  //   const otpCode = params.otpCode;

  //   if (!tradeReference) throw new TradeError("Trade reference is required");
  //   const normalizedReference = tradeReference.trim();

  //   // 1. Find the trade to see who the recipient is
  //   let trade = await P2PTrade.findOne({ reference: normalizedReference });
  //   if (!trade) throw new TradeError("Trade not found", 404);

  //   // Determine Recipient:
  //   // If BUY -> User receives crypto. If SELL -> Merchant receives crypto.
  //   const recipientUserId =
  //     trade.side === "BUY" ? trade.userId : trade.merchantId;
  //   const sellerId = trade.side === "BUY" ? trade.merchantId : trade.userId;

  //   // 2. Fetch the recipient's EXACT wallet for this specific currency
  //   const recipientWallet = await Wallet.findOne({
  //     user_id: recipientUserId,
  //     currency: trade.currencyTarget, // e.g., 'CNGN' or 'USDC'
  //     status: "ACTIVE",
  //     provider: "BLOCKRADAR",
  //   });

  //   if (!recipientWallet || !recipientWallet.walletAddress) {
  //     throw new TradeError(
  //       `Recipient does not have an active ${trade.currencyTarget} wallet.`,
  //     );
  //   }

  //   // Security Check: Only the seller can release
  //   if (confirmerUserId.toString() !== sellerId.toString()) {
  //     throw new TradeError(
  //       "Unauthorized: Only the seller can release crypto",
  //       403,
  //     );
  //   }

  //   // OTP Validation
  //   const otpValid = await verifyOtp(
  //     sellerId.toString(),
  //     "P2P_SETTLEMENT",
  //     otpCode,
  //   );
  //   if (!otpValid) throw new TradeError("Invalid or expired OTP", 401);

  //   const session = await mongoose.startSession();
  //   try {
  //     await session.withTransaction(async () => {
  //       const tradeTx = await P2PTrade.findOne({
  //         reference: normalizedReference,
  //         status: { $ne: "COMPLETED" },
  //       }).session(session);

  //       if (!tradeTx) throw new TradeError("Trade already completed", 409);

  //       const releaseKey = `P2P-REL-FINAL-${tradeTx._id}`;

  //       const releaseResult = await blockrader.transferFunds(
  //         process.env.COMPANY_ESCROW_ACCOUNT_ID, // sourceAddressId (Master)
  //         recipientWallet.externalWalletId, // destinationAddressId (Child UUID)
  //         tradeTx.netCryptoAmount, // amount
  //         tradeTx.currencyTarget, // currency
  //         recipientWallet.walletAddress, // destinationCryptoAddress (0x...)
  //         releaseKey, // p2pReference
  //       );

  //       if (!releaseResult) {
  //         throw new TradeError("Blockchain release failed at provider level");
  //       }

  //       // 4. Record the transaction in your ledger
  //       await Transaction.create(
  //         [
  //           {
  //             idempotencyKey: releaseKey,
  //             walletId: recipientWallet._id,
  //             userId: recipientUserId,
  //             type: "P2P_RELEASE",
  //             amount: tradeTx.netCryptoAmount,
  //             currency: tradeTx.currencyTarget,
  //             status: "COMPLETED",
  //             reference: releaseKey,
  //           },
  //         ],
  //         { session },
  //       );

  //       // 5. Finalize Trade
  //       tradeTx.status = "COMPLETED";
  //       tradeTx.settledAt = new Date();
  //       tradeTx.logs.push({
  //         message: `Released ${tradeTx.netCryptoAmount} ${tradeTx.currencyTarget} to recipient.`,
  //         actor: confirmerUserId,
  //         role: "seller",
  //         time: new Date(),
  //       });

  //       await tradeTx.save({ session });
  //     });
  //     this.notifyRecipientOfRelease(finalTradeData).catch((err) =>
  //       console.error(
  //         "[EmailError] P2P Release notification failed:",
  //         err.message,
  //       ),
  //     );
  //     return await P2PTrade.findOne({ reference: normalizedReference }).lean();
  //   } catch (error) {
  //     console.error("Release Process Failed:", error.message);
  //     throw error;
  //   } finally {
  //     session.endSession();
  //   }
  // },
  async confirmAndReleaseCrypto(params = {}) {
    const tradeReference = params.tradeId || params.reference;
    const confirmerUserId = params.confirmerUserId || params.requesterId;
    const otpCode = params.otpCode;

    if (!tradeReference) throw new TradeError("Trade reference is required");
    const normalizedReference = tradeReference.trim();

    // 1. Find the trade to see who the recipient is
    let trade = await P2PTrade.findOne({ reference: normalizedReference });
    if (!trade) throw new TradeError("Trade not found", 404);

    const recipientUserId =
      trade.side === "BUY" ? trade.userId : trade.merchantId;
    const sellerId = trade.side === "BUY" ? trade.merchantId : trade.userId;

    // 2. Fetch the recipient's wallet
    const recipientWallet = await Wallet.findOne({
      user_id: recipientUserId,
      currency: trade.currencyTarget,
      status: "ACTIVE",
      provider: "BLOCKRADAR",
    });

    if (!recipientWallet || !recipientWallet.walletAddress) {
      throw new TradeError(
        `Recipient does not have an active ${trade.currencyTarget} wallet.`,
      );
    }

    // Security Check
    if (confirmerUserId.toString() !== sellerId.toString()) {
      throw new TradeError(
        "Unauthorized: Only the seller can release crypto",
        403,
      );
    }

    // OTP Validation
    const otpValid = await verifyOtp(
      sellerId.toString(),
      "P2P_SETTLEMENT",
      otpCode,
    );
    if (!otpValid) throw new TradeError("Invalid or expired OTP", 401);

    const session = await mongoose.startSession();
    try {
      let finalTradeData; // Variable defined here for scope access

      await session.withTransaction(async () => {
        const tradeTx = await P2PTrade.findOne({
          reference: normalizedReference,
          status: { $ne: "COMPLETED" },
        }).session(session);

        if (!tradeTx) throw new TradeError("Trade already completed", 409);

        const releaseKey = `P2P-REL-FINAL-${tradeTx._id}`;

        const releaseResult = await blockrader.transferFunds(
          process.env.COMPANY_ESCROW_ACCOUNT_ID,
          recipientWallet.externalWalletId,
          tradeTx.netCryptoAmount,
          tradeTx.currencyTarget,
          recipientWallet.walletAddress,
          releaseKey,
        );

        if (!releaseResult) {
          throw new TradeError("Blockchain release failed at provider level");
        }

        // 4. Record the transaction
        await Transaction.create(
          [
            {
              idempotencyKey: releaseKey,
              walletId: recipientWallet._id,
              userId: recipientUserId,
              type: "P2P_RELEASE",
              amount: tradeTx.netCryptoAmount,
              currency: tradeTx.currencyTarget,
              status: "COMPLETED",
              reference: releaseKey,
            },
          ],
          { session },
        );

        // 5. Finalize Trade
        tradeTx.status = "COMPLETED";
        tradeTx.settledAt = new Date();
        tradeTx.logs.push({
          message: `Released ${tradeTx.netCryptoAmount} ${tradeTx.currencyTarget} to recipient.`,
          actor: confirmerUserId,
          role: "seller",
          time: new Date(),
        });

        await tradeTx.save({ session });
        finalTradeData = tradeTx.toObject(); // Assigning data for email trigger
      });

      // 6. Notify Recipient (Async call after transaction success)
      notifyUserOfCryptoRelease(finalTradeData._id).catch((err) =>
        console.error(
          "[EmailError] P2P Release notification failed:",
          err.message,
        ),
      );

      return finalTradeData;
    } catch (error) {
      console.error("Release Process Failed:", error.message);
      throw error;
    } finally {
      session.endSession();
    }
  },

  async cancelTrade(reference, userId, ip = null) {
    if (!reference) throw new TradeError("Reference required");

    const trade = await P2PTrade.findOne({ reference });
    if (!trade) throw new TradeError("Trade not found", 404);

    const user = await checkUser(userId);
    const isAdmin = user.role === "admin";
    const isBuyer = trade.userId.toString() === userId.toString();
    const isMerchant = trade.merchantId.toString() === userId.toString();

    // ----------------------------
    // 1️⃣ Authorization check
    // Buyer or Admin can cancel anytime.
    // Merchant can only cancel after trade expires.
    // ----------------------------
    if (isMerchant && !isAdmin) {
      const isExpired = new Date() > new Date(trade.expiresAt);
      if (!isExpired) {
        throw new TradeError(
          "Merchant cannot cancel while trade is active. Wait for expiration or open a dispute.",
          403,
        );
      }
    } else if (!isBuyer && !isAdmin) {
      throw new TradeError("Not authorized to cancel this trade", 403);
    }

    // ----------------------------
    // 2️⃣ Terminal states
    // ----------------------------
    const terminalStates = [
      ALLOWED_STATES.COMPLETED,
      ALLOWED_STATES.CANCELLED,
      ALLOWED_STATES.CANCELLED_REVERSED,
      ALLOWED_STATES.FAILED,
    ];
    if (terminalStates.includes(trade.status)) {
      throw new TradeError(
        `Trade is already in a final state: ${trade.status}`,
        409,
      );
    }

    const requiresEscrowReversal =
      trade.status === ALLOWED_STATES.PAYMENT_CONFIRMED_BY_BUYER;
    let reversalTxId = null;

    try {
      // ----------------------------
      // 3️⃣ Handle Escrow Reversal
      // - Scenario B (User sells)
      // - Full gross amount
      // ----------------------------
      if (requiresEscrowReversal) {
        const refundRecipientId =
          trade.side === "BUY" ? trade.merchantId : trade.userId;
        const sourceCurrency = trade.currencyTarget;

        // Full gross escrow includes platform fee
        const refundAmount = trade.amountCrypto;

        const destinationWalletId = await resolveUserWalletId(
          refundRecipientId,
          sourceCurrency,
        );
        const destinationAddress = await resolveUserCryptoAddress(
          refundRecipientId,
          sourceCurrency,
        );

        const transferResult = await blockrader.transferFunds(
          blockrader.BLOCKRADER_MASTER_WALLET_UUID,
          destinationWalletId,
          refundAmount,
          sourceCurrency,
          destinationAddress,
          `${trade.reference}-REVERSAL`,
        );

        if (!transferResult)
          throw new TradeError("Escrow reversal failed at provider");
        reversalTxId =
          transferResult?.data?.id || transferResult?.txId || "n/a";
      }

      // ----------------------------
      // 4️⃣ Atomic DB operations
      // ----------------------------
      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        // Restore merchant ad liquidity
        await MerchantAd.findByIdAndUpdate(
          trade.merchantAdId,
          { $inc: { availableAmount: trade.amountCrypto } },
          { session },
        );

        const newStatus = requiresEscrowReversal
          ? ALLOWED_STATES.CANCELLED_REVERSED
          : ALLOWED_STATES.CANCELLED;

        const updatedTrade = await updateTradeStatusAndLogSafe(
          trade._id,
          newStatus,
          {
            message: `Cancelled by ${
              isAdmin ? "Admin" : isBuyer ? "Buyer" : "Merchant"
            }. ${reversalTxId ? `Escrow reversed (tx: ${reversalTxId})` : ""}`,
            actor: userId,
            role: isAdmin ? "admin" : isBuyer ? "buyer" : "merchant",
            ip,
          },
          trade.status,
          session,
        );

        // 🔑 ADD: REFUND LEDGER
        if (requiresEscrowReversal) {
          await createIdempotentTransaction(
            {
              idempotencyKey: `P2P:${trade._id}:REFUND`,
              walletId: await resolveWalletObjectId(
                refundRecipientId,
                trade.currencyTarget,
              ),
              userId: refundRecipientId,
              type: "P2P_REFUND",
              amount: trade.amountCrypto, // 🟢 CREDIT
              currency: trade.currencyTarget,
              status: "COMPLETED",
              reference: trade.reference,
              metadata: { p2pTradeId: trade._id },
            },
            session,
          );
        }

        await session.commitTransaction();

        // Invalidate caches for both buyer and merchant
        await redisClient.del(`balances:${trade.merchantId}`);
        await redisClient.del(`balances:${trade.userId}`);

        return updatedTrade;
      } catch (dbError) {
        await session.abortTransaction();
        console.error(
          `DATABASE CRASH after reversal sent: ${reversalTxId}. Manual sync may be required for trade ${trade.reference}`,
        );
        throw dbError;
      } finally {
        session.endSession();
      }
    } catch (error) {
      // ----------------------------
      // 5️⃣ Fail-safe
      // ----------------------------
      await updateTradeStatusAndLogSafe(trade._id, ALLOWED_STATES.FAILED, {
        message: `Cancellation failed: ${error.message}`,
        role: "system",
        actor: null,
        ip,
      });
      throw error;
    }
  },
  // ✅ Auto-open disputes when buyer goes silent
  async autoOpenDisputesForSilentBuyers() {
    const TIMEOUT_MINUTES = 30;
    const cutoff = new Date(Date.now() - TIMEOUT_MINUTES * 60 * 1000);

    const stuckTrades = await P2PTrade.find({
      status: ALLOWED_STATES.MERCHANT_PAID,
      updatedAt: { $lte: cutoff },
    });

    for (const trade of stuckTrades) {
      await updateTradeStatusAndLogSafe(
        trade._id,
        ALLOWED_STATES.DISPUTE_PENDING,
        {
          message:
            "Buyer did not confirm payment in time. Dispute opened automatically.",
          role: "system",
        },
        ALLOWED_STATES.MERCHANT_PAID,
      );
    }

    return { processed: stuckTrades.length };
  },
  // ✅ Admin resolves dispute
  async adminResolveTrade(reference, action, adminId, ip = null) {
    const admin = await checkUser(adminId);
    if (admin.role !== "admin") {
      throw new TradeError("Admin access required", 403);
    }

    const trade = await P2PTrade.findOne({ reference });
    if (!trade) throw new TradeError("Trade not found", 404);

    if (trade.status !== ALLOWED_STATES.DISPUTE_PENDING) {
      throw new TradeError("Trade is not under dispute", 409);
    }

    let resolvedTrade;

    if (action === "RELEASE") {
      resolvedTrade = await this.confirmAndReleaseCrypto(
        reference,
        trade.merchantId,
        "ADMIN_OVERRIDE",
        ip,
      );

      setImmediate(() => {
        notifyUserOfAdminResolution(resolvedTrade._id, "RELEASED");
        notifyMerchantOfAdminResolution(resolvedTrade._id, "RELEASED");
      });

      return resolvedTrade;
    }

    if (action === "CANCEL") {
      resolvedTrade = await this.cancelTrade(reference, adminId, ip);

      setImmediate(() => {
        notifyUserOfAdminResolution(resolvedTrade._id, "CANCELLED");
        notifyMerchantOfAdminResolution(resolvedTrade._id, "CANCELLED");
      });

      return resolvedTrade;
    }

    throw new TradeError("Invalid admin action", 400);
  },
  // ✅ List disputes for admin review
  async listDisputes(page = 1, pageSize = 20) {
    const query = { status: "DISPUTE_PENDING" };

    const [disputes, total] = await Promise.all([
      P2PTrade.find(query)
        .populate("userId", "firstName lastName email")
        .populate("merchantId", "firstName lastName email")
        .sort({ updatedAt: -1 }) // Show most recent disputes first
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      P2PTrade.countDocuments(query),
    ]);

    return {
      disputes,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  },
  async getTradeByReference(reference) {
    return await P2PTrade.findOne({ reference })
      .populate("userId", "firstName email role")
      .populate("merchantId", "firstName email role")
      .lean();
  },

  async listTrades(filter = {}, page = 1, pageSize = 20) {
    const q = {};
    if (filter.status) q.status = filter.status;
    if (filter.userId) q.userId = filter.userId;
    if (filter.merchantId) q.merchantId = filter.merchantId;

    const [trades, total] = await Promise.all([
      P2PTrade.find(q)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      P2PTrade.countDocuments(q),
    ]);

    return { trades, total, page, pageSize };
  },
};

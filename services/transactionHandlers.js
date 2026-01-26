// const mongoose = require("mongoose");
// const Wallet = require("../models/walletModel");
// const Transaction = require("../models/transactionModel");
// const FeeLog = require("../models/feeLogModel");
// const Decimal = require("decimal.js");
// const { getFlatFee } = require("./adminFeeService");

// async function handleDepositConfirmed(webhookPayload = {}) {
//   if (webhookPayload.event !== "deposit.success") return null;

//   const data = webhookPayload.payload || {};

//   const {
//     id: externalTxId,
//     amountPaid,
//     currency = "USDC",
//     senderAddress,
//     recipientAddress,
//     reference,
//     wallet: blockradarWallet,
//   } = data;

//   if (!externalTxId || !amountPaid || !reference) {
//     console.warn("⚠️ Invalid Blockradar deposit payload", data);
//     return null;
//   }

//   const normalizedCurrency =
//     currency === "USD" ? "USDC" : currency.toUpperCase();

//   // 🔐 STRONG idempotency (Blockradar retries safe)
//   const alreadyProcessed = await Transaction.findOne({
//     externalTxId,
//     source: "BLOCKRADAR",
//   });

//   if (alreadyProcessed) {
//     console.info(`🔁 Deposit already processed: ${externalTxId}`);
//     return alreadyProcessed;
//   }

//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     let wallet = null;

//     // if (data.externalWalletId) {
//     //   wallet = await Wallet.findOne({
//     //     externalWalletId: data.externalWalletId,
//     //     currency: normalizedCurrency,
//     //     status: "ACTIVE",
//     //   }).session(session);
//     // }
//     if (blockradarWallet?.id) {
//       wallet = await Wallet.findOne({
//         externalWalletId: blockradarWallet.id,
//         currency: normalizedCurrency,
//         status: "ACTIVE",
//       }).session(session);
//     }

//     if (!wallet && blockradarWallet?.address) {
//       wallet = await Wallet.findOne({
//         walletAddress: blockradarWallet.address,
//         currency: normalizedCurrency,
//         status: "ACTIVE",
//       }).session(session);
//     }

//     if (!wallet) {
//       throw new Error(
//         `Wallet not found for Blockradar deposit | extTx=${externalTxId}`,
//       );
//     }

//     const grossAmount = new Decimal(amountPaid);
//     if (grossAmount.lte(0)) {
//       throw new Error("Invalid deposit amount");
//     }

//     const flatFeeValue = await getFlatFee("DEPOSIT", normalizedCurrency);
//     const feeAmount = new Decimal(flatFeeValue || 0);

//     if (feeAmount.gt(grossAmount)) {
//       throw new Error("Deposit fee exceeds amount");
//     }

//     const netAmount = grossAmount.minus(feeAmount);

//     // 💰 Credit wallet
//     await Wallet.updateOne(
//       { _id: wallet._id },
//       { $inc: { balance: Number(netAmount) } },
//       { session },
//     );

//     // 🧾 Create transaction (externalTxId is the lock)
//     const [tx] = await Transaction.create(
//       [
//         {
//           walletId: wallet._id,
//           userId: wallet.user_id,
//           externalTxId,
//           reference,
//           type: "DEPOSIT",
//           source: "BLOCKRADAR",
//           amount: Number(grossAmount),
//           netAmount: Number(netAmount),
//           currency: normalizedCurrency,
//           status: "COMPLETED",
//           metadata: {
//             senderAddress,
//             recipientAddress,
//             rawWebhook: data,
//           },
//           feeDetails: {
//             platformFee: Number(feeAmount),
//             totalFee: Number(feeAmount),
//             networkFee: 0,
//             isDeductedFromAmount: true,
//           },
//         },
//       ],
//       { session },
//     );

//     if (feeAmount.gt(0)) {
//       await FeeLog.create(
//         [
//           {
//             userId: wallet.user_id,
//             transactionId: tx._id,
//             type: "DEPOSIT",
//             currency: normalizedCurrency,
//             grossAmount: Number(grossAmount),
//             feeAmount: Number(feeAmount),
//             platformFee: Number(feeAmount),
//             reference,
//             provider: "BLOCKRADAR",
//           },
//         ],
//         { session },
//       );
//     }

//     await session.commitTransaction();
//     session.endSession();

//     console.info(
//       `✅ Deposit credited | ${netAmount.toString()} ${normalizedCurrency}`,
//     );

//     return tx;
//   } catch (err) {
//     await session.abortTransaction();
//     session.endSession();
//     console.error("❌ Deposit failed:", err.message);
//     throw err;
//   }
// }

// async function handleWithdrawSuccess(eventData = {}) {
//   // Blockradar sends 'reference' inside payload
//   const data = eventData.payload || eventData;
//   const { reference } = data;

//   if (!reference) {
//     console.warn(
//       "Withdrawal success called with missing reference:",
//       eventData,
//     );
//     return null;
//   }

//   const tx = await Transaction.findOne({ reference });
//   if (!tx) {
//     console.warn("Withdrawal success for unknown reference:", reference);
//     return null;
//   }

//   // 🔐 Idempotency guard
//   if (tx.status === "COMPLETED") {
//     console.info(`🔁 Withdrawal already completed: ${reference}`);
//     return tx;
//   }

//   const flatFeeValue = await getFlatFee("WITHDRAWAL", tx.currency);
//   const flatFeeDecimal = new Decimal(flatFeeValue || 0);

//   const grossAmt = new Decimal(tx.amount || 0);
//   const netAmt = grossAmt.minus(flatFeeDecimal);

//   tx.status = "COMPLETED";
//   tx.metadata = { ...tx.metadata, providerData: data };

//   tx.feeDetails = {
//     ...tx.feeDetails,
//     platformFee: Number(flatFeeDecimal),
//     totalFee: Number(flatFeeDecimal),
//     netAmountReceived: Number(netAmt),
//     isDeductedFromAmount: true,
//   };

//   if (data.providerNetworkFee) {
//     const networkFee = Number(data.providerNetworkFee);
//     tx.feeDetails.networkFee = networkFee;

//     await FeeLog.findOneAndUpdate(
//       { transactionId: tx._id },
//       {
//         $setOnInsert: {
//           transactionId: tx._id,
//           type: "WITHDRAWAL",
//           currency: tx.currency,
//           provider: "BLOCKRADAR",
//         },
//         $set: {
//           platformFee: Number(flatFeeDecimal),
//           networkFee,
//           feeAmount: Number(flatFeeDecimal.add(networkFee)),
//           grossAmount: Number(grossAmt),
//         },
//       },
//       { upsert: true },
//     );
//   }

//   await tx.save();
//   return tx;
// }

// module.exports = { handleDepositConfirmed, handleWithdrawSuccess };

const mongoose = require("mongoose");
const Wallet = require("../models/walletModel");
const Transaction = require("../models/transactionModel");
const FeeLog = require("../models/feeLogModel");
const Decimal = require("decimal.js");
const { getFlatFee } = require("./adminFeeService");
const P2PTrade = require("../models/p2pModel");
const MASTER_WALLET_ID = process.env.BLOCKRADER_MASTER_WALLET_UUID;

// async function handleDepositConfirmed(webhookPayload = {}) {
//   if (webhookPayload.event !== "deposit.success") return null;

//   // Fix: Blockradar nests details in 'data'
//   const data = webhookPayload.data || webhookPayload.payload || {};

//   const {
//     id: externalTxId,
//     amountPaid,
//     currency = "USDC",
//     senderAddress,
//     recipientAddress,
//     reference,
//     wallet: blockradarWallet,
//   } = data;

//   // Validation
//   if (!externalTxId || !amountPaid || !reference) {
//     console.warn("⚠️ Invalid Blockradar deposit payload", data);
//     return null;
//   }

//   // --- CURRENCY NORMALIZATION ---
//   let normalizedCurrency = currency.toUpperCase();
//   if (normalizedCurrency === "USD") normalizedCurrency = "USDC";
//   // Explicitly ensuring CNGN remains CNGN (matches your DB)
//   if (normalizedCurrency === "CNGN") normalizedCurrency = "CNGN";

//   // 🔐 Idempotency check
//   const alreadyProcessed = await Transaction.findOne({
//     externalTxId,
//     source: "BLOCKRADAR",
//   });

//   if (alreadyProcessed) {
//     console.info(`🔁 Deposit already processed: ${externalTxId}`);
//     return alreadyProcessed;
//   }

//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     let wallet = null;

//     // --- WALLET LOOKUP ---
//     if (blockradarWallet?.id) {
//       wallet = await Wallet.findOne({
//         externalWalletId: blockradarWallet.id,
//         currency: normalizedCurrency,
//         status: "ACTIVE",
//       }).session(session);
//     }

//     if (!wallet && blockradarWallet?.address) {
//       wallet = await Wallet.findOne({
//         walletAddress: blockradarWallet.address,
//         currency: normalizedCurrency,
//         status: "ACTIVE",
//       }).session(session);
//     }

//     if (!wallet) {
//       throw new Error(
//         `Wallet not found for Blockradar deposit | extTx=${externalTxId} | Currency=${normalizedCurrency}`,
//       );
//     }

//     const grossAmount = new Decimal(amountPaid);
//     const flatFeeValue = await getFlatFee("DEPOSIT", normalizedCurrency);
//     const feeAmount = new Decimal(flatFeeValue || 0);

//     if (feeAmount.gt(grossAmount)) {
//       throw new Error("Deposit fee exceeds amount");
//     }

//     const netAmount = grossAmount.minus(feeAmount);

//     // Credit wallet
//     await Wallet.updateOne(
//       { _id: wallet._id },
//       { $inc: { balance: Number(netAmount) } },
//       { session },
//     );

//     // Create transaction record
//     const [tx] = await Transaction.create(
//       [
//         {
//           walletId: wallet._id,
//           userId: wallet.user_id,
//           externalTxId,
//           reference,
//           type: "DEPOSIT",
//           source: "BLOCKRADAR",
//           amount: Number(grossAmount),
//           netAmount: Number(netAmount),
//           currency: normalizedCurrency,
//           status: "COMPLETED",
//           metadata: {
//             senderAddress,
//             recipientAddress,
//             rawWebhook: data,
//           },
//           feeDetails: {
//             platformFee: Number(feeAmount),
//             totalFee: Number(feeAmount),
//             networkFee: 0,
//             isDeductedFromAmount: true,
//           },
//         },
//       ],
//       { session },
//     );

//     if (feeAmount.gt(0)) {
//       await FeeLog.create(
//         [
//           {
//             userId: wallet.user_id,
//             transactionId: tx._id,
//             type: "DEPOSIT",
//             currency: normalizedCurrency,
//             grossAmount: Number(grossAmount),
//             feeAmount: Number(feeAmount),
//             platformFee: Number(feeAmount),
//             reference,
//             provider: "BLOCKRADAR",
//           },
//         ],
//         { session },
//       );
//     }

//     await session.commitTransaction();
//     session.endSession();

//     console.info(
//       `✅ Deposit credited | ${netAmount.toString()} ${normalizedCurrency}`,
//     );
//     return tx;
//   } catch (err) {
//     // Use the standard way to check if a transaction is active
//     if (session && session.hasEnded === false) {
//       await session.abortTransaction();
//     }
//     if (session) session.endSession();

//     console.error("❌ Deposit failed:", err.message);
//     throw err;
//   }
// }
async function handleDepositConfirmed(webhookPayload = {}) {
  if (webhookPayload.event !== "deposit.success") return null;

  const data = webhookPayload.data || webhookPayload.payload || {};

  const {
    id: externalTxId,
    amountPaid,
    currency = "USDC",
    senderAddress,
    recipientAddress,
    reference,
    wallet: blockradarWallet,
  } = data;

  // 1. Basic Validation
  if (!externalTxId || !amountPaid || !reference) {
    console.warn("⚠️ Invalid Blockradar deposit payload", data);
    return null;
  }

  // 2. Map Currencies (Ensures NGN -> CNGN mapping)
  let normalizedCurrency = currency.toUpperCase();
  if (normalizedCurrency === "USD") normalizedCurrency = "USDC";
  if (normalizedCurrency === "NGN") normalizedCurrency = "CNGN";

  // 3. ESCROW EXCEPTION: Handle Master Wallet (No DB lookup)
  if (blockradarWallet?.id === MASTER_WALLET_ID) {
    console.info(
      `📦 Escrow Deposit Received for Master Wallet. Ref: ${reference}`,
    );

    if (reference && reference.includes("-ESCROW")) {
      const p2pRef = reference.replace("-ESCROW", "");
      await P2PTrade.findOneAndUpdate(
        { reference: p2pRef },
        {
          $set: {
            "metadata.escrowConfirmed": true,
            "metadata.escrowTxId": externalTxId,
          },
        },
      );
      console.info(`✅ P2P Trade ${p2pRef} marked as Escrowed.`);
    }
    return { status: "ESCROW_SUCCESS", externalTxId };
  }

  // 4. 🔐 Normal User Deposit Idempotency check
  const alreadyProcessed = await Transaction.findOne({
    externalTxId,
    source: "BLOCKRADAR",
  });

  if (alreadyProcessed) {
    console.info(`🔁 Deposit already processed: ${externalTxId}`);
    return alreadyProcessed;
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    let wallet = null;

    // 5. Wallet Lookup
    if (blockradarWallet?.id) {
      wallet = await Wallet.findOne({
        externalWalletId: blockradarWallet.id,
        currency: normalizedCurrency,
        status: "ACTIVE",
      }).session(session);
    }

    if (!wallet && blockradarWallet?.address) {
      wallet = await Wallet.findOne({
        walletAddress: blockradarWallet.address,
        currency: normalizedCurrency,
        status: "ACTIVE",
      }).session(session);
    }

    if (!wallet) {
      throw new Error(
        `Wallet not found for Blockradar deposit | extTx=${externalTxId}`,
      );
    }

    const grossAmount = new Decimal(amountPaid);
    const flatFeeValue = await getFlatFee("DEPOSIT", normalizedCurrency);
    const feeAmount = new Decimal(flatFeeValue || 0);
    const netAmount = grossAmount.minus(feeAmount);

    // 6. Credit wallet
    await Wallet.updateOne(
      { _id: wallet._id },
      { $inc: { balance: Number(netAmount) } },
      { session },
    );

    // 7. Create transaction record (WITH THE REQUIRED idempotencyKey)
    const [tx] = await Transaction.create(
      [
        {
          idempotencyKey: `DEP-${externalTxId}`, // FIXES THE SCHEMA ERROR
          walletId: wallet._id,
          userId: wallet.user_id,
          externalTxId,
          reference,
          type: "DEPOSIT",
          source: "BLOCKRADAR",
          amount: Number(grossAmount),
          netAmount: Number(netAmount),
          currency: normalizedCurrency,
          status: "COMPLETED",
          metadata: { senderAddress, recipientAddress, rawWebhook: data },
          feeDetails: {
            platformFee: Number(feeAmount),
            totalFee: Number(feeAmount),
            networkFee: 0,
            isDeductedFromAmount: true,
          },
        },
      ],
      { session },
    );

    await session.commitTransaction();
    session.endSession();

    console.info(
      `✅ User Deposit credited | ${netAmount.toString()} ${normalizedCurrency}`,
    );
    return tx;
  } catch (err) {
    if (session && session.hasEnded === false) await session.abortTransaction();
    if (session) session.endSession();
    console.error("❌ Deposit failed:", err.message);
    throw err;
  }
}
async function handleWithdrawSuccess(eventData = {}) {
  const data = eventData.data || eventData.payload || eventData;
  const { reference } = data;

  if (!reference) {
    console.warn(
      "Withdrawal success called with missing reference:",
      eventData,
    );
    return null;
  }

  const tx = await Transaction.findOne({ reference });
  if (!tx) {
    console.warn("Withdrawal success for unknown reference:", reference);
    return null;
  }

  if (tx.status === "COMPLETED") {
    console.info(`🔁 Withdrawal already completed: ${reference}`);
    return tx;
  }

  const flatFeeValue = await getFlatFee("WITHDRAWAL", tx.currency);
  const flatFeeDecimal = new Decimal(flatFeeValue || 0);
  const grossAmt = new Decimal(tx.amount || 0);
  const netAmt = grossAmt.minus(flatFeeDecimal);

  tx.status = "COMPLETED";
  tx.metadata = { ...tx.metadata, providerData: data };
  tx.feeDetails = {
    ...tx.feeDetails,
    platformFee: Number(flatFeeDecimal),
    totalFee: Number(flatFeeDecimal),
    netAmountReceived: Number(netAmt),
    isDeductedFromAmount: true,
  };

  if (data.gasFee) {
    const networkFee = Number(data.gasFee);
    tx.feeDetails.networkFee = networkFee;

    await FeeLog.findOneAndUpdate(
      { transactionId: tx._id },
      {
        $setOnInsert: {
          transactionId: tx._id,
          type: "WITHDRAWAL",
          currency: tx.currency,
          provider: "BLOCKRADAR",
        },
        $set: {
          platformFee: Number(flatFeeDecimal),
          networkFee,
          feeAmount: Number(flatFeeDecimal.add(networkFee)),
          grossAmount: Number(grossAmt),
        },
      },
      { upsert: true },
    );
  }

  await tx.save();
  return tx;
}

module.exports = { handleDepositConfirmed, handleWithdrawSuccess };

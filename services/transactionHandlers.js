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

async function handleDepositConfirmed(webhookPayload = {}) {
  if (webhookPayload.event !== "deposit.success") return null;

  // Fix: Blockradar nests details in 'data'
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

  // Validation now checks the correct object path
  if (!externalTxId || !amountPaid || !reference) {
    console.warn("⚠️ Invalid Blockradar deposit payload", data);
    return null;
  }

  const normalizedCurrency =
    currency === "USD" ? "USDC" : currency.toUpperCase();

  // 🔐 Idempotency check
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

    if (feeAmount.gt(grossAmount)) {
      throw new Error("Deposit fee exceeds amount");
    }

    const netAmount = grossAmount.minus(feeAmount);

    // Credit wallet
    await Wallet.updateOne(
      { _id: wallet._id },
      { $inc: { balance: Number(netAmount) } },
      { session },
    );

    // Create transaction record
    const [tx] = await Transaction.create(
      [
        {
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
          metadata: {
            senderAddress,
            recipientAddress,
            rawWebhook: data,
          },
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

    if (feeAmount.gt(0)) {
      await FeeLog.create(
        [
          {
            userId: wallet.user_id,
            transactionId: tx._id,
            type: "DEPOSIT",
            currency: normalizedCurrency,
            grossAmount: Number(grossAmount),
            feeAmount: Number(feeAmount),
            platformFee: Number(feeAmount),
            reference,
            provider: "BLOCKRADAR",
          },
        ],
        { session },
      );
    }

    await session.commitTransaction();
    session.endSession();

    console.info(
      `✅ Deposit credited | ${netAmount.toString()} ${normalizedCurrency}`,
    );
    return tx;
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("❌ Deposit failed:", err.message);
    throw err;
  }
}

async function handleWithdrawSuccess(eventData = {}) {
  // standardized extraction for withdrawal too
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
    // Using gasFee from the Blockradar log
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

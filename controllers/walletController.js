const User = require("../models/userModel");
const mongoose = require("mongoose");
const Wallet = require("../models/walletModel");
const { generateAndSendOtp, verifyOtp } = require("../utilities/otpUtils");
const { getFlatFee } = require("../services/adminFeeService");
const logger = require("../utilities/logger");
const p2pService = require("../services/p2pService");
const {
  createWithdrawalRequest,
} = require("../services/withdrawalInterService");
const { initiateCryptoTransfer } = require("../services/cryptoTransServicePc");
const Transaction = require("../models/transactionModel"); // Needed for the non-atomic update
const { withdrawFromBlockrader } = require("../services/providers/blockrader");
// const blockradar = require("../services/providers/blockrader");

const getDashboardBalances = async (req, res) => {
  try {
    const userId = req.user.id;
    const balances = await p2pService.getAllUserWalletBalances(userId);
    return res.status(200).json({
      message: "Dashboard balances fetched successfully",
      data: balances,
    });
  } catch (error) {
    logger.error(
      `❌ Dashboard balances error for user ${req?.user?.id || "UNKNOWN"}: ${
        error.message
      }`
    );
    // Return a generic 500 error to the user for security
    return res.status(500).json({
      success: false,
      message:
        "Failed to fetch dashboard balances. An unexpected error occurred.",
      // For development, you can uncomment the line below:
      debugMessage: error.message,
    });
  }
};

const getWallet = async (req, res) => {
  try {
    const wallets = await Wallet.find({ user_id: req.user.id }).select(
      "currency accountName accountNumber walletAddress"
    );

    return res.status(200).json({ success: true, wallets });
  } catch (err) {
    console.error("❌ Failed to fetch user wallets:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch wallets" });
  }
};

// DEPOSIT FUNCTIONS OLD
// const getDepositAddress = async (req, res) => {
//   try {
//     const userId = req.user.id;
//     const { currency } = req.query;

//     if (!currency) {
//       return res.status(400).json({ error: "Currency is required" });
//     }

//     // ✅ ALWAYS filter by currency
//     const wallet = await Wallet.findOne({
//       user_id: userId,
//       currency,
//       status: "ACTIVE",
//     });

//     if (!wallet) {
//       return res.status(404).json({
//         error: "Wallet not found for this currency",
//       });
//     }

//     if (!wallet.walletAddress) {
//       return res.status(400).json({
//         error: "Deposit address not provisioned yet",
//       });
//     }

//     return res.status(200).json({
//       success: true,
//       address: wallet.walletAddress,
//       currency: wallet.currency,
//       network: wallet.network || "BASE",
//       provider: wallet.provider,
//       message: "Send funds only on the specified network.",
//     });

//   } catch (error) {
//     console.error("Get deposit address error:", error.message);
//     res.status(500).json({ error: "Failed to retrieve deposit address" });
//   }
// };
// DEPOSIT FUNCTIONS
const getDepositAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    const { currency } = req.query;

    if (!currency) {
      return res.status(400).json({ error: "Currency is required" });
    }

    // ✅ Always filter by currency
    const wallet = await Wallet.findOne({
      user_id: userId,
      currency,
      status: "ACTIVE",
    });

    if (!wallet) {
      return res.status(404).json({
        error: "Wallet not found for this currency",
      });
    }

    // Prepare response
    let responseData = {
      success: true,
      currency: wallet.currency,
      provider: wallet.provider,
    };

    if (currency.toUpperCase() === "NGN") {
      // NGN virtual account
      if (!wallet.accountNumber) {
        // ✅ correct field name
        return res.status(400).json({
          error: "Virtual account not provisioned yet",
        });
      }
      responseData.accountNumber = wallet.accountNumber; // ✅ correct
      responseData.accountName = wallet.accountName; // ✅ correct
      responseData.bankName = wallet.bankName; // if it exists
      responseData.message = "Send NGN only to this account number";
    } else {
      // Crypto wallet address (USDC, etc.)
      if (!wallet.walletAddress) {
        return res.status(400).json({
          error: "Deposit address not provisioned yet",
        });
      }
      responseData.address = wallet.walletAddress;
      responseData.network = wallet.network || "BASE";
      responseData.message = "Send funds only on the specified network.";
    }

    return res.status(200).json(responseData);
  } catch (error) {
    console.error("Get deposit address error:", error.message);
    res.status(500).json({ error: "Failed to retrieve deposit address" });
  }
};

// 1️⃣ STEP 1: INITIATION (Request OTP)
// IMPLEMENT PAYCREST WITHDRAWAL LOGIC
const initiateWithdrawal = async (req, res) => {
  try {
    const { walletCurrency, amount } = req.body;

    if (!walletCurrency || !amount) {
      return res
        .status(400)
        .json({ success: false, message: "Required fields are missing" });
    }

    logger.info(`Initiating withdrawal OTP for user ${req.user.id}`);

    const user = await User.findById(req.user.id);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    const wallet = await Wallet.findOne({
      currency: walletCurrency,
      user_id: req.user.id,
    });
    if (!wallet)
      return res
        .status(404)
        .json({ success: false, message: "Wallet not found" });

    // Perform preliminary balance check before sending OTP
    if (wallet.balance < amount) {
      return res
        .status(400)
        .json({ success: false, message: "Insufficient wallet balance" });
    }

    await generateAndSendOtp(req.user.id, "WITHDRAWAL", user.email);

    return res.status(200).json({
      success: true,
      message:
        "Verification code sent to your email. Please check your inbox/spam folder.",
    });
  } catch (error) {
    logger.error("initiateWithdrawal error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
// 2️⃣ STEP 2: COMPLETION (OTP Verification, Paycrest Order, Fund Lock)
const submitPaycrestWithdrawal = async (req, res) => {
  try {
    // 1. Collect all required inputs, including OTP and all Paycrest fiat details
    const {
      walletCurrency, // e.g., "CNGN" (The crypto being spent)
      fiatCurrency, // e.g., "GHS", "USD", "NGN" (The fiat being received) 👈 NEW
      amount,
      otpCode,
      destinationAccountNumber,
      institutionCode,
      accountName,
    } = req.body;
    const userId = req.user.id;

    if (
      !walletCurrency ||
      !destinationAccountNumber ||
      !amount ||
      !otpCode ||
      !institutionCode ||
      !accountName
    ) {
      return res.status(400).json({
        success: false,
        message: "All withdrawal and recipient details required",
      });
    } // 2. Verify OTP

    const isVerified = await verifyOtp(userId, otpCode, "WITHDRAWAL");
    if (!isVerified)
      return res
        .status(401)
        .json({ success: false, message: "Invalid or expired OTP." }); // 3. Call service to create Paycrest order and deduct user funds (atomic transaction)

    const idempotencyKey = crypto
      .createHash("sha256")
      .update(`${userId}-${amount}-${destinationAccountNumber}`)
      .digest("hex");

    // The result object needs to be updated after the crypto transfer if it happens
    let cryptoTransferResult = {};
    let transaction; // Declare transaction here for scope

    const result = await createWithdrawalRequest({
      userId,
      currency: walletCurrency, // "CNGN"
      fiatCurrency, // 👈 NEW: Pass this down
      amount,
      externalAddress: destinationAccountNumber,
      institutionCode,
      accountName,
      idempotencyKey,
    });

    transaction = result.transaction; // Get the initial transaction object
    const validUntil = result.transaction.metadata.paycrestValidUntil;

    if (validUntil && new Date() > new Date(validUntil)) {
      throw new Error("Paycrest order expired before crypto transfer");
    } // 4. CRITICAL STEP: INITIATE ON-CHAIN CRYPTO TRANSFER (ONLY if a new order was created)

    if (!result.alreadyExists) {
      logger.info(
        `Starting crypto transfer for Paycrest Order ID: ${result.paycrestOrderId}`
      );

      cryptoTransferResult = await initiateCryptoTransfer({
        userId: userId,
        token: walletCurrency,
        receiveAddress: result.paycrestReceiveAddress,
        amount: result.cryptoAmountToSend,
        reference: transaction.reference,
      });

      // 5. Update the transaction with the on-chain hash and set status
      transaction = await Transaction.findByIdAndUpdate(
        transaction._id,
        {
          $set: {
            status: "CRYPTO_TRANSFER_SENT", // Funds are locked, crypto is sent
            "metadata.cryptoTxHash": cryptoTransferResult.transactionHash,
            "metadata.cryptoProviderRef":
              cryptoTransferResult.providerReference,
          },
        },
        { new: true }
      ); // Get the updated document
    } // 6. Return Paycrest details to caller

    const responseMessage = result.alreadyExists
      ? "Withdrawal order already created. Check transaction status."
      : "Withdrawal initiated! Funds locked, crypto transfer sent to Paycrest. Awaiting fiat confirmation.";

    return res.status(200).json({
      success: true,
      message: responseMessage,
      data: {
        transaction: transaction, // Return the final, updated transaction
        paycrestOrderId: result.paycrestOrderId,
        paycrestReceiveAddress: result.paycrestReceiveAddress,
        cryptoAmountToSend: result.cryptoAmountToSend,
        cryptoTransfer: cryptoTransferResult, // Will be empty if alreadyExists is true
      },
    });
  } catch (error) {
    logger.error("submitPaycrestWithdrawal error:", error);
    const statusCode = error.message.includes("Insufficient balance")
      ? 400
      : 500;
    return res
      .status(statusCode)
      .json({ success: false, message: error.message });
  }
};
// 3️⃣ STEP 3: Handle direct crypto withdrawal (no fiat off-ramp)
const submitCryptoWithdrawal = async (req, res) => {
  // 1. Start a Client Session for the Atomic Transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { walletCurrency, amount, otpCode, externalCryptoAddress } = req.body;
    const userId = req.user.id;

    // 2. Initial validation (Outside the lock to keep it fast)
    if (!walletCurrency || !externalCryptoAddress || !amount || !otpCode) {
      throw new Error("All details required");
    }

    const isVerified = await verifyOtp(userId, otpCode, "WITHDRAWAL");
    if (!isVerified) throw new Error("Invalid or expired OTP.");

    // 3. Find Wallet within the session (Ensures data consistency)
    const wallet = await Wallet.findOne({
      currency: walletCurrency,
      user_id: userId,
    }).session(session);
    if (!wallet) throw new Error("Wallet not found.");

    // 4. Calculate Fees using our dynamic service
    const flatFeeValue = await getFlatFee("WITHDRAWAL", walletCurrency);
    const feeAmt = new Decimal(flatFeeValue);
    const requestAmt = new Decimal(amount);
    const totalDeduction = requestAmt.add(feeAmt);

    if (new Decimal(wallet.balance).lt(totalDeduction)) {
      throw new Error(
        `Insufficient balance. Need ${totalDeduction.toString()}`
      );
    }

    const idempotencyKey = `crypto-wdr-${userId}-${Date.now()}`;

    // 5. Create PENDING Transaction (Pass the session!)
    let newTransaction = await Transaction.create(
      [
        {
          user_id: userId,
          type: "WITHDRAWAL",
          currency: walletCurrency,
          amount: Number(requestAmt.toString()),
          fee: Number(feeAmt.toString()),
          status: "PENDING_PROVIDER",
          reference: idempotencyKey,
          feeDetails: {
            platformFee: Number(feeAmt.toString()),
            isDeductedFromAmount: false,
          },
          metadata: {
            destination: externalCryptoAddress,
            provider: "BLOCKRADER_CRYPTO",
          },
        },
      ],
      { session }
    );

    // Since Transaction.create returns an array when using sessions, grab the first item
    const txRecord = newTransaction[0];

    // 6. Deduct from wallet balance (Pass the session!)
    wallet.balance = new Decimal(wallet.balance).sub(totalDeduction).toNumber();
    await wallet.save({ session });

    // 7. COMMIT THE DATABASE CHANGES
    // We commit here BEFORE calling the external API.
    // This locks in the deduction so the user can't "double spend" during the API call.
    await session.commitTransaction();
    session.endSession();

    logger.info(`DB Commited. Calling Blockrader for Tx: ${txRecord._id}`);

    // 8. Call Blockrader API
    try {
      const providerResponse = await withdrawFromBlockrader(
        wallet.externalWalletId,
        externalCryptoAddress,
        Number(requestAmt.toString()),
        walletCurrency,
        idempotencyKey,
        txRecord.reference
      );

      // Update status to what the provider says
      await Transaction.findByIdAndUpdate(txRecord._id, {
        $set: {
          status: providerResponse.data?.status || "SENT_TO_PROVIDER",
          provider_ref: providerResponse.data?.id,
          "metadata.blockraderHash": providerResponse.data?.hash,
        },
      });

      return res
        .status(200)
        .json({ success: true, message: "Initiated successfully" });
    } catch (apiError) {
      // --- 🔄 REFUND LOGIC (If API Fails after DB Commit) ---
      logger.error("Blockrader API failed. Initiating manual reversal.");

      await Wallet.updateOne(
        { _id: wallet._id },
        { $inc: { balance: totalDeduction.toNumber() } }
      );

      await Transaction.findByIdAndUpdate(txRecord._id, {
        $set: { status: "FAILED", "metadata.error": apiError.message },
      });

      throw new Error(
        "Provider service unavailable. Funds have been returned to your wallet."
      );
    }
  } catch (error) {
    // If the error happened BEFORE the commit, abort the transaction
    if (session.inTransaction()) {
      await session.abortTransaction();
      session.endSession();
    }

    logger.error("submitCryptoWithdrawal error:", error.message);
    const statusCode = error.message.includes("Insufficient") ? 400 : 500;
    return res
      .status(statusCode)
      .json({ success: false, message: error.message });
  }
};

module.exports = {
  getWallet,
  getDashboardBalances,
  getDepositAddress,
  initiateWithdrawal,
  submitPaycrestWithdrawal,
  submitCryptoWithdrawal,
};

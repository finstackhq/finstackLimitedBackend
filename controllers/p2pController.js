const p2pService = require("../services/p2pService");
const blockrader = require("../services/providers/blockrader");
const User = require("../models/userModel");
const MerchantAd = require("../models/merchantModel");

/* Helper function to map service errors to appropriate HTTP status codes.*/
function handleServiceError(res, error) {
  const message = error.message || "Internal server error.";
  let status = 500;
  // Map specific service errors to appropriate HTTP status codes
  if (
    message.includes("required") ||
    message.includes("Unsupported currency") ||
    message.includes("Invalid amount") ||
    message.includes("missing destination address for target currency") ||
    message.includes("account_number")
  ) {
    status = 400; // Bad Request (client error/missing required data)
  } else if (
    message.includes("Trade not found") ||
    message.includes("User not found") ||
    message.includes("Wallet not found")
  ) {
    status = 404; // Not Found
  } else if (
    message.includes("Not authorized") ||
    message.includes("Only the buyer can confirm")
  ) {
    status = 403; // Forbidden (permission/authorization issues)
  } else if (
    message.includes("Trade not in pending state") ||
    message.includes("Cannot cancel a completed trade") ||
    message.includes("failed: Escrow reversal")
  ) {
    status = 409; // Conflict (wrong state for the action)
  }

  console.error(`Controller Error (${status}):`, message);
  return res.status(status).json({ message });
}
/*Creates or retrieves the user's Blockrader USD Wallet. */
const createUsdWallet = async (req, res) => {
  try {
    const userId = req.user.id;
    // 1. Check if wallet already exists
    const existingWallet = await blockrader.getWalletByUserId(userId, "USD");

    if (existingWallet) {
      return res.status(200).json({
        message: "USD Wallet already exists.",
        data: existingWallet,
      });
    }
    // 2. Fetch user details needed for Blockrader metadata
    const user = await User.findById(userId).lean();
    if (!user) {
      return handleServiceError(
        res,
        new Error("User not found for wallet creation."),
      );
    }
    // 3. Create the wallet via Blockrader service
    const newWallet = await blockrader.createUsdWallet({
      userId: user._id,
      email: user.email,
      name: `${user.firstName} ${user.lastName}`,
      currency: "USD",
    });

    res.status(201).json({
      message: "USD Wallet created successfully.",
      data: newWallet,
    });
  } catch (error) {
    handleServiceError(res, error);
  }
};

/**🧩 Controller: Handles HTTP requests for P2P trading actions */
const createTrade = async (req, res) => {
  try {
    const userId = req.user.id;
    const ip = req.ip;

    const { adId } = req.params;
    const { amountSource } = req.body;

    if (!adId || !amountSource) {
      return handleServiceError(
        res,
        new Error("Ad ID and amountSource are required."),
      );
    }

    if (isNaN(amountSource) || amountSource <= 0) {
      return handleServiceError(res, new Error("Invalid amountSource."));
    }

    // Fetch the ad
    const merchantAd = await MerchantAd.findById(adId);
    if (!merchantAd) {
      return res.status(404).json({ success: false, message: "Ad not found." });
    }

    if (merchantAd.status !== "ACTIVE") {
      return res
        .status(400)
        .json({ success: false, message: "Ad is not active." });
    }

    // Prevent user from trading on their own ad
    if (String(merchantAd.userId) === String(userId)) {
      return res
        .status(400)
        .json({ success: false, message: "You cannot trade on your own ad." });
    }

    // Validate limits
    if (
      amountSource < merchantAd.minLimit ||
      amountSource > merchantAd.maxLimit
    ) {
      return res.status(400).json({
        success: false,
        message: `Amount must be between ${merchantAd.minLimit} and ${merchantAd.maxLimit} ${merchantAd.fiat}.`,
      });
    }
    // We pass the document here, but the service uses the ID for the atomic update
    const rate = merchantAd.price;
    const amountTarget = parseFloat((amountSource / rate).toFixed(8));

    const tradeDetails = {
      userId,
      merchantId: merchantAd.userId,
      adId: merchantAd._id,
      amountSource,
      amountTarget,
      rate,
      currencySource: merchantAd.fiat,
      currencyTarget: merchantAd.asset,
      provider: "BLOCKRADAR",
      ip,
      timeLimit: merchantAd.timeLimit, // ✅ Pass timeLimit
    };
    // Initiate the trade using the service layer
    const newTrade = await p2pService.initiateTrade(
      userId,
      merchantAd,
      tradeDetails,
      ip,
    );

    res.status(201).json({
      success: true,
      message: "Trade initiated successfully.",
      data: newTrade,
    });
  } catch (error) {
    handleServiceError(res, error);
  }
};
// 2. Buyer confirms they’ve paid (starts escrow, POST /trade/:reference/confirm-buyer-payment)
const buyerConfirmPayment = async (req, res) => {
  try {
    const buyerId = req.user.id;
    const { reference } = req.params;
    const ip = req.ip;

    if (!reference) {
      return handleServiceError(
        res,
        new Error("Trade reference is required in the URL path."),
      );
    }

    const trade = await p2pService.confirmBuyerPayment(reference, buyerId, ip);

    res.status(200).json({
      message:
        "Buyer payment confirmed, merchant asset moved to escrow (for external trades)",
      data: trade,
    });
  } catch (error) {
    handleServiceError(res, error);
  }
};
// 3a. Seller initiates crypto release (OTP)
const initiateSettlementOTP = async (req, res) => {
  try {
    const requesterId = req.user.id;
    const { reference } = req.params;

    if (!reference) {
      return handleServiceError(res, new Error("Trade reference is required."));
    }

    const result = await p2pService.initiateSettlementOTP(
      reference,
      requesterId,
    );

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    handleServiceError(res, error);
  }
};

const confirmAndReleaseCrypto = async (req, res) => {
  try {
    const requesterId = req.user.id;
    const { reference } = req.params;
    const { otpCode } = req.body;
    const ip = req.ip;

    if (!reference || !otpCode) {
      return res.status(400).json({
        success: false,
        message: "Reference and OTP code are required.",
      });
    }

    // ✅ FIX: Pass as a single OBJECT {} instead of separate arguments
    const trade = await p2pService.confirmAndReleaseCrypto({
      reference: reference,
      confirmerUserId: requesterId,
      otpCode: otpCode,
      ip: ip,
    });

    return res.status(200).json({
      success: true,
      message: "Crypto released successfully.",
      data: trade,
    });
  } catch (error) {
    handleServiceError(res, error);
  }
};
// 4. Cancel trade (DELETE /trade/:reference/cancel)
// controllers/p2pController.js

const cancelTrade = async (req, res) => {
  try {
    const { reference } = req.params;
    const userId = req.user.id;
    const ip = req.ip;

    const result = await p2pService.cancelTrade(reference, userId, ip);

    return res.status(200).json({
      success: true,
      message: "Trade cancelled successfully and funds returned to seller.",
      data: result,
    });
  } catch (error) {
    // This uses your handleServiceError helper from the file you uploaded
    handleServiceError(res, error);
  }
};
// const cancelTrade = async (req, res) => {
//   try {
//     const userId = req.user.id;
//     const { reference } = req.params;
//     const ip = req.ip;

//     if (!reference) {
//       return handleServiceError(res, new Error("Trade reference is required in the URL path."));
//     }

//     const trade = await p2pService.cancelTrade(reference, userId, ip);

//     res.status(200).json({
//       message: `Trade cancelled successfully. Status: ${trade.status}`,
//       data: trade,
//     });
//   } catch (error) {
//     handleServiceError(res, error);
//   }
// }

const merchantMarkPaid = async (req, res) => {
  try {
    const { reference } = req.params;
    const trade = await p2pService.merchantMarksFiatSent(
      reference,
      req.user.id,
      req.ip,
    );
    res
      .status(200)
      .json({ success: true, message: "Merchant marked as paid", data: trade });
  } catch (error) {
    handleServiceError(res, error);
  }
};

const adminResolveTrade = async (req, res) => {
  try {
    const { reference } = req.params;
    const { action } = req.body; // "RELEASE" or "CANCEL"
    const trade = await p2pService.adminResolveTrade(
      reference,
      action,
      req.user.id,
      req.ip,
    );
    res
      .status(200)
      .json({ success: true, message: "Trade resolved by admin", data: trade });
  } catch (error) {
    handleServiceError(res, error);
  }
};

const getAllDisputes = async (req, res) => {
  try {
    // Only admins should access this (logic usually handled in middleware, but good to be safe)
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const data = await p2pService.listDisputes(page, limit);

    res.status(200).json({
      success: true,
      ...data,
    });
  } catch (error) {
    handleServiceError(res, error);
  }
};

const getTradeDetails = async (req, res) => {
  try {
    const { reference } = req.params;

    // 1. Ensure currentUserId is a string for reliable comparison
    const currentUserId = req.user.id.toString();
    const currentUserRole = req.user.role;

    const trade = await p2pService.getTradeByReference(reference);

    if (!trade) {
      return res
        .status(404)
        .json({ success: false, message: "Trade not found." });
    }

    // 2. Extract IDs safely from populated objects
    // Using ?. and .toString() ensures we compare "68fcd..." === "68fcd..."
    const tradeUserId =
      trade.userId?._id?.toString() || trade.userId?.toString();
    const tradeMerchantId =
      trade.merchantId?._id?.toString() || trade.merchantId?.toString();

    const isUser = currentUserId === tradeUserId;
    const isMerchant = currentUserId === tradeMerchantId;
    const isAdmin = currentUserRole === "admin";

    /**
     * 🔐 BANK INFO VISIBILITY RULE:
     * Only the Buyer, Seller, or Admin should see bank details.
     */
    if (!isUser && !isMerchant && !isAdmin) {
      trade.paymentDetails = null;
    }

    // 🔒 Mask emails for privacy
    if (trade.userId?.email) {
      trade.userId.email = maskEmail(trade.userId.email);
    }
    if (trade.merchantId?.email) {
      trade.merchantId.email = maskEmail(trade.merchantId.email);
    }

    return res.status(200).json({
      success: true,
      data: trade,
    });
  } catch (error) {
    handleServiceError(res, error);
  }
};

// Helper
function maskEmail(email) {
  if (!email) return "";
  const [name, domain] = email.split("@");
  return `${name.substring(0, 2)}***@${domain}`;
}

module.exports = {
  createTrade,
  buyerConfirmPayment,
  initiateSettlementOTP,
  confirmAndReleaseCrypto,
  cancelTrade,
  createUsdWallet,
  merchantMarkPaid,
  adminResolveTrade,
  getAllDisputes,
  getTradeDetails,
};

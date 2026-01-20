const MerchantAd = require("../models/merchantModel");
const logger = require("../utilities/logger");
const FeeConfig = require("../models/feeConfigModel");
const Wallet = require("../models/walletModel");
const { getWalletBalance } = require("../services/providers/blockrader");
const { getFlatFee } = require("../services/adminFeeService");
const p2pService = require("../services/p2pService"); // Ensure the path to your service file is correct

// Create a new Merchant Ad
const createMerchantAd = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      type,
      minLimit,
      maxLimit,
      availableAmount,
      paymentMethods,
      timeLimit,
      instructions,
      autoReply,
    } = req.body;

    const asset = req.body.asset?.trim().toUpperCase();
    const fiat = req.body.fiat?.trim().toUpperCase();

    const price = Number(req.body.price); // FIAT PRICE

    // Required fields
    if (
      !type ||
      !asset ||
      !fiat ||
      price === undefined ||
      !minLimit ||
      !maxLimit ||
      !paymentMethods?.length ||
      !timeLimit ||
      !availableAmount
    ) {
      return res
        .status(400)
        .json({ message: "All required fields must be provided." });
    }

    if (isNaN(price) || price <= 0) {
      return res.status(400).json({ message: "Invalid price value." });
    }

    // Enums
    const validTypes = ["BUY", "SELL"];
    const validCryptoAssets = ["USDC", "CNGN"];
    const validFiatCurrencies = ["NGN", "GHS", "XAF", "XOF", "RMB", "USD"];

    if (!validTypes.includes(type))
      return res.status(400).json({ message: "Invalid ad type." });
    // if (!validCryptoAssets.includes(asset)) return res.status(400).json({ message: "Invalid crypto asset." });
    if (!validCryptoAssets.includes(asset)) {
      return res.status(400).json({ message: "Invalid crypto asset." });
    }
    if (!validFiatCurrencies.includes(fiat))
      return res.status(400).json({ message: "Invalid fiat currency." });

    if (!req.user.kycVerified) {
      return res
        .status(403)
        .json({ message: "Merchant must complete KYC verification." });
    }
    // SELL ads require liquidity check
    if (type === "SELL") {
      const merchantWallet = await Wallet.findOne({
        user_id: userId,
        currency: asset,
      });

      if (!merchantWallet || !merchantWallet.externalWalletId) {
        return res
          .status(404)
          .json({ message: `No ${asset} wallet initialized.` });
      }

      const balanceData = await getWalletBalance(
        merchantWallet.externalWalletId,
        asset,
      );

      if (balanceData.available < availableAmount) {
        return res.status(400).json({
          message: `Insufficient balance. Available: ${balanceData.available}, tried to list: ${availableAmount}.`,
        });
      }

      const maxFiatFromLiquidity = price * availableAmount;

      if (maxLimit > maxFiatFromLiquidity) {
        return res.status(400).json({
          message: `Max limit (${maxLimit}) exceeds available liquidity (${maxFiatFromLiquidity}).`,
        });
      }
    }

    // Create ad
    const ad = await MerchantAd.create({
      userId,
      type,
      asset,
      fiat,
      price,
      rawPrice: price,
      // platformFeeCrypto,
      minLimit,
      maxLimit,
      availableAmount,
      paymentMethods,
      timeLimit,
      instructions: instructions || "",
      autoReply: autoReply || "",
      status: "ACTIVE",
    });

    res.status(201).json({
      success: true,
      message: "Ad created successfully",
      data: ad,
    });
  } catch (error) {
    logger.error("Error creating merchant ad:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};
// Get all active ads (public endpoint)
const getAllAds = async (req, res) => {
  try {
    const pageNum = Number(req.query.page) || 1;
    const limitNum = Number(req.query.limit) || 20;

    const filter = { status: "ACTIVE" };

    // 1️⃣ Fetch paginated ads
    const ads = await MerchantAd.find(filter)
      .populate("userId", "firstName lastName email")
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum);

    // 2️⃣ Get total count (FOR PAGINATION)
    const total = await MerchantAd.countDocuments(filter);

    // 3️⃣ Send response
    res.status(200).json({
      success: true,
      data: ads,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    logger.error("Error fetching ads:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching ads",
    });
  }
};
// Get merchant’s own ads
const getMerchantAds = async (req, res) => {
  try {
    const userId = req.user.id;

    const pageNum = Number(req.query.page) || 1;
    const limitNum = Number(req.query.limit) || 20;
    const { status } = req.query;

    // ✅ 1️⃣ DEFINE FILTER FIRST
    const filter = { userId };

    // ✅ 2️⃣ Validate and apply status
    if (
      status &&
      ["ACTIVE", "INACTIVE", "CLOSED"].includes(status.toUpperCase())
    ) {
      filter.status = status.toUpperCase();
    }

    // 3️⃣ Fetch paginated ads
    const ads = await MerchantAd.find(filter)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum);

    // 4️⃣ Count total
    const total = await MerchantAd.countDocuments(filter);

    // 5️⃣ Respond
    res.status(200).json({
      success: true,
      data: ads,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    logger.error("Error fetching merchant ads:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching merchant ads",
    });
  }
};

//Update an Ad
const updateMerchantAd = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const updateFields = req.body;

    const ad = await MerchantAd.findOne({ _id: id, userId });
    if (!ad) {
      return res
        .status(404)
        .json({ message: "Ad not found or unauthorized to update" });
    }

    // Validate min / max
    const newMinLimit =
      updateFields.minLimit !== undefined
        ? Number(updateFields.minLimit)
        : ad.minLimit;

    const newMaxLimit =
      updateFields.maxLimit !== undefined
        ? Number(updateFields.maxLimit)
        : ad.maxLimit;

    if (newMaxLimit < newMinLimit) {
      return res.status(400).json({
        message: "Max limit must be greater than or equal to the min limit.",
      });
    }

    // Price update (FIAT ONLY — NO FEE ADDED)
    if (updateFields.price !== undefined) {
      const newPrice = Number(updateFields.price);
      if (isNaN(newPrice) || newPrice <= 0) {
        return res.status(400).json({ message: "Invalid price value." });
      }
      ad.price = newPrice;
      ad.rawPrice = newPrice;
    }

    // SELL liquidity check
    if (ad.type === "SELL") {
      const effectivePrice = ad.price;
      const effectiveAvailable =
        updateFields.availableAmount ?? ad.availableAmount;
      const effectiveMaxLimit = updateFields.maxLimit ?? ad.maxLimit;

      const maxFiatFromLiquidity = effectivePrice * effectiveAvailable;

      if (effectiveMaxLimit > maxFiatFromLiquidity) {
        return res.status(400).json({
          message: `Max limit (${effectiveMaxLimit}) exceeds available liquidity (${maxFiatFromLiquidity})`,
        });
      }

      // 🔑 Recalculate crypto fee if liquidity changes
      // const feeConfig = await FeeConfig.findOne({ currency: ad.asset });

      // if (!feeConfig) {
      //   return res.status(400).json({
      //     message: `Platform fee not configured for ${ad.asset}`,
      //   });
      // }

      // ad.platformFeeCrypto = Number(
      //   (effectiveAvailable * feeConfig.feeAmount).toFixed(8)
      // );
    }

    // Allowed updates
    const allowedUpdates = [
      "minLimit",
      "maxLimit",
      "paymentMethods",
      "timeLimit",
      "instructions",
      "autoReply",
      "status",
      "availableAmount",
    ];

    let hasUpdates = false;

    for (const key of allowedUpdates) {
      if (updateFields[key] !== undefined) {
        if (
          ["minLimit", "maxLimit", "timeLimit", "availableAmount"].includes(
            key,
          ) &&
          isNaN(updateFields[key])
        ) {
          return res.status(400).json({ message: `${key} must be numeric.` });
        }
        ad[key] = updateFields[key];
        hasUpdates = true;
      }
    }

    if (!hasUpdates && updateFields.price === undefined) {
      return res
        .status(400)
        .json({ message: "No valid fields provided for update." });
    }

    await ad.save();

    res.status(200).json({
      success: true,
      message: "Ad updated successfully",
      data: ad,
    });
  } catch (error) {
    logger.error("Error updating ad:", error);
    res.status(500).json({ success: false, message: "Error updating ad" });
  }
};
// Deactivate an Ad
const deactivateAd = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const ad = await MerchantAd.findOneAndUpdate(
      { _id: id, userId, status: "ACTIVE" },
      { $set: { status: "INACTIVE" } },
      { new: true }, // Returns the updated document
    );

    if (!ad) {
      return res.status(404).json({
        success: false,
        message: "Ad not found, unauthorized, or already inactive",
      });
    }

    res.status(200).json({
      success: true,
      message: "Ad deactivated successfully",
      data: ad,
    });
  } catch (error) {
    logger.error("Error deactivating ad:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};
// Get merchant orders
const getMerchantOrders = async (req, res) => {
  console.log("REQ.USER:", req.user);
  console.log("MERCHANT ID:", req.user?.id);

  try {
    const merchantId = req.user.id;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const { status } = req.query;

    const filter = { merchantId };
    if (status) filter.status = status;

    const result = await p2pService.listTrades(filter, page, limit);

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error("Error getting merchant orders:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// Delete (soft-delete) a Merchant Ad
const deleteMerchantAd = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Fetch ad
    const ad = await MerchantAd.findOne({ _id: id, userId });
    if (!ad) {
      return res.status(404).json({
        success: false,
        message: "Ad not found or you are not authorized to delete it.",
      });
    }

    // Optional: Check if ad has active trades
    const activeTrades = await p2pService.countActiveTradesForAd(id);
    if (activeTrades > 0) {
      return res.status(400).json({
        success: false,
        message:
          "Cannot delete ad. There are active trades associated with this ad.",
      });
    }

    // Soft-delete: mark status as CLOSED
    ad.status = "CLOSED";
    await ad.save();

    res.status(200).json({
      success: true,
      message: "Ad deleted successfully",
      data: ad,
    });
  } catch (error) {
    logger.error("Error deleting merchant ad:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

module.exports = {
  createMerchantAd,
  getAllAds,
  getMerchantAds,
  updateMerchantAd,
  deactivateAd,
  getMerchantOrders,
  deleteMerchantAd,
};

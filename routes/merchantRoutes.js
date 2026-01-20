const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middlewares/validateToken");
const { merchantOnly, allowRoles } = require("../middlewares/auth");
const { walletLimiter } = require("../middlewares/rateLimiter");
const {
  createMerchantAd,
  getAllAds,
  getMerchantAds,
  deactivateAd,
  updateMerchantAd,
  getMerchantOrders,
  deleteMerchantAd,
  getMerchantTradesSummary,
} = require("../controllers/merchantController");

//  PUBLIC ROUTES
// Anyone (no token required) can view all active ads.
router.get("/ads", walletLimiter, getAllAds);
//  MERCHANT ROUTES
router.post("/ads", verifyToken, walletLimiter, merchantOnly, createMerchantAd); // Create ad
router.patch(
  "/ads/:id",
  verifyToken,
  walletLimiter,
  merchantOnly,
  updateMerchantAd,
);
router.get("/my-ads", verifyToken, walletLimiter, merchantOnly, getMerchantAds); // Get merchant’s ads
router.patch(
  "/ads/:id/deactivate",
  verifyToken,
  walletLimiter,
  merchantOnly,
  deactivateAd,
); // Deactivate ad

//  ADMIN OR MERCHANT ROUTES
router.get(
  "/all-ads",
  verifyToken,
  walletLimiter,
  allowRoles("admin", "merchant"),
  getMerchantAds,
);

router.get(
  "/orders",
  verifyToken,
  walletLimiter,
  merchantOnly,
  getMerchantOrders,
);

// Delete ad
router.delete(
  "/ads/:id",
  verifyToken,
  walletLimiter,
  merchantOnly,
  deleteMerchantAd,
);

router.get(
  "/trades-summary",
  verifyToken,
  walletLimiter,
  getMerchantTradesSummary,
);

module.exports = router;

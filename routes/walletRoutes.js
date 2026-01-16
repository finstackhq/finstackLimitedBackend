const {
  getDepositAddress,
  initiateWithdrawal,
  submitPaycrestWithdrawal,
  getDashboardBalances,
  submitCryptoWithdrawal,
  getWallet,
} = require("../controllers/walletController");
const { verifyToken, isAdmin } = require("../middlewares/validateToken");
const {
  walletLimiter,
  transactionLimiter,
} = require("../middlewares/rateLimiter");

const router = require("express").Router();

//GET /api/wallets - fetch all wallets for the logged-in user
router.get("/getWallet", verifyToken, getWallet);

router.get("/deposit", verifyToken, getDepositAddress);
router.get("/wallet/user-balances", verifyToken, getDashboardBalances);
// (PHASE 1: INITIATE WITHDRAWAL/SEND OTP)
// This is the first step, sending the request and receiving the OTP.
router.post(
  "/withdraw/initiate",
  verifyToken,
  transactionLimiter,
  initiateWithdrawal
);
// NEW ROUTE (PHASE 2: VERIFY OTP AND COMPLETE WITHDRAWAL)
// This is the final step, verifying the OTP and executing the external transaction.
router.post(
  "/withdraw/complete",
  verifyToken,
  transactionLimiter,
  submitPaycrestWithdrawal
);
// CRYPTO WITHDRAWAL ROUTE
router.post(
  "/withdraw/cryptoComplete",
  verifyToken,
  transactionLimiter,
  submitCryptoWithdrawal
);

module.exports = router;

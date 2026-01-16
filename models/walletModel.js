// UPDATING ISSUE
const mongoose = require("mongoose");

const walletSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
      // The unique constraint is moved to a compound index below.
      sparse: true,
    },
    // New field to clearly define the purpose of the wallet for auditing and reconciliation.
    walletType: {
      type: String,
      enum: ["USER", "SYSTEM", "ESCROW"],
      default: "USER",
      required: true,
    },

    lastDepositReference: {
      type: String,
      index: true,
      unique: true, // IMPORTANT: Ensure uniqueness to guarantee no double-credit
      sparse: true, // Only apply the unique constraint if the field is present
    },

    balance: { type: Number, default: 0 },
    currency: {
      type: String,
      uppercase: true,
      enum: ["NGN", "CNGN", "USDC"],
      required: true,
    },
    externalWalletId: { type: String, sparse: true }, // Blockradar wallet UUID
    walletAddress: { type: String, sparse: true }, // Blockchain wallet address (e.g., 0x...)
    accountNumber: { type: String, sparse: true },
    accountName: { type: String },
    bankName: { type: String },
    provider: { type: String, enum: ["BLOCKRADAR", "INTERNAL"] }, // Added provider field
    status: { type: String, enum: ["ACTIVE", "FROZEN"], default: "ACTIVE" },
  },
  { timestamps: true }
);

// CRITICAL FIX: Add a compound unique index on user_id and currency.
// This allows one user to have one NGN wallet, one USD wallet, etc., but not two NGN wallets.
walletSchema.index({ user_id: 1, currency: 1 }, { unique: true, sparse: true });

const Wallet = mongoose.model("Wallet", walletSchema);

module.exports = Wallet;

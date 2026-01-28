const mongoose = require("mongoose");

const P2PTradeSchema = new mongoose.Schema(
  {
    // =====================
    // ACTORS
    // =====================
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    merchantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    merchantAdId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MerchantAd",
      required: true,
      index: true,
    },

    // =====================
    // IDENTIFIERS
    // =====================
    reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // =====================
    // TRADE DIRECTION
    // BUY  → User buys crypto
    // SELL → User sells crypto
    // =====================
    side: {
      type: String,
      enum: ["BUY", "SELL"],
      required: true,
      index: true,
    },

    // =====================
    // LOCKED AMOUNTS
    // =====================
    amountFiat: {
      type: Number,
      required: true,
      min: 0,
    },

    amountCrypto: {
      type: Number, // GROSS escrowed
      required: true,
      min: 0,
    },

    platformFeeCrypto: {
      type: Number,
      required: true,
      min: 0,
    },

    netCryptoAmount: {
      type: Number, // Sent at settlement
      required: true,
      min: 0,
    },

    // =====================
    // PRICING SNAPSHOT
    // =====================
    marketRate: {
      type: Number,
      required: true,
    },

    listingRate: {
      type: Number,
      required: true,
    },

    // =====================
    // CURRENCIES
    // =====================
    currencySource: {
      type: String,
      enum: ["NGN", "CNGN", "USDC", "GHS", "XAF", "XOF", "RMB", "USD"],
      required: true,
    },

    currencyTarget: {
      type: String,
      enum: ["USDC", "CNGN", "CNGN"],
      required: true,
    },

    // =====================
    // PROVIDER
    // =====================
    provider: {
      type: String,
      enum: ["BLOCKRADAR"],
      required: true,
    },

    escrowTxId: {
      type: String,
      index: true,
    },
    // =====================
    // STATE MACHINE
    // =====================
    status: {
      type: String,
      enum: [
        "PENDING_PAYMENT",
        "MERCHANT_PAID",
        "DISPUTE_PENDING",
        "PAYMENT_CONFIRMED_BY_BUYER",
        "COMPLETED",
        "CANCELLED",
        "CANCELLED_REVERSED",
        "FAILED",
      ],
      default: "INIT",
      index: true,
    },

    notifications: {
      merchantNotified: {
        type: Boolean,
        default: false,
        index: true,
      },
      buyerPaidNotified: {
        type: Boolean,
        default: false,
        index: true,
      },
      // disputeNotified: {
      //   type: Boolean,
      //   default: false,
      //   index: true,
      // },
    },

    // =====================
    // TIME CONTROL
    // =====================
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },

    paymentDetails: {
      bankName: { type: String },
      accountNumber: { type: String },
      accountName: { type: String },
      bankCode: { type: String },
      country: { type: String, default: "NG" },
    },
    // =====================
    // OPTIONAL METADATA
    // =====================
    metadata: {
      type: Object,
      default: {},
    },

    // =====================
    // AUDIT LOGS
    // =====================
    logs: [
      {
        message: String,
        actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        role: String,
        ip: String,
        time: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

// Helpful compound indexes
P2PTradeSchema.index({ merchantId: 1, status: 1 });
P2PTradeSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model("P2PTrade", P2PTradeSchema);

const mongoose = require("mongoose");

const merchantAdSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["BUY", "SELL"],
      required: true,
      immutable: true,
      index: true,
    },
    asset: {
      type: String,
      required: true,
      immutable: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    fiat: {
      type: String,
      required: true,
      immutable: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0.00000001,
    },

    rawPrice: {
      type: Number,
      required: true,
    },
    platformFeeCrypto: {
      type: Number,
      //   required: true,
      min: 0,
    },

    availableAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    minLimit: {
      type: Number,
      required: true,
      min: 0.00000001,
    },
    maxLimit: {
      type: Number,
      required: true,
      validate: {
        validator: function (v) {
          return v >= this.minLimit;
        },
        message: (props) =>
          `Max limit (${props.value}) must be greater than or equal to the minimum limit.`,
      },
    },
    paymentMethods: [
      {
        type: String,
        required: true,
        trim: true,
      },
    ],
    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE", "CLOSED"],
      default: "ACTIVE",
      index: true,
    },
    // Time Limit. Stored in minutes.
    timeLimit: {
      type: Number,
      required: true,
      min: 1, // Minimum 1 minute
      max: 60 * 24, // Reasonable upper limit, e.g., 24 hours
      default: 30, // A common default
    },

    // Instructions / Terms ("Terms and Conditions")
    instructions: {
      type: String,
      trim: true,
      default: "",
      maxlength: 1000, // Limit for reasonable text length
    },

    // Auto Reply ("Auto-reply message")
    autoReply: {
      type: String,
      trim: true,
      default: "",
      maxlength: 1000, // Limit for reasonable text length
    },
  },
  { timestamps: true },
);

const MerchantAd = mongoose.model("MerchantAd", merchantAdSchema); // Renamed model to MerchantAd for clarity

module.exports = MerchantAd;

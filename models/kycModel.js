const mongoose = require("mongoose");
const { encrypt, decrypt } = require("../utilities/encryptionUtils");

const kycSchema = new mongoose.Schema(
  {
    firstname: { type: String, required: true },
    lastname: { type: String, required: true },
    gender: { type: String, enum: ["MALE", "FEMALE"], required: true },
    dob: { type: Date, required: true },
    bvn: { type: String },
    nin_number: { type: String },
    nin_user_id: { type: String },
    phone_number: { type: String, required: true },
    address: { type: String, required: true },
    state: { type: String, required: true },
    city: { type: String, required: true },
    country: { type: String, required: true },
    id_type: { type: String },
    id_number: { type: String },
    id_expiry: { type: String },
    selfie: { type: String },
    // <--- Liveliness metadata
    liveliness_confidence: { type: Number, default: null }, // percentage (0-100)
    liveliness_status: {
      type: String,
      enum: ["PENDING", "VERIFIED", "FAILED"],
      default: "PENDING",
    },
    liveliness_reference: { type: String, default: null },
    liveliness_raw: { type: Object, default: null },
    proof_address: { type: String },
    proof_id: {
      front: { type: String },
      back: { type: String },
    },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
    },
    rejectionReason: { type: String },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

// 🔒 Auto-encrypt sensitive fields before saving
kycSchema.pre("save", function (next) {
  if (this.isModified("bvn") && this.bvn) this.bvn = encrypt(this.bvn);
  if (this.isModified("nin_number") && this.nin_number)
    this.nin_number = encrypt(this.nin_number);
  if (this.isModified("nin_user_id") && this.nin_user_id)
    this.nin_user_id = encrypt(this.nin_user_id);
  next();
});

// 🔓 Instance methods to decrypt
kycSchema.methods.getDecryptedBVN = function () {
  return this.bvn ? decrypt(this.bvn) : null;
};

kycSchema.methods.getDecryptedNIN = function () {
  return this.nin_number ? decrypt(this.nin_number) : null;
};

kycSchema.methods.getDecryptedNINUserId = function () {
  return this.nin_user_id ? decrypt(this.nin_user_id) : null;
};

// 🧩 Static method – builds full decrypted payload for 9PSB API
// 🚨 FIX: Added `session` as a parameter and used it in findOne.
kycSchema.statics.getVerifiedDataFor9PSB = async function (userId, session) {
  // CRITICAL FIX: Ensure we only pull a record that is APPROVED.
  const record = await this.findOne(
    {
      user_id: userId,
      status: "APPROVED",
    },
    null, // Projection fields (none specified, so we use null)
    { session }, // <- Inject the session context
  ).populate("user_id", "email firstName lastName");

  if (!record) throw new Error("KYC record not found or is not APPROVED."); // Improved error messag
  return {
    firstname: record.firstname,
    lastname: record.lastname,
    gender: record.gender === "MALE" ? 0 : 1, // 9PSB uses 0=Male, 1=Female
    dateOfBirth: record.dob,
    phoneNo: record.phone_number,
    address: record.address,
    email: record.user_id.email,
    bvn: record.getDecryptedBVN(),
    nin: record.getDecryptedNIN(),
    ninUserId: record.getDecryptedNINUserId(),
    country: record.country,
  };
};

module.exports = mongoose.model("Kyc", kycSchema);

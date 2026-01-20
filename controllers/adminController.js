const mongoose = require("mongoose");
const P2PTrade = require("../models/p2pModel");
const User = require("../models/userModel");
const Kyc = require("../models/kycModel");
const Wallet = require("../models/walletModel");
const FeeConfig = require("../models/feeConfigModel");
const Transaction = require("../models/transactionModel");
const Announcement = require("../models/announcementModel");
const announcementQueue = require("../utilities/announcementQueue");
const sanitizeHtml = require("../utilities/sanitizingHtml");
const p2pService = require("../services/p2pService");
const {
  getOrCreateStablecoinAddress,
  createWalletRecord,
  createVirtualAccountIfMissing,
  getTotalTransactionVolume,
  createVirtualAccountForChildAddress,
} = require("../services/providers/blockrader");
const { updatePlatformFee } = require("../services/adminFeeService");

/* =========== ADMIN: Create Announcement and Send Mail =========== */
const createAnnouncementAndSendMail = async (req, res) => {
  const { title, body } = req.body;

  if (!title || !body) {
    return res.status(400).json({
      success: false,
      message: "Title and body are required",
    });
  }

  const cleanBody = sanitizeHtml(body);

  const announcement = await Announcement.create({
    title,
    body: cleanBody,
    createdBy: req.user._id,
  });

  await announcementQueue.add("sendAnnouncement", {
    announcementId: announcement._id,
    title,
    body: cleanBody,
  });

  return res.status(202).json({
    success: true,
    message: "Announcement queued for delivery",
    announcementId: announcement._id,
  });
};
/* ===========  ADMIN: Get All Users   =========== */

// const getAllUsers = async (req, res) => {
//   try {
//     if (req.user.role !== "admin") {
//       return res.status(403).json({
//         success: false,
//         message: "Admin access required",
//       });
//     }

//     const page = parseInt(req.query.page) || 1;
//     const limit = parseInt(req.query.limit) || 20;
//     const skip = (page - 1) * limit;

//     const matchStage = {};
//     if (req.query.role) matchStage.role = req.query.role;
//     if (req.query.isVerified)
//       matchStage.isVerified = req.query.isVerified === "true";

//     const users = await User.aggregate([
//       { $match: matchStage },

//       /* -------------------- KYC JOIN -------------------- */
//       {
//         $lookup: {
//           from: "kycs",
//           localField: "_id",
//           foreignField: "user_id",
//           as: "kyc",
//         },
//       },
//       {
//         $unwind: {
//           path: "$kyc",
//           preserveNullAndEmptyArrays: true,
//         },
//       },

//       /* -------------------- WALLET JOIN -------------------- */
//       {
//         $lookup: {
//           from: "wallets",
//           let: { userId: "$_id" },
//           pipeline: [
//             {
//               $match: {
//                 $expr: {
//                   $and: [
//                     { $eq: ["$user_id", "$$userId"] },
//                     { $eq: ["$walletType", "USER"] },
//                     { $eq: ["$currency", "NGN"] },
//                   ],
//                 },
//               },
//             },
//             {
//               $project: {
//                 balance: 1,
//                 currency: 1,
//                 status: 1,
//               },
//             },
//           ],
//           as: "wallet",
//         },
//       },
//       {
//         $unwind: {
//           path: "$wallet",
//           preserveNullAndEmptyArrays: true,
//         },
//       },

//       /* -------------------- RESPONSE SHAPE -------------------- */
//       {
//         $project: {
//           email: 1,
//           role: 1,
//           createdAt: 1,
//           isVerified: 1,
//           kycVerified: 1,

//           country: "$kyc.country",
//           kycStatus: "$kyc.status",

//           balance: { $ifNull: ["$wallet.balance", 0] },
//           walletStatus: { $ifNull: ["$wallet.status", "NOT_CREATED"] },
//           currency: { $ifNull: ["$wallet.currency", "NGN"] },
//         },
//       },

//       { $sort: { createdAt: -1 } },
//       { $skip: skip },
//       { $limit: limit },
//     ]);

//     const totalUsers = await User.countDocuments(matchStage);

//     res.status(200).json({
//       success: true,
//       message: "Users fetched successfully",
//       page,
//       totalPages: Math.ceil(totalUsers / limit),
//       totalUsers,
//       users,
//     });
//   } catch (error) {
//     console.error("Admin get users error:", error);
//     res.status(500).json({
//       success: false,
//       message: "Internal server error",
//     });
//   }
// };

const getAllUsers = async (req, res) => {
  try {
    // ✅ Admin access check
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Admin access required",
      });
    }

    // ✅ Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // ✅ Filter
    const matchStage = {};
    if (req.query.role) matchStage.role = req.query.role;
    if (req.query.isVerified)
      matchStage.isVerified = req.query.isVerified === "true";

    // ✅ Aggregate users with KYC info
    const users = await User.aggregate([
      { $match: matchStage },

      // KYC join
      {
        $lookup: {
          from: "kycs",
          localField: "_id",
          foreignField: "user_id",
          as: "kyc",
        },
      },
      { $unwind: { path: "$kyc", preserveNullAndEmptyArrays: true } },

      // Projection of basic fields + KYC
      {
        $project: {
          email: 1,
          role: 1,
          name: 1,
          phone: 1,
          createdAt: 1,
          isVerified: 1,
          kycVerified: 1,
          country: "$kyc.country",
          kycStatus: "$kyc.status",
        },
      },

      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
    ]);

    // ✅ Count total users for pagination
    const totalUsers = await User.countDocuments(matchStage);

    // ✅ Fetch live wallet balances in parallel
    const usersWithBalances = await Promise.all(
      users.map(async (user) => {
        const balances = await p2pService.getAllUserWalletBalances(user._id);

        // Sum total balance
        const totalBalance = balances.reduce(
          (acc, w) => acc + (w.balance?.total || 0),
          0,
        );

        return {
          ...user,
          balances, // all wallets
          totalBalance, // optional summary
        };
      }),
    );

    // ✅ Respond
    return res.status(200).json({
      success: true,
      message: "Users fetched successfully",
      page,
      totalPages: Math.ceil(totalUsers / limit),
      totalUsers,
      users: usersWithBalances,
    });
  } catch (error) {
    console.error("Admin get users error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/* =========== ADMIN: Get All Merchants =========== */
const getAllMerchants = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Filter users by role: "merchant"
    const filter = { role: "merchant" };

    const users = await User.find(filter)
      .select("name email phone role createdAt")
      .skip(skip)
      .limit(limit);

    const totalUsers = await User.countDocuments(filter);

    res.status(200).json({
      success: true,
      message: "Merchants fetched successfully",
      page,
      totalPages: Math.ceil(totalUsers / limit),
      totalUsers,
      users,
    });
  } catch (error) {
    console.error("❌ Error fetching merchants:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
// Update User Role (for admin)
const updateUserRole = async (req, res) => {
  try {
    const { userId, role } = req.body;

    // Validate input
    if (!userId || !role) {
      return res.status(400).json({ message: "User ID and role are required" });
    }

    if (!["user", "merchant", "admin"].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    // Find user and update role
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { role },
      { new: true },
    );
    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      message: "User role updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
// --------------------- Admin Updates KYC ---------------------

const adminUpdateKycStatus = async (req, res) => {
  const { id: kycId, status, rejectionReason } = req.body;
  const normalizedStatus = status?.toUpperCase();

  if (!kycId || !mongoose.Types.ObjectId.isValid(kycId)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid or missing KYC ID." });
  }

  try {
    const kycRecord = await Kyc.findById(kycId).populate(
      "user_id",
      "email firstName lastName",
    );
    if (!kycRecord) throw new Error("KYC record not found.");

    if (normalizedStatus === "APPROVED") {
      /* --------------------------------
     STEP 1: BLOCKRADER – Ensure Wallets Exist
  -------------------------------- */

      // 1️⃣ Get or create stablecoin addresses (USDC & CNGN)
      const { externalWalletId, cryptoAddress, accountName } =
        await getOrCreateStablecoinAddress(kycRecord.user_id);

      let ngnVirtualAccount = null;

      // 2️⃣ For Nigerian users, ensure NGN virtual account exists
      if (kycRecord.country?.toLowerCase() === "nigeria") {
        ngnVirtualAccount = await createVirtualAccountIfMissing(
          kycRecord.user_id,
          externalWalletId,
          {
            firstName: kycRecord.user_id.firstName,
            lastName: kycRecord.user_id.lastName,
            email: kycRecord.user_id.email,
            phoneNo: kycRecord.phone_number,
          },
        );

        console.log(
          `[KYC] NGN Virtual Account for user ${kycRecord.user_id._id}:`,
          ngnVirtualAccount,
        );

        // If NGN VA creation failed, warn but continue
        if (ngnVirtualAccount.fromExisting) {
          console.log(
            `[KYC] NGN Virtual Account already exists in DB for user ${kycRecord.user_id._id}`,
          );
        } else {
          console.log(
            `[KYC] NGN Virtual Account successfully created for user ${kycRecord.user_id._id}`,
          );
        }
      }

      /* --------------------------------
     STEP 2: MONGODB TRANSACTION – Save Wallet Records
  -------------------------------- */
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        // USDC Wallet
        await createWalletRecord({
          userId: kycRecord.user_id._id,
          currency: "USDC",
          externalWalletId,
          walletAddress: cryptoAddress,
          accountName: `${accountName} - USDC`,
          session,
        });

        // CNGN Wallet
        await createWalletRecord({
          userId: kycRecord.user_id._id,
          currency: "CNGN",
          externalWalletId,
          walletAddress: cryptoAddress,
          accountName: `${accountName} - CNGN`,
          session,
        });

        // NGN Wallet (only if virtual account was created)
        // if (ngnVirtualAccount && !ngnVirtualAccount.fromExisting) {
        //   await createWalletRecord({
        //     userId: kycRecord.user_id._id,
        //     currency: "NGN",
        //     accountNumber: ngnVirtualAccount.accountNumber,
        //     accountName: ngnVirtualAccount.accountName,
        //     bankName: ngnVirtualAccount.bankName,
        //     session,
        //   });
        // }

        // NGN Wallet (always save/update if virtual account exists)
        if (ngnVirtualAccount) {
          await createWalletRecord({
            userId: kycRecord.user_id._id,
            currency: "NGN",
            accountNumber: ngnVirtualAccount.accountNumber,
            accountName: ngnVirtualAccount.accountName,
            bankName: ngnVirtualAccount.bankName,
            externalWalletId,
            session,
          });
        }

        // ✅ Update KYC status
        kycRecord.status = "APPROVED";
        await kycRecord.save({ session });

        // ✅ Update user KYC flag
        await User.findByIdAndUpdate(
          kycRecord.user_id._id,
          { kycVerified: true },
          { session },
        );

        await session.commitTransaction();
        session.endSession();

        return res.status(200).json({
          success: true,
          message: "KYC approved. Wallets provisioned successfully.",
          data: kycRecord,
        });
      } catch (dbError) {
        await session.abortTransaction();
        session.endSession();
        console.error("❌ DB Transaction Failed:", dbError);
        throw dbError;
      }
    }

    if (normalizedStatus === "REJECTED") {
      if (!rejectionReason?.trim()) {
        throw new Error("rejectionReason is required when rejecting KYC.");
      }

      if (!kycRecord.user_id) {
        throw new Error("Cannot process KYC: associated user not found.");
      }

      kycRecord.status = "REJECTED";
      kycRecord.rejectionReason = rejectionReason;
      await kycRecord.save();

      await User.findByIdAndUpdate(kycRecord.user_id._id, {
        kycVerified: false,
      });

      return res.status(200).json({
        success: true,
        message: "KYC rejected and updated.",
        data: kycRecord,
      });
    }

    throw new Error("Invalid status: must be APPROVED or REJECTED.");
  } catch (error) {
    console.error("❌ KYC Update Failed:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to process KYC update",
      error: error.message,
    });
  }
};

/* ===========  ADMIN: Get All KYC Records   =========== */
const getAllKycRecords = async (req, res) => {
  try {
    const kycRecords = await Kyc.find().populate(
      "user_id",
      "email firstName lastName",
    );
    return res.status(200).json({
      message: "KYC records fetched successfully",
      data: kycRecords,
    });
  } catch (error) {
    console.error("❌ Error fetching KYC records:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};
/* ===========  ADMIN: Get Pending KYC Records   =========== */
const getPendingKycRecords = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const pendingKycs = await Kyc.find({ status: "PENDING" })
      .populate("user_id", "email firstName lastName")
      .sort({ createdAt: 1 }) // Oldest first so they can be processed in order
      .skip(skip)
      .limit(limit);

    const totalPending = await Kyc.countDocuments({ status: "PENDING" });

    return res.status(200).json({
      success: true,
      message: "Pending KYC records fetched successfully",
      pagination: {
        total: totalPending,
        currentPage: page,
        totalPages: Math.ceil(totalPending / limit),
        limit,
      },
      data: pendingKycs,
    });
  } catch (error) {
    console.error("❌ Error fetching pending KYC records:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
/* ==========   USER/ADMIN: Get Single KYC Record  ==========  */
const getSingleKyc = async (req, res) => {
  try {
    const { id } = req.params;
    const { searchByUserId = false } = req.query;
    let kycRecord;

    if (req.user.role === "admin") {
      if (searchByUserId === "true") {
        kycRecord = await Kyc.findOne({ user_id: id }).populate(
          "user_id",
          "email firstName lastName",
        );
      } else {
        kycRecord = await Kyc.findById(id).populate(
          "user_id",
          "email firstName lastName",
        );
      }
    } else {
      kycRecord = await Kyc.findOne({ user_id: req.user._id }).populate(
        "user_id",
        "email firstName lastName",
      );
    }

    if (!kycRecord) {
      return res.status(404).json({ message: "KYC record not found" });
    }

    return res.status(200).json({
      message: "KYC record fetched successfully",
      data: kycRecord,
    });
  } catch (error) {
    console.error("❌ Error fetching single KYC record:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};
// =========== ADMIN: Fetch all transactions
const getAllTransactions = async (req, res) => {
  try {
    const { type, status, userId } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Dynamic filtering
    const filter = {};
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (userId) filter.userId = userId;

    // Fetch and populate related info
    // 🛑 CRITICAL FIX 12: Corrected model name from 'transactionModel' to 'Transaction'
    const transactions = await Transaction.find(filter)
      .populate("userId", "name email")
      .populate("walletId", "accountNumber")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Total count for pagination metadata
    const total = await Transaction.countDocuments(filter);

    res.status(200).json({
      success: true,
      message: "All transactions fetched successfully",
      page,
      totalPages: Math.ceil(total / limit),
      totalTransactions: total,
      count: transactions.length,
      transactions,
    });
  } catch (error) {
    console.error("❌ Error fetching all transactions:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};
/* =========== ADMIN: Get Total Platform Volume =========== */
const getPlatformVolume = async (req, res) => {
  try {
    const supportedAssets = ["USDC", "CNGN"];

    const depositVolume = await getTotalTransactionVolume(
      "DEPOSIT",
      supportedAssets,
    );
    const withdrawVolume = await getTotalTransactionVolume(
      "WITHDRAW",
      supportedAssets,
    );

    // --- Apply FIX 2: Rounding for display precision ---
    const roundedDepositVolume = parseFloat(depositVolume.toFixed(8));
    const roundedWithdrawVolume = parseFloat(withdrawVolume.toFixed(8));
    const roundedTotalVolume = parseFloat(
      (depositVolume + withdrawVolume).toFixed(8),
    );
    // ----------------------------------------------------

    res.status(200).json({
      success: true,
      message: "Platform volume data fetched successfully",
      data: {
        depositVolume: roundedDepositVolume,
        withdrawVolume: roundedWithdrawVolume,
        totalVolume: roundedTotalVolume,
        currencyScope: supportedAssets.join(" & "),
      },
    });
  } catch (error) {
    console.error("❌ Error fetching platform volume:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch platform volume data",
    });
  }
};

const setFee = async (req, res) => {
  try {
    const { type, currency, targetCurrency, feeAmount } = req.body;

    // Debugging: Log this to see if it's actually there
    console.log("Admin ID from request:", req.user?._id || req.user?.id);

    const adminId = req.user?._id || req.user?.id;

    if (!adminId) {
      return res
        .status(401)
        .json({ success: false, message: "Admin ID not found in token" });
    }

    const result = await updatePlatformFee({
      type,
      currency,
      targetCurrency,
      feeAmount,
      adminId, // Passing it to the service
    });

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("Set Fee Error:", error);
    res.status(500).json({ error: error.message });
  }
};
// 🧾 Get all P2P trades (filters + pagination) Example: /api/admin/trades?status=COMPLETED&page=1&limit=10
const getAllTrades = async (req, res) => {
  try {
    let {
      status,
      userId,
      merchantId,
      startDate,
      endDate,
      page = 1,
      limit = 20,
    } = req.query;

    // ✅ SAFELY PARSE & VALIDATE PAGINATION
    page = Number(page);
    limit = Number(limit);

    if (!Number.isInteger(page) || page < 1) page = 1;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) limit = 20;

    // 🔍 BUILD FILTER
    const filter = {};

    if (status) {
      filter.status = status.trim().toUpperCase();
    }

    if (userId) {
      filter.userId = userId;
    }

    if (merchantId) {
      filter.merchantId = merchantId;
    }

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    // 🧮 COUNT TOTAL (FOR PAGINATION)
    const totalTrades = await P2PTrade.countDocuments(filter);

    // 📦 FETCH PAGINATED TRADES
    const trades = await P2PTrade.find(filter)
      .populate("userId", "name email role")
      .populate("merchantId", "name email role")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(); // 🚀 PERFORMANCE BOOST

    return res.status(200).json({
      success: true,
      message: "Trades retrieved successfully",
      pagination: {
        total: totalTrades,
        currentPage: page,
        totalPages: Math.ceil(totalTrades / limit),
        limit,
      },
      data: trades,
    });
  } catch (error) {
    console.error("Error fetching trades:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch trades",
      details: error.message,
    });
  }
};

//  * 🔎 Get detailed trade info with logs (Example: /api/admin/trades/REF_17290238901)*/
const getTradeDetails = async (req, res) => {
  try {
    const { reference } = req.params;
    if (!reference) {
      return res
        .status(400)
        .json({ success: false, error: "Reference is required" });
    }

    const trade = await P2PTrade.findOne({ reference })
      .populate("userId", "name email role")
      .populate("merchantId", "name email role")
      .populate("logs.actor", "name email role");

    if (!trade) {
      return res.status(404).json({ success: false, error: "Trade not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Trade details retrieved successfully",
      data: trade,
    });
  } catch (error) {
    console.error("Error fetching trade details:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch trade details",
      details: error.message,
    });
  }
};

const getFeeSummary = async (req, res) => {
  try {
    const { currency, from, to } = req.query;

    const filter = {};
    if (currency) filter.currency = currency;
    if (from || to) filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);

    const results = await FeeLog.aggregate([
      { $match: filter },
      {
        $group: {
          _id: {
            currency: "$currency",
            type: "$type",
          },
          totalFees: { $sum: "$feeAmount" },
          totalPlatformFees: { $sum: "$platformFee" },
          totalNetworkFees: { $sum: "$networkFee" },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.currency": 1, "_id.type": 1 } },
    ]);

    res.status(200).json({
      success: true,
      message: "Fee summary fetched successfully",
      data: results,
    });
  } catch (error) {
    console.error("❌ Error fetching fee summary:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
// Update P2P FEES
// const updateFlatFee = async (req, res) => {
//   const { currency, flatFee } = req.body;

//   if (!currency || flatFee === undefined) {
//     return res.status(400).json({ message: "Currency and flatFee required" });
//   }

//   if (flatFee < 0) {
//     return res.status(400).json({ message: "Flat fee cannot be negative" });
//   }

//   const existing = await FeeConfig.findOne({ currency });

//   if (existing) {
//     await FeeHistory.create({
//       currency,
//       oldFee: existing.flatFee,
//       newFee: flatFee,
//       updatedBy: req.user.id
//     });

//     existing.flatFee = flatFee;
//     existing.updatedBy = req.user.id;
//     await existing.save();
//   } else {
//     await FeeConfig.create({
//       currency,
//       flatFee,
//       updatedBy: req.user.id
//     });
//   }

//   res.json({ success: true, message: "Flat fee updated successfully" });
// };

// ========== ADMIN: Get Admin Dashboard Stats ========== */
const getAdminDashboardStats = async (req, res) => {
  try {
    // We run these in parallel to save time
    const [totalUsers, suspendedUsers, pendingKyc, walletAggregation] =
      await Promise.all([
        // 1. Total number of users
        User.countDocuments(),

        // 2. Suspended accounts
        User.countDocuments({ status: "suspended" }),

        // 3. KYCs with PENDING status
        Kyc.countDocuments({ status: "PENDING" }),

        // 4. Sum of all balances across all user wallets
        Wallet.aggregate([
          {
            $group: {
              _id: null, // Group all together
              totalBalance: { $sum: "$balance" },
            },
          },
        ]),
      ]);

    res.status(200).json({
      success: true,
      data: {
        totalUsers,
        suspendedUsers,
        pendingKyc,
        totalPlatformBalance: walletAggregation[0]?.totalBalance || 0,
      },
    });
  } catch (error) {
    console.error("Dashboard Stats Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard statistics",
    });
  }
};

module.exports = {
  createAnnouncementAndSendMail,
  getAllUsers,
  getAllMerchants,
  updateUserRole,
  adminUpdateKycStatus,
  getAllKycRecords,
  getSingleKyc,
  getPendingKycRecords,
  getPlatformVolume,
  getAllTransactions,
  setFee,
  getAllTrades,
  getTradeDetails,
  getFeeSummary,
  getAdminDashboardStats,
};

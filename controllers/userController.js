const UserBankAccount = require("../models/userBankAccountModel");
const User = require("../models/userModel");
const Kyc = require("../models/kycModel");
const Wallet = require("../models/walletModel");

// const getAllUsers = async (req, res) => {
//   try {
//     // 1. Admin Authorization Guard
//     if (req.user.role !== "admin") {
//       return res
//         .status(403)
//         .json({ success: false, message: "Admin access required" });
//     }

//     // 2. Pagination Logic
//     const page = parseInt(req.query.page) || 1;
//     const limit = parseInt(req.query.limit) || 20;
//     const skip = (page - 1) * limit;

//     // 3. Search/Filter (Optional but useful)
//     const { role, isVerified } = req.query;
//     const filter = {};
//     if (role) filter.role = role;
//     if (isVerified) filter.isVerified = isVerified === "true";

//     // 4. Parallel Execution for Speed
//     const [users, total] = await Promise.all([
//       User.find(filter)
//         .select("-password -refreshToken -verificationCode -resetPasswordToken") // 🛡️ Security: Exclude sensitive fields
//         .sort({ createdAt: -1 })
//         .skip(skip)
//         .limit(limit)
//         .lean(),
//       User.countDocuments(filter),
//     ]);

//     res.status(200).json({
//       success: true,
//       data: users,
//       pagination: {
//         totalUsers: total,
//         currentPage: page,
//         totalPages: Math.ceil(total / limit),
//         pageSize: limit,
//       },
//     });
//   } catch (error) {
//     console.error("Error fetching users:", error);
//     res.status(500).json({ success: false, message: "Internal server error" });
//   }
// };

// Get current logged-in user's details

const getAllUsers = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Admin access required",
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const matchStage = {};
    if (req.query.role) matchStage.role = req.query.role;
    if (req.query.isVerified)
      matchStage.isVerified = req.query.isVerified === "true";

    const users = await User.aggregate([
      { $match: matchStage },

      /* -------------------- KYC JOIN -------------------- */
      {
        $lookup: {
          from: "kycs",
          localField: "_id",
          foreignField: "user_id",
          as: "kyc",
        },
      },
      {
        $unwind: {
          path: "$kyc",
          preserveNullAndEmptyArrays: true,
        },
      },

      /* -------------------- WALLET JOIN -------------------- */
      {
        $lookup: {
          from: "wallets",
          let: { userId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$user_id", "$$userId"] },
                    { $eq: ["$walletType", "USER"] },
                    { $eq: ["$currency", "NGN"] },
                  ],
                },
              },
            },
            {
              $project: {
                balance: 1,
                currency: 1,
                status: 1,
              },
            },
          ],
          as: "wallet",
        },
      },
      {
        $unwind: {
          path: "$wallet",
          preserveNullAndEmptyArrays: true,
        },
      },

      /* -------------------- RESPONSE SHAPE -------------------- */
      {
        $project: {
          password: 0,
          refreshToken: 0,
          verificationCode: 0,
          resetPasswordToken: 0,

          email: 1,
          role: 1,
          createdAt: 1,
          isVerified: 1,
          kycVerified: 1,

          country: "$kyc.country",
          kycStatus: "$kyc.status",

          balance: { $ifNull: ["$wallet.balance", 0] },
          walletStatus: "$wallet.status",
          currency: "$wallet.currency",
        },
      },

      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
    ]);

    const totalUsers = await User.countDocuments(matchStage);

    res.status(200).json({
      success: true,
      message: "Users fetched successfully",
      page,
      totalPages: Math.ceil(totalUsers / limit),
      totalUsers,
      users,
    });
  } catch (error) {
    console.error("Admin get users error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

const getMe = async (req, res) => {
  try {
    // req.user.id comes from your verifyToken middleware
    const user = await User.findById(req.user.id).select(
      "-password -refreshToken",
    );

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
// Update current logged-in user's information
const updateMe = async (req, res) => {
  try {
    const userId = req.user.id;

    // Define which fields are allowed to be updated
    const { firstName, lastName, phoneNumber } = req.body;

    // Construct update object
    const updateData = {};
    if (firstName) updateData.firstName = firstName;
    if (lastName) updateData.lastName = lastName;
    if (phoneNumber) updateData.phoneNumber = phoneNumber;

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: true },
    ).select("-password -refreshToken");

    if (!updatedUser) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: updatedUser,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
// Add a new bank account and set it as primary
const addUserBank = async (req, res) => {
  try {
    const { bankName, accountNumber, accountName, bankCode } = req.body;
    const userId = req.user.id;

    // 1. Set all existing accounts for this user to isPrimary: false
    await UserBankAccount.updateMany({ userId }, { isPrimary: false });

    // 2. Create the new account as the Primary one
    const newBank = await UserBankAccount.create({
      userId,
      bankName,
      accountNumber,
      accountName,
      bankCode,
      isPrimary: true,
    });

    res.status(201).json({
      success: true,
      message: "Bank account added and set as primary.",
      data: newBank,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getMyBankAccounts = async (req, res) => {
  try {
    const userId = req.user.id;

    const bankAccounts = await UserBankAccount.find({
      userId,
      deletedAt: null,
    })
      .sort({ isPrimary: -1, createdAt: -1 })
      .select("-__v")
      .lean();

    res.status(200).json({
      success: true,
      data: bankAccounts,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  addUserBank,
  getAllUsers,
  getMe,
  updateMe,
  getMyBankAccounts,
};

const axios = require("axios");
const Wallet = require("../../models/walletModel");

// --- Environment Config ---
const BLOCKRADER_API_KEY = process.env.BLOCKRADER_API_KEY;
const BLOCKRADER_BASE_URL = process.env.BLOCKRADER_BASE_URL;

const BLOCKRADER_MASTER_WALLET_UUID = process.env.COMPANY_ESCROW_ACCOUNT_ID;
const BLOCKRADER_USD_ASSET_ID = process.env.BLOCKRADER_USD_ASSET_ID;
const BLOCKRADER_CNGN_ASSET_ID = process.env.BLOCKRADER_CNGN_ASSET_ID;
const ESCROW_DESTINATION_ADDRESS = process.env.MASTER_WALLET_ADDRESS; // Exported for use in p2pService

// --- Headers (Define once) ---
const headers = {
  // Use the x-api-key header for Blockrader authentication
  "x-api-key": BLOCKRADER_API_KEY,
  "Content-Type": "application/json",
};

// -----------------------------
// 🧩 Utility: Centralized Error Logger
// -----------------------------
function logBlockraderError(context, error) {
  if (error.response) {
    // Attempt to log specific message from the response data if available
    const apiMessage = error.response.data?.message;
    console.error(
      `[Blockrader] ${context} failed with status: ${
        error.response.status
      }. API Message: ${apiMessage || "No specific message"}`
    );
  } else {
    console.error(`[Blockrader] ${context} failed:`, error.message);
  }
}
// -----------------------------
// 🆕 NEW HELPER: Get Asset ID by Currency
// -----------------------------
function getAssetId(currency) {
  // Note: 'cNGN' and 'USDC' are used internally by p2pService
  switch (currency.toUpperCase()) {
    case "USDC":
      return BLOCKRADER_USD_ASSET_ID;
    case "CNGN":
      return BLOCKRADER_CNGN_ASSET_ID;
    default:
      console.error(
        `Unsupported stablecoin asset ID requested for currency: ${currency}`
      );
      throw new Error(
        `Unsupported stablecoin currency for escrow: ${currency}`
      );
  }
}

// -----------------------------
// 💰 NEW HELPER: Create Wallet DB Record
async function createWalletRecord({
  userId,
  currency,
  externalWalletId,
  accountNumber,
  accountName,
  bankName,
  session,
  walletAddress,
}) {
  const filter = { user_id: userId, currency };
  const setOnInsert = {
    user_id: userId,
    currency,
    externalWalletId: externalWalletId || null,
    walletAddress: walletAddress || null,
    accountNumber: accountNumber || null, // <-- match schema
    accountName: accountName || null, // <-- match schema
    bankName: bankName || null,
    provider: "BLOCKRADAR",
    status: "ACTIVE",
  };

  try {
    // atomic-ish: creates once or leaves existing

    await Wallet.updateOne(
      filter,
      { $setOnInsert: setOnInsert },
      { upsert: true, session, timestamps: false }
    );

    // return the current wallet (existing or newly created)
    const wallet = await Wallet.findOne(filter).session(session);
    return wallet;
  } catch (err) {
    // If duplicate key slipped through, treat as success and return existing wallet
    if (err && err.code === 11000) {
      return await Wallet.findOne(filter).session(session);
    }
    throw err; // bubble other errors
  }
}

// async function getOrCreateStablecoinAddress(user) {
//        const existing = await Wallet.findOne({ user_id: user._id, currency: "USDC" });

// if (existing) {
// return {
// fromExisting: true,
// cryptoAddress: existing.cryptoAddress,
// externalWalletId: existing.externalWalletId
// };
// }

// // 🔄 Call original unchanged low-level function
// const newAddress = await createStablecoinAddress({
// userId: user._id,
// email: user.email,
// name: user.firstName
// });

// // 🆕 Prevent duplicates using upsert
// await Wallet.updateOne(
// { user_id: user._id, currency: "USDC" },
// {
// $setOnInsert: {
// cryptoAddress: newAddress.cryptoAddress,
// externalWalletId: newAddress.externalWalletId,
// balance: 0,
// // network: "Polygon"
// }
// },
// { upsert: true }
// );

// return { ...newAddress, fromExisting: false };
// }
async function createVirtualAccountIfMissing(user, childAddressId, kycData) {
  const existing = await Wallet.findOne({
    user_id: user._id,
    currency: "NGN",
  });

  if (existing) {
    return { fromExisting: true, ...existing.toObject() };
  }

  // Only call Blockrader here
  const virtualAccount = await createVirtualAccountForChildAddress(
    childAddressId,
    kycData
  );

  return { fromExisting: false, ...virtualAccount };
}

async function getOrCreateStablecoinAddress(user) {
  const existing = await Wallet.findOne({
    user_id: user._id,
    currency: "USDC",
  });

  if (existing) {
    return {
      fromExisting: true,
      externalWalletId: existing.externalWalletId,
      cryptoAddress: existing.walletAddress,
      accountName: existing.account_name,
    };
  }

  return {
    fromExisting: false,
    ...(await createStablecoinAddress({
      userId: user._id,
      email: user.email,
      name: user.firstName,
    })),
  };
}

// 🚀 REFACTORED: CREATE BLOCKRADER ADDRESS (Replaces createUsdWallet)
async function createStablecoinAddress({ userId, email, name }) {
  try {
    if (!BLOCKRADER_MASTER_WALLET_UUID) {
      throw new Error(
        "FATAL: Master Wallet UUID (COMPANY_ESCROW_ACCOUNT_ID) is missing or undefined."
      );
    }

    const response = await axios.post(
      `${BLOCKRADER_BASE_URL}/wallets/${BLOCKRADER_MASTER_WALLET_UUID}/addresses`,
      {
        disableAutoSweep: true,
        metadata: { userId, email },
        name: `${name}'s Escrow Address`,
      },
      { headers }
    );

    // ✅ CRITICAL FIX: Extract the actual data payload from the nested 'data' field
    const responseData = response.data.data;

    if (!responseData || !responseData.id || !responseData.address) {
      throw new Error(
        "Invalid response from Blockrader API: Missing address ID or crypto address in data payload."
      );
    }

    console.log(
      `[Blockrader] New Address created under Master Wallet for ${email}. ID: ${responseData.id}`
    );

    // 💡 CHANGE: DO NOT create a Wallet record here. Just return the Blockrader address details.
    return {
      externalWalletId: responseData.id, // Blockrader Address ID (UUID)
      cryptoAddress: responseData.address, // The Crypto Address (0x...)
      accountName: `${name}'s Escrow Address`,
    };
  } catch (error) {
    logBlockraderError("Create Stablecoin Address", error);
    throw new Error(
      `Unable to create user address on Blockrader: ${error.message}`
    );
  }
}

// 🏦 CREATE VIRTUAL ACCOUNT (linked to Child Address)
// async function createVirtualAccountForChildAddress(childAddressId, kycData) {
//   const context = "Create Virtual Account (CNGN Deposit) for Child Address";

//   try {
//     const response = await axios.post(
//       `${BLOCKRADER_BASE_URL}/wallets/${BLOCKRADER_MASTER_WALLET_UUID}/addresses/${childAddressId}/virtual-accounts`,
//       {
//         firstname: kycData.firstName,
//         lastname: kycData.lastName,
//         email: kycData.email,
//         phone: kycData.phoneNo,
//       },
//       { headers }
//     );

//     const data = response.data.data;

//     return {
//       accountName: data.accountName,
//       accountNumber: data.accountNumber,
//       bankName: data.bankName,
//       customerId: data.customer.id,
//       platformWalletId: data.wallet.id,
//     };
//   } catch (error) {
//     const message = error.response?.data?.message;

//     // ✅ THIS IS THE FIX
//     if (
//       error.response?.status === 400 &&
//       message?.toLowerCase().includes("already exists")
//     ) {
//       console.warn(
//         "[Blockrader] Virtual account already exists — treating as success"
//       );

//       // 🔁 Fetch existing virtual account
//       const existing = await axios.get(
//         `${BLOCKRADER_BASE_URL}/wallets/${BLOCKRADER_MASTER_WALLET_UUID}/addresses/${childAddressId}/virtual-accounts`,
//         { headers }
//       );

//       const data = existing.data?.data?.[0];
//       if (!data) {
//         throw new Error("Virtual account exists but could not be retrieved");
//       }

//       return {
//         accountName: data.accountName,
//         accountNumber: data.accountNumber,
//         bankName: data.bankName,
//         customerId: data.customer?.id,
//         platformWalletId: data.wallet?.id,
//       };
//     }

//     // ❌ real error
//     throw new Error(
//       "Failed to create user's CNGN deposit account: " +
//         (message || error.message)
//     );
//   }
// }
// 🏦 CREATE VIRTUAL ACCOUNT (linked to Child Address)
async function createVirtualAccountForChildAddress(childAddressId, kycData) {
  const context = "Create Virtual Account (CNGN Deposit) for Child Address";

  try {
    const response = await axios.post(
      `${BLOCKRADER_BASE_URL}/wallets/${BLOCKRADER_MASTER_WALLET_UUID}/addresses/${childAddressId}/virtual-accounts`,
      {
        firstname: kycData.firstName,
        lastname: kycData.lastName,
        email: kycData.email,
        phone: kycData.phoneNo,
      },
      { headers }
    );

    const data = response.data.data;

    return {
      accountName: data.accountName,
      accountNumber: data.accountNumber,
      bankName: data.bankName,
      customerId: data.customer.id,
      platformWalletId: data.wallet.id,
    };
  } catch (error) {
    const message = error.response?.data?.message || "";

    // ✅ THIS IS THE FIX: Handle "already exists" safely
    if (
      error.response?.status === 400 &&
      message.toLowerCase().includes("already exists")
    ) {
      console.warn(
        "[Blockrader] Virtual account already exists — skipping creation"
      );

      // ⚠️ DO NOT try to fetch the existing account — just return a flag
      return { alreadyExists: true };
    }

    // ❌ Any other error is real
    throw new Error(
      "Failed to create user's CNGN deposit account: " +
        (message || error.message)
    );
  }
}

// async function createVirtualAccountIfMissing(user, childAddressId, kycData) {
//   // 1. Check if NGN virtual account already exists
//   const existing = await Wallet.findOne({ user_id: user._id, currency: "NGN" });

//   if (existing) {
//     return { fromExisting: true, ...existing.toObject() };
//   }

//   // 2. Create a new Virtual Account (this calls Blockrader)
//   const virtualAccount = await createVirtualAccountForChildAddress(
//     childAddressId, // MUST be Blockrader Address UUID
//     kycData // must contain: firstName, lastName, email, phoneNo
//   );

//   // 3. Save NGN Bank Account in Wallet collection (idempotent)
//   await Wallet.updateOne(
//     { user_id: user._id, currency: "NGN" },
//     {
//       $setOnInsert: {
//         externalWalletId: childAddressId,
//         account_number: virtualAccount.accountNumber,
//         account_name: virtualAccount.accountName,
//         bankName: virtualAccount.bankName,
//         balance: 0,
//         provider: "BLOCKRADAR",
//         status: "ACTIVE",
//       },
//     },
//     { upsert: true, timestamps: false }
//   );

//   return { fromExisting: false, ...virtualAccount };

// }

// 💰 NEW HELPER: Get Single Wallet Balance
// In your blockrader.js file

// 💰 NEW HELPER: Get Single Wallet Balance

async function createVirtualAccountIfMissing(user, childAddressId, kycData) {
  const existing = await Wallet.findOne({ user_id: user._id, currency: "NGN" });

  if (existing) {
    return { fromExisting: true, ...existing.toObject() };
  }

  // Attempt to create new virtual account
  const virtualAccount = await createVirtualAccountForChildAddress(
    childAddressId,
    kycData
  );

  // If it already exists, just mark as fromExisting (DB record may already exist)
  if (virtualAccount.alreadyExists) {
    return { fromExisting: true };
  }

  // Otherwise, save in MongoDB
  await Wallet.updateOne(
    { user_id: user._id, currency: "NGN" },
    {
      $setOnInsert: {
        externalWalletId: childAddressId,
        account_number: virtualAccount.accountNumber,
        account_name: virtualAccount.accountName,
        bankName: virtualAccount.bankName,
        balance: 0,
        provider: "BLOCKRADAR",
        status: "ACTIVE",
      },
    },
    { upsert: true, timestamps: false }
  );

  return { fromExisting: false, ...virtualAccount };
}

async function getWalletBalance(externalWalletId, currency) {
  const URL = `${BLOCKRADER_BASE_URL}/wallets/${BLOCKRADER_MASTER_WALLET_UUID}/addresses/${externalWalletId}/balances`;

  try {
    const response = await axios.get(URL, { headers });

    // All balances for this user address
    const balancesArray = response.data?.data || [];

    const targetBalance = balancesArray.find(
      (b) =>
        b.asset?.asset?.symbol?.toLowerCase() === currency.toLowerCase() &&
        b.asset.isActive === true
    );
    // ------------------

    // No balance found → Return zero balance object
    if (!targetBalance) {
      return {
        available: 0,
        locked: 0,
        total: 0,
        currency: currency.toUpperCase(),
      };
    }

    const balance = parseFloat(targetBalance.balance || "0");

    return {
      available: balance,
      locked: 0,
      total: balance,
      currency: currency.toUpperCase(),
    };
  } catch (error) {
    console.error("\n🚨 Blockradar Balance Error");
    console.error("URL:", URL);
    console.error("Status:", error.response?.status);
    console.error("Message:", error.response?.data || error.message);
    console.error("-------------------------------------");

    // Use the actual error message from Blockrader when available
    const status = error.response?.status;
    if (status === 404) {
      throw new Error(
        "Unable to fetch wallet balance: Master or Address ID not found on Blockradar."
      );
    }
    throw new Error("Unable to fetch wallet balance: API call failed.");
  }
}

// 🧾 Get User Address ID (Now returns the Address UUID)
async function getUserAddressId(userId) {
  const wallet = await Wallet.findOne({ user_id: userId, currency: "USD" }); // Add currency filter if needed

  if (!wallet) {
    // This addresses Error 1: Wallet not found
    throw new Error(
      `Wallet document not found for user ${userId} and currency USD.`
    );
  }
  if (!wallet.account_number) {
    // This addresses Error 1 and 3: The 0x address is missing from the DB record
    throw new Error(
      `Wallet found for user ${userId}, but the required 'account_number' (crypto address) is missing.`
    );
  } // We return the Address UUID (stored as externalWalletId)

  return {
    addressId: wallet.externalWalletId,
    cryptoAddress: wallet.account_number,
  };
}

// 💸 Get Transfer Fee (Using a placeholder for internal transfers)
async function getTransferFee(asset = "USD") {
  try {
    const { data } = await axios.get(
      `${BLOCKRADER_BASE_URL}/fees?asset=${asset}`,
      { headers }
    );
    return data;
  } catch (error) {
    logBlockraderError("Get Transfer Fee", error);
    throw new Error("Failed to fetch transfer fee from Blockrader.");
  }
}

// ⬆️ CORE FUNDING FUNCTION: Fund Child Wallet (Master -> Child)
async function fundChildWallet(
  destinationCryptoAddress,
  amount,
  currency,
  p2pReference = null
) {
  try {
    console.log(
      `[Blockrader] Attempting internal funding of ${amount} ${currency} from Master Wallet → Child Crypto Address ${destinationCryptoAddress}`
    ); // CRITICAL: Ensure Master UUID is present
    if (!BLOCKRADER_MASTER_WALLET_UUID) {
      throw new Error(
        "FATAL: Master Wallet UUID (COMPANY_ESCROW_ACCOUNT_ID) is missing or undefined."
      );
    } // Using the documented Master Wallet Withdrawal endpoint for Master -> Child funding

    const url = `${BLOCKRADER_BASE_URL}/wallets/${BLOCKRADER_MASTER_WALLET_UUID}/withdraw`;
    console.log(`[Blockrader] Target API URL: ${url}`); // Use the P2P reference if provided, otherwise fall back to a generic one
    const reference = p2pReference || `Master-Fund-${Date.now()}`;
    const assetId = getAssetId(currency); // Step 2: Perform the withdrawal from Master
    const { data } = await axios.post(
      url,
      {
        assetId: assetId, // The child wallet's crypto address (0x...) goes in the 'address' field
        address: destinationCryptoAddress,
        amount: amount.toString(), // ✅ FIX 1: Use the P2P reference for reconciliation
        reference: reference,
      },
      { headers }
    );
    const txId = data.data?.id || data.id;
    console.log(
      "[Blockrader] Child Wallet funding successful. Transaction ID:",
      txId
    );
    return data;
  } catch (error) {
    logBlockraderError("Fund Child Wallet (Master -> Child)", error);
    throw new Error(
      "Funding transfer failed at provider level. Check Master balance and destination address."
    );
  }
}

// -----------------------------
// 🔁 P2P Function Wrapper: Handles Escrow and Settlement transfers
// -----------------------------
/**
 * P2P Wrapper: Transfers funds between two internal addresses (one of which is always the Master Wallet).
 * Routes the transfer to the correct Blockrader API endpoint based on source/destination.
 *
 * @param {string} sourceAddressId - The internal Address ID (UUID) or BLOCKRADER_MASTER_WALLET_UUID.
 * @param {string} destinationAddressId - The internal Address ID (UUID) or BLOCKRADER_MASTER_WALLET_UUID.
 * @param {number} amount - Amount to transfer.
 * @param {string} currency - The currency symbol (e.g., 'USD').
 * @param {string} destinationCryptoAddress - The recipient's 0x... address (account_number) for the API body.
 * @param {string} [p2pReference] - The P2P trade reference to use for reconciliation. (NEW PARAMETER)
 * @returns {Promise<Object>} Transfer result data.
 */
async function transferFunds(
  sourceAddressId,
  destinationAddressId,
  amount,
  currency,
  destinationCryptoAddress,
  p2pReference = null
) {
  const assetId = getAssetId(currency);

  if (sourceAddressId === BLOCKRADER_MASTER_WALLET_UUID) {
    // --- Flow 1: Master -> Child (Settlement/Reversal) ---
    // This is Master Wallet (source UUID) -> User Child Address (destination crypto address).
    console.log(
      `[Blockrader] P2P Router: Executing Master Wallet -> Child Address settlement/reversal.`
    ); // Pass the p2pReference down to fundChildWallet
    return fundChildWallet(
      destinationCryptoAddress,
      amount,
      currency,
      p2pReference
    );
  } else if (destinationAddressId === BLOCKRADER_MASTER_WALLET_UUID) {
    // --- Flow 2: Child -> Master (Escrow) ---
    // This is User Child Address (source UUID) -> Master Wallet (destination crypto address).
    console.log(
      `[Blockrader] P2P Router: Executing Child Address -> Master Wallet escrow.`
    ); // The P2P reference is preferred, falling back to a unique escrow ID

    const reference = p2pReference || `ESCROW-${sourceAddressId}-${Date.now()}`; // Use the source address ID (child address UUID) for the withdraw endpoint
    const url = `${BLOCKRADER_BASE_URL}/wallets/${BLOCKRADER_MASTER_WALLET_UUID}/addresses/${sourceAddressId}/withdraw`;

    try {
      const { data } = await axios.post(
        url,
        {
          assetId: assetId,
          address: destinationCryptoAddress, // Should be ESCROW_DESTINATION_ADDRESS
          amount: amount.toString(),
          requestId: reference, // Use reference as idempotency key // ✅ FIX 2: Add the P2P reference for webhook reconciliation
          reference: reference,
        },
        { headers }
      );

      console.log(
        "[Blockrader] Escrow to Master successful. Transaction ID:",
        data.transferId || data.id
      );
      return data;
    } catch (error) {
      logBlockraderError("Escrow to Master (Child -> Master)", error);
      throw new Error(
        "Escrow transfer failed at provider level. Check user balance and API configuration."
      );
    }
  } else {
    throw new Error(
      "Unsupported P2P transfer flow: Transfer must involve the Master Escrow Wallet."
    );
  }
}

// -----------------------------
// 💵 Withdraw from Blockrader (Child -> External Withdrawal)
// -----------------------------
/**
 * Withdraws funds from an internal address (sourceAddressId) to an external 0x... address.
 * @param {string} sourceAddressId - The internal Address ID (UUID) to withdraw from.
 * @param {string} toCryptoAddress - The external 0x... crypto address.
 * @param {number} amount - Amount to transfer.
 * @param {string} currency - The currency symbol (e.g., 'USDC', 'CNGN').
 * @param {string} idempotencyKey - Unique key for safety.
 * @param {string} [p2pReference] - Optional P2P trade reference.
 */
async function withdrawFromBlockrader(
  sourceAddressId,
  toCryptoAddress,
  amount,
  currency,
  idempotencyKey,
  p2pReference = null
) {
  if (!idempotencyKey) {
    throw new Error(
      "External withdrawal requires a unique idempotencyKey for safety."
    );
  }

  try {
    console.log(
      `[Blockrader] Attempting external withdrawal of  ${amount} ${currency} from child ID ${sourceAddressId} to external ${toCryptoAddress}`
    );

    // This endpoint uses the correct documented format: /wallets/{masterId}/addresses/{sourceId}/withdraw
    const url = `${BLOCKRADER_BASE_URL}/wallets/${BLOCKRADER_MASTER_WALLET_UUID}/addresses/${sourceAddressId}/withdraw`;
    const assetId = getAssetId(currency);
    const { data } = await axios.post(
      url,
      {
        assetId: assetId,
        address: toCryptoAddress,
        amount: amount.toString(),
        requestId: idempotencyKey,
        reference: p2pReference || idempotencyKey,
      },
      { headers }
    );

    console.log("[Blockrader] External Withdrawal successful:", data);
    return data;
  } catch (error) {
    logBlockraderError("External Withdrawal (Child -> External)", error);
    throw new Error("External withdrawal failed at provider level.");
  }
}

// -----------------------------
// 📈 NEW CORE FUNCTION: Get Total Transaction Volume (Handles Pagination)
// -----------------------------
/**
 * Recursively fetches all successful transactions from the Master Wallet
 * and calculates the total volume, filtered by assets and transaction type.
 * @param {('DEPOSIT'|'WITHDRAW')} type - The transaction type.
 * @param {string[]} assets - Array of asset symbols (e.g., ['USDC', 'CNGN']).
 * @param {number} [page=1] - Current page number for recursion (default 1).
 * @param {number} [limit=100] - Number of items per page.
 * @param {number} [totalVolume=0] - Running total volume for recursion.
 * @returns {Promise<number>} The total successful transaction volume.
 */
async function getTotalTransactionVolume(
  type,
  assets,
  page = 1,
  limit = 100,
  totalVolume = 0
) {
  const context = `Get Total Volume (Type: ${type}, Assets: ${assets.join(
    ", "
  )})`;
  if (!BLOCKRADER_MASTER_WALLET_UUID) {
    throw new Error(
      "FATAL: Master Wallet UUID is missing for volume calculation."
    );
  }

  // The assets query parameter expects a comma-separated string
  const assetsString = assets.join(", ");

  // Blockrader transactions endpoint for the Master Escrow Wallet
  const url = `${BLOCKRADER_BASE_URL}/wallets/${BLOCKRADER_MASTER_WALLET_UUID}/transactions`;

  try {
    const response = await axios.get(url, {
      headers,
      params: {
        status: "SUCCESS",
        type: type,
        assets: assetsString,
        page: page,
        limit: limit, // Fetch up to 100 per page to reduce calls
      },
    });

    // 1. Sum transactions on the current page
    const transactions = response.data?.data || [];
    const currentPageVolume = transactions.reduce((sum, tx) => {
      // Amount is a string, convert to float for summation
      return sum + parseFloat(tx.amount || "0");
    }, 0);

    const currentTotal = totalVolume + currentPageVolume;

    // 2. Check for pagination info
    const totalPages = response.data?.analytics?.totalPages || 1;

    if (page < totalPages) {
      // Recursively fetch the next page
      return getTotalTransactionVolume(
        type,
        assets,
        page + 1,
        limit,
        currentTotal
      );
    }

    // 3. Return the final accumulated volume
    return currentTotal;
  } catch (error) {
    logBlockraderError(context, error);
    throw new Error(
      `Failed to fetch total transaction volume from Blockrader: ${error.message}`
    );
  }
}

module.exports = {
  createWalletRecord,
  getOrCreateStablecoinAddress,
  createStablecoinAddress,
  createVirtualAccountForChildAddress,
  createVirtualAccountIfMissing,
  getTotalTransactionVolume,
  getUserAddressId,
  fundChildWallet,
  transferFunds,
  getAssetId,
  getTransferFee,
  getWalletBalance,
  withdrawExternal: withdrawFromBlockrader,
  BLOCKRADER_MASTER_WALLET_UUID,
  ESCROW_DESTINATION_ADDRESS,
  BLOCKRADER_CNGN_ASSET_ID,
};

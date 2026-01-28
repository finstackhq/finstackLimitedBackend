const axios = require("axios");

const fetchPaycrestRate = async ({ token, amount, currency, network }) => {
  // Ensure network is lowercase as per docs
  const normalizedNetwork = network.toLowerCase();

  const url = `${process.env.PAYCREST_BASE_URL}/rates/${token}/${amount}/${currency}?network=${normalizedNetwork}`;

  console.log(`[Paycrest] Fetching rate from: ${url}`);

  try {
    const { data } = await axios.get(url, {
      headers: {
        "API-Key": process.env.PAYCREST_API_KEY,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });

    if (!data?.data) {
      throw new Error("Failed to fetch Paycrest rate: No data in response");
    }

    return typeof data.data === "object" ? data.data : { rate: data.data };
  } catch (error) {
    if (error.response?.status === 404) {
      throw new Error(
        `Paycrest: No provider found for ${token} to ${currency} on ${normalizedNetwork} for amount ${amount}`,
      );
    }
    throw error;
  }
};

module.exports = fetchPaycrestRate;

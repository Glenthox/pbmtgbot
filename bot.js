require("dotenv").config()
const TelegramBot = require("node-telegram-bot-api")
const axios = require("axios")
const crypto = require("crypto")
const express = require("express")
const bodyParser = require("body-parser")

// Configuration
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY
const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY
const FOSTER_API_KEY = process.env.FOSTER_API_KEY
const FOSTER_BASE_URL = "https://agent.jaybartservices.com/api/v1"

// Firebase Realtime Database config
const FIREBASE_URL = "https://crudapp-c51d3-default-rtdb.asia-southeast1.firebasedatabase.app/"

// Firebase helpers
async function firebaseSet(path, data) {
  return axios.put(`${FIREBASE_URL}${path}.json`, data)
}

async function firebaseUpdate(path, data) {
  return axios.patch(`${FIREBASE_URL}${path}.json`, data)
}

async function firebaseGet(path) {
  const res = await axios.get(`${FIREBASE_URL}${path}.json`)
  return res.data
}

// Save user profile
async function saveUserProfile(user) {
  const profile = {
    username: user.username || "unknown",
    first_name: user.first_name || "",
    last_name: user.last_name || "",
    wallet: 0,
    created_at: new Date().toISOString(),
  }
  await firebaseSet(`users/${user.id}/profile`, profile)
}

// Get user profile
async function getUserProfile(userId) {
  try {
    const profile = await firebaseGet(`users/${userId}/profile`)
    return profile || { wallet: 0, username: "unknown", first_name: "", last_name: "" }
  } catch (error) {
    console.error("Error getting user profile:", error)
    return { wallet: 0, username: "unknown", first_name: "", last_name: "" }
  }
}

// Update wallet balance
async function updateWallet(userId, amount) {
  const profile = await getUserProfile(userId)
  const newBalance = (profile?.wallet || 0) + amount
  await firebaseUpdate(`users/${userId}/profile`, { wallet: newBalance })
  return newBalance
}

// Deduct from wallet
async function deductFromWallet(userId, amount) {
  const profile = await getUserProfile(userId)
  const currentBalance = profile?.wallet || 0

  if (currentBalance < amount) {
    throw new Error("Insufficient wallet balance")
  }

  const newBalance = currentBalance - amount
  await firebaseUpdate(`users/${userId}/profile`, { wallet: newBalance })
  return newBalance
}

// Save order
async function saveOrder(userId, orderId, orderData) {
  await firebaseSet(`users/${userId}/orders/${orderId}`, orderData)
}

// Save transaction
async function saveTransaction(userId, txnId, txnData) {
  await firebaseSet(`users/${userId}/transactions/${txnId}`, txnData)
}

// Express server for webhook
const app = express()
app.use(bodyParser.json())

const PORT = process.env.PORT || 3000
const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://pbmtgbot.onrender.com"

// Initialize bot with webhook
const bot = new TelegramBot(BOT_TOKEN, { webHook: true })

// Start Express server first, then set webhook
app.listen(PORT, async () => {
  console.log(`🚀 Express server running on port ${PORT}`)
  try {
    await bot.setWebHook(`${WEBHOOK_URL}/bot${BOT_TOKEN}`)
    console.log(`✅ Telegram webhook set to: ${WEBHOOK_URL}/bot${BOT_TOKEN}`)
  } catch (err) {
    console.error("❌ Failed to set Telegram webhook:", err.message)
  }
})

// Health check endpoint for Render
app.get("/health", (req, res) => {
  res.status(200).send("OK")
})

// Telegram webhook endpoint
app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body)
  res.status(200).send("OK")
})

app.post("/paystack/webhook", async (req, res) => {
  try {
    const hash = crypto.createHmac("sha512", PAYSTACK_SECRET_KEY).update(JSON.stringify(req.body)).digest("hex")

    if (hash === req.headers["x-paystack-signature"]) {
      const event = req.body

      if (event.event === "charge.success") {
        const { reference, amount, metadata } = event.data

        if (metadata && metadata.type === "wallet_deposit") {
          const userId = metadata.chatId
          const depositAmount = amount / 100 // Convert from kobo to cedis

          // Credit user wallet
          await updateWallet(userId, depositAmount)

          // Update transaction status
          await firebaseUpdate(`users/${userId}/transactions/${reference}`, {
            status: "success",
            updated_at: new Date().toISOString(),
          })

          // Send success message to user
          const successMessage = `✅ *WALLET DEPOSIT SUCCESSFUL*

Amount: ₵${depositAmount.toFixed(2)}
Reference: ${reference}
Status: COMPLETED

Your wallet has been credited successfully!`

          try {
            await bot.sendMessage(userId, successMessage, { parse_mode: "Markdown" })
          } catch (botError) {
            console.error("Failed to send deposit success message:", botError)
          }
        }
      }
    }

    res.status(200).send("OK")
  } catch (error) {
    console.error("Webhook error:", error)
    res.status(500).send("Error")
  }
})

// Cache for API packages
const cachedPackages = null
const lastFetchTime = 0
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

// User sessions storage
const userSessions = new Map()

// Foster Console API helper functions
async function makeAPIRequest(endpoint, method = "GET", data = null) {
  try {
    const config = {
      method,
      url: `${FOSTER_BASE_URL}${endpoint}`,
      headers: {
        "x-api-key": FOSTER_API_KEY,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      timeout: 15000,
    }

    if (data) {
      config.data = data
    }

    const response = await axios(config)
    return response.data
  } catch (error) {
    console.error(`API Error for ${endpoint}:`, error.response?.data || error.message)
    throw error
  }
}

async function purchaseDataBundle(phoneNumber, networkId, volume) {
  try {
    const purchaseData = {
      recipient_msisdn: phoneNumber,
      network_id: networkId,
      shared_bundle: Number.parseInt(volume),
    }

    const result = await makeAPIRequest("/buy-other-package", "POST", purchaseData)
    return result
  } catch (error) {
    console.error("Purchase failed:", error)
    throw error
  }
}

function validatePhoneNumber(phone) {
  const phoneRegex = /^(\+233|233|0)?[235][0-9]\d{7}$/
  return phoneRegex.test(phone.replace(/\s+/g, ""))
}

function formatPhoneNumber(phone) {
  const cleaned = phone
    .replace(/\s+/g, "")
    .replace(/^\+?233/, "")
    .replace(/^0/, "")
  return `0${cleaned}`
}

function generateReference() {
  return "DATA_" + crypto.randomBytes(8).toString("hex").toUpperCase()
}

function generateDepositReference() {
  return "DEP_" + crypto.randomBytes(8).toString("hex").toUpperCase()
}

// Hardcoded data packages
const DATA_PACKAGES = {
  mtn: {
    name: "MTN Ghana",
    packages: [
      { id: 1, volumeGB: "1", priceGHS: 4.8, volume: "1000", network_id: 3, network: "MTN" },
      { id: 2, volumeGB: "2", priceGHS: 9.2, volume: "2000", network_id: 3, network: "MTN" },
      { id: 3, volumeGB: "3", priceGHS: 13.5, volume: "3000", network_id: 3, network: "MTN" },
      { id: 4, volumeGB: "4", priceGHS: 17.8, volume: "4000", network_id: 3, network: "MTN" },
      { id: 5, volumeGB: "5", priceGHS: 22.0, volume: "5000", network_id: 3, network: "MTN" },
      { id: 6, volumeGB: "6", priceGHS: 25.5, volume: "6000", network_id: 3, network: "MTN" },
      { id: 7, volumeGB: "8", priceGHS: 33.5, volume: "8000", network_id: 3, network: "MTN" },
      { id: 8, volumeGB: "10", priceGHS: 41.5, volume: "10000", network_id: 3, network: "MTN" },
      { id: 9, volumeGB: "15", priceGHS: 59.0, volume: "15000", network_id: 3, network: "MTN" },
      { id: 10, volumeGB: "20", priceGHS: 76.0, volume: "20000", network_id: 3, network: "MTN" },
      { id: 11, volumeGB: "25", priceGHS: 94.0, volume: "25000", network_id: 3, network: "MTN" },
      { id: 12, volumeGB: "30", priceGHS: 112.0, volume: "30000", network_id: 3, network: "MTN" },
      { id: 13, volumeGB: "40", priceGHS: 148.0, volume: "40000", network_id: 3, network: "MTN" },
      { id: 14, volumeGB: "50", priceGHS: 185.0, volume: "50000", network_id: 3, network: "MTN" },
      { id: 15, volumeGB: "100", priceGHS: 370.0, volume: "100000", network_id: 3, network: "MTN" },
    ],
  },
  airteltigo: {
    name: "AirtelTigo Ghana",
    packages: [
      { id: 16, volumeGB: "1", priceGHS: 4.5, volume: "1000", network_id: 1, network: "AirtelTigo" },
      { id: 17, volumeGB: "2", priceGHS: 8.8, volume: "2000", network_id: 1, network: "AirtelTigo" },
      { id: 18, volumeGB: "3", priceGHS: 13.0, volume: "3000", network_id: 1, network: "AirtelTigo" },
      { id: 19, volumeGB: "4", priceGHS: 17.2, volume: "4000", network_id: 1, network: "AirtelTigo" },
      { id: 20, volumeGB: "5", priceGHS: 21.5, volume: "5000", network_id: 1, network: "AirtelTigo" },
      { id: 21, volumeGB: "6", priceGHS: 25.0, volume: "6000", network_id: 1, network: "AirtelTigo" },
      { id: 22, volumeGB: "7", priceGHS: 28.5, volume: "7000", network_id: 1, network: "AirtelTigo" },
      { id: 23, volumeGB: "8", priceGHS: 32.0, volume: "8000", network_id: 1, network: "AirtelTigo" },
      { id: 24, volumeGB: "9", priceGHS: 35.5, volume: "9000", network_id: 1, network: "AirtelTigo" },
      { id: 25, volumeGB: "10", priceGHS: 39.0, volume: "10000", network_id: 1, network: "AirtelTigo" },
      { id: 26, volumeGB: "12", priceGHS: 46.5, volume: "12000", network_id: 1, network: "AirtelTigo" },
      { id: 27, volumeGB: "15", priceGHS: 59.0, volume: "15000", network_id: 1, network: "AirtelTigo" },
      { id: 28, volumeGB: "20", priceGHS: 74.0, volume: "20000", network_id: 1, network: "AirtelTigo" },
      { id: 29, volumeGB: "25", priceGHS: 92.5, volume: "25000", network_id: 1, network: "AirtelTigo" },
      { id: 30, volumeGB: "30", priceGHS: 111.0, volume: "30000", network_id: 1, network: "AirtelTigo" },
      { id: 31, volumeGB: "40", priceGHS: 148.0, volume: "40000", network_id: 1, network: "AirtelTigo" },
      { id: 32, volumeGB: "50", priceGHS: 185.0, volume: "50000", network_id: 1, network: "AirtelTigo" },
      { id: 33, volumeGB: "100", priceGHS: 370.0, volume: "100000", network_id: 1, network: "AirtelTigo" },
    ],
  },
  telecel: {
    name: "Telecel Ghana",
    packages: [
      { id: 34, volumeGB: "10", priceGHS: 42.0, volume: "10000", network_id: 2, network: "Telecel" },
      { id: 35, volumeGB: "15", priceGHS: 63.0, volume: "15000", network_id: 2, network: "Telecel" },
      { id: 36, volumeGB: "20", priceGHS: 84.0, volume: "20000", network_id: 2, network: "Telecel" },
      { id: 37, volumeGB: "25", priceGHS: 105.0, volume: "25000", network_id: 2, network: "Telecel" },
      { id: 38, volumeGB: "30", priceGHS: 126.0, volume: "30000", network_id: 2, network: "Telecel" },
      { id: 39, volumeGB: "40", priceGHS: 168.0, volume: "40000", network_id: 2, network: "Telecel" },
      { id: 40, volumeGB: "50", priceGHS: 210.0, volume: "50000", network_id: 2, network: "Telecel" },
      { id: 41, volumeGB: "100", priceGHS: 420.0, volume: "100000", network_id: 2, network: "Telecel" },
    ],
  },
}

function getDataPackages() {
  return DATA_PACKAGES
}

// Bot command handlers
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id
  const user = msg.from

  // Save user profile when they start the bot
  try {
    await saveUserProfile(user)
  } catch (error) {
    console.error("Error saving user profile:", error)
  }

  const welcomeMessage = `*WELCOME TO PBM HUB GHANA*

THE FASTEST AND MOST SECURE WAY TO BUY DATA BUNDLES IN GHANA.

FEATURES:
💰 WALLET SYSTEM
📱 MTN, TELECEL, AND AIRTELTIGO PACKAGES
🔒 SECURE PAYMENTS
⚡ FASTER DELIVERY
🕐 24/7 SERVICE
💎 BEST RATES

SELECT YOUR NETWORK TO BEGIN.`
  const keyboard = {
    inline_keyboard: [
      [
        { text: "MTN", callback_data: "network_mtn" },
        { text: "TELECEL", callback_data: "network_telecel" },
      ],
      [
        { text: "AIRTELTIGO", callback_data: "network_airteltigo" },
        { text: "📋 MY ORDERS", callback_data: "my_orders" },
      ],
      [
        { text: "💰 WALLET", callback_data: "wallet_menu" },
        { text: "👤 ACCOUNT", callback_data: "account_info" },
      ],
      [
        { text: "HELP", callback_data: "help" },
        { text: "SUPPORT", callback_data: "support" },
      ],
      [{ text: "EXIT", callback_data: "exit" }],
    ],
  }
  bot.sendMessage(chatId, welcomeMessage, {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  })
})

// Network selection handler
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id
  const messageId = query.message.message_id
  const data = query.data

  try {
    if (data.startsWith("network_")) {
      const network = data.replace("network_", "")
      await handleNetworkSelection(chatId, messageId, network)
    } else if (data.startsWith("package_")) {
      const packageId = data.replace("package_", "")
      await handlePackageSelection(chatId, messageId, packageId)
    } else if (data === "back_to_networks") {
      await showNetworkSelection(chatId, messageId)
    } else if (data === "help") {
      await showHelp(chatId, messageId)
    } else if (data === "support") {
      await showSupport(chatId, messageId)
    } else if (data.startsWith("confirm_")) {
      const reference = data.split("_")[1]
      await handlePaymentConfirmation(chatId, messageId, reference)
    } else if (data === "my_orders") {
      await showMyOrders(chatId, messageId)
    } else if (data.startsWith("show_more_orders")) {
      await showMoreOrders(chatId, messageId)
    } else if (data === "wallet_menu") {
      await showWalletMenu(chatId, messageId)
    } else if (data === "deposit_wallet") {
      await initiateWalletDeposit(chatId, messageId)
    } else if (data === "account_info") {
      await showAccountInfo(chatId, messageId)
    } else if (data.startsWith("pay_with_")) {
      const method = data.replace("pay_with_", "")
      await handlePaymentMethodSelection(chatId, messageId, method)
    } else if (data === "back_to_main") {
      await showMainMenu(chatId, messageId)
    }

    try {
      await bot.answerCallbackQuery(query.id)
    } catch (answerError) {
      console.error("Failed to answer callback query:", answerError)
    }
  } catch (error) {
    console.error("Callback query error:", error)
    try {
      await bot.answerCallbackQuery(query.id, { text: "❌ An error occurred. Please try again." })
    } catch (answerError) {
      console.error("Failed to answer callback query with error:", answerError)
    }
  }
})

async function showNetworkSelection(chatId, messageId) {
  const welcomeMessage = `*WELCOME TO PBM HUB GHANA*

THE FASTEST AND MOST SECURE WAY TO BUY DATA BUNDLES IN GHANA.

FEATURES:
💰 WALLET SYSTEM
📱 MTN, TELECEL, AND AIRTELTIGO PACKAGES
🔒 SECURE PAYMENTS
⚡ FASTER DELIVERY
🕐 24/7 SERVICE
💎 BEST RATES

SELECT YOUR NETWORK TO BEGIN.`
  const keyboard = {
    inline_keyboard: [
      [
        { text: "MTN", callback_data: "network_mtn" },
        { text: "TELECEL", callback_data: "network_telecel" },
      ],
      [
        { text: "AIRTELTIGO", callback_data: "network_airteltigo" },
        { text: "📋 MY ORDERS", callback_data: "my_orders" },
      ],
      [
        { text: "💰 WALLET", callback_data: "wallet_menu" },
        { text: "👤 ACCOUNT", callback_data: "account_info" },
      ],
      [
        { text: "HELP", callback_data: "help" },
        { text: "SUPPORT", callback_data: "support" },
      ],
      [{ text: "EXIT", callback_data: "exit" }],
    ],
  }

  try {
    await bot.editMessageText(welcomeMessage, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
      reply_markup: keyboard,
    })
  } catch (error) {
    console.error("Error showing main menu:", error)
    await bot.sendMessage(chatId, welcomeMessage, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    })
  }
}

async function showHelp(chatId, messageId) {
  const helpMessage = `*❓ HELP*

Here are some common commands:
/start - Start the bot
/my_orders - View your order history
/wallet_menu - Manage your wallet balance
/account_info - View your account information

If you have any questions or need assistance, please contact support.`

  const keyboard = {
    inline_keyboard: [
      [
        { text: "🏠 MAIN MENU", callback_data: "back_to_main" },
        { text: "🎧 SUPPORT", callback_data: "support" },
      ],
    ],
  }

  try {
    await bot.editMessageText(helpMessage, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
      reply_markup: keyboard,
    })
  } catch (error) {
    console.error("Error showing help:", error)
    await bot.sendMessage(chatId, helpMessage, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    })
  }
}

async function showSupport(chatId, messageId) {
  const supportMessage = `*🎧 SUPPORT*

For any issues or questions, please contact our support team:
Email: support@pbmhubghana.com
Phone: +233 24 123 4567

We're here to help!`

  const keyboard = {
    inline_keyboard: [[{ text: "🏠 MAIN MENU", callback_data: "back_to_main" }]],
  }

  try {
    await bot.editMessageText(supportMessage, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
      reply_markup: keyboard,
    })
  } catch (error) {
    console.error("Error showing support:", error)
    await bot.sendMessage(chatId, supportMessage, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    })
  }
}

async function handleNetworkSelection(chatId, messageId, network) {
  try {
    const dataPackages = getDataPackages()
    const packages = dataPackages[network]
    if (!packages || packages.packages.length === 0) {
      const errorMessage = "NO PACKAGES AVAILABLE FOR THIS NETWORK. PLEASE TRY AGAIN LATER."
      await bot.editMessageText(errorMessage, {
        chat_id: chatId,
        message_id: messageId,
      })
      return
    }
    const message = `*${packages.name.toUpperCase()} DATA PACKAGES*

SELECT YOUR PREFERRED BUNDLE PACKAGE:`
    const packageButtons = []
    for (let i = 0; i < packages.packages.length; i += 3) {
      packageButtons.push(
        packages.packages.slice(i, i + 3).map((pkg) => ({
          text: `${pkg.volumeGB}GB | ₵${pkg.priceGHS.toFixed(2)}`.toUpperCase(),
          callback_data: `package_${pkg.id}`,
        })),
      )
    }
    const keyboard = {
      inline_keyboard: [
        ...packageButtons,
        [
          { text: "BACK", callback_data: "back_to_networks" },
          { text: "HELP", callback_data: "help" },
        ],
      ],
    }
    await bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
      reply_markup: keyboard,
    })
  } catch (error) {
    console.error("Network selection error:", error)
    await bot.sendMessage(chatId, "❌ An error occurred. Please try /start to begin again.")
  }
}

async function handlePackageSelection(chatId, messageId, packageId) {
  try {
    const dataPackages = getDataPackages()
    let selectedPackage = null
    let networkName = ""
    for (const [network, data] of Object.entries(dataPackages)) {
      const pkg = data.packages.find((p) => p.id === Number.parseInt(packageId))
      if (pkg) {
        selectedPackage = pkg
        networkName = data.name
        break
      }
    }

    if (!selectedPackage) {
      await bot.sendMessage(chatId, "❌ Package not found. Please try again.")
      return
    }

    userSessions.set(chatId, {
      ...userSessions.get(chatId),
      selectedPackage: {
        id: selectedPackage.id,
        volumeGB: selectedPackage.volumeGB,
        priceGHS: selectedPackage.priceGHS,
        volume: selectedPackage.volume,
        network_id: selectedPackage.network_id,
        network: selectedPackage.network,
        networkName: networkName,
      },
      step: "phone_input",
    })

    const message = `📦 *PACKAGE SELECTED*

🌐 *NETWORK:* ${networkName.toUpperCase()}
📊 *PACKAGE:* ${selectedPackage.volumeGB}GB | ₵${selectedPackage.priceGHS.toFixed(2)}

📱 *ENTER YOUR GHANA PHONE NUMBER (E.G. 0241234567 OR +233241234567):*`

    const keyboard = {
      inline_keyboard: [
        [{ text: "🔙 BACK TO PACKAGES", callback_data: `network_${selectedPackage.network.toLowerCase()}` }],
        [{ text: "🏠 MAIN MENU", callback_data: "back_to_networks" }],
      ],
    }

    await bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
      reply_markup: keyboard,
    })
  } catch (error) {
    console.error("Package selection error:", error)
    await bot.sendMessage(chatId, "❌ An error occurred. Please try /start to begin again.")
  }
}

async function showWalletMenu(chatId, messageId) {
  try {
    const profile = await getUserProfile(chatId)
    const walletBalance = profile.wallet || 0

    const walletMessage = `*💰 WALLET MENU*

💳 *Current Balance:* ₵${walletBalance.toFixed(2)}

Choose an option:`

    const keyboard = {
      inline_keyboard: [
        [{ text: "💰 Deposit Money", callback_data: "deposit_wallet" }],
        [{ text: "📊 Check Balance", callback_data: "wallet_menu" }],
        [{ text: "📋 Transaction History", callback_data: "wallet_history" }],
        [
          { text: "🔙 Back to Menu", callback_data: "back_to_networks" },
          { text: "🎧 Support", callback_data: "support" },
        ],
      ],
    }

    await bot.editMessageText(walletMessage, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
      reply_markup: keyboard,
    })
  } catch (error) {
    console.error("Wallet menu error:", error)
    await bot.sendMessage(chatId, "❌ An error occurred. Please try /start to begin again.")
  }
}

async function showAccountInfo(chatId, messageId) {
  try {
    const profile = await getUserProfile(chatId)
    const orders = await getLastOrders(chatId, 5)
    const totalSpent = orders.reduce((sum, order) => sum + (order.amount || 0), 0)

    const accountMessage = `*👤 ACCOUNT INFORMATION*

Name: ${profile.first_name} ${profile.last_name || ""}
Username: @${profile.username}
Wallet Balance: ₵${(profile.wallet || 0).toFixed(2)}
Total Orders: ${orders.length}
Total Spent: ₵${totalSpent.toFixed(2)}
Member Since: ${new Date(profile.created_at || Date.now()).toLocaleDateString()}

Account Status: ✅ Active`

    const keyboard = {
      inline_keyboard: [
        [
          { text: "💰 WALLET", callback_data: "wallet_menu" },
          { text: "📋 MY ORDERS", callback_data: "my_orders" },
        ],
        [{ text: "🏠 MAIN MENU", callback_data: "back_to_main" }],
      ],
    }

    await bot.editMessageText(accountMessage, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
      reply_markup: keyboard,
    })
  } catch (error) {
    console.error("Error showing account info:", error)
    await bot.sendMessage(chatId, "❌ Error loading account info. Please try again.")
  }
}

async function initiateWalletDeposit(chatId, messageId) {
  userSessions.set(chatId, {
    step: "deposit_amount",
  })

  const depositMessage = `*💳 WALLET DEPOSIT*

Enter the amount you want to deposit (minimum ₵5.00):

Example: 10 or 25.50`

  await bot.editMessageText(depositMessage, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "Markdown",
  })
}

async function getLastOrders(userId, limit = 5) {
  try {
    const orders = await firebaseGet(`users/${userId}/orders`)
    if (!orders) return []

    // Convert orders object to array with order IDs
    const ordersArray = Object.entries(orders).map(([orderId, orderData]) => ({
      id: orderId,
      ...orderData,
    }))

    // Sort by timestamp (newest first) and limit to specified number
    return ordersArray.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, limit)
  } catch (error) {
    console.error("Error fetching orders:", error)
    return []
  }
}

async function showMyOrders(chatId, messageId) {
  try {
    // Show loading message first
    await bot.editMessageText("🔍 Loading your order history...", {
      chat_id: chatId,
      message_id: messageId,
    })

    const orders = await getLastOrders(chatId, 5)
    const allOrders = await getLastOrders(chatId, 50) // Get more for count

    if (orders.length === 0) {
      const noOrdersMessage = `*📋 MY ORDERS*

❌ NO ORDERS FOUND

You haven't made any purchases yet.
Start by selecting a network to buy your first data bundle!`

      const keyboard = {
        inline_keyboard: [
          [
            { text: "🔄 BUY DATA", callback_data: "back_to_networks" },
            { text: "🏠 MAIN MENU", callback_data: "back_to_main" },
          ],
        ],
      }

      await bot.editMessageText(noOrdersMessage, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "Markdown",
        reply_markup: keyboard,
      })
      return
    }

    // Format orders for display
    let ordersMessage = `*📋 MY ORDERS (SHOWING ${orders.length} OF ${allOrders.length})*\n\n`

    orders.forEach((order, index) => {
      const orderDate = new Date(order.timestamp).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })

      const statusEmoji = order.status === "success" ? "✅" : order.status === "pending" ? "⏳" : "❌"

      ordersMessage += `${index + 1}. ${statusEmoji} *${order.bundle}* - ₵${order.amount}\n`
      ordersMessage += `   📅 ${orderDate}\n`
      ordersMessage += `   📱 ${order.phone_number || "N/A"}\n`
      ordersMessage += `   💳 ${order.payment_method.toUpperCase()}\n`
      ordersMessage += `   📊 ${order.status.toUpperCase()}\n\n`
    })

    ordersMessage += `💡 *TIP:* Your successful orders show data bundles that were delivered to your phone.`

    const keyboard = {
      inline_keyboard: [
        ...(allOrders.length > 5 ? [[{ text: "📄 SHOW MORE", callback_data: "show_more_orders" }]] : []),
        [
          { text: "🔄 BUY MORE DATA", callback_data: "back_to_networks" },
          { text: "🏠 MAIN MENU", callback_data: "back_to_main" },
        ],
        [{ text: "🎧 SUPPORT", callback_data: "support" }],
      ],
    }

    await bot.editMessageText(ordersMessage, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
      reply_markup: keyboard,
    })
  } catch (error) {
    console.error("Error showing orders:", error)

    const errorMessage = `❌ *ERROR LOADING ORDERS*

Unable to fetch your order history at the moment.
Please try again later or contact support if the problem persists.`

    const keyboard = {
      inline_keyboard: [
        [
          { text: "🔄 TRY AGAIN", callback_data: "my_orders" },
          { text: "🏠 MAIN MENU", callback_data: "back_to_main" },
        ],
        [{ text: "🎧 SUPPORT", callback_data: "support" }],
      ],
    }

    try {
      await bot.editMessageText(errorMessage, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "Markdown",
        reply_markup: keyboard,
      })
    } catch (editError) {
      console.error("Failed to edit message with error:", editError)
      await bot.sendMessage(chatId, errorMessage, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      })
    }
  }
}

async function showMoreOrders(chatId, messageId) {
  try {
    await bot.editMessageText("🔍 Loading more orders...", {
      chat_id: chatId,
      message_id: messageId,
    })

    const orders = await getLastOrders(chatId, 20) // Show up to 20 orders

    let ordersMessage = `*📋 ALL MY ORDERS (${orders.length} TOTAL)*\n\n`

    orders.forEach((order, index) => {
      const orderDate = new Date(order.timestamp).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })

      const statusEmoji = order.status === "success" ? "✅" : order.status === "pending" ? "⏳" : "❌"

      ordersMessage += `${index + 1}. ${statusEmoji} *${order.bundle}* - ₵${order.amount}\n`
      ordersMessage += `   📅 ${orderDate}\n`
      ordersMessage += `   📱 ${order.phone_number || "N/A"}\n`
      ordersMessage += `   💳 ${order.payment_method.toUpperCase()}\n`
      ordersMessage += `   📊 ${order.status.toUpperCase()}\n\n`
    })

    const keyboard = {
      inline_keyboard: [
        [
          { text: "🔄 BUY MORE DATA", callback_data: "back_to_networks" },
          { text: "🏠 MAIN MENU", callback_data: "back_to_main" },
        ],
        [{ text: "🎧 SUPPORT", callback_data: "support" }],
      ],
    }

    await bot.editMessageText(ordersMessage, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
      reply_markup: keyboard,
    })
  } catch (error) {
    console.error("Error showing more orders:", error)
    await bot.sendMessage(chatId, "❌ Error loading orders. Please try again.")
  }
}

async function showMainMenu(chatId, messageId) {
  const welcomeMessage = `*WELCOME TO PBM HUB GHANA*

THE FASTEST AND MOST SECURE WAY TO BUY DATA BUNDLES IN GHANA.

FEATURES:
💰 WALLET SYSTEM
📱 MTN, TELECEL, AND AIRTELTIGO PACKAGES
🔒 SECURE PAYMENTS
⚡ FASTER DELIVERY
🕐 24/7 SERVICE
💎 BEST RATES

SELECT YOUR NETWORK TO BEGIN.`
  const keyboard = {
    inline_keyboard: [
      [
        { text: "MTN", callback_data: "network_mtn" },
        { text: "TELECEL", callback_data: "network_telecel" },
      ],
      [
        { text: "AIRTELTIGO", callback_data: "network_airteltigo" },
        { text: "📋 MY ORDERS", callback_data: "my_orders" },
      ],
      [
        { text: "💰 WALLET", callback_data: "wallet_menu" },
        { text: "👤 ACCOUNT", callback_data: "account_info" },
      ],
      [
        { text: "HELP", callback_data: "help" },
        { text: "SUPPORT", callback_data: "support" },
      ],
      [{ text: "EXIT", callback_data: "exit" }],
    ],
  }

  try {
    await bot.editMessageText(welcomeMessage, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
      reply_markup: keyboard,
    })
  } catch (error) {
    console.error("Error showing main menu:", error)
    await bot.sendMessage(chatId, welcomeMessage, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    })
  }
}

async function handlePaymentConfirmation(chatId, messageId, reference) {
  try {
    console.log(`[v0] Verifying payment for reference: ${reference}`)

    const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
    })

    console.log(`[v0] Payment verification response:`, response.data)

    if (response.data.status && response.data.data.status === "success") {
      const session = userSessions.get(chatId)

      if (!session) {
        await bot.editMessageText(`❌ Session expired. Please start a new transaction.`, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [[{ text: "🏠 Start Over", callback_data: "back_to_networks" }]],
          },
        })
        return
      }

      // Check if this is a wallet deposit
      if (reference.startsWith("deposit_")) {
        await processWalletDeposit(chatId, session, reference, response.data.data.amount / 100)
      } else {
        if (!session.selectedPackage || !session.selectedPackage.priceGHS) {
          await bot.editMessageText(`❌ Package information missing. Please start a new transaction.`, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
              inline_keyboard: [[{ text: "🏠 Start Over", callback_data: "back_to_networks" }]],
            },
          })
          return
        }
        await processDataBundle(chatId, session, reference)
      }
    } else {
      await bot.editMessageText(
        `❌ Payment not found or failed. 

Status: ${response.data.data?.status || "Unknown"}
Reference: ${reference}

Please ensure payment was completed and try again.`,
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔄 Try Again", callback_data: `confirm_${reference}` }],
              [{ text: "🎧 Contact Support", callback_data: "support" }],
            ],
          },
        },
      )
    }
  } catch (error) {
    console.error("Payment verification error:", error)
    await bot.editMessageText(
      `❌ Verification failed: ${error.message}

Please try again or contact support if the issue persists.`,
      {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔄 Try Again", callback_data: `confirm_${reference}` }],
            [{ text: "🎧 Contact Support", callback_data: "support" }],
          ],
        },
      },
    )
  }
}

async function handlePaymentMethodSelection(chatId, messageId, method) {
  const session = userSessions.get(chatId)
  if (!session || !session.selectedPackage) {
    await bot.editMessageText(`❌ Session expired. Please start a new transaction.`, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: [[{ text: "🏠 Start Over", callback_data: "back_to_networks" }]],
      },
    })
    return
  }

  const { selectedPackage } = session
  const reference = generateReference()

  await saveTransaction(chatId, reference, {
    amount: selectedPackage.priceGHS,
    bundle: `${selectedPackage.volumeGB}GB`,
    network: selectedPackage.network,
    payment_method: method,
    status: "pending",
    timestamp: new Date().toISOString(),
  })

  const paymentMessage = `📦 *PACKAGE SELECTED*

🌐 *NETWORK:* ${selectedPackage.networkName.toUpperCase()}
📊 *PACKAGE:* ${selectedPackage.volumeGB}GB | ₵${selectedPackage.priceGHS.toFixed(2)}
📱 *PHONE NUMBER:* ${formatPhoneNumber(session.phoneNumber)}

You have selected to pay with ${method.toUpperCase()}.
Please complete the payment to proceed.`

  const keyboard = {
    inline_keyboard: [[{ text: "🏠 MAIN MENU", callback_data: "back_to_main" }]],
  }

  await bot.editMessageText(paymentMessage, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "Markdown",
    reply_markup: keyboard,
  })

  // Redirect user to Paystack payment page
  const paystackUrl = `https://paystack.com/pay/${reference}`
  await bot.sendMessage(chatId, `Please complete your payment here: ${paystackUrl}`, {
    parse_mode: "Markdown",
  })
}

async function processWalletDeposit(chatId, session, reference, amount) {
  try {
    await updateWallet(chatId, amount)

    const depositMessage = `✅ *WALLET DEPOSIT SUCCESSFUL*

Amount: ₵${amount.toFixed(2)}
Reference: ${reference}
Status: COMPLETED

Your wallet has been credited successfully!`

    await bot.sendMessage(chatId, depositMessage, { parse_mode: "Markdown" })
  } catch (error) {
    console.error("Error processing wallet deposit:", error)
    await bot.sendMessage(chatId, "❌ An error occurred while processing your deposit. Please try again.")
  }
}

async function processDataBundle(chatId, session, reference) {
  try {
    const { selectedPackage, phoneNumber } = session
    const result = await purchaseDataBundle(phoneNumber, selectedPackage.network_id, selectedPackage.volume)

    if (result.status === "success") {
      await saveOrder(chatId, reference, {
        amount: selectedPackage.priceGHS,
        bundle: `${selectedPackage.volumeGB}GB`,
        network: selectedPackage.network,
        phone_number: phoneNumber,
        payment_method: session.paymentMethod,
        status: "success",
        timestamp: new Date().toISOString(),
      })

      const successMessage = `✅ *DATA BUNDLE PURCHASE SUCCESSFUL*

🌐 *NETWORK:* ${selectedPackage.networkName.toUpperCase()}
📊 *PACKAGE:* ${selectedPackage.volumeGB}GB | ₵${selectedPackage.priceGHS.toFixed(2)}
📱 *PHONE NUMBER:* ${formatPhoneNumber(phoneNumber)}

Your data bundle has been successfully purchased and delivered to your phone!`

      await bot.sendMessage(chatId, successMessage, { parse_mode: "Markdown" })
    } else {
      await saveOrder(chatId, reference, {
        amount: selectedPackage.priceGHS,
        bundle: `${selectedPackage.volumeGB}GB`,
        network: selectedPackage.network,
        phone_number: phoneNumber,
        payment_method: session.paymentMethod,
        status: "failed",
        timestamp: new Date().toISOString(),
      })

      const errorMessage = `❌ *DATA BUNDLE PURCHASE FAILED*

🌐 *NETWORK:* ${selectedPackage.networkName.toUpperCase()}
📊 *PACKAGE:* ${selectedPackage.volumeGB}GB | ₵${selectedPackage.priceGHS.toFixed(2)}
📱 *PHONE NUMBER:* ${formatPhoneNumber(phoneNumber)}

Please try again later or contact support if the problem persists.`

      await bot.sendMessage(chatId, errorMessage, { parse_mode: "Markdown" })
    }
  } catch (error) {
    console.error("Error processing data bundle:", error)
    await bot.sendMessage(chatId, "❌ An error occurred while processing your data bundle purchase. Please try again.")
  }
}

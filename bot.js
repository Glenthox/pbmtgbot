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
    wallet: 0,
  }
  await firebaseSet(`users/${user.id}/profile`, profile)
}

// Update wallet balance
async function updateWallet(userId, amount) {
  const profile = await firebaseGet(`users/${userId}/profile`)
  const newBalance = (profile?.wallet || 0) + amount
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
MTN, TELECEL, AND AIRTELTIGO PACKAGES
SECURE PAYMENTS
FASTER DELIVERY
24/7 SERVICE
BEST RATES

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
      const network = data.replace("network_", "") // Improved string parsing
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

async function getLastOrders(userId, limit = 10) {
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

    const orders = await getLastOrders(chatId, 10)

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
    let ordersMessage = `*📋 MY ORDERS (LAST ${orders.length})*\n\n`

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
      ordersMessage += `   💳 ${order.payment_method.toUpperCase()}\n`
      ordersMessage += `   📊 ${order.status.toUpperCase()}\n\n`
    })

    ordersMessage += `💡 *TIP:* Your successful orders show data bundles that were delivered to your phone.`

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

async function showMainMenu(chatId, messageId) {
  const welcomeMessage = `*WELCOME TO PBM HUB GHANA*

THE FASTEST AND MOST SECURE WAY TO BUY DATA BUNDLES IN GHANA.

FEATURES:
MTN, TELECEL, AND AIRTELTIGO PACKAGES
SECURE PAYMENTS
FASTER DELIVERY
24/7 SERVICE
BEST RATES

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
      const pkg = data.packages.find((p) => p.id == packageId)
      if (pkg) {
        selectedPackage = pkg
        networkName = data.name
        break
      }
    }
    if (!selectedPackage) {
      await bot.editMessageText("PACKAGE NOT FOUND. PLEASE TRY AGAIN.", {
        chat_id: chatId,
        message_id: messageId,
      })
      return
    }
    userSessions.set(chatId, {
      package: selectedPackage,
      network: networkName,
      step: "phone_input",
    })
    const message = `*PACKAGE SELECTED*

NETWORK: ${networkName.toUpperCase()}
PACKAGE: ${selectedPackage.volumeGB}GB | ₵${selectedPackage.priceGHS.toFixed(2)}

ENTER YOUR GHANA PHONE NUMBER (E.G. 0241234567 OR +233241234567):`
    await bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
    })
  } catch (error) {
    console.error("Package selection error:", error)
    await bot.sendMessage(chatId, "❌ An error occurred. Please try /start to begin again.")
  }
}

// Phone number input handler
bot.on("message", async (msg) => {
  const chatId = msg.chat.id
  const text = msg.text

  if (text && text.startsWith("/")) return

  const session = userSessions.get(chatId)
  if (!session || session.step !== "phone_input") return

  if (!validatePhoneNumber(text)) {
    bot.sendMessage(
      chatId,
      "❌ Invalid phone number format. Please enter a valid Ghana phone number (e.g., 0241234567 or +233241234567)",
    )
    return
  }

  const formattedPhone = formatPhoneNumber(text)
  session.phoneNumber = formattedPhone
  session.step = "payment"

  await initiatePayment(chatId, session)
})

async function initiatePayment(chatId, session) {
  try {
    const reference = generateReference()
    const amount = Math.round(session.package.priceGHS * 100)
    const paymentData = {
      email: `user${chatId}@pbmhub.com`,
      amount: amount,
      reference: reference,
      currency: "GHS",
      callback_url: `${WEBHOOK_URL}/verify.html?reference=${reference}`,
      metadata: {
        chatId: chatId,
        phoneNumber: session.phoneNumber,
        packageId: session.package.id,
        network: session.network,
      },
    }
    const response = await axios.post("https://api.paystack.co/transaction/initialize", paymentData, {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    })
    if (response.data.status) {
      const paymentUrl = response.data.data.authorization_url
      session.reference = reference
      session.paymentInitiated = Date.now()
      userSessions.set(chatId, session)

      // Log order and transaction in Firebase (pending)
      const userId = chatId
      const orderId = reference
      const orderData = {
        bundle: `${session.package.volumeGB}GB`,
        amount: session.package.priceGHS,
        payment_method: "paystack",
        status: "pending",
        timestamp: new Date().toISOString(),
      }
      await saveOrder(userId, orderId, orderData)
      const txnData = {
        type: "deposit",
        amount: session.package.priceGHS,
        payment_method: "paystack",
        status: "pending",
        reference: reference,
        timestamp: new Date().toISOString(),
      }
      await saveTransaction(userId, reference, txnData)

      const message = `*PAYMENT DETAILS*

NETWORK: ${session.network.toUpperCase()}
PACKAGE: ${session.package.volumeGB}GB | ₵${session.package.priceGHS.toFixed(2)}
PHONE: ${session.phoneNumber}
AMOUNT: ₵${session.package.priceGHS.toFixed(2)}
REFERENCE: ${reference}

SELECT AN OPTION BELOW TO CONTINUE:`
      const keyboard = {
        inline_keyboard: [
          [
            { text: "PAY", url: paymentUrl },
            { text: "I PAID", callback_data: `confirm_${reference}` },
          ],
          [
            { text: "CANCEL", callback_data: "back_to_networks" },
            { text: "HELP", callback_data: "help" },
          ],
        ],
      }
      await bot.sendMessage(chatId, message, {
        reply_markup: keyboard,
      })
    } else {
      throw new Error("Failed to initialize payment")
    }
  } catch (error) {
    console.error("Payment initialization error:", error)

    try {
      if (error.response && error.response.status === 401) {
        await bot.sendMessage(chatId, "❌ Paystack key is INVALID. Please check your .env file.")
      } else if (error.code === "ETIMEDOUT") {
        await bot.sendMessage(
          chatId,
          "❌ Network timeout: Unable to reach Paystack API. Check your internet connection.",
        )
      } else {
        await bot.sendMessage(chatId, `❌ Failed to initialize payment: ${error.message}`)
      }
    } catch (botError) {
      console.error("Failed to send error message:", botError)
    }
  }
}

async function handlePaymentConfirmation(chatId, messageId, reference) {
  try {
    const session = userSessions.get(chatId)
    if (!session || !session.reference) {
      await bot.editMessageText("❌ Session expired. Please start a new purchase.", {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [[{ text: "🔄 Start Over", callback_data: "back_to_networks" }]],
        },
      })
      return
    }

    const actualReference = session.reference

    await bot.editMessageText("🔍 Verifying your payment... Please wait.", {
      chat_id: chatId,
      message_id: messageId,
    })

    const response = await axios.get(`https://api.paystack.co/transaction/verify/${actualReference}`, {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      },
      timeout: 15000,
    })

    if (response.data.status && response.data.data.status === "success") {
      const paymentData = response.data.data
      const expectedAmount = Math.round(session.package.priceGHS * 100)

      if (paymentData.amount !== expectedAmount) {
        await bot.editMessageText("❌ Payment amount mismatch. Please contact support.", {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [[{ text: "🎧 Contact Support", callback_data: "support" }]],
          },
        })
        return
      }

      // Log transaction in Firebase
      const userId = chatId
      const txnId = paymentData.reference || reference
      const txnData = {
        type: "deposit",
        amount: paymentData.amount / 100,
        payment_method: "paystack",
        status: "success",
        reference: paymentData.reference,
        timestamp: new Date().toISOString(),
      }
      await saveTransaction(userId, txnId, txnData)
      // Update wallet balance
      await updateWallet(userId, paymentData.amount / 100)
      // Send receipt message
      await bot.sendMessage(chatId, "✅ Payment Successful. Please go back to the bot to proceed.")

      await processDataBundle(chatId, session)
      userSessions.delete(chatId)
    } else {
      const paymentStatus = response.data.data?.status || "unknown"
      let statusMessage = ""

      if (paymentStatus === "pending") {
        statusMessage = "⏳ Payment is still pending. Please wait a moment and try again."
      } else if (paymentStatus === "failed") {
        statusMessage = "❌ Payment failed. Please try making a new payment."
      } else {
        statusMessage = "❌ Payment not confirmed yet. Please complete your payment first."
      }

      const keyboard = {
        inline_keyboard: [
          [{ text: "🔄 Check Again", callback_data: `confirm_${actualReference}` }],
          [{ text: "💳 New Payment", callback_data: "back_to_networks" }],
          [{ text: "🎧 Support", callback_data: "support" }],
        ],
      }

      await bot.editMessageText(statusMessage, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard,
      })
    }
  } catch (error) {
    console.error("Payment verification error:", error)

    let errorMessage = "❌ Unable to verify payment. "

    if (error.response?.status === 404) {
      errorMessage += "Transaction not found. Please ensure you completed the payment."
    } else if (error.response?.status === 401) {
      errorMessage += "Authentication error. Please contact support."
    } else if (error.code === "ETIMEDOUT") {
      errorMessage += "Verification timeout. Please try again."
    } else {
      errorMessage += "Please try again or contact support."
    }

    const keyboard = {
      inline_keyboard: [
        [{ text: "🔄 Try Again", callback_data: `confirm_${reference}` }],
        [{ text: "🎧 Contact Support", callback_data: "support" }],
        [{ text: "🔄 Start Over", callback_data: "back_to_networks" }],
      ],
    }

    try {
      await bot.editMessageText(errorMessage, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard,
      })
    } catch (editError) {
      console.error("Failed to edit message:", editError)
      // Send new message if edit fails
      await bot.sendMessage(chatId, errorMessage, { reply_markup: keyboard })
    }
  }
}

async function processDataBundle(chatId, session) {
  const processingMessage = `⏳ PROCESSING YOUR DATA BUNDLE...

NETWORK: ${session.network}
PACKAGE: ${session.package.volumeGB}GB - ₵${session.package.priceGHS.toFixed(2)}
PHONE: ${session.phoneNumber}

PLEASE RELAX WHILE WE PROCESS YOUR REQUEST...`

  let processingMsg
  try {
    processingMsg = await bot.sendMessage(chatId, processingMessage)
  } catch (error) {
    console.error("Failed to send processing message:", error)
    return
  }

  try {
    const result = await purchaseDataBundle(session.phoneNumber, session.package.network_id, session.package.volume)

    // Handle Foster Console API response format
    if (result.success === true) {
      const successMessage = `BUNDLE PROCESSED SUCCESSFULLY

NETWORK: ${session.network}
PACKAGE: ${session.package.volumeGB}GB - ₵${session.package.priceGHS.toFixed(2)}
PHONE: ${session.phoneNumber}
TRANSACTION ID: ${result.transaction_code}

THANK YOU FOR USING PBM HUB GHANA!`

      // Log order and transaction in Firebase
      const userId = chatId
      const orderId = result.transaction_code || Date.now()
      const orderData = {
        bundle: `${session.package.volumeGB}GB`,
        amount: session.package.priceGHS,
        payment_method: "wallet",
        status: "success",
        timestamp: new Date().toISOString(),
      }
      await saveOrder(userId, orderId, orderData)
      const txnData = {
        type: "purchase",
        amount: session.package.priceGHS,
        payment_method: "wallet",
        status: "success",
        reference: result.transaction_code || "wallet",
        timestamp: new Date().toISOString(),
      }
      await saveTransaction(userId, orderId, txnData)

      const keyboard = {
        inline_keyboard: [[{ text: "🔄 BUY AGAIN", callback_data: "back_to_networks" }]],
      }

      await bot.editMessageText(successMessage, {
        chat_id: chatId,
        message_id: processingMsg.message_id,
        reply_markup: keyboard,
      })
    } else {
      throw new Error(result.message || "Purchase failed")
    }
  } catch (error) {
    console.error("Data bundle purchase failed:", error)

    let errorMessage = "❌ Failed to activate data bundle. "

    // Handle specific Foster Console API error codes
    if (error.response?.status === 400) {
      const responseData = error.response.data
      if (responseData.message === "Insufficient balance.") {
        errorMessage += "Insufficient balance in Foster Console."
      } else {
        errorMessage += "Invalid request or insufficient balance."
      }
    } else if (error.response?.status === 404) {
      errorMessage += "Package not found or out of stock."
    } else if (error.response?.status === 403) {
      errorMessage += "Access denied for this network transaction."
    } else {
      errorMessage += "Please contact support for assistance."
    }

    const keyboard = {
      inline_keyboard: [
        [{ text: "🔄 Try Again", callback_data: "back_to_networks" }],
        [{ text: "🎧 Contact Support", callback_data: "support" }],
      ],
    }

    try {
      await bot.editMessageText(errorMessage, {
        chat_id: chatId,
        message_id: processingMsg.message_id,
        reply_markup: keyboard,
      })
    } catch (editError) {
      console.error("Failed to edit message:", editError)
      await bot.sendMessage(chatId, errorMessage, { reply_markup: keyboard })
    }
  }
}

async function showNetworkSelection(chatId, messageId) {
  const message = `*CHOOSE YOUR NETWORK*

SELECT YOUR PREFERRED NETWORK PROVIDER:`
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
        { text: "HELP", callback_data: "help" },
        { text: "SUPPORT", callback_data: "support" },
      ],
      [{ text: "🏠 MAIN MENU", callback_data: "back_to_main" }],
    ],
  }
  bot.editMessageText(message, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "Markdown",
    reply_markup: keyboard,
  })
}

async function showHelp(chatId, messageId) {
  const helpMessage = `*HELP & INSTRUCTIONS*

HOW TO USE PBM HUB GHANA:
1. CHOOSE NETWORK
2. SELECT DATA PACKAGE
3. ENTER PHONE NUMBER
4. COMPLETE PAYMENT
5. CLICK "I PAID" TO ACTIVATE

SUPPORTED NETWORKS: MTN, TELECEL, AIRTELTIGO
PAYMENT METHODS: CARD, MOBILE MONEY, BANK
DATA PACKAGES: 1GB TO 5GB, BEST RATES, INSTANT ACTIVATION.`
  const keyboard = {
    inline_keyboard: [
      [
        { text: "BACK", callback_data: "back_to_networks" },
        { text: "🏠 MAIN MENU", callback_data: "back_to_main" },
      ],
    ],
  }
  bot.editMessageText(helpMessage, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "Markdown",
    reply_markup: keyboard,
  })
}

async function showSupport(chatId, messageId) {
  const supportMessage = `*CUSTOMER SUPPORT*

FOR HELP, CONTACT US:
EMAIL: update@pbmdatahub.pro
PHONE: +23354 056 2479
TELEGRAM: @glenthox

BUSINESS HOURS:
MON-FRI: 8AM-8PM
SAT-SUN: 10AM-6PM

COMMON ISSUES:
PAYMENT NOT REFLECTING
DATA NOT RECEIVED
WRONG NUMBER ENTERED
REFUND REQUESTS

WE RESPOND WITHIN 10 MINUTES.`
  const keyboard = {
    inline_keyboard: [
      [
        { text: "BACK", callback_data: "back_to_networks" },
        { text: "🏠 MAIN MENU", callback_data: "back_to_main" },
      ],
      [{ text: "🎧 SUPPORT", callback_data: "support" }],
    ],
  }
  bot.editMessageText(supportMessage, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "Markdown",
    reply_markup: keyboard,
  })
}

bot.on("polling_error", (error) => {
  console.error("Polling error:", error)
  // Don't restart, just log the error
})

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason)
  // Don't exit the process, just log the error
})

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error)
  // Don't exit the process, just log the error
})

async function validatePaystackKey() {
  try {
    const response = await axios.get("https://api.paystack.co/bank", {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      },
      timeout: 10000,
    })
    if (response.data.status) {
      console.log("✅ Paystack key is valid and API is reachable.")
    } else {
      console.error("❌ Paystack key is invalid or API returned an error.")
    }
  } catch (error) {
    if (error.response && error.response.status === 401) {
      console.error("❌ Paystack key is INVALID. Please check your .env file.")
    } else if (error.code === "ETIMEDOUT") {
      console.error("❌ Network timeout: Unable to reach Paystack API. Check your internet connection.")
    } else {
      console.error("❌ Paystack key validation failed:", error.message)
    }
  }
}

// Initialize validations
validatePaystackKey()
console.log("🤖 PBM HUB Ghana is running with webhook... 🇬🇭")

setInterval(
  () => {
    const now = Date.now()
    const THIRTY_MINUTES = 30 * 60 * 1000

    for (const [chatId, session] of userSessions.entries()) {
      if (session.paymentInitiated && now - session.paymentInitiated > THIRTY_MINUTES) {
        userSessions.delete(chatId)
        console.log(`Cleaned up expired session for chat ${chatId}`)
      }
    }
  },
  5 * 60 * 1000,
) // Run cleanup every 5 minutes

// Serve dynamic verify.html for payment status
app.get("/verify.html", async (req, res) => {
  const reference = req.query.reference || req.query.trxref
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Complete - PBM HUB</title>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Poppins', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .container { background: white; border-radius: 20px; box-shadow: 0 20px 40px rgba(0,0,0,0.1); padding: 24px 18px; max-width: 420px; width: 100%; text-align: center; position: relative; overflow: hidden; }
    .container::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 5px; background: linear-gradient(90deg, #1e3c72, #2a5298, #1e3c72); }
    .logo { width: 60px; height: 60px; background: linear-gradient(135deg, #1e3c72, #2a5298); border-radius: 50%; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; }
    .logo img { width:36px;height:36px; }
    h1 { color: #1e3c72; font-size: 22px; margin-bottom: 8px; font-weight: 700; letter-spacing: 1px; }
    .subtitle { color: #666; font-size: 13px; margin-bottom: 18px; font-weight: 500; }
    .status-card { background: #f8f9ff; border: 2px solid #e3e8ff; border-radius: 12px; padding: 10px 8px; margin: 10px 0; min-height: 70px; }
    .status-icon { width: 32px; height: 32px; border-radius: 50%; margin: 0 auto 4px; display: flex; align-items: center; justify-content: center; font-size: 22px; }
    .status-message { font-size: 13px; font-weight: 600; margin-bottom: 4px; letter-spacing: 0.3px; }
    .status-details { font-size: 11px; color: #666; line-height: 1.4; font-weight: 400; }
    .reference { background: #e3f2fd; border: 1px solid #bbdefb; border-radius: 8px; padding: 6px; margin: 8px 0; font-family: 'Poppins', 'Courier New', monospace; font-size: 11px; color: #1565c0; word-break: break-all; font-weight: 500; }
    .btn { background: linear-gradient(135deg, #1e3c72, #2a5298); color: white; border: none; padding: 6px 12px; border-radius: 16px; font-size: 11px; font-weight: 500; cursor: pointer; transition: all 0.3s ease; text-decoration: none; display: inline-block; margin: 0 2px; letter-spacing: 0.3px; min-width: 80px; }
    .btn:hover { transform: translateY(-2px); box-shadow: 0 6px 12px rgba(30,60,114,0.18); }
    #actionButtons { display: flex; flex-direction: row; justify-content: center; align-items: center; gap: 6px; margin-top: 6px; }
    .footer { margin-top: 10px; padding-top: 8px; border-top: 1px solid #eee; color: #999; font-size: 9px; font-weight: 400; }
    .ghana-flag { display: inline-block; margin: 0 3px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo"><img src="https://img.icons8.com/ios/50/follow.png" alt="Go to Bot"></div>
    <h1>PBM HUB</h1>
    <p class="subtitle">Follow Instruction To Proceed!</p>
    <div class="status-card">
      <div class="status-icon"> <img src="https://img.icons8.com/ios/50/follow.png" alt="Go to Bot" style="width:32px;height:32px;"> </div>
      <div class="status-message">Thank you for your payment!</div>
      <div class="status-details">To complete your bundle purchase, please return to the Telegram bot and click <b>"I have paid"</b>.<br>The bot will verify your payment and process your bundle instantly.<br><br>If you have any issues, contact support.</div>
    </div>
    <div class="reference"><strong>Transaction Reference:</strong><br><span>${reference || "N/A"}</span></div>
    <div id="actionButtons">
      <a href="https://t.me/pbmhub_bot" class="btn">Go to Telegram Bot</a>
    </div>
    <div class="footer">
      <p>Secure payments powered by Paystack <span class="ghana-flag">🇬🇭</span></p>
      <p>© 2025 PBM HUB Ghana. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`)
})

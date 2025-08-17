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

// Express server for webhook
const app = express()
app.use(bodyParser.json())

const PORT = process.env.PORT || 3000
const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://pbmtgbot.onrender.com"

// Initialize bot with webhook
const bot = new TelegramBot(BOT_TOKEN, { webHook: true })
bot.setWebHook(`${WEBHOOK_URL}/bot${BOT_TOKEN}`)

// Health check endpoint for Render
app.get("/health", (req, res) => {
  res.status(200).send("OK")
})

// Telegram webhook endpoint
app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body)
  res.status(200).send("OK")
})

app.listen(PORT, () => {
  console.log(`🚀 Express server running on port ${PORT}`)
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
  airteltigo: {
    name: "AirtelTigo Ghana",
    packages: [
      { id: 11, volumeGB: "1", priceGHS: 7.5, volume: "1000", network_id: 1, network: "AirtelTigo" },
      { id: 12, volumeGB: "2", priceGHS: 14.5, volume: "2000", network_id: 1, network: "AirtelTigo" },
      { id: 13, volumeGB: "3", priceGHS: 21.5, volume: "3000", network_id: 1, network: "AirtelTigo" },
      { id: 14, volumeGB: "4", priceGHS: 28.5, volume: "4000", network_id: 1, network: "AirtelTigo" },
      { id: 15, volumeGB: "5", priceGHS: 35.5, volume: "5000", network_id: 1, network: "AirtelTigo" },
    ],
  },
  mtn: {
    name: "MTN Ghana",
    packages: [
      { id: 1, volumeGB: "1", priceGHS: 8.5, volume: "1000", network_id: 3, network: "MTN" },
      { id: 2, volumeGB: "2", priceGHS: 16.0, volume: "2000", network_id: 3, network: "MTN" },
      { id: 3, volumeGB: "3", priceGHS: 23.5, volume: "3000", network_id: 3, network: "MTN" },
      { id: 4, volumeGB: "4", priceGHS: 31.0, volume: "4000", network_id: 3, network: "MTN" },
      { id: 5, volumeGB: "5", priceGHS: 38.5, volume: "5000", network_id: 3, network: "MTN" },
    ],
  },
  telecel: {
    name: "Telecel Ghana",
    packages: [
      { id: 6, volumeGB: "1", priceGHS: 9.0, volume: "1000", network_id: 2, network: "Telecel" },
      { id: 7, volumeGB: "2", priceGHS: 17.0, volume: "2000", network_id: 2, network: "Telecel" },
      { id: 8, volumeGB: "3", priceGHS: 25.0, volume: "3000", network_id: 2, network: "Telecel" },
      { id: 9, volumeGB: "4", priceGHS: 33.0, volume: "4000", network_id: 2, network: "Telecel" },
      { id: 10, volumeGB: "5", priceGHS: 41.0, volume: "5000", network_id: 2, network: "Telecel" },
    ],
  },
}

function getDataPackages() {
  return DATA_PACKAGES
}

// Bot command handlers
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id
  const welcomeMessage = `
🎊 *Welcome to PBM HUB Ghana!* 📱✨

Your premium solution for purchasing data bundles quickly and securely in Ghana.

🌟 *Premium Features:*
• 🇬🇭 MTN, Telecel & AirtelTigo packages
• 💎 Secure Paystack payments
• ⚡ Instant data delivery
• 🛡️ 24/7 automated service
• 🎯 Best rates in Ghana

Choose your network to get started! 👇
  `

  const keyboard = {
    inline_keyboard: [
      [
        { text: "📶 MTN Ghana", callback_data: "network_mtn" },
        { text: "📡 Telecel Ghana", callback_data: "network_telecel" },
      ],
      [{ text: "🌐 AirtelTigo Ghana", callback_data: "network_airteltigo" }],
      [
        { text: "❓ Help", callback_data: "help" },
        { text: "🎧 Support", callback_data: "support" },
      ],
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

async function handleNetworkSelection(chatId, messageId, network) {
  try {
    const dataPackages = getDataPackages()
    const packages = dataPackages[network]

    if (!packages || packages.packages.length === 0) {
      const errorMessage = "❌ No packages available for this network. Please try again later."

      try {
        await bot.editMessageText(errorMessage, {
          chat_id: chatId,
          message_id: messageId,
        })
      } catch (editError) {
        if (editError.response?.body?.description?.includes("message is not modified")) {
          // Message is already showing this content, send new message instead
          await bot.sendMessage(chatId, errorMessage)
        } else {
          throw editError
        }
      }
      return
    }

    const message = `
📶 *${packages.name} Data Packages* 🇬🇭

Choose your preferred data bundle:
    `

    const packageButtons = []
    for (let i = 0; i < packages.packages.length; i += 2) {
      packageButtons.push(
        packages.packages.slice(i, i + 2).map((pkg) => ({
          text: `${pkg.volumeGB}GB • GH₵${pkg.priceGHS.toFixed(2)}`,
          callback_data: `package_${pkg.id}`,
        })),
      )
    }

    const keyboard = {
      inline_keyboard: [...packageButtons, [{ text: "⬅️ Back to Networks", callback_data: "back_to_networks" }]],
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
      await bot.editMessageText("❌ Package not found. Please try again.", {
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

    const message = `
💎 *Package Selected*

*Network:* ${networkName} 🇬🇭
*Package:* ${selectedPackage.volumeGB}GB - GH₵${selectedPackage.priceGHS.toFixed(2)}

📱 Please enter your Ghana phone number:
(Format: 0241234567 or +233241234567)
    `

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
      email: `user${chatId}@PBM HUB.com`,
      amount: amount,
      reference: reference,
      currency: "GHS",
      callback_url: `https://glenthox.github.io/pbmtgbot/index.html?reference=${reference}`,
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

      const message = `💳 Payment Details 🇬🇭

Network: ${session.network}
Package: ${session.package.volumeGB}GB - GH₵${session.package.priceGHS.toFixed(2)}
Phone: ${session.phoneNumber}
Amount: GH₵${session.package.priceGHS.toFixed(2)}
Reference: ${reference}

Click the button below to complete your payment:`

      const keyboard = {
        inline_keyboard: [
          [{ text: "💎 Pay Now", url: paymentUrl }],
          [{ text: "✅ I have paid", callback_data: `confirm_${reference}` }],
          [{ text: "❌ Cancel", callback_data: "back_to_networks" }],
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
  const processingMessage = `⏳ Processing your data bundle... 🇬🇭

Network: ${session.network}
Package: ${session.package.volumeGB}GB - GH₵${session.package.priceGHS.toFixed(2)}
Phone: ${session.phoneNumber}

Please wait while we activate your data bundle.`

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
      const successMessage = `✅ Data Bundle Activated Successfully! 🎉

Network: ${session.network} 🇬🇭
Package: ${session.package.volumeGB}GB - GH₵${session.package.priceGHS.toFixed(2)}
Phone: ${session.phoneNumber}
Transaction ID: ${result.transaction_code}

Your data bundle has been successfully activated! 🎊

Thank you for using PBM HUB Ghana! 💎`

      const keyboard = {
        inline_keyboard: [[{ text: "🔄 Buy Another", callback_data: "back_to_networks" }]],
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
  const message = `
📱 *Choose Your Network* 🇬🇭

Select your preferred network provider:
  `

  const keyboard = {
    inline_keyboard: [
      [
        { text: "📶 MTN Ghana", callback_data: "network_mtn" },
        { text: "📡 Telecel Ghana", callback_data: "network_telecel" },
      ],
      [{ text: "🌐 AirtelTigo Ghana", callback_data: "network_airteltigo" }],
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
  const helpMessage = `
❓ *Help & Instructions* 🇬🇭

*How to use PBM HUB Ghana:*

1️⃣ Choose your network (MTN, Telecel, or AirtelTigo)
2️⃣ Select your preferred data package (1-5GB)
3️⃣ Enter your Ghana phone number
4️⃣ Complete payment via Paystack (GHS)
5️⃣ Receive instant data activation

*Supported Networks:*
• 📶 MTN Ghana
• 📡 Telecel Ghana
• 🌐 AirtelTigo Ghana

*Payment Methods:*
• 💳 Debit/Credit Cards
• 🏦 Mobile Money
• 📱 Bank Transfer

*Data Packages:*
• 💎 1GB to 5GB options available
• 🎯 Best rates in Ghana
• ⚡ Instant activation
  `

  const keyboard = {
    inline_keyboard: [[{ text: "⬅️ Back to Main Menu", callback_data: "back_to_networks" }]],
  }

  bot.editMessageText(helpMessage, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "Markdown",
    reply_markup: keyboard,
  })
}

async function showSupport(chatId, messageId) {
  const supportMessage = `
🎧 *Customer Support* 🇬🇭

Need help? We're here for you!

*Contact Options:*
• 📧 Email: support@PBM HUB.gh
• 📞 Phone: +233 50 123 4567
• 💬 Telegram: @PBM HUBGhanaSupport

*Business Hours:*
Monday - Friday: 8:00 AM - 8:00 PM (GMT)
Saturday - Sunday: 10:00 AM - 6:00 PM (GMT)

*Common Issues:*
• 💳 Payment not reflecting
• 📱 Data not received
• ❌ Wrong number entered
• 💰 Refund requests

We typically respond within 30 minutes! 💎
  `

  const keyboard = {
    inline_keyboard: [[{ text: "⬅️ Back to Main Menu", callback_data: "back_to_networks" }]],
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

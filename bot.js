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
    phone_number: null,
    phone_verified: false
  }
  await firebaseSet(`users/${user.id}/profile`, profile)
}

// Request phone number from user
async function requestPhoneNumber(chatId) {
  const message = `📱 *PHONE NUMBER REQUIRED*

To use PBM Hub Ghana, you need to set your phone number first.

Please enter your Ghana phone number:
(e.g., 0241234567 or +233241234567)

This number will be used for:
• Receiving data bundles
• Account verification
• Transaction notifications

ℹ️ *Note:* Only Ghana phone numbers are accepted.`

  await bot.sendMessage(chatId, message, {
    parse_mode: "Markdown",
  })

  // Set user session to phone setup
  userSessions.set(chatId, {
    step: "setup_phone"
  })
}

// Save phone number to user profile
async function savePhoneNumber(userId, phone) {
  await firebaseUpdate(`users/${userId}/profile`, {
    phone_number: phone,
    phone_verified: true
  })
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

async function saveOrder(userId, orderId, orderData) {
  // Only save if order is successful
  if (orderData.status === "success") {
    await firebaseSet(`users/${userId}/orders/${orderId}`, orderData)
  }
}

// Save transaction
async function saveTransaction(userId, txnId, txnData) {
  await firebaseSet(`users/${userId}/transactions/${txnId}`, txnData)
}

async function findOrderById(userId, orderId) {
  try {
    const order = await firebaseGet(`users/${userId}/orders/${orderId}`)
    return order
  } catch (error) {
    console.error("Error finding order:", error)
    return null
  }
}

// Express server for webhook
const app = express()
app.use(bodyParser.json({
  verify: (req, res, buf) => { req.rawBody = buf } // keep raw for HMAC
}))

// Serve payment verification HTML page
const paymentVerificationHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Verification - DataBot Ghana</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .container { background: white; border-radius: 20px; box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1); padding: 40px; max-width: 500px; width: 100%; text-align: center; position: relative; overflow: hidden; }
    .container::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 5px; background: linear-gradient(90deg, #1e3c72, #2a5298, #1e3c72); }
    .logo { width: 80px; height: 80px; background: linear-gradient(135deg, #1e3c72, #2a5298); border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; font-size: 32px; color: white; }
    h1 { color: #1e3c72; font-size: 28px; margin-bottom: 10px; font-weight: 700; }
    .subtitle { color: #666; font-size: 16px; margin-bottom: 30px; }
    .status-card { background: #f8f9ff; border: 2px solid #e3e8ff; border-radius: 15px; padding: 30px; margin: 20px 0; }
    .status-icon { width: 60px; height: 60px; border-radius: 50%; margin: 0 auto 15px; display: flex; align-items: center; justify-content: center; font-size: 24px; }
    .loading { background: #fff3cd; color: #856404; animation: pulse 2s infinite; }
    .success { background: #d4edda; color: #155724; }
    .error { background: #f8d7da; color: #721c24; }
    @keyframes pulse { 0% { transform: scale(1); } 50% { transform: scale(1.05); } 100% { transform: scale(1); } }
    .spinner { width: 24px; height: 24px; border: 3px solid #f3f3f3; border-top: 3px solid #1e3c72; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .status-message { font-size: 18px; font-weight: 600; margin-bottom: 10px; }
    .status-details { font-size: 14px; color: #666; line-height: 1.5; }
    .reference { background: #e3f2fd; border: 1px solid #bbdefb; border-radius: 8px; padding: 15px; margin: 20px 0; font-family: 'Courier New', monospace; font-size: 14px; color: #1565c0; word-break: break-all; }
    .btn { background: linear-gradient(135deg, #1e3c72, #2a5298); color: white; border: none; padding: 15px 30px; border-radius: 25px; font-size: 16px; font-weight: 600; cursor: pointer; transition: all 0.3s ease; text-decoration: none; display: inline-block; margin: 10px; }
    .btn:hover { transform: translateY(-2px); box-shadow: 0 10px 20px rgba(30, 60, 114, 0.3); }
    .btn-secondary { background: white; color: #1e3c72; border: 2px solid #1e3c72; }
    .btn-secondary:hover { background: #1e3c72; color: white; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; color: #999; font-size: 12px; }
    .ghana-flag { display: inline-block; margin: 0 5px; }
    @media (max-width: 600px) { .container { padding: 30px 20px; margin: 10px; } h1 { font-size: 24px; } .btn { padding: 12px 25px; font-size: 14px; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">📱</div>
    <h1>DataBot Ghana</h1>
    <p class="subtitle">Payment Verification <span class="ghana-flag">🇬🇭</span></p>
    <div class="status-card">
      <div class="status-icon loading" id="statusIcon">
        <div class="spinner"></div>
      </div>
      <div class="status-message" id="statusMessage">Verifying Payment...</div>
      <div class="status-details" id="statusDetails">Please wait while we confirm your payment with Paystack.</div>
    </div>
    <div class="reference" id="referenceDiv" style="display: none;">
      <strong>Transaction Reference:</strong><br>
      <span id="referenceText"></span>
    </div>
    <div id="actionButtons" style="display: none;">
      <a href="https://t.me/pbmhub_bot" class="btn" id="continueBtn">Continue to Telegram</a>
    </div>
    <div class="footer">
      <p>Secure payments powered by Paystack <span class="ghana-flag">🇬🇭</span></p>
      <p>© 2024 DataBot Ghana. All rights reserved.</p>
    </div>
  </div>
  <script>
    // Get reference from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const reference = urlParams.get('reference');
    if (reference) {
      document.getElementById('referenceDiv').style.display = 'block';
      document.getElementById('referenceText').textContent = reference;
    }
    // Show instructions
    setTimeout(() => {
      document.getElementById('statusIcon').className = 'status-icon success';
      document.getElementById('statusIcon').innerHTML = '✅';
      document.getElementById('statusMessage').textContent = 'Payment Completed!';
      document.getElementById('statusDetails').innerHTML = 'Your payment has been received.<br><b>Return to Telegram and click "I PAID" in the bot to complete your purchase or credit your wallet.</b>';
      document.getElementById('actionButtons').style.display = 'block';
    }, 2500);
  </script>
</body>
</html>`;

// Route to serve payment verification page
app.get("/payment-success", (req, res) => {
  const reference = req.query.reference || req.query.trxref || "";
  res.setHeader("Content-Type", "text/html");
  // Inject reference into HTML
  res.send(paymentVerificationHtml.replace(/reference\s*=\s*urlParams.get\('reference'\)/, `reference = '${reference}'`));
});

const PORT = process.env.PORT || 3000
const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://pbmtgbot.onrender.com"

// Initialize bot with webhook
const bot = new TelegramBot(BOT_TOKEN, { webHook: true })

// Start Express server first, then set webhook
app.listen(PORT, async () => {
  console.log(`🚀 Express server running on port ${PORT}`)
  try {
    await bot.setWebHook(`${WEBHOOK_URL}/webhook/${BOT_TOKEN}`)
    console.log("✅ Webhook set successfully")
  } catch (error) {
    console.error("❌ Failed to set webhook:", error)
  }
})

// Webhook endpoint
app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body)
  res.sendStatus(200)
})

// Paystack webhook for payment verification
app.post("/paystack/webhook", async (req, res) => {
  try {
    const signature = req.headers["x-paystack-signature"]
    const computed = crypto.createHmac("sha512", PAYSTACK_SECRET_KEY)
      .update(req.rawBody)
      .digest("hex")
    if (computed !== signature) return res.sendStatus(401)

    const event = req.body
    if (event?.event !== "charge.success") return res.sendStatus(200)

    const data = event.data
    const reference = data.reference
    const meta = data.metadata || {}
    const userId = Number(meta.user_id || (reference?.split("_")[1]))

    // Idempotency: skip if processed
    const already = await firebaseGet(`users/${userId}/transactions/${reference}`)
    if (already?.status === "processed") return res.sendStatus(200)

    if (meta.type === "deposit") {
      await processWalletDeposit(userId, { type: "deposit" }, reference, data.amount / 100)
    } else if (meta.type === "purchase") {
      const pkg = getPackageById(meta.package_id)
      if (!pkg) throw new Error("Unknown package")
      await processDataBundle(userId, {
        selectedPackage: pkg,
        phoneNumber: meta.phone_number,
        paymentMethod: "paystack",
      }, reference)
    }

    await saveTransaction(userId, reference, { status: "processed", at: new Date().toISOString() })
    return res.sendStatus(200)
  } catch (e) {
    console.error("Webhook error:", e)
    return res.sendStatus(500)
  }
})

// User sessions storage
const userSessions = new Map()

// Package lookup helper
function getPackageById(id) {
  for (const net in dataPackages) {
    const p = dataPackages[net].find(x => x.id === id)
    if (p) return p
  }
  return null
}

// Data packages
const dataPackages = {
  mtn: [
    {
      id: "mtn_1gb",
      volumeGB: 1,
      priceGHS: 4.9,
      network: "mtn",
      networkName: "MTN Ghana",
      network_id: 3, // Changed to MTN's correct network_id
      volume: "1000",
    },
    {
      id: "mtn_2gb",
      volumeGB: 2,
      priceGHS: 9.5,
      network: "mtn",
      networkName: "MTN Ghana",
      network_id: 3,
      volume: "2000",
    },
    {
      id: "mtn_3gb",
      volumeGB: 3,
      priceGHS: 14.2,
      network: "mtn",
      networkName: "MTN Ghana",
      network_id: 3,
      volume: "3000",
    },
    {
      id: "mtn_5gb",
      volumeGB: 5,
      priceGHS: 23,
      network: "mtn",
      networkName: "MTN Ghana",
      network_id: 3,
      volume: "5000",
    },
    {
      id: "mtn_10gb",
      volumeGB: 10,
      priceGHS: 43,
      network: "mtn",
      networkName: "MTN Ghana",
      network_id: 3,
      volume: "10000",
    },
    {
      id: "mtn_15gb",
      volumeGB: 15,
      priceGHS: 63,
      network: "mtn",
      networkName: "MTN Ghana",
      network_id: 3,
      volume: "15000",
    },
    {
      id: "mtn_20gb",
      volumeGB: 20,
      priceGHS: 84,
      network: "mtn",
      networkName: "MTN Ghana",
      network_id: 3,
      volume: "20000",
    },
    {
      id: "mtn_30gb",
      volumeGB: 30,
      priceGHS: 124,
      network: "mtn",
      networkName: "MTN Ghana",
      network_id: 3,
      volume: "30000",
    },
  ],
  telecel: [
    {
      id: "telecel_10gb",
      volumeGB: 10,
      priceGHS: 42.5,
      network: "telecel",
      networkName: "Telecel Ghana",
      network_id: 2,
      volume: "10000",
    },
    {
      id: "telecel_15gb",
      volumeGB: 15,
      priceGHS: 59.0,
      network: "telecel",
      networkName: "Telecel Ghana",
      network_id: 2,
      volume: "15000",
    },
    {
      id: "telecel_20gb",
      volumeGB: 20,
      priceGHS: 77.5,
      network: "telecel",
      networkName: "Telecel Ghana",
      network_id: 2,
      volume: "20000",
    },
    {
      id: "telecel_30gb",
      volumeGB: 30,
      priceGHS: 114.5,
      network: "telecel",
      networkName: "Telecel Ghana",
      network_id: 2,
      volume: "30000",
    },
  ],
  airteltigo: [
    {
      id: "airteltigo_1gb",
      volumeGB: 1,
      priceGHS: 4.5,
      network: "airteltigo",
      networkName: "AirtelTigo Ghana",
      network_id: 1, // Changed to AirtelTigo's correct network_id
      volume: "1000",
    },
    {
      id: "airteltigo_2gb",
      volumeGB: 2,
      priceGHS: 8.7,
      network: "airteltigo",
      networkName: "AirtelTigo Ghana",
      network_id: 1,
      volume: "2000",
    },
    {
      id: "airteltigo_3gb",
      volumeGB: 3,
      priceGHS: 12.7,
      network: "airteltigo",
      networkName: "AirtelTigo Ghana",
      network_id: 1,
      volume: "3000",
    },
    {
      id: "airteltigo_5gb",
      volumeGB: 5,
      priceGHS: 21,
      network: "airteltigo",
      networkName: "AirtelTigo Ghana",
      network_id: 1,
      volume: "5000",
    },
    {
      id: "airteltigo_10gb",
      volumeGB: 10,
      priceGHS: 39.50,
      network: "airteltigo",
      networkName: "AirtelTigo Ghana",
      network_id: 1,
      volume: "10000",
    },
    {
      id: "airteltigo_15gb",
      volumeGB: 15,
      priceGHS: 61.0,
      network: "airteltigo",
      networkName: "AirtelTigo Ghana",
      network_id: 1,
      volume: "15000",
    },
    {
      id: "airteltigo_20gb",
      volumeGB: 20,
      priceGHS: 90.5,
      network: "airteltigo",
      networkName: "AirtelTigo Ghana",
      network_id: 1,
      volume: "20000",
    },
    {
      id: "airteltigo_30gb",
      volumeGB: 30,
      priceGHS: 135.5,
      network: "airteltigo",
      networkName: "AirtelTigo Ghana",
      network_id: 1,
      volume: "30000",
    },
  ],
}

// Utility functions
function generateReference() {
  return `pbm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

function formatPhoneNumber(phone) {
  // Remove any spaces or special characters
  phone = phone.replace(/\s+/g, "").replace(/[^\d+]/g, "")

  // Strip any prefix and get last 9 digits
  const last9Digits = phone.replace(/^\+?233|^0/, "").slice(-9)
  
  // For Foster API, return just the number without prefix
  return "0" + last9Digits
}

function isValidGhanaNumber(phone) {
  // Remove any spaces or special characters
  phone = phone.replace(/\s+/g, "").replace(/[^\d+]/g, "")
  
  // Check if it matches any of these formats:
  // 0XXXXXXXXX (10 digits starting with 0)
  // 233XXXXXXXXX (12 digits starting with 233)
  // +233XXXXXXXXX (13 digits starting with +233)
  return /^(0|233|\+233)[2-9]\d{8}$/.test(phone)
}

// Admin functions
const ADMIN_USERNAME = "glenthox"

function isAdmin(username) {
  return username === ADMIN_USERNAME
}

async function sendAnnouncementToAllUsers(message, fromChatId) {
  try {
    // Get all users from Firebase
    const usersData = await firebaseGet("users")
    if (!usersData) return 0

    let successCount = 0
    let failCount = 0

    for (const userId in usersData) {
      try {
        await bot.sendMessage(userId, 
          `📢 *ANNOUNCEMENT*\n\n${message}`, 
          { parse_mode: "Markdown" }
        )
        successCount++
      } catch (error) {
        console.error(`Failed to send announcement to ${userId}:`, error)
        failCount++
      }
      // Add a small delay to avoid hitting rate limits
      await new Promise(resolve => setTimeout(resolve, 50))
    }

    // Send summary to admin
    await bot.sendMessage(fromChatId, 
      `📊 *Announcement Delivery Report*\n\n` +
      `✅ Successfully sent: ${successCount}\n` +
      `❌ Failed: ${failCount}\n` +
      `📩 Total users: ${Object.keys(usersData).length}`,
      { parse_mode: "Markdown" }
    )

    return successCount
  } catch (error) {
    console.error("Error sending announcement:", error)
    throw error
  }
}

// Bot command handlers
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id
  const user = msg.from

  // Clear any existing session but preserve user data
  userSessions.delete(chatId)

  try {
    // Check if user profile exists, create only if doesn't exist
    const existingProfile = await firebaseGet(`users/${user.id}/profile`)
    if (!existingProfile) {
      await firebaseSet(`users/${user.id}/profile`, {
        username: user.username || "unknown",
        first_name: user.first_name || "",
        last_name: user.last_name || "",
        wallet: 0,
        created_at: new Date().toISOString(),
        phone_number: null, // Initialize phone number as null
        phone_verified: false
      })
      // Prompt new user to set phone number
      await requestPhoneNumber(chatId)
      return // Don't show main menu until phone is set
    }

    // Check if existing user has phone number
    if (!existingProfile.phone_number || !existingProfile.phone_verified) {
      await requestPhoneNumber(chatId)
      return // Don't show main menu until phone is set
    }
  } catch (error) {
    console.error("Error checking/creating user profile:", error)
  }

  const welcomeMessage = `WELCOME TO PBM HUB GHANA

THE FASTEST AND MOST SECURE WAY TO BUY DATA BUNDLES IN GHANA.

FEATURES:
💰 WALLET SYSTEM
📱 MTN, TELECEL, AND AIRTELTIGO PACKAGES
🔒 SECURE PAYMENTS
⚡ FASTER DELIVERY
🕐 24/7 SERVICE
💎 BEST RATES

SELECT YOUR NETWORK TO BEGIN.`

  // Base keyboard for all users
  const baseKeyboard = [
    [
      { text: "MTN", callback_data: "network_mtn" },
      { text: "TELECEL", callback_data: "network_telecel" },
      { text: "AIRTELTIGO", callback_data: "network_airteltigo" }
    ],
    [
      { text: "💰 WALLET", callback_data: "wallet_menu" },
      { text: "📋 MY ORDERS", callback_data: "my_orders" },
      { text: "� FIND ORDER", callback_data: "find_order" }
    ],
    [
      { text: "👤 ACCOUNT", callback_data: "account_info" },
      { text: "❓ HELP", callback_data: "help" },
      { text: "🎧 SUPPORT", callback_data: "support" }
    ]
  ]

  // Add admin button if user is admin
  if (isAdmin(user.username)) {
    baseKeyboard.push([
      { text: "📢 SEND ANNOUNCEMENT", callback_data: "send_announcement" }
    ])
  }

  // Add exit button as the last row
  baseKeyboard.push([
    { text: "❌ EXIT", callback_data: "exit" }
  ])

  const keyboard = {
    inline_keyboard: baseKeyboard
  }

  bot.sendMessage(chatId, welcomeMessage, {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  })
})

bot.onText(/\/find (.+)/, async (msg, match) => {
  const chatId = msg.chat.id
  const orderId = match[1].trim()

  try {
    const order = await findOrderById(chatId, orderId)

    if (order) {
      const orderDate = new Date(order.timestamp).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })

      const orderMessage = `🔍 *ORDER FOUND*

📋 *ORDER ID:* ${orderId}
📊 *PACKAGE:* ${order.bundle}
💰 *AMOUNT:* ₵${order.amount}
🌐 *NETWORK:* ${order.network.toUpperCase()}
📱 *PHONE:* ${order.phone_number}
💳 *PAYMENT:* ${order.payment_method.toUpperCase()}
📅 *DATE:* ${orderDate}
✅ *STATUS:* ${order.status.toUpperCase()}`

      bot.sendMessage(chatId, orderMessage, { parse_mode: "Markdown" })
    } else {
      bot.sendMessage(chatId, `❌ Order with ID "${orderId}" not found.`)
    }
  } catch (error) {
    console.error("Error finding order:", error)
    bot.sendMessage(chatId, "❌ Error searching for order. Please try again.")
  }
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
      const reference = data.slice("confirm_".length) // keep the entire reference
      await handlePaymentConfirmation(chatId, messageId, reference)
    } else if (data === "my_orders") {
      await showMyOrders(chatId, messageId)
    } else if (data.startsWith("show_more_orders")) {
      await showMoreOrders(chatId, messageId)
    } else if (data === "wallet_menu") {
      await showWalletMenu(chatId, messageId)
    } else if (data === "check_balance") {
      await showWalletBalance(chatId, messageId)
    } else if (data === "deposit_wallet") {
      await initiateWalletDeposit(chatId, messageId)
    } else if (data === "account_info") {
      await showAccountInfo(chatId, messageId)
    } else if (data === "find_order") {
      await initiateFindOrder(chatId, messageId)
    } else if (data.startsWith("pay_with_")) {
      const method = data.replace("pay_with_", "")
      await handlePaymentMethodSelection(chatId, messageId, method)
    } else if (data.startsWith("confirm_announcement_")) {
      if (!isAdmin(query.from.username)) {
        await bot.editMessageText("❌ You don't have permission to send announcements.", {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "back_to_main" }]]
          }
        })
        return
      }

      const session = userSessions.get(chatId)
      if (!session || !session.announcementText) {
        await bot.editMessageText("❌ Announcement session expired. Please try again.", {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "back_to_main" }]]
          }
        })
        return
      }

      await bot.editMessageText("📢 Sending announcement to all users...", {
        chat_id: chatId,
        message_id: messageId
      })

      try {
        await sendAnnouncementToAllUsers(session.announcementText, chatId)
        userSessions.delete(chatId)
      } catch (error) {
        await bot.editMessageText("❌ Failed to send announcement. Please try again.", {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "back_to_main" }]]
          }
        })
      }
    } else if (data === "back_to_main") {
      await showMainMenu(chatId, messageId)
    } else if (data === "send_announcement") {
      if (!isAdmin(query.from.username)) {
        await bot.editMessageText("❌ You don't have permission to send announcements.", {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "back_to_main" }]]
          }
        })
        return
      }

      // Set session for announcement composition
      userSessions.set(chatId, {
        step: "compose_announcement"
      })

      await bot.editMessageText(
        `📢 *COMPOSE ANNOUNCEMENT*\n\n` +
        `Type your announcement message below.\n\n` +
        `Your message will be sent to all registered users.\n` +
        `You can use Markdown formatting:\n` +
        `*bold text*\n` +
        `_italic text_\n` +
        `[link text](URL)\n\n` +
        `Type /cancel to cancel.`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "🏠 Cancel", callback_data: "back_to_main" }]]
          }
        }
      )
    } else if (data === "exit") {
      await bot.editMessageText("👋 Thank you for using PBM Hub Ghana! See you next time.", {
        chat_id: chatId,
        message_id: messageId,
      })
    }

    try {
      await bot.answerCallbackQuery(query.id)
    } catch (answerError) {
      console.error("Failed to answer callback query:", answerError)
    }
  } catch (error) {
    console.error("Callback query error:", error)
    try {
      await bot.editMessageText("❌ An error occurred. Please try again.", {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "back_to_main" }]],
        },
      })
    } catch (editError) {
      console.error("Failed to edit message with error:", editError)
    }
  }
})

async function initiateFindOrder(chatId, messageId) {
  userSessions.set(chatId, {
    step: "find_order",
  })

  const findMessage = `🔍 *FIND ORDER*

Enter your order ID to search for your order:

Example: pbm_1234567890_abc123def`

  await bot.editMessageText(findMessage, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "back_to_main" }]],
    },
  })
}

// Message handler for user inputs
bot.on("message", async (msg) => {
  const chatId = msg.chat.id
  const text = msg.text

  // Skip if it's a command
  if (text && text.startsWith("/")) return

  const session = userSessions.get(chatId)
  if (!session) return

  try {
    if (session.step === "setup_phone") {
      if (!isValidGhanaNumber(text)) {
        await bot.sendMessage(chatId, 
          "❌ Invalid phone number. Please enter a valid Ghana phone number:\n" +
          "Examples:\n" +
          "• 0241234567\n" +
          "• +233241234567\n" +
          "• 233241234567"
        )
        return
      }

      const formattedPhone = formatPhoneNumber(text)
      await savePhoneNumber(chatId, formattedPhone)

      await bot.sendMessage(chatId,
        `✅ *Phone number set successfully!*\n\n` +
        `Your phone number: ${formattedPhone}\n\n` +
        `You can now use all features of PBM Hub Ghana.`,
        { parse_mode: "Markdown" }
      )

      // Clear session and show main menu
      userSessions.delete(chatId)
      await showMainMenu(chatId, null)
      return
    }
    
    if (session.step === "phone_number") {
      await handlePhoneNumberInput(chatId, text, session)
    } else if (session.step === "deposit_amount") {
      await handleDepositAmountInput(chatId, text)
    } else if (session.step === "find_order") {
      await handleFindOrderInput(chatId, text)
    } else if (session.step === "compose_announcement") {
      if (!isAdmin(msg.from.username)) {
        bot.sendMessage(chatId, "❌ You don't have permission to send announcements.")
        return
      }

      // Check for cancel command
      if (text.toLowerCase() === '/cancel') {
        userSessions.delete(chatId)
        await showMainMenu(chatId, null)
        return
      }

      // Show confirmation message
      const confirmKeyboard = {
        inline_keyboard: [
          [
            { text: "✅ Send", callback_data: `confirm_announcement_${Date.now()}` },
            { text: "❌ Cancel", callback_data: "back_to_main" }
          ]
        ]
      }

      await bot.sendMessage(chatId,
        `📢 *PREVIEW ANNOUNCEMENT*\n\n` +
        `${text}\n\n` +
        `Are you sure you want to send this announcement to all users?`,
        {
          parse_mode: "Markdown",
          reply_markup: confirmKeyboard
        }
      )

      // Store announcement text in session
      userSessions.set(chatId, {
        step: "confirm_announcement",
        announcementText: text
      })
    }
  } catch (error) {
    console.error("Message handling error:", error)
    bot.sendMessage(chatId, "❌ An error occurred. Please try again or contact support.")
  }
})

async function handleFindOrderInput(chatId, orderId) {
  try {
    const order = await findOrderById(chatId, orderId.trim())

    if (order) {
      const orderDate = new Date(order.timestamp).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })

      const orderMessage = `🔍 *ORDER FOUND*

📋 *ORDER ID:* ${orderId}
📊 *PACKAGE:* ${order.bundle}
💰 *AMOUNT:* ₵${order.amount}
🌐 *NETWORK:* ${order.network.toUpperCase()}
📱 *PHONE:* ${order.phone_number}
💳 *PAYMENT:* ${order.payment_method.toUpperCase()}
📅 *DATE:* ${orderDate}
✅ *STATUS:* ${order.status.toUpperCase()}`

      const keyboard = {
        inline_keyboard: [
          [
            { text: "🔄 BUY MORE DATA", callback_data: "back_to_networks" },
            { text: "🏠 MAIN MENU", callback_data: "back_to_main" },
          ],
        ],
      }

      await bot.sendMessage(chatId, orderMessage, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      })
    } else {
      await bot.sendMessage(chatId, `❌ Order with ID "${orderId}" not found.`, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🔍 Try Again", callback_data: "find_order" },
              { text: "🏠 Main Menu", callback_data: "back_to_main" },
            ],
          ],
        },
      })
    }
  } catch (error) {
    console.error("Error finding order:", error)
    await bot.sendMessage(chatId, "❌ Error searching for order. Please try again.")
  }

  // Clear session
  userSessions.delete(chatId) 
}

async function handleDepositAmountInput(chatId, text) {
  const amount = Number.parseFloat(text)

  // Check minimum and maximum deposit limits
  if (isNaN(amount) || amount < 0.5) {
    bot.sendMessage(chatId, "❌ Invalid amount. Please enter a valid amount (minimum ₵0.50):")
    return
  }
  if (amount > 1000) {
    bot.sendMessage(chatId, "❌ Maximum deposit amount is ₵1,000.00. Please enter a smaller amount:")
    return
  }

  // Calculate service charge (2%)
  const serviceCharge = amount * 0.02
  const totalAmount = amount + serviceCharge

  try {
    const reference = `deposit_${chatId}_${Date.now()}`
    const email = `user${chatId}@pbmhub.com`

    // Show charge breakdown before proceeding
    const confirmMessage = `💰 *DEPOSIT DETAILS*

Amount: ₵${amount.toFixed(2)}
Service Charge (2%): ₵${serviceCharge.toFixed(2)}
Total to Pay: ₵${totalAmount.toFixed(2)}

You will receive: ₵${amount.toFixed(2)} in your wallet.`

    await bot.sendMessage(chatId, confirmMessage, { parse_mode: "Markdown" })

    const paystackResponse = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email: email,
        amount: Math.round(totalAmount * 100), // Convert to kobo, including service charge
        reference: reference,
        callback_url: `${WEBHOOK_URL}/payment-success`,
        metadata: {
          user_id: chatId,
          type: "deposit",
          amount: amount, // Store original amount without service charge
          service_charge: serviceCharge,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      },
    )

    if (paystackResponse.data.status) {
      const paymentUrl = paystackResponse.data.data.authorization_url

      // Update session with deposit info
      userSessions.set(chatId, {
        type: "deposit",
        amount: amount,
        reference: reference,
        step: "payment_pending",
      })

      const depositMessage = 
        `💳 WALLET DEPOSIT\n\n` +
        `Amount: <b>₵${amount.toFixed(2)}</b>\n` +
        `Reference: <code>${reference}</code>\n\n` +
        `Click the link below to complete your payment:\n` +
        `${paymentUrl}\n\n` +
        `After payment, click "I HAVE PAID" to verify your transaction.`

      const keyboard = {
        inline_keyboard: [
          [{ text: "✅ I HAVE PAID", callback_data: `confirm_${reference}` }],
          [{ text: "🏠 Main Menu", callback_data: "back_to_main" }],
        ],
      }

      await bot.sendMessage(chatId, depositMessage, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      })
    } else {
      throw new Error("Failed to create payment link")
    }
  } catch (error) {
    console.error("Deposit initialization error:", error)
    bot.sendMessage(chatId, `❌ Failed to initialize deposit: ${error.message}\n\nPlease try again or contact support.`)
  }
}

async function handlePhoneNumberInput(chatId, phoneNumber, session) {
  if (!isValidGhanaNumber(phoneNumber)) {
    bot.sendMessage(
      chatId,
      "❌ Invalid phone number. Please enter a valid Ghana phone number (e.g., 0241234567 or +233241234567):",
    )
    return
  }

  const formattedPhone = formatPhoneNumber(phoneNumber)
  session.phoneNumber = formattedPhone
  userSessions.set(chatId, session)

  const { selectedPackage } = session
  const profile = await getUserProfile(chatId)
  const walletBalance = profile?.wallet || 0

  const paymentOptions = []

  // Add wallet option if user has sufficient balance
  if (walletBalance >= selectedPackage.priceGHS) {
    paymentOptions.push([{ text: `💰 PAY WITH WALLET (₵${walletBalance.toFixed(2)})`, callback_data: "pay_with_wallet" }])
  }

  // Always add Paystack option
  paymentOptions.push([{ text: "💳 PAY WITH MOMO", callback_data: "pay_with_paystack" }])
  paymentOptions.push([{ text: "🏠 MAIN MENU", callback_data: "back_to_main" }])

  const confirmMessage = `📦 *PACKAGE SELECTED*

🌐 *NETWORK:* ${selectedPackage.networkName.toUpperCase()}
📊 *PACKAGE:* ${selectedPackage.volumeGB}GB | ₵${selectedPackage.priceGHS.toFixed(2)}
📱 *PHONE NUMBER:* ${formattedPhone}

💰 *WALLET BALANCE:* ₵${walletBalance.toFixed(2)}

SELECT PAYMENT METHOD:`

  const keyboard = { inline_keyboard: paymentOptions }

  bot.sendMessage(chatId, confirmMessage, {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  })
}

async function handleNetworkSelection(chatId, messageId, network) {
  const packages = dataPackages[network]
  if (!packages) {
    await bot.editMessageText("❌ Network not available", {
      chat_id: chatId,
      message_id: messageId,
    })
    return
  }

  const networkNames = {
    mtn: "MTN GHANA",
    telecel: "TELECEL GHANA",
    airteltigo: "AIRTELTIGO GHANA",
  }

  const message = `📱 *${networkNames[network]} DATA PACKAGES*\n\nSelect your preferred data package:\n\n`

  // Create keyboard with 4 buttons per row
  const keyboard = []
  for (let i = 0; i < packages.length; i += 4) {
    const row = packages.slice(i, i + 4).map((pkg) => ({
      text: `${pkg.volumeGB}GB - ₵${pkg.priceGHS.toFixed(2)}`,
      callback_data: `package_${pkg.id}`,
    }))
    keyboard.push(row)
  }

  keyboard.push([{ text: "🔙 BACK", callback_data: "back_to_networks" }])

  await bot.editMessageText(message, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: keyboard },
  })
}

async function showNetworkSelection(chatId, messageId) {
  const message = `*SELECT YOUR NETWORK*

Choose your mobile network to view available data packages:`

  const keyboard = {
    inline_keyboard: [
      [
        { text: "MTN", callback_data: "network_mtn" },
        { text: "TELECEL", callback_data: "network_telecel" },
        { text: "AIRTELTIGO", callback_data: "network_airteltigo" },
      ],
      [{ text: "🏠 MAIN MENU", callback_data: "back_to_main" }],
    ],
  }

  await bot.editMessageText(message, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "Markdown",
    reply_markup: keyboard,
  })
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
        { text: "AIRTELTIGO", callback_data: "network_airteltigo" },
      ],
      [
        { text: "📋 MY ORDERS", callback_data: "my_orders" },
        { text: "💰 WALLET", callback_data: "wallet_menu" },
        { text: "👤 ACCOUNT", callback_data: "account_info" },
      ],
      [
        { text: "🔍 FIND ORDER", callback_data: "find_order" },
        { text: "HELP", callback_data: "help" },
        { text: "SUPPORT", callback_data: "support" },
      ],
      [{ text: "EXIT", callback_data: "exit" }],
    ],
  }

  await bot.editMessageText(welcomeMessage, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "Markdown",
    reply_markup: keyboard,
  })
}

async function handlePackageSelection(chatId, messageId, packageId) {
  // Find the package across all networks
  let selectedPackage = null
  for (const network in dataPackages) {
    const pkg = dataPackages[network].find((p) => p.id === packageId)
    if (pkg) {
      selectedPackage = pkg
      break
    }
  }

  if (!selectedPackage) {
    await bot.editMessageText("❌ Package not found", {
      chat_id: chatId,
      message_id: messageId,
    })
    return
  }

  // Store package selection in session
  userSessions.set(chatId, {
    selectedPackage,
    step: "phone_number",
  })

  const serviceCharge = selectedPackage.priceGHS * 0.02;
  const totalAmount = selectedPackage.priceGHS + serviceCharge;

  const message = `📦 *PACKAGE SELECTED*

🌐 *NETWORK:* ${selectedPackage.networkName.toUpperCase()}
📊 *PACKAGE:* ${selectedPackage.volumeGB}GB
💰 *PRICE BREAKDOWN:*
• Package Price: ₵${selectedPackage.priceGHS.toFixed(2)}
• Service Charge (2%): ₵${serviceCharge.toFixed(2)}
• Total to Pay: ₵${totalAmount.toFixed(2)}

ℹ️ *Note:* A 2% service charge is applied to all transactions to cover payment processing fees.

ENTER YOUR GHANA PHONE NUMBER (E.G. 0241234567 OR +233241234567):`

  await bot.editMessageText(message, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "Markdown",
  })
}

async function showWalletMenu(chatId, messageId) {
  try {
    const profile = await getUserProfile(chatId)
    const walletBalance = profile?.wallet || 0

    const walletMessage = `💰 *WALLET MENU*

Current Balance: ₵${walletBalance.toFixed(2)}

What would you like to do?`

    const keyboard = {
      inline_keyboard: [
        [
          { text: "💳 DEPOSIT", callback_data: "deposit_wallet" },
          { text: "📊 CHECK BALANCE", callback_data: "check_balance" },
        ],
        [
          { text: "📋 TRANSACTIONS", callback_data: "my_orders" },
          { text: "🏠 MAIN MENU", callback_data: "back_to_main" },
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
    console.error("Error showing wallet menu:", error)
    await bot.editMessageText("❌ Error loading wallet. Please try again.", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "back_to_main" }]],
      },
    })
  }
}

async function showWalletBalance(chatId, messageId) {
  try {
    const profile = await getUserProfile(chatId)
    const walletBalance = profile?.wallet || 0

    const balanceMessage = `💰 *WALLET BALANCE*

Current Balance: ₵${walletBalance.toFixed(2)}

${walletBalance < 5 ? "💡 *TIP:* Minimum deposit is ₵5.00" : "✅ You can use your wallet to buy data bundles!"}`

    const keyboard = {
      inline_keyboard: [
        [
          { text: "💳 DEPOSIT", callback_data: "deposit_wallet" },
          { text: "🔄 BUY DATA", callback_data: "back_to_networks" },
        ],
        [{ text: "🏠 MAIN MENU", callback_data: "back_to_main" }],
      ],
    }

    await bot.editMessageText(balanceMessage, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
      reply_markup: keyboard,
    })
  } catch (error) {
    console.error("Error showing wallet balance:", error)
    await bot.editMessageText("❌ Error loading balance. Please try again.", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "back_to_main" }]],
      },
    })
  }
}

async function initiateWalletDeposit(chatId, messageId) {
  userSessions.set(chatId, {
    step: "deposit_amount",
  })

  const depositMessage = `💳 *WALLET DEPOSIT*

Enter the amount you want to deposit:

• Minimum: ₵0.50
• Maximum: ₵1,000.00
• Service Charge: 2%

Example: 10 or 25.50

Note: A 2% service charge will be added to your deposit amount.`

  await bot.editMessageText(depositMessage, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "back_to_main" }]],
    },
  })
}

async function showAccountInfo(chatId, messageId) {
  try {
    const profile = await getUserProfile(chatId)
    const orders = await getLastOrders(chatId, 50)
    const successfulOrders = orders.filter((order) => order.status === "success")

    const accountMessage = `👤 *ACCOUNT INFORMATION*

👤 *NAME:* ${profile.first_name} ${profile.last_name}
📧 *USERNAME:* @${profile.username}
� *PHONE:* ${profile.phone_number || "Not set"}
�💰 *WALLET BALANCE:* ₵${(profile.wallet || 0).toFixed(2)}
📅 *MEMBER SINCE:* ${new Date(profile.created_at).toLocaleDateString("en-GB")}

📊 *STATISTICS:*
• Total Orders: ${successfulOrders.length}
• Total Spent: ₵${successfulOrders.reduce((sum, order) => sum + order.amount, 0).toFixed(2)}

💡 *ACCOUNT STATUS:* Active`

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
    await bot.editMessageText("❌ Error loading account information. Please try again.", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "back_to_main" }]],
      },
    })
  }
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
      const noOrdersMessage = `📋 *MY ORDERS*

❌ NO ORDERS FOUND

You haven't made any successful purchases yet.
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
    let ordersMessage = `📋 *MY ORDERS (SHOWING ${orders.length} OF ${allOrders.length})*\n\n`

    orders.forEach((order, index) => {
      const orderDate = new Date(order.timestamp).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })

      ordersMessage += `${index + 1}. ✅ *${order.bundle}* - ₵${order.amount}\n`
      ordersMessage += `   📅 ${orderDate}\n`
      ordersMessage += `   📱 ${order.phone_number || "N/A"}\n`
      ordersMessage += `   💳 ${order.payment_method.toUpperCase()}\n`
      ordersMessage += `   📊 SUCCESS\n\n`
    })

    ordersMessage += `💡 *TIP:* Only successful orders are shown here.`

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

    let ordersMessage = `📋 *ALL MY ORDERS (${orders.length} TOTAL)*\n\n`

    orders.forEach((order, index) => {
      const orderDate = new Date(order.timestamp).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })

      ordersMessage += `${index + 1}. ✅ *${order.bundle}* - ₵${order.amount}\n`
      ordersMessage += `   📅 ${orderDate}\n`
      ordersMessage += `   📱 ${order.phone_number || "N/A"}\n`
      ordersMessage += `   💳 ${order.payment_method.toUpperCase()}\n`
      ordersMessage += `   📊 SUCCESS\n\n`
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

async function showHelp(chatId, messageId) {
  const helpMessage = `❓ *HELP & SUPPORT*

*HOW TO BUY DATA:*
1. Select your network (MTN, Telecel, AirtelTigo)
2. Choose your data package
3. Enter your phone number
4. Select payment method (Wallet or Paystack)
5. Complete payment and receive data instantly

*WALLET SYSTEM:*
• Deposit money once, buy multiple times
• Minimum deposit: ₵5.00
• Instant crediting after successful payment
• Check balance anytime

*PAYMENT METHODS:*
• 💰 Wallet (if you have sufficient balance)
• 💳 Paystack (Mobile Money, Bank Cards)

*COMMANDS:*
• /start - Main menu
• /find [order_id] - Find specific order

*NEED MORE HELP?*
Contact our support team for assistance.`

  const keyboard = {
    inline_keyboard: [
      [
        { text: "🎧 CONTACT SUPPORT", callback_data: "support" },
        { text: "🏠 MAIN MENU", callback_data: "back_to_main" },
      ],
    ],
  }

  await bot.editMessageText(helpMessage, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "Markdown",
    reply_markup: keyboard,
  })
}

async function showSupport(chatId, messageId) {
  const supportMessage = `🎧 *CUSTOMER SUPPORT*

Need help? We're here for you!

*CONTACT METHODS:*
📧 Email: support@pbmhub.com
📱 Telegram: @glenthox
⏰ Hours: 24/7 Support

*COMMON ISSUES:*
• Payment not reflecting? Wait 5-10 minutes
• Data not received? Check your phone number
• Wallet issues? Contact support immediately

*RESPONSE TIME:*
We typically respond within 30 minutes during business hours.

For urgent issues, please use WhatsApp for faster response.`

  const keyboard = {
    inline_keyboard: [
      [
        { text: "📋 MY ORDERS", callback_data: "my_orders" },
        { text: "💰 WALLET", callback_data: "wallet_menu" },
      ],
      [{ text: "🏠 MAIN MENU", callback_data: "back_to_main" }],
    ],
  }

  await bot.editMessageText(supportMessage, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "Markdown",
    reply_markup: keyboard,
  })
}

async function handlePaymentConfirmation(chatId, messageId, reference) {
  try {
    const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
    })

    if (response.data.status && response.data.data.status === "success") {
      const v = response.data.data
      const meta = v.metadata || {}
      const type = meta.type
      // Idempotency
      const done = await firebaseGet(`users/${chatId}/transactions/${reference}`)
      if (done?.status !== "processed") {
        if (type === "deposit") {
          await processWalletDeposit(chatId, { type: "deposit" }, reference, v.amount / 100)
        } else if (type === "purchase") {
          const pkg = getPackageById(meta.package_id)
          if (!pkg) throw new Error("Unknown package")
          await processDataBundle(chatId, {
            selectedPackage: pkg,
            phoneNumber: meta.phone_number,
            paymentMethod: "paystack",
          }, reference)
        }
        await saveTransaction(chatId, reference, { status: "processed", at: new Date().toISOString() })
      }
      
      await bot.editMessageText("✅ Payment verified and processed successfully!", {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "back_to_main" }]],
        },
      })
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

  if (method === "wallet") {
    try {
      // Deduct from wallet
      await deductFromWallet(chatId, selectedPackage.priceGHS)

      // Process data bundle purchase
      const result = await purchaseDataBundle(session.phoneNumber, selectedPackage.network_id, selectedPackage.volume)

      if (result.status === "success") {
        const reference = generateReference()

        // Save successful order
        await saveOrder(chatId, reference, {
          amount: selectedPackage.priceGHS,
          bundle: `${selectedPackage.volumeGB}GB`,
          network: selectedPackage.network,
          phone_number: session.phoneNumber,
          payment_method: "wallet",
          status: "success",
          timestamp: new Date().toISOString(),
        })

        const successMessage = `✅ *PURCHASE SUCCESSFUL*

🌐 *NETWORK:* ${selectedPackage.networkName.toUpperCase()}
📊 *PACKAGE:* ${selectedPackage.volumeGB}GB | ₵${selectedPackage.priceGHS.toFixed(2)}
� *SERVICE CHARGE (2%):* ₵${(selectedPackage.priceGHS * 0.02).toFixed(2)}
💵 *TOTAL PAID:* ₵${(selectedPackage.priceGHS * 1.02).toFixed(2)}
�📱 *PHONE:* ${session.phoneNumber}
💳 *PAYMENT:* WALLET
📋 *ORDER ID:* ${reference}

Your data bundle has been delivered successfully!`

        await bot.editMessageText(successMessage, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "🔄 BUY MORE", callback_data: "back_to_networks" },
                { text: "🏠 MAIN MENU", callback_data: "back_to_main" },
              ],
            ],
          },
        })
      } else {
        // Refund wallet if purchase failed
        await updateWallet(chatId, selectedPackage.priceGHS)

        await bot.editMessageText("❌ Data bundle purchase failed. Your wallet has been refunded.", {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [
                { text: "🔄 TRY AGAIN", callback_data: `package_${selectedPackage.id}` },
                { text: "🎧 SUPPORT", callback_data: "support" },
              ],
            ],
          },
        })
      }
    } catch (error) {
      console.error("Wallet payment error:", error)
      await bot.editMessageText(`❌ ${error.message}`, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [
            [
              { text: "💳 DEPOSIT", callback_data: "deposit_wallet" },
              { text: "🏠 MAIN MENU", callback_data: "back_to_main" },
            ],
          ],
        },
      })
    }
  } else if (method === "paystack") {
    try {
      const reference = `purchase_${chatId}_${Date.now()}`
      const email = `user${chatId}@pbmhub.com`

      // Calculate service charge (2%) for direct purchase
      const serviceCharge = selectedPackage.priceGHS * 0.02;
      const totalAmount = selectedPackage.priceGHS + serviceCharge;

      // Create Paystack payment link
      const paystackResponse = await axios.post(
        "https://api.paystack.co/transaction/initialize",
        {
          email: email,
          amount: Math.round(totalAmount * 100), // Convert to kobo, including service charge
          reference: reference,
          callback_url: `${WEBHOOK_URL}/payment-success`,
          metadata: {
            user_id: chatId,
            type: "purchase",
            package_id: selectedPackage.id,
            phone_number: session.phoneNumber,
            original_amount: selectedPackage.priceGHS,
            service_charge: serviceCharge,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
        },
      )

      if (paystackResponse.data.status) {
        const paymentUrl = paystackResponse.data.data.authorization_url

        // Update session with purchase info
        userSessions.set(chatId, {
          ...session,
          type: "purchase",
          reference: reference,
          paymentMethod: "paystack",
          step: "payment_pending",
        })

        const paymentMessage = 
          `💳 <b>PAYMENT REQUIRED</b>\n\n` +
          `🌐 <b>NETWORK:</b> ${selectedPackage.networkName.toUpperCase()}\n` +
          `📊 <b>PACKAGE:</b> ${selectedPackage.volumeGB}GB | ₵${selectedPackage.priceGHS.toFixed(2)}\n` +
          `� <b>SERVICE CHARGE (2%):</b> ₵${serviceCharge.toFixed(2)}\n` +
          `💵 <b>TOTAL:</b> ₵${totalAmount.toFixed(2)}\n` +
          `�📱 <b>PHONE:</b> ${session.phoneNumber}\n` +
          `📋 <b>REFERENCE:</b> <code>${reference}</code>\n\n` +
          `Click the link below to complete your payment:\n` +
          `${paymentUrl}\n\n` +
          `After payment, click "I PAID" to verify your transaction.`

        const keyboard = {
          inline_keyboard: [
            [{ text: "✅ I PAID", callback_data: `confirm_${reference}` }],
            [{ text: "🏠 Main Menu", callback_data: "back_to_main" }],
          ],
        }

        await bot.editMessageText(paymentMessage, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "HTML",
          reply_markup: keyboard,
        })
      } else {
        throw new Error("Failed to create payment link")
      }
    } catch (error) {
      console.error("Paystack payment error:", error)
      await bot.editMessageText(
        `❌ Failed to initialize payment: ${error.message}\n\nPlease try again or contact support.`,
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [
                { text: "🔄 TRY AGAIN", callback_data: `package_${selectedPackage.id}` },
                { text: "🎧 SUPPORT", callback_data: "support" },
              ],
            ],
          },
        },
      )
    }
  }

  // Clear session after processing
  userSessions.delete(chatId)
}

async function processWalletDeposit(chatId, session, reference, amount) {
  try {
    await updateWallet(chatId, amount)

    const depositMessage = `✅ *WALLET DEPOSIT SUCCESSFUL*

💰 *AMOUNT:* ₵${amount.toFixed(2)}
📋 *REFERENCE:* ${reference}
📅 *DATE:* ${new Date().toLocaleDateString("en-GB")}
✅ *STATUS:* COMPLETED

Your wallet has been credited successfully!`

    const keyboard = {
      inline_keyboard: [
        [
          { text: "🔄 BUY DATA", callback_data: "back_to_networks" },
          { text: "💰 WALLET", callback_data: "wallet_menu" },
        ],
        [{ text: "🏠 MAIN MENU", callback_data: "back_to_main" }],
      ],
    }

    await bot.sendMessage(chatId, depositMessage, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    })
  } catch (error) {
    console.error("Error processing wallet deposit:", error)
    await bot.sendMessage(chatId, "❌ An error occurred while processing your deposit. Please contact support.")
  }
}

async function processDataBundle(chatId, session, reference) {
  try {
    // Check if order was already processed
    const existingOrder = await firebaseGet(`users/${chatId}/orders/${reference}`)
    if (existingOrder?.status === "success") {
      console.log(`Order ${reference} was already processed successfully`)
      return true
    }

    const { selectedPackage, phoneNumber } = session
    
    // Save pending order first
    await firebaseSet(`users/${chatId}/orders/${reference}`, {
      amount: selectedPackage.priceGHS,
      bundle: `${selectedPackage.volumeGB}GB`,
      network: selectedPackage.network,
      phone_number: phoneNumber,
      payment_method: session.paymentMethod || "paystack",
      status: "pending",
      timestamp: new Date().toISOString(),
    })

    const result = await purchaseDataBundle(phoneNumber, selectedPackage.network_id, selectedPackage.volume)

    if (result.status === "success") {
      // Update order to success
      await saveOrder(chatId, reference, {
        amount: selectedPackage.priceGHS,
        bundle: `${selectedPackage.volumeGB}GB`,
        network: selectedPackage.network,
        phone_number: phoneNumber,
        payment_method: session.paymentMethod || "paystack",
        status: "success",
        timestamp: new Date().toISOString(),
        provider_transaction_id: result.data.transaction_code,
        provider_response: {
          status: "success",
          message: result.data.message,
          transaction_code: result.data.transaction_code
        }
      })

      const successMessage = `✅ *DATA BUNDLE PURCHASE SUCCESSFUL*

🌐 *NETWORK:* ${selectedPackage.networkName.toUpperCase()}
📊 *PACKAGE:* ${selectedPackage.volumeGB}GB | ₵${selectedPackage.priceGHS.toFixed(2)}
📱 *PHONE:* ${phoneNumber}
📋 *ORDER ID:* ${reference}
📅 *DATE:* ${new Date().toLocaleDateString("en-GB")}

Your data bundle has been successfully delivered!`

      const keyboard = {
        inline_keyboard: [
          [
            { text: "🔄 BUY MORE", callback_data: "back_to_networks" },
            { text: "📋 MY ORDERS", callback_data: "my_orders" },
          ],
          [{ text: "🏠 MAIN MENU", callback_data: "back_to_main" }],
        ],
      }

      await bot.sendMessage(chatId, successMessage, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      })
    } else {
      // Don't save failed orders
      const errorMessage = `❌ *DATA BUNDLE PURCHASE FAILED*

🌐 *NETWORK:* ${selectedPackage.networkName.toUpperCase()}
📊 *PACKAGE:* ${selectedPackage.volumeGB}GB | ₵${selectedPackage.priceGHS.toFixed(2)}
📱 *PHONE:* ${phoneNumber}

The purchase failed. Please contact support for assistance.`

      const keyboard = {
        inline_keyboard: [
          [
            { text: "🔄 TRY AGAIN", callback_data: `package_${selectedPackage.id}` },
            { text: "🎧 SUPPORT", callback_data: "support" },
          ],
        ],
      }

      await bot.sendMessage(chatId, errorMessage, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      })
    }
  } catch (error) {
    console.error("Error processing data bundle:", error)
    await bot.sendMessage(chatId, "❌ An error occurred while processing your purchase. Please contact support.")
  }
}

// Foster Console API integration
async function purchaseDataBundle(phoneNumber, networkId, volume, retryCount = 0) {
  try {
    // Format phone number for Foster API (0-prefixed, no country code)
    const formattedPhone = phoneNumber.replace(/^\+?233|^0/, "")
    const phone = "0" + formattedPhone

    console.log(`Attempting to purchase bundle: Phone=${phone}, Network=${networkId}, Volume=${volume}`)

    const response = await axios.post(
      `${FOSTER_BASE_URL}/buy-other-package`,
      {
        recipient_msisdn: phone,
        network_id: networkId,
        shared_bundle: volume
      },
      {
        headers: {
          "x-api-key": FOSTER_API_KEY,
          "Accept": "application/json",
          "Content-Type": "application/json"
        },
        timeout: 30000,
      },
    )

    console.log("Foster API Response:", response.data)

    if (!response.data) {
      throw new Error("Empty response from Foster API")
    }

    // According to API docs, success response has success: true
    if (response.data.success === true) {
      return {
        status: "success",
        message: response.data.message || "Package purchased successfully",
        data: {
          transaction_code: response.data.transaction_code,
          ...response.data
        }
      }
    } else {
      // API returns 400 for insufficient balance, 404 for package not found
      throw new Error(response.data.message || "Purchase failed")
    }
  } catch (error) {
    console.error("Foster API error:", error)

    // Handle specific API error cases
    if (error.response) {
      const errorMsg = error.response.data?.message;
      
      switch (error.response.status) {
        case 403:
          throw new Error("This network is not available for purchase")
        case 404:
          throw new Error("Package not found or out of stock")
        case 400:
          if (errorMsg?.toLowerCase().includes("insufficient")) {
            throw new Error("Insufficient balance in vendor account")
          }
          throw new Error(errorMsg || "Invalid request parameters")
        default:
          console.error("Foster API Error Response:", error.response.data)
          throw new Error(errorMsg || "Service temporarily unavailable")
      }
    }

    // Implement retry logic for transient errors
    if (retryCount < 2 && (
      error.code === 'ECONNRESET' ||
      error.code === 'ETIMEDOUT' ||
      error.response?.status >= 500
    )) {
      console.log(`Retrying purchase attempt ${retryCount + 1}/2...`)
      await new Promise(resolve => setTimeout(resolve, 2000 * (retryCount + 1)))
      return purchaseDataBundle(phoneNumber, networkId, volume, retryCount + 1)
    }

    return {
      status: "failed",
      message: error.response?.data?.message || "Network error occurred",
      error: error.message,
    }
  }
}

// Error handling
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason)
})

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error)
})

console.log("🤖 PBM Hub Ghana Bot is running...")

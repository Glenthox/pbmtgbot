require("dotenv").config()
const TelegramBot = require("node-telegram-bot-api")
const axios = require("axios")
const crypto = require("crypto")
const express = require("express")
const bodyParser = require("body-parser")
const path = require("path")

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
app.use(bodyParser.json())
app.use(express.static(path.join(__dirname, "public")))

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

app.post("/paystack/webhook", async (req, res) => {
  const hash = crypto.createHmac("sha512", PAYSTACK_SECRET_KEY).update(JSON.stringify(req.body)).digest("hex")

  if (hash === req.headers["x-paystack-signature"]) {
    const event = req.body
    console.log("[v0] Webhook received:", event.event, event.data?.reference)

    if (event.event === "charge.success") {
      const { reference, amount, customer } = event.data

      // Extract user ID from reference - handle both formats
      let userId
      if (reference.startsWith("deposit_")) {
        userId = reference.split("_")[1]
      } else if (reference.startsWith("purchase_")) {
        userId = reference.split("_")[1]
      } else {
        userId = reference.split("_")[1] // fallback for old format
      }

      console.log("[v0] Processing webhook for user:", userId, "reference:", reference)

      try {
        const session = userSessions.get(Number.parseInt(userId))
        if (session && session.reference === reference) {
          console.log("[v0] Session found for webhook processing")

          if (session.type === "deposit") {
            await processWalletDeposit(Number.parseInt(userId), session, reference, amount / 100)
          } else if (session.type === "purchase") {
            await processDataBundle(Number.parseInt(userId), session, reference)
          }

          // Clear session after successful processing
          userSessions.delete(Number.parseInt(userId))
          console.log("[v0] Session cleared after webhook processing")
        } else {
          console.log("[v0] No matching session found for webhook")
        }
      } catch (error) {
        console.error("[v0] Webhook processing error:", error)
      }
    }
  } else {
    console.log("[v0] Invalid webhook signature")
  }

  res.sendStatus(200)
})

app.get("/payment-success", (req, res) => {
  const { reference, status, amount, type } = req.query
  console.log("[v0] Payment success redirect:", { reference, status, amount, type })

  // Generate embedded HTML response instead of redirecting to separate file
  const htmlContent = generatePaymentSuccessHTML(reference, status, amount, type)
  res.send(htmlContent)
})

function generatePaymentSuccessHTML(reference, status, amount, type) {
  const isSuccess = status === "success" || status === "successful"
  const statusColor = isSuccess ? "#10B981" : "#EF4444"
  const statusIcon = isSuccess ? "✅" : "❌"
  const statusText = isSuccess ? "Payment Successful!" : "Payment Failed"

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Payment ${isSuccess ? "Successful" : "Failed"} - PBM Hub Ghana</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        
        .container {
            background: white;
            border-radius: 20px;
            padding: 40px 30px;
            text-align: center;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            max-width: 400px;
            width: 100%;
            animation: slideUp 0.6s ease-out;
        }
        
        @keyframes slideUp {
            from {
                opacity: 0;
                transform: translateY(30px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        .status-icon {
            font-size: 4rem;
            margin-bottom: 20px;
            display: block;
        }
        
        .status-title {
            color: ${statusColor};
            font-size: 1.8rem;
            font-weight: 700;
            margin-bottom: 10px;
        }
        
        .status-subtitle {
            color: #6B7280;
            font-size: 1rem;
            margin-bottom: 30px;
        }
        
        .details {
            background: #F9FAFB;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 30px;
            text-align: left;
        }
        
        .detail-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 0;
            border-bottom: 1px solid #E5E7EB;
        }
        
        .detail-row:last-child {
            border-bottom: none;
        }
        
        .detail-label {
            color: #6B7280;
            font-weight: 500;
        }
        
        .detail-value {
            color: #111827;
            font-weight: 600;
        }
        
        .return-button {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 15px 30px;
            border-radius: 12px;
            font-size: 1.1rem;
            font-weight: 600;
            cursor: pointer;
            text-decoration: none;
            display: inline-block;
            transition: transform 0.2s ease;
            width: 100%;
        }
        
        .return-button:hover {
            transform: translateY(-2px);
        }
        
        .footer {
            margin-top: 20px;
            color: #9CA3AF;
            font-size: 0.9rem;
        }
        
        .loading {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid #f3f3f3;
            border-top: 3px solid #667eea;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-left: 10px;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="container">
        <span class="status-icon">${statusIcon}</span>
        <h1 class="status-title">${statusText}</h1>
        <p class="status-subtitle">
            ${
              isSuccess
                ? "Your payment has been processed successfully!"
                : "There was an issue processing your payment."
            }
        </p>
        
        <div class="details">
            <div class="detail-row">
                <span class="detail-label">Reference:</span>
                <span class="detail-value">${reference || "N/A"}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Amount:</span>
                <span class="detail-value">₵${amount || "0.00"}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Type:</span>
                <span class="detail-value">${type === "deposit" ? "Wallet Deposit" : "Bundle Purchase"}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Status:</span>
                <span class="detail-value" style="color: ${statusColor}">${statusText}</span>
            </div>
        </div>
        
        <button class="return-button" onclick="returnToBot()">
            <span id="button-text">Return to Bot</span>
            <span id="loading" class="loading" style="display: none;"></span>
        </button>
        
        <div class="footer">
            <p>PBM Hub Ghana - Secure Data Bundle Service</p>
            <p>Need help? Contact @glenthox on Telegram</p>
        </div>
    </div>

    <script>
        function returnToBot() {
            const button = document.querySelector('.return-button');
            const buttonText = document.getElementById('button-text');
            const loading = document.getElementById('loading');
            
            buttonText.style.display = 'none';
            loading.style.display = 'inline-block';
            button.disabled = true;
            
            // Auto-redirect to Telegram after 2 seconds
            setTimeout(() => {
                window.location.href = 'https://t.me/pbmhubghanabot';
            }, 2000);
        }
        
        // Auto-redirect after 10 seconds if user doesn't click
        setTimeout(() => {
            returnToBot();
        }, 10000);
    </script>
</body>
</html>
  `
}

app.get("/verify.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "payment-success.html"))
})

// User sessions storage
const userSessions = new Map()

// Data packages
const dataPackages = {
  mtn: [
    {
      id: "mtn_1gb",
      volumeGB: 1,
      priceGHS: 4.8,
      network: "mtn",
      networkName: "MTN Ghana",
      network_id: 1,
      volume: "1024",
    },
    {
      id: "mtn_2gb",
      volumeGB: 2,
      priceGHS: 9.6,
      network: "mtn",
      networkName: "MTN Ghana",
      network_id: 1,
      volume: "2048",
    },
    {
      id: "mtn_3gb",
      volumeGB: 3,
      priceGHS: 14.4,
      network: "mtn",
      networkName: "MTN Ghana",
      networkName: "MTN Ghana",
      network_id: 1,
      volume: "3072",
    },
    {
      id: "mtn_5gb",
      volumeGB: 5,
      priceGHS: 24.0,
      network: "mtn",
      networkName: "MTN Ghana",
      network_id: 1,
      volume: "5120",
    },
    {
      id: "mtn_10gb",
      volumeGB: 10,
      priceGHS: 48.0,
      network: "mtn",
      networkName: "MTN Ghana",
      network_id: 1,
      volume: "10240",
    },
    {
      id: "mtn_15gb",
      volumeGB: 15,
      priceGHS: 72.0,
      network: "mtn",
      networkName: "MTN Ghana",
      network_id: 1,
      volume: "15360",
    },
    {
      id: "mtn_20gb",
      volumeGB: 20,
      priceGHS: 96.0,
      network: "mtn",
      networkName: "MTN Ghana",
      network_id: 1,
      volume: "20480",
    },
    {
      id: "mtn_30gb",
      volumeGB: 30,
      priceGHS: 144.0,
      network: "mtn",
      networkName: "MTN Ghana",
      network_id: 1,
      volume: "30720",
    },
  ],
  telecel: [
    {
      id: "telecel_1gb",
      volumeGB: 1,
      priceGHS: 5.0,
      network: "telecel",
      networkName: "Telecel Ghana",
      network_id: 2,
      volume: "1024",
    },
    {
      id: "telecel_2gb",
      volumeGB: 2,
      priceGHS: 10.0,
      network: "telecel",
      networkName: "Telecel Ghana",
      network_id: 2,
      volume: "2048",
    },
    {
      id: "telecel_3gb",
      volumeGB: 3,
      priceGHS: 15.0,
      network: "telecel",
      networkName: "Telecel Ghana",
      network_id: 2,
      volume: "3072",
    },
    {
      id: "telecel_5gb",
      volumeGB: 5,
      priceGHS: 25.0,
      network: "telecel",
      networkName: "Telecel Ghana",
      network_id: 2,
      volume: "5120",
    },
    {
      id: "telecel_10gb",
      volumeGB: 10,
      priceGHS: 50.0,
      network: "telecel",
      networkName: "Telecel Ghana",
      network_id: 2,
      volume: "10240",
    },
    {
      id: "telecel_15gb",
      volumeGB: 15,
      priceGHS: 75.0,
      network: "telecel",
      networkName: "Telecel Ghana",
      network_id: 2,
      volume: "15360",
    },
    {
      id: "telecel_20gb",
      volumeGB: 20,
      priceGHS: 100.0,
      network: "telecel",
      networkName: "Telecel Ghana",
      network_id: 2,
      volume: "20480",
    },
    {
      id: "telecel_30gb",
      volumeGB: 30,
      priceGHS: 150.0,
      network: "telecel",
      networkName: "Telecel Ghana",
      network_id: 2,
      volume: "30720",
    },
  ],
  airteltigo: [
    {
      id: "airteltigo_1gb",
      volumeGB: 1,
      priceGHS: 4.5,
      network: "airteltigo",
      networkName: "AirtelTigo Ghana",
      network_id: 3,
      volume: "1024",
    },
    {
      id: "airteltigo_2gb",
      volumeGB: 2,
      priceGHS: 9.0,
      network: "airteltigo",
      networkName: "AirtelTigo Ghana",
      network_id: 3,
      volume: "2048",
    },
    {
      id: "airteltigo_3gb",
      volumeGB: 3,
      priceGHS: 13.5,
      network: "airteltigo",
      networkName: "AirtelTigo Ghana",
      network_id: 3,
      volume: "3072",
    },
    {
      id: "airteltigo_5gb",
      volumeGB: 5,
      priceGHS: 22.5,
      network: "airteltigo",
      networkName: "AirtelTigo Ghana",
      network_id: 3,
      volume: "5120",
    },
    {
      id: "airteltigo_10gb",
      volumeGB: 10,
      priceGHS: 45.0,
      network: "airteltigo",
      networkName: "AirtelTigo Ghana",
      network_id: 3,
      volume: "10240",
    },
    {
      id: "airteltigo_15gb",
      volumeGB: 15,
      priceGHS: 67.5,
      network: "airteltigo",
      networkName: "AirtelTigo Ghana",
      network_id: 3,
      volume: "15360",
    },
    {
      id: "airteltigo_20gb",
      volumeGB: 20,
      priceGHS: 90.0,
      network: "airteltigo",
      networkName: "AirtelTigo Ghana",
      network_id: 3,
      volume: "20480",
    },
    {
      id: "airteltigo_30gb",
      volumeGB: 30,
      priceGHS: 135.0,
      network: "airteltigo",
      networkName: "AirtelTigo Ghana",
      network_id: 3,
      volume: "30720",
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

  // Convert to international format
  if (phone.startsWith("0")) {
    return "+233" + phone.substring(1)
  } else if (phone.startsWith("233")) {
    return "+" + phone
  } else if (phone.startsWith("+233")) {
    return phone
  }

  return phone
}

function isValidGhanaNumber(phone) {
  const formatted = formatPhoneNumber(phone)
  return /^\+233[2-9]\d{8}$/.test(formatted)
}

function validateMinimumOrder(amount) {
  const MINIMUM_ORDER = 1.0 // 1 GHC minimum
  return amount >= MINIMUM_ORDER
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

async function handlePaymentMethodSelection(chatId, messageId, method) {
  const session = userSessions.get(chatId)
  if (!session || !session.selectedPackage || !session.phoneNumber) {
    await bot.editMessageText("❌ Session expired. Please start again.", {
      chat_id: chatId,
      message_id: messageId,
    })
    return
  }

  if (method === "wallet") {
    // Handle wallet payment
    // (Code for wallet payment will be added here later)
  } else if (method === "paystack") {
    // Initialize Paystack transaction
    const { selectedPackage, phoneNumber } = session
    const amount = selectedPackage.priceGHS
    const reference = `purchase_${chatId}_${Date.now()}`
    const email = `user${chatId}@pbmhub.com`

    try {
      const paystackResponse = await axios.post(
        "https://api.paystack.co/transaction/initialize",
        {
          email: email,
          amount: Math.round(amount * 100), // Convert to kobo
          reference: reference,
          callback_url: `${WEBHOOK_URL}/payment-success?reference=${reference}&amount=${amount}&type=purchase`,
          metadata: {
            user_id: chatId,
            type: "purchase",
            amount: amount,
            phone_number: phoneNumber,
            package_id: selectedPackage.id,
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

        // Update session with payment info
        session.type = "purchase"
        session.amount = amount
        session.reference = reference
        userSessions.set(chatId, session)

        const paymentMessage = `💳 *PAYMENT REQUIRED*

Click the link below to complete your payment:
${paymentUrl}

After successful payment, return here and click "I PAID" to verify your transaction.`

        const keyboard = {
          inline_keyboard: [
            [{ text: "✅ I PAID", callback_data: `confirm_${reference}` }],
            [{ text: "🏠 Main Menu", callback_data: "back_to_main" }],
          ],
        }

        await bot.editMessageText(paymentMessage, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "Markdown",
          reply_markup: keyboard,
        })
      } else {
        throw new Error("Failed to create payment link")
      }
    } catch (error) {
      console.error("Paystack initialization error:", error)
      await bot.editMessageText(
        `❌ Failed to initialize payment: ${error.message}\n\nPlease try again or contact support.`,
        {
          chat_id: chatId,
          message_id: messageId,
        },
      )
    }
  } else {
    await bot.editMessageText("❌ Invalid payment method selected.", {
      chat_id: chatId,
      message_id: messageId,
    })
  }
}

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
      await verifyPayment(chatId, messageId, reference)
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
    } else if (data === "back_to_main") {
      await showMainMenu(chatId, messageId)
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
    if (session.step === "phone_number") {
      await handlePhoneNumberInput(chatId, text, session)
    } else if (session.step === "deposit_amount") {
      await handleDepositAmountInput(chatId, text)
    } else if (session.step === "find_order") {
      await handleFindOrderInput(chatId, text)
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

  if (isNaN(amount) || amount < 5) {
    bot.sendMessage(chatId, "❌ Invalid amount. Please enter a valid amount (minimum ₵5.00):")
    return
  }

  try {
    const reference = `deposit_${chatId}_${Date.now()}`
    const email = `user${chatId}@pbmhub.com`

    const paystackResponse = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email: email,
        amount: Math.round(amount * 100), // Convert to kobo
        reference: reference,
        callback_url: `${WEBHOOK_URL}/payment-success?reference=${reference}&amount=${amount}&type=deposit`,
        metadata: {
          user_id: chatId,
          type: "deposit",
          amount: amount,
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

      const depositMessage = `💳 WALLET DEPOSIT

Amount: ₵${amount.toFixed(2)}
Reference: ${reference}

Click the link below to complete your payment:
${paymentUrl}

After successful payment, return here and click "I PAID" to verify your transaction.`

      const keyboard = {
        inline_keyboard: [
          [{ text: "✅ I PAID", callback_data: `confirm_${reference}` }],
          [{ text: "🏠 Main Menu", callback_data: "back_to_main" }],
        ],
      }

      await bot.sendMessage(chatId, depositMessage, {
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
  await showPackageConfirmation(chatId, selectedPackage, formattedPhone)
}

async function showPackageConfirmation(chatId, selectedPackage, phoneNumber) {
  if (!validateMinimumOrder(selectedPackage.priceGHS)) {
    const errorMessage = `❌ *MINIMUM ORDER REQUIREMENT*

The minimum order amount is ₵1.00
Selected package: ₵${selectedPackage.priceGHS.toFixed(2)}

Please select a package worth at least ₵1.00`

    const keyboard = {
      inline_keyboard: [
        [{ text: "🔙 SELECT PACKAGE", callback_data: `network_${selectedPackage.network}` }],
        [{ text: "🏠 MAIN MENU", callback_data: "back_to_main" }],
      ],
    }

    bot.sendMessage(chatId, errorMessage, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    })
    return
  }

  const profile = await getUserProfile(chatId)
  const walletBalance = profile?.wallet || 0

  const paymentOptions = []

  // Add wallet option if user has sufficient balance
  if (walletBalance >= selectedPackage.priceGHS) {
    paymentOptions.push([{ text: `💰 WALLET (₵${walletBalance.toFixed(2)})`, callback_data: "pay_with_wallet" }])
  }

  // Always add Paystack option
  paymentOptions.push([{ text: "💳 PAYSTACK", callback_data: "pay_with_paystack" }])
  paymentOptions.push([{ text: "🏠 MAIN MENU", callback_data: "back_to_main" }])

  const confirmMessage = `📦 *PACKAGE SELECTED*

🌐 *NETWORK:* ${selectedPackage.networkName.toUpperCase()}
📊 *PACKAGE:* ${selectedPackage.volumeGB}GB | ₵${selectedPackage.priceGHS.toFixed(2)}
📱 *PHONE NUMBER:* ${phoneNumber}

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

  const message = `📦 *PACKAGE SELECTED*

🌐 *NETWORK:* ${selectedPackage.networkName.toUpperCase()}
📊 *PACKAGE:* ${selectedPackage.volumeGB}GB | ₵${selectedPackage.priceGHS.toFixed(2)}

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

Enter the amount you want to deposit (minimum ₵5.00):

Example: 10 or 25.50`

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
💰 *WALLET BALANCE:* ₵${(profile.wallet || 0).toFixed(2)}
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

For urgent issues, please contact @glenthox on Telegram for faster response.`

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

async function verifyPayment(chatId, messageId, reference) {
  console.log("[v0] Manual verification requested for:", reference)

  try {
    // Show loading message
    await bot.editMessageText("🔍 Verifying payment... Please wait.", {
      chat_id: chatId,
      message_id: messageId,
    })

    const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      },
    })

    console.log("[v0] Paystack verification response:", response.data.data?.status)

    if (response.data.status && response.data.data.status === "success") {
      const session = userSessions.get(chatId)

      if (!session) {
        console.log("[v0] No session found for manual verification")
        await bot.editMessageText("❌ Session expired. Please start a new transaction.", {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [[{ text: "🏠 Start Over", callback_data: "back_to_main" }]],
          },
        })
        return
      }

      // Validate that the reference matches the session
      if (session.reference !== reference) {
        console.log("[v0] Reference mismatch in session")
        await bot.editMessageText("❌ Payment reference mismatch. Please try again.", {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [[{ text: "🏠 Start Over", callback_data: "back_to_main" }]],
          },
        })
        return
      }

      console.log("[v0] Processing manual verification for type:", session.type)

      if (session.type === "deposit") {
        await processWalletDeposit(chatId, session, reference, session.amount)
      } else if (session.type === "purchase") {
        await processDataBundle(chatId, session, reference)
      }

      // Clear session after successful processing
      userSessions.delete(chatId)
      console.log("[v0] Session cleared after manual verification")

      await bot.editMessageText("✅ Payment verified and processed successfully!", {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "back_to_main" }]],
        },
      })
    } else {
      console.log("[v0] Payment verification failed:", response.data.data?.status)
      await bot.editMessageText(
        `❌ Payment verification failed. 

Status: ${response.data.data?.status || "Unknown"}
Reference: ${reference}

Please ensure payment was completed successfully and try again.`,
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔄 Try Again", callback_data: `confirm_${reference}` }],
              [{ text: "🎧 Contact Support", url: "https://t.me/glenthox" }],
              [{ text: "🏠 Main Menu", callback_data: "back_to_main" }],
            ],
          },
        },
      )
    }
  } catch (error) {
    console.error("[v0] Payment verification error:", error)
    await bot.editMessageText(
      `❌ Verification failed: ${error.message}

Please try again or contact support if the issue persists.`,
      {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔄 Try Again", callback_data: `confirm_${reference}` }],
            [{ text: "🎧 Contact Support", url: "https://t.me/glenthox" }],
            [{ text: "🏠 Main Menu", callback_data: "back_to_main" }],
          ],
        },
      },
    )
  }
}

async function processWalletDeposit(chatId, session, reference, amount) {
  console.log("[v0] Processing wallet deposit:", { chatId, reference, amount })

  try {
    // Update wallet balance
    const newBalance = await updateWallet(chatId, amount)
    console.log("[v0] Wallet updated, new balance:", newBalance)

    // Save transaction record
    await saveTransaction(chatId, reference, {
      type: "deposit",
      amount: amount,
      reference: reference,
      status: "success",
      timestamp: new Date().toISOString(),
    })

    const depositMessage = `✅ *WALLET DEPOSIT SUCCESSFUL*

💰 *AMOUNT:* ₵${amount.toFixed(2)}
📋 *REFERENCE:* ${reference}
📅 *DATE:* ${new Date().toLocaleDateString("en-GB")}
💳 *NEW BALANCE:* ₵${newBalance.toFixed(2)}
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
    console.error("[v0] Error processing wallet deposit:", error)
    await bot.sendMessage(chatId, "❌ An error occurred while processing your deposit. Please contact support.")
  }
}

async function processDataBundle(chatId, session, reference) {
  console.log("[v0] Processing data bundle:", { chatId, reference, package: session.selectedPackage?.id })

  try {
    const { selectedPackage, phoneNumber } = session

    if (!selectedPackage || !phoneNumber) {
      throw new Error("Missing package or phone number information")
    }

    const result = await purchaseDataBundle(phoneNumber, selectedPackage.network_id, selectedPackage.volume)
    console.log("[v0] Bundle purchase result:", result.status)

    if (result.status === "success") {
      // Save successful order
      await saveOrder(chatId, reference, {
        amount: selectedPackage.priceGHS,
        bundle: `${selectedPackage.volumeGB}GB`,
        network: selectedPackage.network,
        phone_number: phoneNumber,
        payment_method: "paystack",
        status: "success",
        timestamp: new Date().toISOString(),
      })

      // Save transaction record
      await saveTransaction(chatId, reference, {
        type: "purchase",
        amount: selectedPackage.priceGHS,
        reference: reference,
        package: `${selectedPackage.volumeGB}GB`,
        network: selectedPackage.network,
        phone: phoneNumber,
        status: "success",
        timestamp: new Date().toISOString(),
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
      console.log("[v0] Bundle purchase failed:", result.message)

      // Save failed transaction for tracking
      await saveTransaction(chatId, reference, {
        type: "purchase",
        amount: selectedPackage.priceGHS,
        reference: reference,
        package: `${selectedPackage.volumeGB}GB`,
        network: selectedPackage.network,
        phone: phoneNumber,
        status: "failed",
        error: result.message,
        timestamp: new Date().toISOString(),
      })

      const errorMessage = `❌ *DATA BUNDLE PURCHASE FAILED*

🌐 *NETWORK:* ${selectedPackage.networkName.toUpperCase()}
📊 *PACKAGE:* ${selectedPackage.volumeGB}GB | ₵${selectedPackage.priceGHS.toFixed(2)}
📱 *PHONE:* ${phoneNumber}
📋 *REFERENCE:* ${reference}

Reason: ${result.message || "Unknown error"}

Your payment was successful but the bundle delivery failed. Please contact support for assistance.`

      const keyboard = {
        inline_keyboard: [
          [
            { text: "🔄 TRY AGAIN", callback_data: `package_${selectedPackage.id}` },
            { text: "🎧 SUPPORT", url: "https://t.me/glenthox" },
          ],
          [{ text: "🏠 MAIN MENU", callback_data: "back_to_main" }],
        ],
      }

      await bot.sendMessage(chatId, errorMessage, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      })
    }
  } catch (error) {
    console.error("[v0] Error processing data bundle:", error)
    await bot.sendMessage(chatId, "❌ An error occurred while processing your purchase. Please contact support.")
  }
}

// Foster Console API integration
async function purchaseDataBundle(phoneNumber, networkId, volume) {
  try {
    const response = await axios.post(
      `${FOSTER_BASE_URL}/data`,
      {
        phone: phoneNumber,
        network_id: networkId,
        volume: volume,
      },
      {
        headers: {
          Authorization: `Bearer ${FOSTER_API_KEY}`,
          "Content-Type": "application/json",
        },
      },
    )

    return {
      status: response.data.success ? "success" : "failed",
      message: response.data.message || "Purchase completed",
      data: response.data,
    }
  } catch (error) {
    console.error("Foster API error:", error)
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

bot.on("callback_query", async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id
  const messageId = callbackQuery.message.message_id
  const data = callbackQuery.data

  try {
    await bot.answerCallbackQuery(callbackQuery.id)

    if (data === "pay_with_wallet") {
      const session = userSessions.get(chatId)
      if (!session || !session.selectedPackage) {
        await bot.editMessageText("❌ Session expired. Please start again.", {
          chat_id: chatId,
          message_id: messageId,
        })
        return
      }

      const profile = await getUserProfile(chatId)
      const walletBalance = profile?.wallet || 0
      const packagePrice = session.selectedPackage.priceGHS

      if (!validateMinimumOrder(packagePrice)) {
        await bot.editMessageText(`❌ Minimum order amount is ₵1.00\nPackage price: ₵${packagePrice.toFixed(2)}`, {
          chat_id: chatId,
          message_id: messageId,
        })
        return
      }

      if (walletBalance < packagePrice) {
        const insufficientMessage = `❌ *INSUFFICIENT WALLET BALANCE*

💰 *WALLET BALANCE:* ₵${walletBalance.toFixed(2)}
💳 *REQUIRED AMOUNT:* ₵${packagePrice.toFixed(2)}
💸 *SHORTFALL:* ₵${(packagePrice - walletBalance).toFixed(2)}

Please deposit more funds or use Paystack payment.`

        const keyboard = {
          inline_keyboard: [
            [
              { text: "💳 DEPOSIT", callback_data: "deposit_wallet" },
              { text: "💳 PAYSTACK", callback_data: "pay_with_paystack" },
            ],
            [{ text: "🏠 MAIN MENU", callback_data: "back_to_main" }],
          ],
        }

        await bot.editMessageText(insufficientMessage, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "Markdown",
          reply_markup: keyboard,
        })
        return
      }

      try {
        // Deduct from wallet
        await deductFromWallet(chatId, packagePrice)

        // Process the data bundle purchase
        const result = await purchaseDataBundle(
          session.phoneNumber,
          session.selectedPackage.network_id,
          session.selectedPackage.volume,
        )

        if (result.status === "success") {
          const orderId = `wallet_${Date.now()}_${chatId}`

          // Save successful order
          await saveOrder(chatId, orderId, {
            amount: packagePrice,
            bundle: `${session.selectedPackage.volumeGB}GB`,
            network: session.selectedPackage.network,
            phone_number: session.phoneNumber,
            payment_method: "wallet",
            status: "success",
            timestamp: new Date().toISOString(),
          })

          const successMessage = `✅ *WALLET PAYMENT SUCCESSFUL*

🌐 *NETWORK:* ${session.selectedPackage.networkName.toUpperCase()}
📊 *PACKAGE:* ${session.selectedPackage.volumeGB}GB | ₵${packagePrice.toFixed(2)}
📱 *PHONE:* ${session.phoneNumber}
📋 *ORDER ID:* ${orderId}
💰 *NEW BALANCE:* ₵${(walletBalance - packagePrice).toFixed(2)}

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

          await bot.editMessageText(successMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "Markdown",
            reply_markup: keyboard,
          })
        } else {
          // Refund wallet if purchase failed
          await updateWallet(chatId, packagePrice)

          await bot.editMessageText(
            "❌ Purchase failed. Your wallet has been refunded. Please try again or contact support.",
            {
              chat_id: chatId,
              message_id: messageId,
            },
          )
        }

        // Clear session
        userSessions.delete(chatId)
      } catch (error) {
        console.error("Wallet payment error:", error)
        await bot.editMessageText("❌ Payment failed. Please try again or contact support.", {
          chat_id: chatId,
          message_id: messageId,
        })
      }
    }

    // ... existing code for other callback queries ...
  } catch (error) {
    console.error("Callback query error:", error)
    await bot.answerCallbackQuery(callbackQuery.id, { text: "❌ An error occurred. Please try again." })
  }
})

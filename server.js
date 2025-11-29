const express = require("express")
const cors = require("cors")
const path = require("path")
const admin = require("firebase-admin")
require("dotenv").config()

const app = express()
const PORT = process.env.PORT || 3000

// Middleware
app.use(cors())
app.use(express.json())
app.use(express.static("public"))

// Firebase Admin SDK Configuration
const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  })
}

const db = admin.database()

// SMM API Configuration
const API_URL = process.env.SMM_API_URL || "https://gainrealgrowth.com/api/v2"
const API_KEY = process.env.SMM_API_KEY

if (!API_KEY) {
  console.warn("WARNING: SMM_API_KEY not set in .env file")
}

// Helper function to make API calls with minimal logging
async function makeApiCall(params) {
  try {
    const formData = new URLSearchParams()
    formData.append("key", API_KEY)
    for (const [key, value] of Object.entries(params)) {
      formData.append(key, value)
    }

    console.log(`\n📡 ${params.action?.toUpperCase()}:`, params)

    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    })

    if (!response.ok) {
      throw new Error(`API returned status ${response.status}`)
    }

    const result = await response.json()
    console.log(`✅ Response:`, result)

    return result
  } catch (error) {
    console.error(`❌ ${params.action?.toUpperCase()} Error:`, error.message)
    throw error
  }
}

// Get all services
app.get("/api/services", async (req, res) => {
  try {
    const services = await makeApiCall({ action: "services" })
    if (services.error) {
      return res.status(400).json({ error: services.error })
    }
    res.json(services)
  } catch (error) {
    console.error("Get services error:", error)
    res.status(500).json({ error: "Failed to fetch services" })
  }
})

// Get user balance from Firebase database
app.post("/api/balance", async (req, res) => {
  try {
    const { uid } = req.body
    if (!uid) {
      console.log("❌ Missing uid")
      return res.status(400).json({ error: "User ID required" })
    }

    console.log(`\n💰 Balance check: ${uid}`)

    const walletRef = db.ref(`wallets/${uid}`)
    const snapshot = await walletRef.once("value")
    
    if (!snapshot.exists()) {
      console.log(`⚠️  Wallet not found, returning 0`)
      return res.json({ balance: 0, currency: "GHS" })
    }

    const wallet = snapshot.val()
    console.log(`✅ Balance: ${wallet.balance || 0} ${wallet.currency || "GHS"}`)

    res.json({ 
      balance: wallet.balance || 0, 
      currency: wallet.currency || "GHS" 
    })
  } catch (error) {
    console.error(`❌ Balance Error:`, error.message)
    res.status(500).json({ error: "Failed to fetch balance" })
  }
})

// Place a new order
app.post("/api/order", async (req, res) => {
  try {
    const { uid, serviceId, link, quantity, runs, interval } = req.body

    if (!uid || !serviceId || !link || !quantity) {
      const missing = []
      if (!uid) missing.push("uid")
      if (!serviceId) missing.push("serviceId")
      if (!link) missing.push("link")
      if (!quantity) missing.push("quantity")
      console.log(`❌ Missing fields: ${missing.join(", ")}`)
      return res.status(400).json({ error: `Missing required fields: ${missing.join(", ")}` })
    }

    console.log(`\n🛒 Order: Service ${serviceId}, Qty ${quantity}, Link: ${link.substring(0, 30)}...`)

    // Get services to validate and get pricing
    const services = await makeApiCall({ action: "services" })
    const service = services.find((s) => s.service == serviceId)

    if (!service) {
      console.log(`❌ Service ${serviceId} not found`)
      return res.status(400).json({ error: "Service not found" })
    }

    if (quantity < service.min || quantity > service.max) {
      console.log(`❌ Qty ${quantity} out of range (${service.min}-${service.max})`)
      return res.status(400).json({
        error: `Quantity must be between ${service.min} and ${service.max}`,
      })
    }

    // Calculate cost
    const cost = (parseFloat(service.rate) * quantity) / 1000

    // Check wallet balance
    const walletRef = db.ref(`wallets/${uid}`)
    const walletSnapshot = await walletRef.once("value")
    const wallet = walletSnapshot.val() || { balance: 0, currency: "GHS" }
    const currentBalance = parseFloat(wallet.balance) || 0

    if (currentBalance < cost) {
      console.log(`❌ Insufficient balance: ${currentBalance} < ${cost}`)
      return res.status(400).json({ 
        error: `Insufficient balance. You have ${currentBalance} but need ${cost}` 
      })
    }

    // Prepare order parameters
    const orderParams = {
      action: "add",
      service: serviceId,
      link: link.trim(),
      quantity: quantity,
    }

    if (runs) orderParams.runs = runs
    if (interval) orderParams.interval = interval

    // Place order on API
    const result = await makeApiCall(orderParams)

    if (result.error) {
      console.log(`❌ API Error: ${result.error}`)
      return res.status(400).json({ error: result.error })
    }

    const orderId = result.order

    console.log(`✅ Order placed: #${orderId}, Cost: ${cost}`)

    // Deduct from wallet
    const newBalance = currentBalance - cost

    await walletRef.update({
      balance: newBalance,
      lastUpdated: Date.now(),
    })

    console.log(`💳 Wallet deducted: ${currentBalance} → ${newBalance}`)

    // Save to Firebase
    const orderData = {
      orderId: orderId,
      serviceId: parseInt(serviceId),
      serviceName: service.name,
      serviceType: service.type,
      category: service.category,
      link: link.trim(),
      quantity: parseInt(quantity),
      cost: cost,
      rate: parseFloat(service.rate),
      status: "Pending",
      startTime: runs ? parseInt(runs) : 0,
      interval: interval ? parseInt(interval) : null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    await db.ref(`orders/${uid}/${orderId}`).set(orderData)
    console.log(`💾 Saved to Firebase: orders/${uid}/${orderId}`)

    // Log transaction
    await db.ref(`transactions/${uid}`).push({
      type: "order_payment",
      orderId: orderId,
      amount: cost,
      previousBalance: currentBalance,
      newBalance: newBalance,
      status: "completed",
      timestamp: Date.now(),
    })

    console.log(`📝 Transaction logged`)

    res.json({ success: true, order: orderId, cost: cost, newBalance: newBalance })
  } catch (error) {
    console.error(`❌ Order Error:`, error.message)
    res.status(500).json({ error: "Failed to place order" })
  }
})

// Get order status
app.post("/api/order-status", async (req, res) => {
  try {
    const { orderId } = req.body

    if (!orderId) {
      console.log("❌ Missing orderId")
      return res.status(400).json({ error: "Order ID required" })
    }

    console.log(`\n📊 Status check: Order #${orderId}`)

    const result = await makeApiCall({ action: "status", order: orderId })

    if (result.error) {
      console.log(`❌ API Error: ${result.error}`)
      return res.status(400).json({ error: result.error })
    }

    console.log(`✅ Status: ${result.status}, Remains: ${result.remains}`)
    res.json(result)
  } catch (error) {
    console.error(`❌ Status Error:`, error.message)
    res.status(500).json({ error: "Failed to fetch order status" })
  }
})

// Get multiple orders status
app.post("/api/orders-status", async (req, res) => {
  try {
    const { orderIds } = req.body

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ error: "Order IDs array required" })
    }

    const result = await makeApiCall({
      action: "status",
      orders: orderIds.join(","),
    })

    res.json(result)
  } catch (error) {
    console.error("Orders status error:", error)
    res.status(500).json({ error: "Failed to fetch orders status" })
  }
})

// Add funds to wallet (update in Firebase)
app.post("/api/add-funds", async (req, res) => {
  try {
    const { uid, amount } = req.body

    if (!uid || !amount) {
      console.log("❌ Missing uid or amount")
      return res.status(400).json({ error: "User ID and amount required" })
    }

    const addAmount = parseFloat(amount)
    if (addAmount <= 0) {
      console.log(`❌ Invalid amount: ${addAmount}`)
      return res.status(400).json({ error: "Amount must be greater than 0" })
    }

    console.log(`\n💵 Add funds: ${addAmount} for ${uid}`)

    const walletRef = db.ref(`wallets/${uid}`)
    const snapshot = await walletRef.once("value")
    const currentWallet = snapshot.val() || { balance: 0, currency: "GHS" }
    const currentBalance = parseFloat(currentWallet.balance) || 0

    const newBalance = currentBalance + addAmount
    
    await walletRef.update({
      balance: newBalance,
      lastUpdated: Date.now(),
    })

    await db.ref(`transactions/${uid}`).push({
      type: "add_funds",
      amount: addAmount,
      previousBalance: currentBalance,
      newBalance: newBalance,
      status: "completed",
      timestamp: Date.now(),
    })

    console.log(`✅ Wallet updated: ${currentBalance} → ${newBalance}`)
    console.log(`💾 Transaction logged`)

    res.json({
      success: true,
      previousBalance: currentBalance,
      newBalance: newBalance,
      amount: addAmount,
    })
  } catch (error) {
    console.error(`❌ Add Funds Error:`, error.message)
    res.status(500).json({ error: "Failed to add funds" })
  }
})

// Get user orders from Firebase
app.get("/api/user-orders/:uid", async (req, res) => {
  try {
    const { uid } = req.params

    if (!uid) {
      console.log("❌ Missing uid")
      return res.status(400).json({ error: "User ID required" })
    }

    console.log(`\n📦 User orders: ${uid}`)

    const ordersRef = db.ref(`orders/${uid}`)
    const snapshot = await ordersRef.once("value")
    const ordersData = snapshot.val() || {}

    const orders = Object.entries(ordersData).map(([key, order]) => ({
      ...order,
      localId: key,
    }))

    console.log(`✅ Retrieved: ${orders.length} orders`)

    res.json(orders)
  } catch (error) {
    console.error(`❌ User Orders Error:`, error.message)
    res.status(500).json({ error: "Failed to fetch orders" })
  }
})

// Create refill
app.post("/api/refill", async (req, res) => {
  try {
    const { uid, orderId } = req.body

    if (!orderId) {
      console.log("❌ Missing orderId")
      return res.status(400).json({ error: "Order ID required" })
    }

    console.log(`\n🔄 Refill request: Order #${orderId}`)

    const result = await makeApiCall({ action: "refill", order: orderId })

    if (result.error) {
      console.log(`❌ API Error: ${result.error}`)
      return res.status(400).json({ error: result.error })
    }

    const refillId = result.refill
    console.log(`✅ Refill created: #${refillId}`)

    await db.ref(`refills/${uid}/${refillId}`).set({
      orderId: orderId,
      refillId: refillId,
      createdAt: Date.now(),
      status: "pending",
    })
    console.log(`💾 Saved to Firebase`)

    res.json({ success: true, refill: refillId })
  } catch (error) {
    console.error(`❌ Refill Error:`, error.message)
    res.status(500).json({ error: "Failed to request refill" })
  }
})

// Get refill status
app.post("/api/refill-status", async (req, res) => {
  try {
    const { refillId } = req.body

    if (!refillId) {
      console.log("❌ Missing refillId")
      return res.status(400).json({ error: "Refill ID required" })
    }

    console.log(`\n🔄📊 Refill status: #${refillId}`)

    const result = await makeApiCall({ action: "refill_status", refill: refillId })

    if (result.error) {
      console.log(`❌ API Error: ${result.error}`)
      return res.status(400).json({ error: result.error })
    }

    console.log(`✅ Status: ${result.status}`)
    res.json(result)
  } catch (error) {
    console.error(`❌ Refill Status Error:`, error.message)
    res.status(500).json({ error: "Failed to fetch refill status" })
  }
})

// Update order status in Firebase (for background sync)
app.post("/api/update-order-status", async (req, res) => {
  try {
    const { uid, orderId, status } = req.body

    if (!uid || !orderId || !status) {
      console.log("❌ Missing required fields")
      return res.status(400).json({ error: "Missing required fields" })
    }

    console.log(`\n🔄 Update status: Order #${orderId} → ${status}`)

    await db.ref(`orders/${uid}/${orderId}`).update({
      status: status,
      updatedAt: Date.now(),
    })

    console.log(`✅ Updated in Firebase`)

    res.json({ success: true })
  } catch (error) {
    console.error(`❌ Update Status Error:`, error.message)
    res.status(500).json({ error: "Failed to update order status" })
  }
})

// Serve index.html for SPA routing
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"))
})

app.listen(PORT, () => {
  console.log(`✓ Server running on http://localhost:${PORT}`)
  console.log(`✓ Firebase Project: ${process.env.FIREBASE_PROJECT_ID}`)
  console.log(`✓ SMM API configured: ${!!API_KEY}`)
})

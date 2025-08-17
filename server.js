const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const winston = require("winston");
const dotenv = require("dotenv");
const https = require("https");
const serverless = require('serverless-http');

// Load environment variables
dotenv.config({ debug: true });

// Environment variables
const {
  APP_KEY,
  APP_SECRET,
  MERCH_CODE,
  APPID,
  NOTIFY_URL,
  API_BASE
} = process.env;

// Logger setup
const logger = winston.createLogger({
  level: "debug",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "app.log" })
  ]
});

// Private key is loaded lazily to avoid crashing in serverless environment
function loadPrivateKey() {
  if (process.env.PRIVATE_KEY) {
    logger.debug('Private key loaded from environment variable PRIVATE_KEY');
    return process.env.PRIVATE_KEY;
  }
  if (process.env.PRIVATE_KEY_PATH) {
    try {
      const key = fs.readFileSync(process.env.PRIVATE_KEY_PATH, 'utf8');
      logger.debug(`Private key loaded from ${process.env.PRIVATE_KEY_PATH}`);
      return key;
    } catch (err) {
      logger.warn(`Private key not loaded from ${process.env.PRIVATE_KEY_PATH}: ${err.message}`);
      return null;
    }
  }
  return null;
}

logger.debug(`Private key load deferred; PRIVATE_KEY ${process.env.PRIVATE_KEY ? 'present' : 'absent'}, PRIVATE_KEY_PATH=${process.env.PRIVATE_KEY_PATH || './private_key_pkcs8.pem'}`);

// Initialize Express app
const app = express();
app.use(express.json());

// 🛠️ Utility Functions

// Generate nonce string
function generateNonce() {
  return crypto.randomBytes(16).toString("hex");
}

// Get current timestamp in seconds
function getTimestamp() {
  return Math.floor(Date.now() / 1000).toString();
}

// Create raw request string for signature
function createRawRequest(params) {
  // Filter out excluded parameters and empty values
  const excludedParams = new Set(['sign', 'sign_type', 'biz_content']);
  const filteredParams = {};
  
  for (const [key, value] of Object.entries(params)) {
    if (!excludedParams.has(key) && value !== null && value !== undefined && String(value).trim() !== '') {
      filteredParams[key] = String(value);
    }
  }
  
  // Sort by key and create the raw string
  const sortedKeys = Object.keys(filteredParams).sort();
  const raw = sortedKeys
    .map(key => `${key}=${filteredParams[key]}`)
    .join("&");
  return raw;
}

// Generate signature using RSA-PSS (matching Python implementation)
function generateSignature(params) {
  try {
    const rawString = createRawRequest(params);
    logger.debug(`Content to sign: ${rawString}`);
    const key = loadPrivateKey();
    if (!key) {
      throw new Error('Private key not available for signing');
    }

    const signature = crypto.sign('sha256', Buffer.from(rawString, 'utf-8'), {
      key,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
      mgf1Hash: 'sha256'
    });

    return signature.toString('base64');
  } catch (error) {
    logger.error(`Error generating signature: ${error.message}`);
    throw error;
  }
}

// Parse payment response
function parsePaymentResponse(response) {
  try {
    return typeof response === "string" ? JSON.parse(response) : response;
  } catch (error) {
    logger.error(`Error parsing payment response: ${error.message}`);
    return null;
  }
}

// 🛒 Endpoints

// Authenticate and get token
app.get("/auth", async (req, res) => {
  try {
    logger.info("Requesting authentication token");
    const response = await axios.post(
      `${API_BASE}/apiaccess/payment/gateway/payment/v1/token`,
      { appSecret: APP_SECRET },
      {
        headers: {
          "X-APP-KEY": APP_KEY,
          "Content-Type": "application/json"
        },
        timeout: 30000,
        httpsAgent: new https.Agent({ rejectUnauthorized: false })
      }
    );

    logger.info("Authentication successful", {
      status: response.status,
      data: JSON.stringify(response.data, null, 2)
    });

    res.json(response.data);
  } catch (error) {
    logger.error("Error in /auth", {
      message: error.message,
      status: error.response?.status,
      data: JSON.stringify(error.response?.data, null, 2),
      stack: error.stack
    });

    const status = error.response?.status || 500;
    res.status(status).json({
      error: error.message,
      apiResponse: error.response?.data || null
    });
  }
});

// Create order and generate payment URL
app.get("/checkout-url", async (req, res) => {
  try {
    // Authenticate
    logger.info("Requesting authentication token for checkout");
    const auth = await axios.post(
      `${API_BASE}/apiaccess/payment/gateway/payment/v1/token`,
      { appSecret: APP_SECRET },
      {
        headers: {
          "X-APP-KEY": APP_KEY,
          "Content-Type": "application/json"
        },
        timeout: 30000,
        httpsAgent: new https.Agent({ rejectUnauthorized: false })
      }
    );

    const token = auth.data.token.replace(/^Bearer\s+/, "");
    const nonce_str = generateNonce();
    const timestamp = getTimestamp();
    const orderId = `${timestamp}001`;

    // Order information
    const biz_content = {
      trans_currency: "DJF",
      total_amount: "3000",
      merch_order_id: orderId,
      appid: APPID,
      merch_code: MERCH_CODE,
      timeout_express: "120m",
      trade_type: "Checkout",
      notify_url: NOTIFY_URL,
      title: "Commande test",
      business_type: "BuyGoods"
    };

    // Parameters for signature
    const signParams = {
      appid: APPID,
      business_type: "BuyGoods",
      merch_code: MERCH_CODE,
      merch_order_id: orderId,
      method: "payment_preorder",
      nonce_str,
      notify_url: NOTIFY_URL,
      timeout_express: "120m",
      timestamp,
      title: "Commande test",
      total_amount: "3000",
      trade_type: "Checkout",
      trans_currency: "DJF",
      version: "1.0"
    };

    // Generate signature
    const sign = generateSignature(signParams);

    // Build request payload
    const payload = {
      nonce_str,
      biz_content,
      method: "payment_preorder",
      version: "1.0",
      sign_type: "SHA256WithRSA",
      timestamp,
      sign
    };

    logger.info("Sending payment request", {
      url: `${API_BASE}/payment/v1/merchant/preOrder`,
      payload: JSON.stringify(payload, null, 2)
    });

    // Send request to D-Money
    const order = await axios.post(
      `${API_BASE}/payment/v1/merchant/preOrder`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-APP-KEY": APP_KEY,
          "Content-Type": "application/json"
        },
        timeout: 30000,
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        validateStatus: status => status < 500
      }
    );

    logger.info("Payment response", {
      status: order.status,
      headers: order.headers,
      data: JSON.stringify(order.data, null, 2)
    });

    // Parse and validate response
    const parsedResponse = parsePaymentResponse(order.data);
    if (!parsedResponse) {
      throw new Error("Failed to parse payment response");
    }

    // Get prepay_id from the actual API response
    const prepay_id = parsedResponse.prepay_id;
    if (!prepay_id) {
      throw new Error("No prepay_id in response");
    }

    // Build checkout URL
    const checkoutParams = {
      appid: APPID,
      merch_code: MERCH_CODE,
      nonce_str,
      prepay_id,
      timestamp,
      version: "1.0",
      trade_type: "Checkout",
      language: "fr"
    };

    const checkoutSign = generateSignature(checkoutParams);
    const queryString = new URLSearchParams({
      ...checkoutParams,
      sign: checkoutSign,
      sign_type: "SHA256WithRSA"
    }).toString();

    const checkoutURL = `https://pgtest.d-money.dj:38443/payment/web/paygate?${queryString}`;
    res.json({ checkoutURL });

  } catch (error) {
    logger.error("Error in /checkout-url", {
      message: error.message,
      status: error.response?.status,
      data: JSON.stringify(error.response?.data, null, 2),
      stack: error.stack
    });

    const status = error.response?.status || 500;
    res.status(status).json({
      error: error.message,
      apiResponse: error.response?.data || null
    });
  }
});

// Query order status
app.get("/query-order/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    logger.info(`Querying order status for orderId: ${orderId}`);
    const auth = await axios.post(
      `${API_BASE}/apiaccess/payment/gateway/payment/v1/token`,
      { appSecret: APP_SECRET },
      {
        headers: {
          "X-APP-KEY": APP_KEY,
          "Content-Type": "application/json"
        },
        timeout: 30000,
        httpsAgent: new https.Agent({ rejectUnauthorized: false })
      }
    );

    const token = auth.data.token.replace(/^Bearer\s+/, "");
    const nonce_str = generateNonce();
    const timestamp = getTimestamp();

    const signParams = {
      appid: APPID,
      merch_code: MERCH_CODE,
      merch_order_id: orderId,
      method: "payment.queryorder",
      nonce_str,
      timestamp,
      version: "1.0"
    };

    const sign = generateSignature(signParams);
    const payload = {
      nonce_str,
      method: "payment.queryorder",
      version: "1.0",
      sign_type: "SHA256WithRSA",
      timestamp,
      sign,
      biz_content: {
        merch_order_id: orderId,
        appid: APPID,
        merch_code: MERCH_CODE
      }
    };

    const response = await axios.post(
      `${API_BASE}/apiaccess/payment/gateway/payment/v1/merchant/queryOrder`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-APP-KEY": APP_KEY,
          "Content-Type": "application/json"
        },
        timeout: 30000,
        httpsAgent: new https.Agent({ rejectUnauthorized: false })
      }
    );

    logger.info("Order query response", {
      status: response.status,
      data: JSON.stringify(response.data, null, 2)
    });

    res.json(response.data);
  } catch (error) {
    logger.error("Error in /query-order", {
      message: error.message,
      status: error.response?.status,
      data: JSON.stringify(error.response?.data, null, 2),
      stack: error.stack
    });
    res.status(error.response?.status || 500).json({
      error: error.message,
      apiResponse: error.response?.data || null
    });
  }
});

// Webhook endpoint (placeholder)
app.post("/webhooks/payment", async (req, res) => {
  try {
    const data = req.body;
    logger.info("Received webhook notification", { data: JSON.stringify(data, null, 2) });
    // TODO: Implement webhook signature verification and handling
    res.status(200).json({ message: "Webhook received" });
  } catch (error) {
    logger.error("Error in /webhooks/payment", {
      message: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: error.message });
  }
});

// Export handler for serverless platforms (Vercel) and allow loca run with `node server.js`
const handler = serverless(app);

if (require.main === module) {
  // Running locally
  const PORT = process.env.PORT || 9000;
  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Server started on http://0.0.0.0:${PORT}`);
  });

}

// Export both app and handler so other entrypoints can choose
module.exports = { app, handler };
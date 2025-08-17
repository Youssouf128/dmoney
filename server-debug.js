const express = require("express");

// Initialize Express app
const app = express();
app.use(express.json());

// Test endpoint simple
app.get("/", (req, res) => {
  try {
    res.json({ 
      status: "OK", 
      message: "Server is working",
      timestamp: new Date().toISOString(),
      env: {
        NODE_ENV: process.env.NODE_ENV,
        hasAppKey: !!process.env.APP_KEY,
        hasPrivateKey: !!process.env.PRIVATE_KEY
      }
    });
  } catch (error) {
    console.error("Error in root endpoint:", error);
    res.status(500).json({ error: error.message });
  }
});

// Test des variables d'environnement
app.get("/test-env", (req, res) => {
  try {
    const envVars = {
      APP_KEY: process.env.APP_KEY ? "SET" : "NOT SET",
      APP_SECRET: process.env.APP_SECRET ? "SET" : "NOT SET",
      MERCH_CODE: process.env.MERCH_CODE ? "SET" : "NOT SET",
      APPID: process.env.APPID ? "SET" : "NOT SET",
      API_BASE: process.env.API_BASE ? "SET" : "NOT SET",
      NOTIFY_URL: process.env.NOTIFY_URL ? "SET" : "NOT SET",
      PRIVATE_KEY: process.env.PRIVATE_KEY ? "SET" : "NOT SET"
    };
    
    res.json({ 
      status: "Environment check",
      variables: envVars
    });
  } catch (error) {
    console.error("Error checking environment:", error);
    res.status(500).json({ error: error.message });
  }
});

// Test de la clé privée
app.get("/test-key", (req, res) => {
  try {
    if (!process.env.PRIVATE_KEY) {
      return res.status(400).json({ error: "PRIVATE_KEY not set" });
    }
    
    const keyContent = process.env.PRIVATE_KEY.replace(/\\n/g, '\n');
    const hasBeginTag = keyContent.includes('-----BEGIN');
    const hasEndTag = keyContent.includes('-----END');
    
    res.json({
      status: "Private key check",
      hasBeginTag,
      hasEndTag,
      keyLength: keyContent.length,
      preview: keyContent.substring(0, 50) + "..."
    });
  } catch (error) {
    console.error("Error testing key:", error);
    res.status(500).json({ error: error.message });
  }
});

// Export pour Vercel
module.exports = app;

// Start server (seulement en développement local)
if (process.env.NODE_ENV !== 'production' && require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Debug server started on http://localhost:${PORT}`);
  });
}
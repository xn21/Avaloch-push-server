// server.js
// Avaloch Staff Push Notification Server

const express = require("express");
const apn     = require("apn");
const fs      = require("fs");

const app = express();
app.use(express.json());

// ── Config ────────────────────────────────────────────────────────────────────
const config = {
  apnsKeyId:  process.env.APNS_KEY_ID  || "YOUR_KEY_ID",
  apnsTeamId: process.env.APNS_TEAM_ID || "8LH2QGPV85",
  apnsKey:    process.env.APNS_KEY,
  bundleId:   process.env.BUNDLE_ID    || "com.avaloch.Avaloch-Staff",
  production: process.env.NODE_ENV === 'production',
};

// ── Token Store ───────────────────────────────────────────────────────────────
const TOKEN_FILE = "./tokens.json";
let tokenStore = {};

function loadTokens() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      tokenStore = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
      console.log(`[Tokens] Loaded ${Object.keys(tokenStore).length} tokens`);
    }
  } catch (e) {
    console.warn("[Tokens] Could not load tokens:", e.message);
  }
}

function saveTokens() {
  try { fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenStore, null, 2)); }
  catch (e) { console.warn("[Tokens] Could not save tokens:", e.message); }
}

loadTokens();

// ── APNs Provider ─────────────────────────────────────────────────────────────
let apnProvider = null;

function getProvider() {
  if (apnProvider) return apnProvider;
  if (!config.apnsKey) { console.warn("[APNs] No APNS_KEY configured"); return null; }
  try {
    apnProvider = new apn.Provider({
      token: { key: config.apnsKey, keyId: config.apnsKeyId, teamId: config.apnsTeamId },
      production: config.production,
    });
    console.log("[APNs] Provider initialized");
    return apnProvider;
  } catch (e) {
    console.error("[APNs] Init failed:", e.message);
    return null;
  }
}

// ── Send Helper ───────────────────────────────────────────────────────────────
async function sendToRoles(roles, title, body, destination, excludeDeviceID = null) {
  const provider = getProvider();
  if (!provider) return { sent: 0, error: "No APNs provider" };

  const tokens = Object.values(tokenStore)
    .filter(t => roles.includes(t.role))
    .filter(t => !excludeDeviceID || t.deviceID !== excludeDeviceID)
    .map(t => t.token);

  if (tokens.length === 0) {
    console.log(`[APNs] No tokens for roles: ${roles.join(", ")}`);
    return { sent: 0 };
  }

  const notification = new apn.Notification();
  notification.expiry  = Math.floor(Date.now() / 1000) + 3600;
  notification.badge   = 1;
  notification.sound   = "default";
  notification.alert   = { title, body };
  notification.payload = { destination };
  notification.topic   = config.bundleId;

  const result = await provider.send(notification, tokens);
  console.log(`[APNs] Sent: ${result.sent.length}, Failed: ${result.failed.length}`);

  result.failed.forEach(f => {
    const reason = f.response?.reason;
    console.log(`[APNs] Failed token: ${f.device?.substring(0, 10)}... reason: ${reason} status: ${f.status}`);
    if (reason === "BadDeviceToken" || reason === "Unregistered") {
      const entry = Object.entries(tokenStore).find(([, v]) => v.token === f.device);
      if (entry) {
        console.log(`[APNs] Removing bad token for ${entry[1].userName}`);
        delete tokenStore[entry[0]]; saveTokens();
      }
    }
  });

  return { sent: result.sent.length, failed: result.failed.length };
}

const ALL_ROLES = ["Management", "Front Desk", "Housekeeping", "Maintenance", "Food & Beverage"];

// ── Token Routes ──────────────────────────────────────────────────────────────
app.post("/register", (req, res) => {
  const { token, userName, role, deviceID } = req.body;
  if (!token || !userName || !role || !deviceID)
    return res.status(400).json({ error: "Missing fields" });
  tokenStore[deviceID] = { token, userName, role, updatedAt: new Date().toISOString() };
  saveTokens();
  console.log(`[Tokens] Registered ${userName} (${role})`);
  res.json({ success: true });
});

app.post("/unregister", (req, res) => {
  const { deviceID } = req.body;
  if (deviceID && tokenStore[deviceID]) {
    console.log(`[Tokens] Unregistered ${tokenStore[deviceID].userName}`);
    delete tokenStore[deviceID];
    saveTokens();
  }
  res.json({ success: true });
});

// ── Notification Routes ───────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({
  status: "Avaloch push server running",
  env: config.production ? "production" : "sandbox",
  registeredDevices: Object.keys(tokenStore).length
}));

app.post("/notify/bulletin", async (req, res) => {
  try { res.json({ success: true, ...await sendToRoles(ALL_ROLES, req.body.title, req.body.body, req.body.destination, req.body.deviceID) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post("/notify/chat", async (req, res) => {
  try { res.json({ success: true, ...await sendToRoles(ALL_ROLES, req.body.title, req.body.body, req.body.destination, req.body.deviceID) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post("/notify/guest-message", async (req, res) => {
  try { res.json({ success: true, ...await sendToRoles(["Front Desk"], req.body.title, req.body.body, req.body.destination) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post("/notify/reorder", async (req, res) => {
  try { res.json({ success: true, ...await sendToRoles(["Management", "Front Desk"], req.body.title, req.body.body, req.body.destination) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post("/notify/maintenance", async (req, res) => {
  try { res.json({ success: true, ...await sendToRoles(ALL_ROLES, req.body.title, req.body.body, req.body.destination, req.body.deviceID) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Avaloch push server on port ${PORT}`);
  getProvider();
});

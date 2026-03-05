// server.js
// Avaloch Staff Push Notification Server
// Deploy to Render (free tier) at: https://render.com

const express = require("express");
const apn     = require("node-apn");
const https   = require("https");

const app  = express();
app.use(express.json());

// ── Config (set these as Render environment variables) ────────────────────────
const config = {
  apnsKeyId:   process.env.APNS_KEY_ID    || "7CZNLB7NC4",
  apnsTeamId:  process.env.APNS_TEAM_ID   || "8LH2QGPV85",
  apnsKeyPath: process.env.APNS_KEY_PATH  || "./AuthKey_7CZNLB7NC4.p8",
  apnsKeyContent: process.env.APNS_KEY,   // full key content as env var (preferred on Render)
  bundleId:    process.env.BUNDLE_ID      || "com.avaloch.Avaloch-Staff",
  production:  process.env.NODE_ENV === "production",
  cloudKitToken: process.env.CLOUDKIT_SERVER_TOKEN,
  cloudKitContainer: "iCloud.com.avaloch.staff",
  cloudKitEnv: process.env.NODE_ENV === "production" ? "production" : "development",
};

// ── APNs Provider ─────────────────────────────────────────────────────────────
const apnProvider = new apn.Provider({
  token: {
    key:    config.apnsKeyContent || config.apnsKeyPath,
    keyId:  config.apnsKeyId,
    teamId: config.apnsTeamId,
  },
  production: config.production,
});

// ── CloudKit REST helper ──────────────────────────────────────────────────────
// Fetches device tokens from CloudKit filtered by role(s)
async function fetchDeviceTokens(roles) {
  return new Promise((resolve, reject) => {
    const filterFields = roles.map(role => ({
      fieldName: "role",
      comparator: "EQUALS",
      fieldValue: { value: role, type: "STRING" }
    }));

    const body = JSON.stringify({
      query: {
        recordType: "DeviceToken",
        filterBy: filterFields.length === 1
          ? filterFields
          : [{ fieldName: "role", comparator: "IN",
               fieldValue: { value: roles, type: "STRING_LIST" } }]
      },
      zoneID: { zoneName: "_defaultZone" }
    });

    const options = {
      hostname: "api.apple-cloudkit.com",
      path: `/database/1/${config.cloudKitContainer}/${config.cloudKitEnv}/public/records/query`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "X-CloudKit-AuthToken": config.cloudKitToken,
      }
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          const tokens = (parsed.records || [])
            .map(r => r.fields?.token?.value)
            .filter(Boolean);
          resolve(tokens);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// All roles
const ALL_ROLES = ["Management", "Front Desk", "Housekeeping", "Maintenance", "Food & Beverage"];

// ── Send helper ───────────────────────────────────────────────────────────────
async function sendToRoles(roles, title, body, destination, excludeToken = null) {
  try {
    const tokens = await fetchDeviceTokens(roles);
    const filtered = excludeToken
      ? tokens.filter(t => t !== excludeToken)
      : tokens;

    if (filtered.length === 0) {
      console.log(`[APNs] No tokens found for roles: ${roles.join(", ")}`);
      return { sent: 0 };
    }

    const notification = new apn.Notification();
    notification.expiry      = Math.floor(Date.now() / 1000) + 3600; // 1hr TTL
    notification.badge       = 1;
    notification.sound       = "default";
    notification.alert       = { title, body };
    notification.payload     = { destination };
    notification.topic       = config.bundleId;

    const result = await apnProvider.send(notification, filtered);
    console.log(`[APNs] Sent to ${result.sent.length} devices, failed: ${result.failed.length}`);

    // Log any failures for debugging
    result.failed.forEach(f => {
      console.error(`[APNs] Failed token ${f.device}: ${f.error?.message || f.response?.reason}`);
    });

    return { sent: result.sent.length, failed: result.failed.length };
  } catch (err) {
    console.error("[APNs] Error:", err.message);
    throw err;
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Health check
app.get("/", (req, res) => {
  res.json({ status: "Avaloch push server running", env: config.production ? "production" : "sandbox" });
});

// 1. Bulletin posted → notify everyone
app.post("/notify/bulletin", async (req, res) => {
  const { title, body, destination } = req.body;
  try {
    const result = await sendToRoles(ALL_ROLES, title, body, destination);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Staff chat message → notify everyone except sender
app.post("/notify/chat", async (req, res) => {
  const { title, body, destination, senderName } = req.body;
  // We exclude by senderName match — fetch all tokens then filter by name
  // For simplicity we send to all and let the app suppress if sender matches
  try {
    const result = await sendToRoles(ALL_ROLES, title, body, destination);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Guest message → Front Desk only
app.post("/notify/guest-message", async (req, res) => {
  const { title, body, destination } = req.body;
  try {
    const result = await sendToRoles(["Front Desk"], title, body, destination);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Reorder request submitted → Management + Front Desk
app.post("/notify/reorder", async (req, res) => {
  const { title, body, destination } = req.body;
  try {
    const result = await sendToRoles(["Management", "Front Desk"], title, body, destination);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Maintenance ticket created → Maintenance only
app.post("/notify/maintenance", async (req, res) => {
  const { title, body, destination } = req.body;
  try {
    const result = await sendToRoles(["Maintenance"], title, body, destination);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Avaloch push server listening on port ${PORT}`);
  console.log(`Environment: ${config.production ? "Production" : "Sandbox"}`);
  console.log(`Bundle ID: ${config.bundleId}`);
});

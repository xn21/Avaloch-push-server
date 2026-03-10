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
  production: false, // sandbox for simulator testing; set to true for AdHoc/App Store builds
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

app.post("/notify/inventory", async (req, res) => {
  try { res.json({ success: true, ...await sendToRoles(ALL_ROLES, req.body.title, req.body.body, req.body.destination, req.body.deviceID) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post("/notify/guest-experience", async (req, res) => {
  try { res.json({ success: true, ...await sendToRoles(["Management", "Front Desk"], req.body.title, req.body.body, req.body.destination, req.body.deviceID) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post("/notify/competitor-rates", async (req, res) => {
  try { res.json({ success: true, ...await sendToRoles(["Management", "Front Desk"], req.body.title, req.body.body, req.body.destination, req.body.deviceID) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── StayNTouch Webhook ────────────────────────────────────────────────────────
const STAYNTOUCH_BASE_URL      = process.env.STAYNTOUCH_API_URL      || "https://api.uat.stayntouch.com/connect";
const STAYNTOUCH_AUTH_URL      = process.env.STAYNTOUCH_AUTH_URL     || "https://auth-uat.stayntouch.com/oauth/token";
const STAYNTOUCH_CLIENT_ID     = process.env.STAYNTOUCH_CLIENT_ID;
const STAYNTOUCH_CLIENT_SECRET = process.env.STAYNTOUCH_CLIENT_SECRET;
const STAYNTOUCH_HOTEL_ID      = process.env.STAYNTOUCH_HOTEL_ID     || "300";
const WEBHOOK_SECRET           = process.env.STAYNTOUCH_WEBHOOK_SECRET;

// ── Token cache (auto-refreshes, no manual rotation needed) ──────────────────
let stayntouchToken = {
  value:     process.env.STAYNTOUCH_API_TOKEN || null,
  expiresAt: process.env.STAYNTOUCH_API_TOKEN ? Date.now() + 25 * 24 * 60 * 60 * 1000 : 0,
};

async function getStayntouchToken() {
  // Return cached token if still valid (with 1hr buffer)
  if (stayntouchToken.value && Date.now() < stayntouchToken.expiresAt - 60 * 60 * 1000) {
    return stayntouchToken.value;
  }
  if (!STAYNTOUCH_CLIENT_ID || !STAYNTOUCH_CLIENT_SECRET) {
    throw new Error("Missing STAYNTOUCH_CLIENT_ID or STAYNTOUCH_CLIENT_SECRET");
  }
  console.log("[StayNTouch] Refreshing API token...");
  const response = await fetch(STAYNTOUCH_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id:     STAYNTOUCH_CLIENT_ID,
      client_secret: STAYNTOUCH_CLIENT_SECRET,
      grant_type:    "client_credentials",
    }),
  });
  if (!response.ok) throw new Error(`Token refresh failed: ${response.status}`);
  const data = await response.json();
  stayntouchToken = {
    value:     data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
  };
  console.log("[StayNTouch] Token refreshed successfully");
  return stayntouchToken.value;
}

async function stayntouchGet(path) {
  const token = await getStayntouchToken();
  const response = await fetch(`${STAYNTOUCH_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "API-Version": "2.0",
    },
  });
  if (!response.ok) throw new Error(`StayNTouch API error: ${response.status} ${path}`);
  return response.json();
}

// ── StayNTouch Proxy Routes ───────────────────────────────────────────────────

// GET /stayntouch/reservations — active reservations, proxied from StayNTouch
app.get("/stayntouch/reservations", async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    // Fetch checked-in guests + today's arrivals + today's departures
    const [checkedInData, arrivingData, departingData] = await Promise.all([
      stayntouchGet(`/reservations?hotel_id=${STAYNTOUCH_HOTEL_ID}&status=CHECKEDIN`),
      stayntouchGet(`/reservations?hotel_id=${STAYNTOUCH_HOTEL_ID}&status=RESERVED&arrival_date=${today}`),
      stayntouchGet(`/reservations?hotel_id=${STAYNTOUCH_HOTEL_ID}&status=CHECKEDOUT&departure_date=${today}`),
    ]);

    const allResults = [
      ...(checkedInData.results  || []),
      ...(arrivingData.results   || []),
      ...(departingData.results  || []),
    ];

    // Deduplicate by id
    const seen = new Set();
    const unique = allResults.filter(r => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });

    const reservations = unique.map(r => {
      const primaryGuest = (r.guests || []).find(g => g.is_primary) || r.guests?.[0] || {};
      const guestName = primaryGuest.first_name && primaryGuest.last_name
        ? `${primaryGuest.first_name} ${primaryGuest.last_name}`
        : "Guest";
      const stayDate = (r.stay_dates || [])[0] || {};
      const adults   = stayDate.adults   ?? r.adults   ?? 1;
      const children = stayDate.children ?? r.children ?? 0;

      // Clean notes — strip Way/experience booking noise, keep only plain text
      let notes = null;
      if (r.notes && Array.isArray(r.notes)) {
        const clean = r.notes
          .map(n => n.description || "")
          .filter(n => n && !n.startsWith("Way confirmation code"))
          .join(" | ");
        notes = clean || null;
      } else if (typeof r.notes === "string" && r.notes && !r.notes.startsWith("Way confirmation code")) {
        notes = r.notes;
      }

      return {
        id:                  String(r.id),
        confirmation_number: r.confirmation_number || `#${r.id}`,
        primary_guest_name:  guestName,
        room_number:         r.room?.number         || "—",
        room_type:           r.room?.room_type_id   ? String(r.room.room_type_id) : "—",
        arrival_date:        r.arrival_date,
        departure_date:      r.departure_date,
        adults,
        children,
        status:              r.status,
        notes,
      };
    });

    res.json({ reservations });
  } catch (e) {
    console.error("[StayNTouch] /reservations error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /stayntouch/rooms — room statuses, proxied from StayNTouch
app.get("/stayntouch/rooms", async (req, res) => {
  try {
    const data = await stayntouchGet(`/rooms?hotel_id=${STAYNTOUCH_HOTEL_ID}`);
    const rooms = (data.results || data.rooms || data || []).map(r => ({
      id:                  String(r.id || r.number),
      room_number:         r.number          || r.room_number    || "—",
      room_type_id:        r.room_type_id    ? String(r.room_type_id) : "—",
      floor:               r.floor?.number   || null,
      status:              r.status          || null,
      service_status:      r.service_status  || null,
      occupied:            r.occupied        ?? false,
    }));
    res.json({ rooms });
  } catch (e) {
    console.error("[StayNTouch] /rooms error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── StayNTouch Webhook Handler ────────────────────────────────────────────────

// Events that carry enough info in the payload — no callback needed
const NO_CALLBACK_EVENTS = ["noshow_reservation", "cancel_reservation"];

async function fetchReservation(reservationId) {
  return stayntouchGet(`/reservations/${reservationId}`);
}

function buildNotificationForEvent(event, reservation) {
  const guestName  = reservation?.guest?.name || reservation?.primary_guest_name || "Guest";
  const roomNumber = reservation?.room?.number || reservation?.room_number || "—";
  switch (event) {
    case "reservation_created":  return { title: "New Reservation",        body: `${guestName} — Room ${roomNumber}` };
    case "reservation_updated":  return { title: "Reservation Updated",    body: `${guestName} — Room ${roomNumber}` };
    case "reinstate":            return { title: "Reservation Reinstated", body: `${guestName} — Room ${roomNumber}` };
    case "cancel_reservation":   return { title: "Reservation Cancelled",  body: `${guestName} — Room ${roomNumber}` };
    case "noshow_reservation":   return { title: "No-Show",                body: `${guestName} — Room ${roomNumber}` };
    case "card_replace":         return { title: "Card Updated",           body: `${guestName} — Room ${roomNumber}` };
    default:                     return { title: "Reservation Update",     body: guestName };
  }
}

app.post("/webhooks/stayntouch", async (req, res) => {
  try {
    // Validate webhook secret if configured
    if (WEBHOOK_SECRET) {
      const incomingSecret = req.headers["x-stayntouch-secret"] || req.headers["authorization"];
      if (incomingSecret !== WEBHOOK_SECRET) {
        console.warn("[Webhook] Unauthorized request rejected");
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    const { event, reservation_id } = req.body;

    if (!event || !reservation_id) {
      console.warn("[Webhook] Missing event or reservation_id in payload");
      return res.status(400).json({ error: "Missing event or reservation_id" });
    }

    console.log(`[Webhook] Received event: ${event}, reservation_id: ${reservation_id}`);

    let reservation = null;

    if (NO_CALLBACK_EVENTS.includes(event)) {
      // Payload contains enough info — use it directly, but only extract what we need
      const r = req.body.reservation || {};
      reservation = {
        guest: { name: r.guest_name || r.guest?.name },
        room:  { number: r.room_number || r.room?.number },
      };
    } else {
      // Fetch full reservation details from StayNTouch (do not log raw response)
      const data = await fetchReservation(reservation_id);
      reservation = {
        guest: { name: data?.guest?.name || data?.guest_name },
        room:  { number: data?.room?.number || data?.room_number },
      };
    }

    const { title, body } = buildNotificationForEvent(event, reservation);

    // Send to Management and Front Desk only
    await sendToRoles(["Management", "Front Desk"], title, body, "reservations");

    res.json({ success: true, event });
  } catch (e) {
    console.error("[Webhook] Error processing StayNTouch webhook:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Data Export Email (Resend) ────────────────────────────────────────────────
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const EXPORT_RECIPIENT = "christian@avalochinn.com";

app.post("/send-export-email", express.raw({ type: "application/octet-stream", limit: "50mb" }), async (req, res) => {
  try {
    const fileName = req.headers["x-filename"] || "avaloch-backup.zip";

    if (!RESEND_API_KEY) {
      console.warn("[Export] No RESEND_API_KEY configured");
      return res.status(500).json({ success: false, error: "Email service not configured" });
    }

    if (!req.body || req.body.length === 0) {
      return res.status(400).json({ success: false, error: "No file data received" });
    }

    const base64Zip = req.body.toString("base64");

    const emailPayload = {
      from: "Avaloch Inn <info@avalochinn.com>",
      to: [EXPORT_RECIPIENT],
      subject: `Avaloch Inn Data Backup – ${fileName}`,
      html: `
        <p>Automated data backup from the Avaloch Staff App.</p>
        <p><strong>File:</strong> ${fileName}</p>
        <p><strong>Generated:</strong> ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}</p>
        <p>All app data is attached as a ZIP file containing individual CSVs per record type.</p>
      `,
      attachments: [
        {
          filename: fileName,
          content: base64Zip,
        },
      ],
    };

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailPayload),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("[Export] Resend error:", result);
      return res.status(500).json({ success: false, error: result.message || "Email send failed" });
    }

    console.log(`[Export] Email sent successfully to ${EXPORT_RECIPIENT}, id: ${result.id}`);
    res.json({ success: true, emailId: result.id });

  } catch (e) {
    console.error("[Export] Email endpoint error:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Avaloch push server on port ${PORT}`);
  getProvider();
});

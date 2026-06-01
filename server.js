// server.js
// Avaloch Staff Push Notification Server

const express = require("express");
const cors    = require("cors");
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
  production: true,
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

// Log SNT env on boot so we can see exactly what the server is working with
console.log(`[StayNTouch] Boot config:
  API URL:        ${STAYNTOUCH_BASE_URL}
  Auth URL:       ${STAYNTOUCH_AUTH_URL}
  Hotel ID:       ${STAYNTOUCH_HOTEL_ID}
  Client ID set:  ${!!STAYNTOUCH_CLIENT_ID}
  Secret set:     ${!!STAYNTOUCH_CLIENT_SECRET}
  Static token:   ${process.env.STAYNTOUCH_API_TOKEN ? "PRESENT (will block refresh)" : "not set (good)"}`);

// ── Token cache (auto-refreshes, no manual rotation needed) ──────────────────
let stayntouchToken = {
  value:     process.env.STAYNTOUCH_API_TOKEN || null,
  expiresAt: process.env.STAYNTOUCH_API_TOKEN ? Date.now() + 25 * 24 * 60 * 60 * 1000 : 0,
};

async function getStayntouchToken() {
  // Return cached token if still valid (with 1hr buffer)
  if (stayntouchToken.value && Date.now() < stayntouchToken.expiresAt - 60 * 60 * 1000) {
    console.log(`[StayNTouch] Using cached token (expires in ${Math.round((stayntouchToken.expiresAt - Date.now()) / 3600000)}h)`);
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
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    console.error(`[StayNTouch] Token refresh failed: ${response.status} — ${errText.substring(0, 200)}`);
    throw new Error(`Token refresh failed: ${response.status}`);
  }
  const data = await response.json();
  stayntouchToken = {
    value:     data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
  };
  console.log(`[StayNTouch] Token refreshed successfully, expires in ${Math.round(data.expires_in / 3600)}h`);
  return stayntouchToken.value;
}

// Admin endpoint to force a token refresh without restarting the server
app.post("/admin/refresh-token", async (req, res) => {
  try {
    stayntouchToken = { value: null, expiresAt: 0 };
    const token = await getStayntouchToken();
    res.json({ success: true, tokenPrefix: token.substring(0, 12) + "..." });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

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

// ── Room-type catalog cache ───────────────────────────────────────────────────
//
// SNT identifies room types by numeric IDs in /reservations and /rooms responses.
// Avaloch-side filtering (lodge-only, room type breakdowns, etc.) operates on
// short codes (LKW / LDW / LKM / LDM). We hit /hotels/{id}/room_types once per
// TTL window to build an id→code map and enrich downstream responses.
//
// 10-minute TTL is plenty — room type catalogs change rarely and a stale entry
// just means a freshly-added room type renders as null code until refresh.

let roomTypeMapCache = { value: null, fetchedAt: 0 };
const ROOM_TYPE_CACHE_TTL_MS = 10 * 60 * 1000;

async function getRoomTypeMap() {
  const now = Date.now();
  if (roomTypeMapCache.value && now - roomTypeMapCache.fetchedAt < ROOM_TYPE_CACHE_TTL_MS) {
    return roomTypeMapCache.value;
  }
  try {
    const data = await stayntouchGet(`/hotels/${STAYNTOUCH_HOTEL_ID}/room_types`);
    const list = data.results || data || [];
    const map = {};
    for (const rt of list) {
      // SNT shape varies — try the common keys for the short code
      const code = rt.code || rt.short_code || rt.abbreviation || rt.room_type_code || null;
      if (rt.id != null) map[String(rt.id)] = code;
    }
    roomTypeMapCache = { value: map, fetchedAt: now };
    console.log(`[StayNTouch] Room-type map refreshed: ${Object.keys(map).length} types`);
    return map;
  } catch (e) {
    console.warn(`[StayNTouch] getRoomTypeMap failed: ${e.message}`);
    // Return last-known map if we have one — better stale than empty
    return roomTypeMapCache.value || {};
  }
}

// ── Shared Mapping Helper ─────────────────────────────────────────────────────

// Resolve the most specific room_type_id we can for a reservation:
//   1. The actual room assignment (post-checkin or pre-assigned), then
//   2. The first stay_date's room_type_id (always populated, even pre-assignment)
// This lets the frontend lodge-filter RESERVED rows before a room is allocated.
function pickRoomTypeId(r) {
  if (r.room?.room_type_id != null) return String(r.room.room_type_id);
  const sd = (r.stay_dates || [])[0];
  if (sd?.room_type_id != null) return String(sd.room_type_id);
  if (r.room_type_id != null) return String(r.room_type_id);   // SNT summary's flat row-level field
  return null;
}

// Maps a raw SNT reservation into the compact summary shape used by the iOS app's
// Reservation model. Used by both /reservations (today's buckets) and /reservations/search.
//
// IMPORTANT: existing fields (id, confirmation_number, primary_guest_name,
// room_number, room_type, arrival_date, departure_date, adults, children,
// status, notes) MUST stay shape-compatible — the iOS app reads them. Add new
// fields, don't repurpose old ones.
function mapReservationSummary(r, today, roomTypeMap = {}) {
  today = today || new Date().toISOString().slice(0, 10);

  // Guest name resolution handles BOTH SNT shapes:
  //   1. Full /reservations: nested guests[] with first_name/last_name.
  //   2. /reservations/summary: flat row-level first_name/last_name.
  // Nested path stays FIRST (full-endpoint behavior unchanged); flat path is
  // the summary fallback; r.primary_guest_name (a flat string SNT sometimes
  // sends) then the "Guest" placeholder remain as final fallbacks.
  const primaryGuest = (r.guests || []).find(g => g.is_primary) || r.guests?.[0] || {};
  const flatGuestName = [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
  const guestName = primaryGuest.first_name && primaryGuest.last_name
    ? `${primaryGuest.first_name} ${primaryGuest.last_name}`
    : (flatGuestName || r.primary_guest_name || "Guest");
  const stayDate = (r.stay_dates || [])[0] || {};
  const adults   = stayDate.adults   ?? r.adults   ?? 1;
  const children = stayDate.children ?? r.children ?? 0;

  // Display status — align with SNT dashboard terminology
  let displayStatus = r.status;
  if (r.status === "CHECKEDIN" && r.departure_date === today) displayStatus = "DEPARTING";
  if (r.status === "CHECKEDIN" && r.departure_date >  today)  displayStatus = "CHECKEDIN";
  if (r.status === "RESERVED"  && r.arrival_date  === today)  displayStatus = "RESERVED";

  // Clean notes — strip Way/experience booking noise
  let notes = null;
  if (r.notes && Array.isArray(r.notes)) {
    const clean = r.notes
      .map(n => n.description || n.text || "")
      .filter(n => n && !n.startsWith("Way confirmation code"))
      .join(" | ");
    notes = clean || null;
  } else if (typeof r.notes === "string" && r.notes && !r.notes.startsWith("Way confirmation code")) {
    notes = r.notes;
  }

  const roomTypeId   = pickRoomTypeId(r);
  const roomTypeCode = roomTypeId != null ? (roomTypeMap[roomTypeId] || null) : null;

  // Room number: nested room.number (full /reservations) FIRST, then SNT
  // summary's flat room_id, then the "—" placeholder.
  // TODO(christian): summary's room_id is an internal SNT room identifier, not
  // the guest-facing room number ("504") the full endpoint returns. Surfaced
  // as-is for now because it beats "—"; to render a display-friendly number it
  // likely needs joining against the rooms inventory (a rooms-id->number cache,
  // analogous to roomTypeMap). Not plumbed this session.
  const roomNumber = r.room?.number || (r.room_id != null ? String(r.room_id) : "—");

  return {
    // ── Existing iOS-compat fields (unchanged shape) ──
    id:                  String(r.id),
    confirmation_number: r.confirmation_number || `#${r.id}`,
    primary_guest_name:  guestName,
    room_number:         roomNumber,
    room_type:           r.room?.room_type_id   ? String(r.room.room_type_id) : (roomTypeId || "—"),
    arrival_date:        r.arrival_date,
    departure_date:      r.departure_date,
    adults,
    children,
    status:              displayStatus,
    notes,

    // ── New fields for the web staff portal ──
    // Lodge-filter source — populated even when no room is assigned yet.
    room_type_id:        roomTypeId,        // string id, or null
    room_type_code:      roomTypeCode,      // e.g. "LKW", or null if unknown
    // Channel signals — surfaced raw so the frontend can iterate on the
    // 3-bucket privacy collapse (Direct via website / Direct via front
    // desk / OTA channel) without redeploying the proxy. source_code is
    // what disambiguates SiteMinder pushes: "Hotel Website" vs an OTA name.
    segment_code:        r.segment_code     || null,
    creator_login:       r.creator?.login   || null,
    source_code:         r.source_code      || null,
  };
}

// ── StayNTouch Proxy — shared middleware ─────────────────────────────────────
//
// Web staff portal hits these from a browser. The iOS app also hits them
// (legacy path), so changes here must stay backward-compatible.
//
// Bearer auth: WEB_CLIENT_TOKEN in env. If unset, the check is bypassed
// (preserves iOS behavior until the iOS app is updated to send the token).
// When set, requests without a matching `Authorization: Bearer <token>`
// get 401. This is a SPEED BUMP, not real auth — the token is shipped to
// any browser that loads the staff portal. Real auth (e.g. Supabase JWT
// validated proxy-side) is the eventual fix.
const WEB_CLIENT_TOKEN = process.env.WEB_CLIENT_TOKEN || "";

const STAFF_PORTAL_ORIGINS = [
  "https://avalochstaff.xtiansampson.com",
  "https://avalochstaff.com",
  "http://localhost:5173",  // vite dev
  "http://localhost:4173",  // vite preview
];

function requireWebToken(req, res, next) {
  if (!WEB_CLIENT_TOKEN) return next();   // disabled → allow (iOS-compat)
  const auth = req.headers["authorization"] || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1].trim() : "";
  if (token !== WEB_CLIENT_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

const sntRouter = express.Router();
// CORS first so even 401 responses carry the right ACAO header for browser
// fetches that need to read the body of the failure.
sntRouter.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);  // curl, server-to-server
    if (STAFF_PORTAL_ORIGINS.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type"],
  maxAge: 86400,
}));
sntRouter.use(requireWebToken);

// ── StayNTouch Proxy Routes ───────────────────────────────────────────────────

const ISO_DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

function resolveDate(req) {
  const raw = (req.query.date || "").trim();
  if (raw && ISO_DATE_RX.test(raw)) return raw;
  return new Date().toISOString().slice(0, 10);
}

// GET /stayntouch/reservations?date=YYYY-MM-DD — active reservations for a date
sntRouter.get("/reservations", async (req, res) => {
  try {
    const date = resolveDate(req);

    // SNT dashboard logic:
    //   Arrivals  = RESERVED  where arrival_date  == date
    //   Stayovers = CHECKEDIN where departure_date >  date
    //   Departing = CHECKEDIN where departure_date == date
    //
    // SNT's `arrival_date` query string is unreliable in practice — we fetch
    // both status buckets in full and filter locally. Cheap relative to the
    // total per-day volume Avaloch sees.
    const [checkedInData, reservedData, roomTypeMap] = await Promise.all([
      stayntouchGet(`/reservations?hotel_id=${STAYNTOUCH_HOTEL_ID}&status=CHECKEDIN`),
      stayntouchGet(`/reservations?hotel_id=${STAYNTOUCH_HOTEL_ID}&status=RESERVED`),
      getRoomTypeMap(),
    ]);

    const checkedIn = (checkedInData.results || []);
    const reserved  = (reservedData.results  || []);

    const arrivals  = reserved.filter(r => r.arrival_date  === date);
    const stayovers = checkedIn.filter(r => r.departure_date >  date);
    const departing = checkedIn.filter(r => r.departure_date === date);

    // Dedupe by id (a single reservation can land in multiple buckets in
    // edge cases, e.g. same-day arrival+departure)
    const seen = new Set();
    const unique = [...arrivals, ...stayovers, ...departing].filter(r => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });

    const reservations = unique.map(r => mapReservationSummary(r, date, roomTypeMap));

    console.log(`[StayNTouch] Reservations for ${date}: ${arrivals.length} arriving, ${stayovers.length} stayovers, ${departing.length} departing`);

    res.json({ reservations, date });
  } catch (e) {
    console.error("[StayNTouch] /reservations error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /stayntouch/reservations/summary?date=YYYY-MM-DD
//
// Lightweight today-feed for the staff portal's Live Operations widget.
// Per Maria @ SNT (cert review), polling /connect/reservations is too
// resource-intensive on their side; /connect/reservations/summary is the
// purpose-built endpoint for the today-view use case. Single SNT call,
// no status-bucket gymnastics, no per-status pagination.
//
// Response shape mirrors /stayntouch/reservations ({ reservations, date })
// so the frontend swap is a one-line method-name change. Rows are run
// through mapReservationSummary for shape parity — any field the summary
// payload omits comes back null, the iOS-compat fields stay populated
// where present.
sntRouter.get("/reservations/summary", async (req, res) => {
  try {
    const date = resolveDate(req);

    const [data, roomTypeMap] = await Promise.all([
      stayntouchGet(`/reservations/summary?hotel_id=${STAYNTOUCH_HOTEL_ID}&date=${date}`),
      getRoomTypeMap(),
    ]);

    // SNT's list endpoints generally return rows under `results`; some
    // variants use `reservations`. Accept either, default to empty.
    const raw = data.results || data.reservations || [];

    const reservations = raw.map(r => mapReservationSummary(r, date, roomTypeMap));

    console.log(`[StayNTouch] Reservations summary for ${date}: ${reservations.length} rows`);

    res.json({ reservations, date });
  } catch (e) {
    console.error("[StayNTouch] /reservations/summary error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /stayntouch/reservations/search?lastName=X — reservation lookup by last name
// SNT's /reservations endpoint appears to require a `status` filter (without it,
// results are empty). We query all relevant status buckets in parallel, merge,
// dedupe, and filter locally by last name.
sntRouter.get("/reservations/search", async (req, res) => {
  try {
    const lastName = (req.query.lastName || "").trim();
    if (lastName.length < 2) {
      return res.status(400).json({ error: "lastName must be at least 2 characters" });
    }

    const today = new Date().toISOString().slice(0, 10);

    // Query each status bucket in parallel. SNT requires `status` to return results.
    // CHECKEDOUT can be high-volume so we cap per_page aggressively.
    const statuses = ["CHECKEDIN", "RESERVED", "CHECKEDOUT"];
    const [bucketResults, roomTypeMap] = await Promise.all([
      Promise.all(statuses.map(s =>
        stayntouchGet(`/reservations?hotel_id=${STAYNTOUCH_HOTEL_ID}&status=${s}&per_page=50`)
          .then(data => ({ status: s, results: data.results || [] }))
          .catch(err => {
            console.warn(`[StayNTouch] Search: failed to fetch ${s}: ${err.message}`);
            return { status: s, results: [] };
          })
      )),
      getRoomTypeMap(),
    ]);

    // Merge + dedupe by id
    const seen = new Set();
    const all = [];
    for (const bucket of bucketResults) {
      for (const r of bucket.results) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          all.push(r);
        }
      }
    }

    // Local filter: case-insensitive match against:
    // (1) any guest's last_name, or
    // (2) the primary_guest_name string (catches edge cases like "Jon Snow(SALIDO)")
    const lower = lastName.toLowerCase();
    const matches = all.filter(r => {
      const guests = r.guests || [];
      const guestLastMatch = guests.some(g => (g.last_name || "").toLowerCase().includes(lower));
      const primaryNameMatch = (r.primary_guest_name || "").toLowerCase().includes(lower);
      return guestLastMatch || primaryNameMatch;
    });

    // Sort: most relevant first — reservations closest to today
    matches.sort((a, b) => {
      const aDist = Math.abs(new Date(a.arrival_date || 0) - new Date(today));
      const bDist = Math.abs(new Date(b.arrival_date || 0) - new Date(today));
      return aDist - bDist;
    });

    const reservations = matches.map(r => mapReservationSummary(r, today, roomTypeMap));

    const bucketBreakdown = bucketResults.map(b => `${b.status}:${b.results.length}`).join(" ");
    console.log(`[StayNTouch] Search "${lastName}": buckets(${bucketBreakdown}) = ${all.length} unique, matched ${matches.length}`);

    res.json({
      reservations,
      total: matches.length,
      truncated: all.length >= 150, // rough upper bound (3 buckets * 50)
    });
  } catch (e) {
    console.error("[StayNTouch] /reservations/search error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /stayntouch/reservations/:id — full reservation detail, passed through raw
sntRouter.get("/reservations/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!/^\d+$/.test(id)) {
      return res.status(400).json({ error: "Invalid reservation id" });
    }
    const [data, roomTypeMap] = await Promise.all([
      stayntouchGet(`/reservations/${id}?hotel_id=${STAYNTOUCH_HOTEL_ID}`),
      getRoomTypeMap(),
    ]);

    // Unlike /summary and /search, this detail endpoint passes the raw SNT
    // payload through rather than running it through mapReservationSummary,
    // so the two normalizations below are duplicated inline here.
    // TODO(christian): the stay_dates departure-drop and the room_type_id ->
    // room_type_code lookup mirror logic in mapReservationSummary / pickRoomTypeId.
    // Left duplicated for now (the detail view consumes the full raw payload,
    // not the compact mapped shape); extract a shared helper if a third
    // consumer appears.

    // SNT appends the departure date as the final stay_dates entry — needed by
    // hourly-rate hotels, spurious for nightly-rate Avaloch (it double-counts a
    // night in the frontend's totals/nights math). Drop it. Build a new object;
    // don't mutate the SNT response.
    const filteredStayDates = (data.stay_dates || []).filter(sd => sd.date !== data.departure_date);

    // Room type: the detail payload carries stay_dates[].room_type_id (an integer
    // like 8766), not a display code. Resolve the first stay date's id against the
    // same id->code cache the summary feed uses; null on cache miss.
    const detailRoomTypeId = filteredStayDates[0]?.room_type_id ?? data.stay_dates?.[0]?.room_type_id;
    const detailRoomTypeCode = detailRoomTypeId != null
      ? (roomTypeMap[String(detailRoomTypeId)] || null)
      : null;

    res.json({
      ...data,
      stay_dates:     filteredStayDates,
      room_type_code: detailRoomTypeCode,
    });
  } catch (e) {
    console.error(`[StayNTouch] /reservations/${req.params.id} error:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /stayntouch/rooms — room statuses, proxied from StayNTouch and enriched
// with the human-readable room_type_code from the catalog.
sntRouter.get("/rooms", async (req, res) => {
  try {
    const [data, roomTypeMap] = await Promise.all([
      stayntouchGet(`/rooms?hotel_id=${STAYNTOUCH_HOTEL_ID}`),
      getRoomTypeMap(),
    ]);
    const rawRooms = data.results || data.rooms || data || [];

    const rooms = rawRooms.map(r => {
      const roomTypeId = r.room_type_id != null ? String(r.room_type_id) : null;
      return {
        id:             String(r.id || r.number),
        room_number:    r.number         || r.room_number || "—",
        room_type_id:   roomTypeId       || "—",                // iOS-compat
        room_type_code: roomTypeId ? (roomTypeMap[roomTypeId] || null) : null,
        floor:          r.floor?.number  || null,
        status:         r.status         || null,   // CLEAN, DIRTY, INSPECTED, etc.
        service_status: r.service_status || null,   // IN_SERVICE, OUT_OF_SERVICE
        occupied:       r.occupied       ?? false,
      };
    });

    const occupiedCount = rooms.filter(r => r.occupied).length;
    const totalCount    = rooms.length;

    console.log(`[StayNTouch] Rooms: ${occupiedCount}/${totalCount} occupied`);
    res.json({ rooms, occupied_count: occupiedCount, total_count: totalCount });
  } catch (e) {
    console.error("[StayNTouch] /rooms error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /stayntouch/room_types — the room-type catalog. Useful for any future
// widget that wants to render id→code mappings or list available types.
sntRouter.get("/room_types", async (req, res) => {
  try {
    const data = await stayntouchGet(`/hotels/${STAYNTOUCH_HOTEL_ID}/room_types`);
    const list = data.results || data || [];
    res.json({ room_types: list });
  } catch (e) {
    console.error("[StayNTouch] /room_types error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Mount the router. Adding a new SNT-backed endpoint is one route registration
// on sntRouter — auth, CORS, and base path are handled by the middleware above.
app.use("/stayntouch", sntRouter);

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

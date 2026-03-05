# Avaloch Push Server

Node.js server for sending push notifications to Avaloch Staff app via APNs.

## Deployment to Render

### 1. Create a GitHub repo
Push this folder to a new GitHub repo (e.g. `avaloch-push-server`).

### 2. Create a Render Web Service
- Go to render.com → New → Web Service
- Connect your GitHub repo
- Runtime: Node
- Build Command: `npm install`
- Start Command: `node server.js`

### 3. Set Environment Variables in Render Dashboard
Under Environment → Add the following:

| Key | Value |
|-----|-------|
| `NODE_ENV` | `development` (change to `production` for App Store) |
| `APNS_KEY_ID` | `7CZNLB7NC4` |
| `APNS_TEAM_ID` | `8LH2QGPV85` |
| `BUNDLE_ID` | `com.avaloch.Avaloch-Staff` |
| `APNS_KEY` | Paste the full contents of your `.p8` file here |
| `CLOUDKIT_SERVER_TOKEN` | Your CloudKit server-to-server token (see below) |

### 4. Get your CloudKit Server Token
- Go to CloudKit Dashboard → iCloud.com.avaloch.staff
- Click API Access → Server-to-Server Keys
- Create a new key and copy the token

### 5. Update iOS app
In `NotificationService.swift`, update:
```swift
private let serverBaseURL = "https://your-actual-render-url.onrender.com"
```
Replace with your Render service URL (shown in Render dashboard after deploy).

## Endpoints

| Method | Endpoint | Notifies |
|--------|----------|----------|
| POST | `/notify/bulletin` | Everyone |
| POST | `/notify/chat` | Everyone |
| POST | `/notify/guest-message` | Front Desk only |
| POST | `/notify/reorder` | Management + Front Desk |
| POST | `/notify/maintenance` | Maintenance only |

## Health Check
GET `/` returns server status.

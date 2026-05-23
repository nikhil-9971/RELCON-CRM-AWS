const express = require("express");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();
const SECRET = process.env.JWT_SECRET || "relcon-secret-key";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const tokenStore = new Map();

function getMeetConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  return { clientId, clientSecret, redirectUri };
}

function getRelconUser(req) {
  return String(req.user?.engineerName || req.user?.username || req.user?.name || "").trim();
}

function missingConfig(config) {
  return Object.entries(config).filter(([, value]) => !String(value || "").trim()).map(([key]) => key);
}

async function exchangeCodeForToken(code) {
  const { clientId, clientSecret, redirectUri } = getMeetConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const url = "https://oauth2.googleapis.com/token";
  const response = await axios.post(url, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return response.data;
}

async function refreshAccessToken(relconUser, tokenData) {
  const { clientId, clientSecret } = getMeetConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: tokenData.refresh_token,
    grant_type: "refresh_token",
  });
  const url = "https://oauth2.googleapis.com/token";
  const response = await axios.post(url, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const nextToken = {
    ...tokenData,
    ...response.data,
    expires_at: Date.now() + Number(response.data.expires_in || 3600) * 1000,
  };
  tokenStore.set(relconUser, nextToken);
  return nextToken;
}

async function getValidToken(relconUser) {
  const tokenData = tokenStore.get(relconUser);
  if (!tokenData) return null;
  if (Date.now() < Number(tokenData.expires_at || 0) - 60000) return tokenData;
  if (!tokenData.refresh_token) return null;
  return refreshAccessToken(relconUser, tokenData);
}

router.get("/auth-url", authMiddleware, (req, res) => {
  const config = getMeetConfig();
  const missing = missingConfig(config);
  if (missing.length) {
    return res.status(500).json({ error: "Google Meet configuration missing", missing });
  }

  const relconUser = getRelconUser(req);
  const state = jwt.sign({ relconUser, nonce: Date.now() }, SECRET, { expiresIn: "10m" });
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    scope: GOOGLE_SCOPE,
    state,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent select_account",
  });

  res.json({
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  });
});

router.get("/callback", async (req, res) => {
  try {
    const { code, state, error, error_description: errorDescription } = req.query;
    if (error) throw new Error(errorDescription || error);
    if (!code || !state) throw new Error("Missing authorization code or state");

    const decoded = jwt.verify(String(state), SECRET);
    const relconUser = String(decoded.relconUser || "").trim();
    if (!relconUser) throw new Error("Invalid state");

    const tokenData = await exchangeCodeForToken(String(code));
    tokenStore.set(relconUser, {
      ...tokenData,
      expires_at: Date.now() + Number(tokenData.expires_in || 3600) * 1000,
    });

    res.send(`<!doctype html><html><body style="font-family:Arial,sans-serif;padding:28px;">
      <h3>Google Meet connected</h3>
      <p>You can close this window and return to RELCON CRM.</p>
      <script>
        try { window.opener && window.opener.postMessage({ type: "relcon-meet-connected" }, "*"); } catch {}
        setTimeout(function(){ window.close(); }, 900);
      </script>
    </body></html>`);
  } catch (err) {
    res.status(400).send(`<!doctype html><html><body style="font-family:Arial,sans-serif;padding:28px;">
      <h3>Google Meet connection failed</h3>
      <p>${String(err.message || "Unable to connect Google Meet")}</p>
    </body></html>`);
  }
});

router.get("/status", authMiddleware, (req, res) => {
  const relconUser = getRelconUser(req);
  res.json({ connected: tokenStore.has(relconUser) });
});

router.post("/create-meeting", authMiddleware, async (req, res) => {
  try {
    const relconUser = getRelconUser(req);
    const tokenData = await getValidToken(relconUser);
    if (!tokenData?.access_token) {
      return res.status(401).json({ authRequired: true, message: "Google account not connected" });
    }

    const startDate = new Date(Date.now() + 2 * 60 * 1000);
    const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
    const subject = String(req.body?.subject || "RELCON CRM Google Meet").slice(0, 180);
    const requestId = `relcon-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const response = await axios.post(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1",
      {
        summary: subject,
        start: { dateTime: startDate.toISOString() },
        end: { dateTime: endDate.toISOString() },
        conferenceData: {
          createRequest: {
            requestId,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "Content-Type": "application/json",
        },
      }
    );

    const meetUrl = response.data?.hangoutLink ||
      response.data?.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri;

    res.json({
      joinUrl: meetUrl,
      subject: response.data?.summary || subject,
      meetingId: response.data?.id,
    });
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.error?.message || err.message || "Failed to create Google Meet";
    res.status(status).json({ error: message });
  }
});

module.exports = router;

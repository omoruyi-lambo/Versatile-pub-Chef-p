/**
 * utils/notify.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Central push-notification helper used by every route file.
 *
 * Exports:
 *   sendPush(playerIds, title, message, sendAfter?)
 *     → Sends a OneSignal push to the given player IDs.
 *     → If sendAfter (Date) is provided the notification is scheduled.
 *     → Returns the OneSignal API response body, or null on failure.
 *
 *   getAdminPlayerIds()
 *     → Returns an array of all admin OneSignal player IDs from the DB.
 *
 *   getCustomerPlayerId(customerId)
 *     → Returns a single customer's OneSignal player ID from the DB.
 *
 * Required environment variables (set these on Render):
 *   ONESIGNAL_APP_ID      — your OneSignal App ID
 *                           (Dashboard → Settings → Keys & IDs → App ID)
 *   ONESIGNAL_REST_KEY    — your OneSignal REST API Key
 *                           (Dashboard → Settings → Keys & IDs → REST API Key)
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const https    = require('https');
const User     = require('../models/User');
const Customer = require('../models/Customer');

// ─── Core send function ───────────────────────────────────────────────────────

/**
 * Send a OneSignal push notification.
 *
 * @param {string[]} playerIds  - OneSignal subscription IDs to target
 * @param {string}   title      - Notification heading
 * @param {string}   message    - Notification body
 * @param {Date}     [sendAfter] - If provided, schedule for this time (UTC)
 * @returns {Promise<object|null>} OneSignal response body, or null on failure
 */
async function sendPush(playerIds, title, message, sendAfter = null) {
  const appId   = process.env.ONESIGNAL_APP_ID;
  const restKey = process.env.ONESIGNAL_REST_KEY;

  // ── Guard: skip silently if env vars not set ──────────────────
  if (!appId || !restKey) {
    console.warn(
      '[notify] Skipping push — ONESIGNAL_APP_ID or ONESIGNAL_REST_KEY not set.\n' +
      '         Add them in Render → Environment Variables.'
    );
    return null;
  }

  // ── Guard: skip if no recipients ─────────────────────────────
  const ids = (playerIds || []).filter(Boolean);
  if (ids.length === 0) {
    console.warn('[notify] sendPush called with empty playerIds — skipping.');
    return null;
  }

  // ── Build payload ─────────────────────────────────────────────
  const payload = {
    app_id:            appId,
    include_player_ids: ids,
    headings:  { en: String(title   || 'Versatile Pub') },
    contents:  { en: String(message || '') },
    // Small icon for Android, shows restaurant branding
    android_accent_color: 'ff7a1a',
    // iOS badge
    ios_badgeType:  'Increase',
    ios_badgeCount: 1,
  };

  // Optional: schedule the notification for a future time
  if (sendAfter instanceof Date && !isNaN(sendAfter)) {
    // OneSignal expects UTC string: "2024-01-15 14:00:00 UTC"
    const pad = n => String(n).padStart(2, '0');
    const d   = sendAfter;
    payload.send_after =
      `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ` +
      `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
  }

  const body = JSON.stringify(payload);

  // ── Send via Node https (no extra dependency needed) ──────────
  return new Promise((resolve) => {
    const options = {
      hostname: 'onesignal.com',
      path:     '/api/v1/notifications',
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Authorization':  `Basic ${restKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.errors && parsed.errors.length) {
            console.warn('[notify] OneSignal errors:', JSON.stringify(parsed.errors));
          } else {
            console.log(
              `[notify] Push sent — recipients: ${parsed.recipients ?? ids.length}, ` +
              `id: ${parsed.id ?? 'N/A'}`
            );
          }
          resolve(parsed);
        } catch (e) {
          console.error('[notify] Could not parse OneSignal response:', data);
          resolve(null);
        }
      });
    });

    req.on('error', (err) => {
      console.error('[notify] OneSignal request error:', err.message);
      resolve(null);
    });

    req.write(body);
    req.end();
  });
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

/**
 * Get all admin / owner OneSignal player IDs from the User collection.
 * @returns {Promise<string[]>}
 */
async function getAdminPlayerIds() {
  try {
    const admins = await User.find(
      {
        active: true,
        oneSignalPlayerId: { $exists: true, $ne: null, $nin: ['', null] },
      },
      'oneSignalPlayerId'
    ).lean();

    return admins
      .map(u => u.oneSignalPlayerId)
      .filter(Boolean);
  } catch (err) {
    console.error('[notify] getAdminPlayerIds error:', err.message);
    return [];
  }
}

/**
 * Get a single customer's OneSignal player ID by their MongoDB _id.
 * @param {string|ObjectId} customerId
 * @returns {Promise<string|null>}
 */
async function getCustomerPlayerId(customerId) {
  if (!customerId) return null;
  try {
    const customer = await Customer.findById(customerId)
      .select('oneSignalPlayerId')
      .lean();
    return customer?.oneSignalPlayerId ?? null;
  } catch (err) {
    console.error('[notify] getCustomerPlayerId error:', err.message);
    return null;
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { sendPush, getAdminPlayerIds, getCustomerPlayerId };

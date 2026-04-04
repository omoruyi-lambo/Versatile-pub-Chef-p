/**
 * routes/settings.js
 * System-wide settings management.
 *
 * Public endpoints:
 *   GET   /api/settings/ordering        â€” check if online ordering is enabled
 *   POST  /api/settings/player-id       â€” register customer's OneSignal player ID
 *
 * Admin-only endpoints (require Bearer token):
 *   GET   /api/settings                 â€” all settings as key/value map
 *   PATCH /api/settings/ordering        â€” enable / disable online ordering
 *   PATCH /api/settings/admin-player-id â€” register the logged-in admin's player ID
 */

const express  = require('express');
const jwt      = require('jsonwebtoken');
const Settings = require('../models/Settings');
const User     = require('../models/User');
const Customer = require('../models/Customer');
const { protect } = require('../middleware/auth');

const router = express.Router();

// â”€â”€â”€ Public â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * GET /api/settings/ordering
 * Called by the frontend before rendering the order form.
 * Returns { success, enabled, message? }
 */
router.get('/ordering', async (req, res) => {
  try {
    const enabled = await Settings.get('onlineOrderingEnabled', true);
    const message = enabled
      ? null
      : await Settings.get('orderingDisabledMessage', 'Online ordering is currently unavailable. Please call us.');

    res.json({ success: true, enabled: !!enabled, message });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch settings.' });
  }
});

/**
 * POST /api/settings/player-id
 * Called from index.html after a customer accepts push notifications.
 * Body: { playerId: String, token?: String }
 *
 * If a valid customer JWT is provided, the ID is saved to that customer's record.
 * If no token (anonymous / pre-login), we acknowledge and OneSignal holds the ID.
 */
router.post('/player-id', async (req, res) => {
  try {
    const { playerId, token } = req.body;
    if (!playerId) {
      return res.status(400).json({ success: false, message: 'playerId is required.' });
    }

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        // Only save to Customer accounts (type: 'customer')
        if (decoded.type === 'customer') {
          const customer = await Customer.findById(decoded.id);
          if (customer) {
            customer.oneSignalPlayerId = playerId;
            await customer.save({ validateBeforeSave: false });
            return res.json({ success: true, message: 'Player ID saved to your account.' });
          }
        }
      } catch (_) {
        // Invalid / expired token â€” fall through to anonymous acknowledgment
      }
    }

    res.json({ success: true, message: 'Player ID registered.' });
  } catch (err) {
    console.error('Save player ID error:', err);
    res.status(500).json({ success: false, message: 'Could not save player ID.' });
  }
});

/**
 * GET /api/settings/public
 * Returns ONLY the customer-relevant settings (no auth required).
 * Called by index.html on every page load to apply live settings.
 */
router.get('/public', async (req, res) => {
  try {
    const all = await Settings.find().lean();
    const raw = {};
    all.forEach(s => { raw[s.key] = s.value; });

    // Only expose settings the customer page needs
    const pub = {
      delivFee:             raw.delivFee            !== undefined ? Number(raw.delivFee)   : 800,
      minFree:              raw.minFree             !== undefined ? Number(raw.minFree)    : 0,
      eta:                  raw.eta                || '30â€“45 minutes',
      deliveryEnabled:      raw.deliveryEnabled     !== false,
      pickupEnabled:        raw.pickupEnabled       !== false,
            podEnabled:           raw.podEnabled           !== false,
      paystackPublicKey:    process.env.PAYSTACK_PUBLIC_KEY || '',
      oneSignalAppId:       process.env.ONESIGNAL_APP_ID || '',
      oneSignalSafariWebId: process.env.ONESIGNAL_SAFARI_WEB_ID || '',
      restName:             raw.restName            || 'Versatile Pub by Chef P Kitchen',
      phone:                raw.phone               || '09052155013',
      address:              raw.address             || '17A Jemide Ave, GRA, Benin City',
      hours:                raw.hours               || 'Open 24 hours',
    };

    // Merge OOS keys (stored as oos_<id>)
    const oos = {};
    Object.entries(raw).forEach(([k, v]) => {
      if (k.startsWith('oos_')) oos[k.replace('oos_', '')] = v;
    });
    if (Object.keys(oos).length) pub.oos = oos;

    res.json({ success: true, settings: pub });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch public settings.' });
  }
});


router.get('/', protect, async (req, res) => {
  try {
    const all = await Settings.find().lean();
    const map = {};
    all.forEach(s => { map[s.key] = s.value; });
    res.json({ success: true, settings: map });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch settings.' });
  }
});

/**
 * PATCH /api/settings/ordering
 * Toggle online ordering on or off from the admin dashboard.
 * Body: { enabled: Boolean, message?: String }
 *
 * Requires role 'owner' or 'admin'. Broadcasts via Socket.IO so the
 * dashboard UI reflects the change immediately.
 */
router.patch('/ordering', protect, async (req, res) => {
  try {
    const { enabled, message } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, message: '"enabled" must be a boolean.' });
    }

    await Settings.set(
      'onlineOrderingEnabled',
      enabled,
      'Controls whether customers can place orders online'
    );

    if (!enabled && message) {
      await Settings.set(
        'orderingDisabledMessage',
        message,
        'Shown to customers when ordering is disabled'
      );
    }

    // Broadcast to all connected dashboard clients
    const io = req.app.get('io');
    if (io) io.emit('ordering_status_changed', { enabled });

    res.json({
      success: true,
      enabled,
      message: `Online ordering is now ${enabled ? 'ENABLED âœ…' : 'DISABLED âŒ'}.`,
    });
  } catch (err) {
    console.error('Toggle ordering error:', err);
    res.status(500).json({ success: false, message: 'Could not update setting.' });
  }
});

/**
 * PATCH /api/settings/admin-player-id
 * POST  /api/settings/admin-player-id  â† also accept POST (sent by admin dashboard)
 * Called from admin-dashboard.html after the admin accepts browser push notifications.
 * Saves the OneSignal player ID against the currently logged-in User document.
 * Body: { playerId: String }
 */
async function saveAdminPlayerId(req, res) {
  try {
    const { playerId } = req.body;
    if (!playerId) {
      return res.status(400).json({ success: false, message: 'playerId is required.' });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { oneSignalPlayerId: playerId },
      { new: true }
    ).select('-password');

    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    res.json({
      success: true,
      message: 'OneSignal player ID saved. You will now receive push notifications.',
      user: { id: user._id, username: user.username, displayName: user.displayName },
    });
  } catch (err) {
    console.error('Admin player ID error:', err);
    res.status(500).json({ success: false, message: 'Could not save player ID.' });
  }
}
router.patch('/admin-player-id', protect, saveAdminPlayerId);
router.post('/admin-player-id',  protect, saveAdminPlayerId);

/**
 * POST /api/notify/all
 * Send a push notification to ALL subscribed customers.
 * Called by admin dashboard broadcast modal and OOS notifications.
 * Body: { title, message, data? }
 */
router.post('/notify/all', protect, async (req, res) => {
  try {
    const { title, message } = req.body;
    if (!title || !message) {
      return res.status(400).json({ success: false, message: 'title and message are required.' });
    }

    const customers = await Customer.find(
      { oneSignalPlayerId: { $exists: true, $ne: null, $nin: ['', null] } },
      'oneSignalPlayerId'
    ).lean();

    const playerIds = customers.map(c => c.oneSignalPlayerId).filter(Boolean);

    if (playerIds.length === 0) {
      return res.json({ success: true, message: 'No subscribed customers to notify.', sent: 0 });
    }

    const { sendPush } = require('../utils/notify');
    const result = await sendPush(playerIds, title, message);

    // Also broadcast via Socket.IO for customers currently on the site
    const io = req.app.get('io');
    if (io) io.emit('customer_announcement', { title, message });

    res.json({
      success: true,
      message: `Notification sent to ${result?.recipients ?? playerIds.length} customers.`,
      sent: result?.recipients ?? playerIds.length,
    });
  } catch (err) {
    console.error('Notify all error:', err);
    res.status(500).json({ success: false, message: 'Could not send notification.' });
  }
});

/**
 * POST /api/notify/customer
 * Send a push notification to ONE specific customer by their player ID.
 * Called by admin dashboard when accepting/rejecting a specific order.
 * Body: { playerId, title, message, data? }
 */
router.post('/notify/customer', protect, async (req, res) => {
  try {
    const { playerId, title, message } = req.body;
    if (!playerId) {
      return res.status(400).json({ success: false, message: 'playerId is required.' });
    }

    const { sendPush } = require('../utils/notify');
    const result = await sendPush([playerId], title || 'ðŸ½ï¸ Versatile Pub', message || 'Your order has been updated.');

    res.json({ success: true, result });
  } catch (err) {
    console.error('Notify customer error:', err);
    res.status(500).json({ success: false, message: 'Could not send notification.' });
  }
});

/**
 * POST /api/notify/admin
 * Send a push notification to the admin.
 * Body: { playerId, title, message, data? }
 */
router.post('/notify/admin', protect, async (req, res) => {
  try {
    const { playerId, title, message } = req.body;
    if (!playerId) {
      return res.status(400).json({ success: false, message: 'playerId is required.' });
    }

    const { sendPush } = require('../utils/notify');
    const result = await sendPush([playerId], title || 'ðŸ”” New Order!', message || 'A new order has been placed.');

    res.json({ success: true, result });
  } catch (err) {
    console.error('Notify admin error:', err);
    res.status(500).json({ success: false, message: 'Could not send notification.' });
  }
});

/**
 * POST /api/settings/notify-customers
 * Broadcast a push notification to ALL subscribed customers,
 * OR to specific players if playerIds array is provided.
 * Body: { title, message, playerIds?: string[] }
 */
router.post('/notify-customers', protect, async (req, res) => {
  try {
    const { title, message, playerIds: specificIds } = req.body;
    if (!title || !message) {
      return res.status(400).json({ success: false, message: 'title and message are required.' });
    }

    const { sendPush } = require('../utils/notify');
    let playerIds = specificIds;

    // If no specific IDs given, get all subscribed customers from DB
    if (!playerIds || !playerIds.length) {
      const customers = await Customer.find(
        { oneSignalPlayerId: { $exists: true, $ne: null, $nin: ['', null] } },
        'oneSignalPlayerId'
      ).lean();
      playerIds = customers.map(c => c.oneSignalPlayerId).filter(Boolean);
    }

    if (!playerIds.length) {
      return res.json({ success: true, message: 'No subscribed customers to notify.', sent: 0 });
    }

    const result = await sendPush(playerIds, title, message);

    // Also broadcast via Socket.IO so any open customer tabs see it live
    const io = req.app.get('io');
    if (io) io.emit('customer_announcement', { title, message });

    res.json({
      success: true,
      message: `Notification sent to ${result?.recipients ?? playerIds.length} customers.`,
      sent: result?.recipients ?? playerIds.length,
    });
  } catch (err) {
    console.error('Notify customers error:', err);
    res.status(500).json({ success: false, message: 'Could not send notification.' });
  }
});

/**
 * POST /api/settings (bulk)
 * Save multiple settings at once.
 * Body: Array of { key, value }
 */
router.post('/', protect, async (req, res) => {
  try {
    const items = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Array of { key, value } required.' });
    }
    await Promise.all(items.map(({ key, value }) => Settings.set(key, value)));

    // Build a flat map of keyâ†’value to broadcast so the customer frontend
    // can apply the changes immediately (delivery toggles, fees, etc.)
    const broadcastPayload = { keys: items.map(i => i.key) };
    items.forEach(({ key, value }) => { broadcastPayload[key] = value; });

    // Broadcast to all connected clients so customer site can react live
    const io = req.app.get('io');
    if (io) io.emit('settings_changed', broadcastPayload);

    res.json({ success: true, message: `${items.length} setting(s) saved.` });
  } catch (err) {
    console.error('Bulk settings save error:', err);
    res.status(500).json({ success: false, message: 'Could not save settings.' });
  }
});

module.exports = router;

/**
 * routes/reservations.js
 *
 * CHANGE LOG vs original
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/reservations
 *   • Immediate push → admins: "New reservation for [Event] by [Guest]"
 *   • Immediate push → customer: "Your spot for [Event] is confirmed!"
 *   • Scheduled push → customer: 2-hour reminder before eventDate (send_after)
 *     The OneSignal notification ID is saved to reservation.reminderScheduledId
 *
 * PATCH /api/reservations/:id/status
 *   • On 'cancelled': attempts to cancel the scheduled reminder via OneSignal DELETE
 *   • On 'confirmed': sends a fresh confirmation push to the customer
 * ─────────────────────────────────────────────────────────────────────────────
 */

const express     = require('express');
const axios       = require('axios');
const Reservation = require('../models/Reservation');
const Customer    = require('../models/Customer');
const { protect } = require('../middleware/auth');
const { sendPush, getAdminPlayerIds, getCustomerPlayerId } = require('../utils/notify');

const router = express.Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve customer's OneSignal player ID from a reservation.
 * Priority: customerId ref → email lookup → phone lookup.
 */
async function resolveCustomerPid(reservation) {
  if (reservation.customerId) {
    const pid = await getCustomerPlayerId(reservation.customerId);
    if (pid) return pid;
  }
  if (reservation.guestEmail || reservation.guestPhone) {
    const query = [];
    if (reservation.guestEmail) query.push({ email: new RegExp(`^${reservation.guestEmail}$`, 'i') });
    if (reservation.guestPhone) query.push({ phone: reservation.guestPhone });
    const customer = await Customer.findOne({ $or: query }).select('oneSignalPlayerId').lean();
    return customer?.oneSignalPlayerId ?? null;
  }
  return null;
}

/**
 * Attempt to cancel a scheduled OneSignal notification by its ID.
 * Silently ignores failures (notification may have already been sent).
 */
async function cancelScheduledNotification(notificationId) {
  if (!notificationId || !process.env.ONESIGNAL_APP_ID || !process.env.ONESIGNAL_REST_KEY) return;
  try {
    await axios.delete(
      `https://onesignal.com/api/v1/notifications/${notificationId}?app_id=${process.env.ONESIGNAL_APP_ID}`,
      {
        headers: { Authorization: `Basic ${process.env.ONESIGNAL_REST_KEY}` },
        timeout: 6000,
      }
    );
    console.log(`[OneSignal] Scheduled notification ${notificationId} cancelled.`);
  } catch (err) {
    const detail = err.response?.data ?? err.message;
    console.warn('[OneSignal] Could not cancel scheduled notification:', JSON.stringify(detail));
  }
}

// ─── POST /api/reservations — New booking (public) ───────────────────────────
router.post('/', async (req, res) => {
  try {
    const {
      guestName, guestEmail, guestPhone,
      date, time, guests, occasion, requests,
      customerId,
    } = req.body;

    if (!guestName || !guestPhone || !date || !time || !guests) {
      return res.status(400).json({
        success: false,
        message: 'Name, phone, date, time and guest count are required.',
      });
    }

    // ── Future-date check ─────────────────────────────────────
    const bookingDate = new Date(date); bookingDate.setHours(0, 0, 0, 0);
    const today       = new Date();     today.setHours(0, 0, 0, 0);
    if (bookingDate < today) {
      return res.status(400).json({
        success: false,
        message: 'Booking date must be today or in the future.',
      });
    }

    // ── Save reservation ──────────────────────────────────────
    // eventName and eventDate are auto-populated by the pre-save hook in the model
    const reservation = await Reservation.create({
      customerId: customerId || null,
      guestName, guestEmail, guestPhone,
      date, time, guests: Number(guests),
      occasion, requests,
      eventName: occasion || 'Table Reservation',
    });

    const eventLabel = reservation.eventName;

    // ── Real-time → admin dashboard ───────────────────────────
    const io = req.app.get('io');
    if (io) io.to('dashboard').emit('new_reservation', reservation);

    // ── OneSignal push → admins (immediate) ──────────────────
    const adminIds = await getAdminPlayerIds();
    if (adminIds.length > 0) {
      sendPush(
        adminIds,
        '📅 New Reservation!',
        `New reservation for "${eventLabel}" by ${guestName} on ${date} at ${time}`
      ).catch(() => {});
    }

    // ── OneSignal push → customer (immediate confirmation) ────
    const customerPid = await resolveCustomerPid(reservation);
    if (customerPid) {
      sendPush(
        [customerPid],
        '🎉 Reservation Confirmed!',
        `Your spot for "${eventLabel}" on ${date} at ${time} is confirmed! We look forward to seeing you.`
      ).catch(() => {});
    }

    // ── OneSignal scheduled reminder → customer (2 hrs before) ─
    if (customerPid && reservation.eventDate) {
      const reminderTime = new Date(reservation.eventDate.getTime() - 2 * 60 * 60 * 1000);
      const now          = new Date();

      if (reminderTime > now) {
        // Schedule the reminder — store the returned notification ID
        const notifResult = await sendPush(
          [customerPid],
          '⏰ Reminder: Your Reservation is Soon!',
          `Just a heads-up — "${eventLabel}" at EJ Cuisine is in 2 hours (${time}). See you soon!`,
          reminderTime
        );

        if (notifResult?.id) {
          reservation.reminderScheduledId = notifResult.id;
          await reservation.save();
        }
      }
    }

    res.status(201).json({ success: true, reservation });
  } catch (err) {
    console.error('Create reservation error:', err);
    res.status(500).json({ success: false, message: 'Could not create reservation.' });
  }
});

// ─── GET /api/reservations — All reservations (admin) ────────────────────────
router.get('/', protect, async (req, res) => {
  try {
    const { status, date, limit = 100, skip = 0 } = req.query;
    const filter = {};

    if (status && status !== 'all') filter.status = status;
    if (date) filter.date = date;

    const [reservations, total] = await Promise.all([
      Reservation.find(filter)
        .sort({ date: 1, time: 1 })
        .limit(Number(limit))
        .skip(Number(skip))
        .lean(),
      Reservation.countDocuments(filter),
    ]);

    res.json({ success: true, total, reservations });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch reservations.' });
  }
});

// ─── PATCH /api/reservations/:id/status — Confirm / cancel ───────────────────
router.patch('/:id/status', protect, async (req, res) => {
  try {
    const { status, note } = req.body;
    const allowed = ['pending', 'confirmed', 'cancelled', 'completed'];

    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status.' });
    }

    const update = { status, note };
    if (status === 'confirmed') update.confirmedAt = new Date();
    if (status === 'cancelled') update.cancelledAt = new Date();

    const reservation = await Reservation.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation not found.' });
    }

    // ── Real-time → dashboard ─────────────────────────────────
    const io = req.app.get('io');
    if (io) io.to('dashboard').emit('reservation_updated', reservation);

    const customerPid = await resolveCustomerPid(reservation);
    const eventLabel  = reservation.eventName || 'your reservation';

    // ── If cancelled: cancel scheduled reminder + notify customer ─
    if (status === 'cancelled') {
      if (reservation.reminderScheduledId) {
        await cancelScheduledNotification(reservation.reminderScheduledId);
        // Clear the stored ID so we don't try again
        await Reservation.findByIdAndUpdate(reservation._id, { reminderScheduledId: null });
      }
      if (customerPid) {
        sendPush(
          [customerPid],
          '❌ Reservation Cancelled',
          `Your reservation for "${eventLabel}" on ${reservation.date} has been cancelled. Call us if you need help.`
        ).catch(() => {});
      }
    }

    // ── If confirmed: send confirmation push to customer ──────
    if (status === 'confirmed' && customerPid) {
      sendPush(
        [customerPid],
        '✅ Reservation Confirmed!',
        `Great news! Your spot for "${eventLabel}" on ${reservation.date} at ${reservation.time} is confirmed.`
      ).catch(() => {});
    }

    res.json({ success: true, reservation });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not update reservation.' });
  }
});

// ─── DELETE /api/reservations/:id ────────────────────────────────────────────
router.delete('/:id', protect, async (req, res) => {
  try {
    const reservation = await Reservation.findByIdAndDelete(req.params.id);

    // Best-effort cancel of any scheduled OneSignal notification
    if (reservation?.reminderScheduledId) {
      cancelScheduledNotification(reservation.reminderScheduledId).catch(() => {});
    }

    res.json({ success: true, message: 'Reservation deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not delete reservation.' });
  }
});

module.exports = router;

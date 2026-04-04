/**
 * models/Reservation.js
 *
 * CHANGE LOG
 * ──────────────────────────────────────────────────────────────────────────────
 * + customerId          — optional ref to Customer (when guest is logged in)
 * + eventName           — friendly label (defaults to occasion or 'Table Reservation')
 * + eventDate           — full JS Date built from date + time by pre-save hook;
 *                         used to schedule OneSignal send_after reminders
 * + reminderScheduledId — OneSignal notification ID of the scheduled 2-hour
 *                         reminder; stored so it can be cancelled on cancellation
 *
 * All original fields (guestName, guestEmail, guestPhone, date, time, guests,
 * occasion, requests, status, confirmedAt, cancelledAt, note, indexes) unchanged.
 * ──────────────────────────────────────────────────────────────────────────────
 */

const mongoose = require('mongoose');

const reservationSchema = new mongoose.Schema(
  {
    // ── New reference ─────────────────────────────────────────
    customerId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Customer',
      default: null,
    },
    // ─────────────────────────────────────────────────────────

    guestName:  { type: String, required: true, trim: true },
    guestEmail: { type: String, trim: true, lowercase: true },
    guestPhone: { type: String, required: true, trim: true },

    date:     { type: String, required: true }, // "YYYY-MM-DD"
    time:     { type: String, required: true }, // "HH:MM"
    guests:   { type: Number, required: true, min: 1, max: 20 },
    occasion: { type: String, trim: true },
    requests: { type: String, trim: true },

    // ── New fields ────────────────────────────────────────────
    /**
     * Human-readable event label used in push notification messages.
     * Populated by the pre-save hook; falls back to occasion or 'Table Reservation'.
     */
    eventName: { type: String, trim: true, default: '' },

    /**
     * Full ISO Date computed from date + time strings.
     * Required for OneSignal's send_after scheduling.
     */
    eventDate: { type: Date, default: null },

    /**
     * OneSignal notification ID of the scheduled 2-hour reminder.
     * Saved so the reminder can be cancelled if the reservation is cancelled.
     */
    reminderScheduledId: { type: String, default: null },
    // ─────────────────────────────────────────────────────────

    status: {
      type:    String,
      enum:    ['pending', 'confirmed', 'cancelled', 'completed'],
      default: 'pending',
    },

    confirmedAt: { type: Date },
    cancelledAt: { type: Date },
    note:        { type: String },
  },
  { timestamps: true }
);

// ── Pre-save hook: build eventDate and eventName ──────────────
reservationSchema.pre('save', function (next) {
  // Build eventDate from date + time strings (only on new docs or when date/time changes)
  if ((this.isNew || this.isModified('date') || this.isModified('time')) && this.date && this.time) {
    const combined = new Date(`${this.date}T${this.time}:00`);
    if (!isNaN(combined)) this.eventDate = combined;
  }

  // Default eventName
  if (!this.eventName) {
    this.eventName = this.occasion || 'Table Reservation';
  }

  next();
});

// ── Indexes ───────────────────────────────────────────────────
reservationSchema.index({ date: 1, status: 1 });
reservationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Reservation', reservationSchema);

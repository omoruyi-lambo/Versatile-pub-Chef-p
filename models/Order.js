/**
 * models/Order.js
 *
 * CHANGE LOG
 * ──────────────────────────────────────────────────────────────────────────────
 * + customerId       — optional ref to Customer (when buyer is logged in)
 * + riderId          — optional ref to Rider (set when status → 'transporting')
 * + 'transporting'   — new status: rider is on the way to customer
 * + 'rejected'       — new status: kitchen/admin cannot process the order
 * + rejectionReason  — optional text stored when status = 'rejected'
 *
 * All original fields (ref, customerName, customerEmail, customerPhone,
 * items, subtotal, deliveryFee, grandTotal, isDelivery, deliveryAddress,
 * isPaid, paystackRef, note, itemCount virtual, indexes) are unchanged.
 * ──────────────────────────────────────────────────────────────────────────────
 */

const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
  {
    id:       { type: Number, required: true },
    name:     { type: String, required: true },
    qty:      { type: Number, required: true, min: 1 },
    price:    { type: Number, required: true, min: 0 },
    category: { type: String, default: 'other' },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    ref: {
      type:     String,
      required: true,
      unique:   true,
      uppercase: true,
    },

    // ── New references ────────────────────────────────────────
    customerId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Customer',
      default: null,
    },
    riderId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Rider',
      default: null,
    },
    // ─────────────────────────────────────────────────────────

    customerName:    { type: String, required: true, trim: true },
    customerEmail:   { type: String, trim: true, lowercase: true },
    customerPhone:   { type: String, required: true, trim: true },

    items:           { type: [orderItemSchema], required: true },
    subtotal:        { type: Number, required: true },
    deliveryFee:     { type: Number, default: 0 },
    grandTotal:      { type: Number, required: true },

    isDelivery:      { type: Boolean, default: false },
    deliveryAddress: { type: String, trim: true },

    isPaid:      { type: Boolean, default: false },
    paystackRef: { type: String },

    note:            { type: String, trim: true },
    oneSignalPlayerId: { type: String, default: null }, // guest customer push notification ID

    // ── New field ─────────────────────────────────────────────
    rejectionReason: { type: String, trim: true, default: '' },
    // ─────────────────────────────────────────────────────────

    status: {
      type:    String,
      enum:    ['new', 'preparing', 'ready', 'transporting', 'delivered', 'cancelled', 'rejected'],
      default: 'new',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  }
);

// ── Virtual: item count ───────────────────────────────────────
orderSchema.virtual('itemCount').get(function () {
  return this.items.reduce((s, i) => s + i.qty, 0);
});

// ── Indexes ───────────────────────────────────────────────────
orderSchema.index({ createdAt: -1 });
orderSchema.index({ status: 1 });

module.exports = mongoose.model('Order', orderSchema);

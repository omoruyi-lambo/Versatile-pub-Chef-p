/**
 * models/Customer.js
 * Customer accounts for EJ Cuisine.
 *
 * CHANGE LOG
 * ----------
 * + oneSignalPlayerId  — stores the OneSignal Web/App player ID so
 *                        we can send off-site push notifications to customers.
 */

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const customerSchema = new mongoose.Schema(
  {
    full_name:        { type: String, required: true, trim: true },
    email:            { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone:            { type: String, required: true, trim: true },
    delivery_address: { type: String, trim: true, default: '' },
    password:         { type: String, required: true, select: false },

    /** OneSignal player ID — set when the customer subscribes to notifications */
    oneSignalPlayerId: { type: String, default: null },

    active:    { type: Boolean, default: true },
    lastLogin: { type: Date },
  },
  { timestamps: true }
);

customerSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

customerSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('Customer', customerSchema);

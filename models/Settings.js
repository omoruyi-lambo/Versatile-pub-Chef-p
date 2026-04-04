/**
 * models/Settings.js
 * Key-value store for system-wide settings.
 *
 * Keys used by EJ Cuisine:
 *   "onlineOrderingEnabled"  (Boolean, default: true)
 *
 * Usage:
 *   await Settings.get('onlineOrderingEnabled', true)
 *   await Settings.set('onlineOrderingEnabled', false)
 */

const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema(
  {
    key:         { type: String, required: true, unique: true },
    value:       { type: mongoose.Schema.Types.Mixed },
    description: { type: String, default: '' },
  },
  { timestamps: true }
);

// ── Static helpers ────────────────────────────────────────────

/** Read a setting by key. Returns defaultValue if the key doesn't exist yet. */
settingsSchema.statics.get = async function (key, defaultValue = null) {
  const doc = await this.findOne({ key }).lean();
  return doc !== null ? doc.value : defaultValue;
};

/** Upsert a setting value. */
settingsSchema.statics.set = async function (key, value, description = '') {
  return this.findOneAndUpdate(
    { key },
    { $set: { value, ...(description && { description }) } },
    { upsert: true, new: true }
  );
};

module.exports = mongoose.model('Settings', settingsSchema);

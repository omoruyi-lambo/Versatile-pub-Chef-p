/**
 * models/User.js
 *
 * CHANGE LOG
 * ──────────────────────────────────────────────────────────────────────────────
 * + email              — optional, used for admin identification / contact
 * + oneSignalPlayerId  — stores the Web Push player ID so admins receive
 *                        off-site push notifications via OneSignal
 *
 * Everything else (username, password, role, displayName, lastLogin, active,
 * comparePassword, pre-save hash) is unchanged from the original.
 * ──────────────────────────────────────────────────────────────────────────────
 */

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    username: {
      type:      String,
      required:  true,
      unique:    true,
      trim:      true,
      lowercase: true,
    },
    password: {
      type:      String,
      required:  true,
      minlength: 6,
      select:    false, // never returned by default
    },
    role: {
      type:    String,
      enum:    ['owner', 'admin', 'staff'],
      default: 'admin',
    },
    displayName: { type: String },

    // ── New fields ───────────────────────────────────────────
    email: {
      type:      String,
      trim:      true,
      lowercase: true,
      default:   '',
    },

    /**
     * oneSignalPlayerId
     * Set when the admin/owner opens the dashboard and accepts
     * browser push notifications. Used by utils/notify.js to
     * send off-site alerts for new orders and reservations.
     */
    oneSignalPlayerId: { type: String, default: null },
    // ────────────────────────────────────────────────────────

    lastLogin: { type: Date },
    active:    { type: Boolean, default: true },
  },
  { timestamps: true }
);

// ── Hash password before save ─────────────────────────────────
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// ── Compare password ──────────────────────────────────────────
userSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);

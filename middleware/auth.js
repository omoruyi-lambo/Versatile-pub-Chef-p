/**
 * middleware/auth.js
 *
 * CHANGE LOG
 * ──────────────────────────────────────────────────────────────────────────────
 * protect()
 *   • Now rejects customer tokens (type: 'customer') — admin routes stay
 *     completely separate from customer-facing routes. A customer accidentally
 *     hitting an admin endpoint gets a clear 403 instead of a confusing error.
 *
 * ownerOnly() — unchanged.
 * ──────────────────────────────────────────────────────────────────────────────
 */

const jwt  = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;

  // Accept from Authorization header or cookie
  if (req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies?.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorised. Please log in.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Reject customer tokens — they are not staff/admin accounts
    if (decoded.type === 'customer') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Staff login required.',
      });
    }

    req.user = await User.findById(decoded.id).select('-password');

    if (!req.user || !req.user.active) {
      return res.status(401).json({ success: false, message: 'Account not found or disabled.' });
    }

    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
};

const ownerOnly = (req, res, next) => {
  if (req.user?.role !== 'owner') {
    return res.status(403).json({ success: false, message: 'Owner access required.' });
  }
  next();
};

module.exports = { protect, ownerOnly };

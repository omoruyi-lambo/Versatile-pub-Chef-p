const express   = require('express');
const jwt       = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const Customer  = require('../models/Customer');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { success: false, message: 'Too many attempts. Try again in 15 minutes.' },
});

const signToken = (id) =>
  jwt.sign({ id, type: 'customer' }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  });

// ── POST /api/customer-auth — single endpoint the frontend calls ──
// Body: { action: 'login' | 'register' | 'logout' | 'me', ...fields }
router.post('/', async (req, res) => {
  const { action } = req.body;

  // Only rate-limit login and register — NOT me/logout (page loads would hit limit)
  if (action === 'login' || action === 'register') {
    await new Promise((resolve, reject) => {
      loginLimiter(req, res, (err) => err ? reject(err) : resolve());
    }).catch(() => {});
    if (res.headersSent) return;
  }

  try {
    // ── REGISTER ────────────────────────────────────────────────
    if (action === 'register') {
      const { full_name, email, phone, delivery_address, password, confirm_password } = req.body;

      const errors = {};
      if (!full_name || full_name.length < 2) errors.full_name = 'Please enter your full name';
      if (!phone)                             errors.phone     = 'Phone number is required';
      if (!email || !email.includes('@'))     errors.email     = 'Enter a valid email address';
      if (!password || password.length < 8)   errors.password  = 'Password must be at least 8 characters';
      if (password !== confirm_password)       errors.confirm_password = 'Passwords do not match';

      if (Object.keys(errors).length) {
        return res.status(400).json({ success: false, errors });
      }

      const exists = await Customer.findOne({ email: email.toLowerCase() });
      if (exists) {
        return res.status(409).json({
          success: false,
          errors: { email: 'An account with this email already exists' },
        });
      }

      const customer = await Customer.create({
        full_name, email, phone,
        delivery_address: delivery_address || '',
        password,
      });

      const token = signToken(customer._id);

      return res.status(201).json({
        success: true,
        token,
        user: {
          id:               customer._id,
          full_name:        customer.full_name,
          email:            customer.email,
          phone:            customer.phone,
          delivery_address: customer.delivery_address,
        },
      });
    }

    // ── LOGIN ────────────────────────────────────────────────────
    if (action === 'login') {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and password are required.' });
      }

      const customer = await Customer.findOne({ email: email.toLowerCase() }).select('+password');
      if (!customer || !customer.active) {
        return res.status(401).json({ success: false, message: 'Incorrect email or password.' });
      }

      const isMatch = await customer.comparePassword(password);
      if (!isMatch) {
        return res.status(401).json({ success: false, message: 'Incorrect email or password.' });
      }

      customer.lastLogin = new Date();
      await customer.save({ validateBeforeSave: false });

      const token = signToken(customer._id);

      return res.json({
        success: true,
        token,
        user: {
          id:               customer._id,
          full_name:        customer.full_name,
          email:            customer.email,
          phone:            customer.phone,
          delivery_address: customer.delivery_address,
        },
      });
    }

    // ── ME (verify token) ────────────────────────────────────────
    if (action === 'me') {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Not authenticated.' });
      }
      const token = authHeader.split(' ')[1];
      try {
        const decoded  = jwt.verify(token, process.env.JWT_SECRET);
        const customer = await Customer.findById(decoded.id);
        if (!customer) return res.status(401).json({ success: false, message: 'Account not found.' });
        return res.json({
          success: true,
          user: {
            id:               customer._id,
            full_name:        customer.full_name,
            email:            customer.email,
            phone:            customer.phone,
            delivery_address: customer.delivery_address,
          },
        });
      } catch (e) {
        const msg = e.name === 'TokenExpiredError' ? 'Session expired. Please sign in again.' : 'Session error. Please sign in again.';
        return res.status(401).json({ success: false, message: msg });
      }
    }

    // ── LOGOUT (client-side — just confirm) ─────────────────────
    if (action === 'logout') {
      return res.json({ success: true, message: 'Logged out.' });
    }

    return res.status(400).json({ success: false, message: 'Unknown action.' });

  } catch (err) {
    console.error('Customer auth error:', err);
    res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

module.exports = router;

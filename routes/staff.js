const express  = require('express');
const Staff    = require('../models/Staff');
const { protect } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/staff — All active staff (admin) ─────────────────
router.get('/', protect, async (req, res) => {
  try {
    const staff = await Staff.find({ active: true }).sort({ role: 1, createdAt: 1 });
    res.json({ success: true, staff });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch staff.' });
  }
});

// ── POST /api/staff — Add staff (admin) ───────────────────────
router.post('/', protect, async (req, res) => {
  try {
    const { firstName, lastName, role, phone } = req.body;
    if (!firstName || !lastName || !role) {
      return res.status(400).json({ success: false, message: 'First name, last name and role are required.' });
    }
    const member = await Staff.create({ firstName, lastName, role, phone });
    res.status(201).json({ success: true, member });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not add staff member.' });
  }
});

// ── PATCH /api/staff/:id/status — Update status ───────────────
router.patch('/:id/status', protect, async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['online', 'offline', 'busy'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status.' });
    }
    const member = await Staff.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!member) return res.status(404).json({ success: false, message: 'Staff member not found.' });
    res.json({ success: true, member });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not update status.' });
  }
});

// ── DELETE /api/staff/:id — Soft-delete staff ─────────────────
router.delete('/:id', protect, async (req, res) => {
  try {
    const member = await Staff.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
    if (!member) return res.status(404).json({ success: false, message: 'Staff member not found.' });
    res.json({ success: true, message: 'Staff member removed.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not remove staff member.' });
  }
});

module.exports = router;

/**
 * routes/riders.js
 * CRUD management for delivery riders (admin-only).
 *
 * GET    /api/riders           — list active riders
 * POST   /api/riders           — add a rider
 * PATCH  /api/riders/:id       — update rider details
 * PATCH  /api/riders/:id/availability — toggle isAvailable
 * DELETE /api/riders/:id       — soft-delete (active: false)
 */

const express  = require('express');
const Rider    = require('../models/Rider');
const { protect } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/riders ───────────────────────────────────────────
router.get('/', protect, async (req, res) => {
  try {
    const { available } = req.query;
    const filter = { active: true };
    if (available !== undefined) filter.isAvailable = available === 'true';

    const riders = await Rider.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ success: true, riders });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch riders.' });
  }
});

// ── POST /api/riders ──────────────────────────────────────────
router.post('/', protect, async (req, res) => {
  try {
    const { name, phoneNumber, vehicleDetails } = req.body;
    if (!name || !phoneNumber) {
      return res.status(400).json({ success: false, message: 'Name and phone number are required.' });
    }
    const rider = await Rider.create({ name, phoneNumber, vehicleDetails });
    res.status(201).json({ success: true, rider });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not add rider.' });
  }
});

// ── PATCH /api/riders/:id — Update details ────────────────────
router.patch('/:id', protect, async (req, res) => {
  try {
    const rider = await Rider.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!rider) return res.status(404).json({ success: false, message: 'Rider not found.' });
    res.json({ success: true, rider });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not update rider.' });
  }
});

// ── PATCH /api/riders/:id/availability — Toggle availability ──
router.patch('/:id/availability', protect, async (req, res) => {
  try {
    const rider = await Rider.findById(req.params.id);
    if (!rider) return res.status(404).json({ success: false, message: 'Rider not found.' });
    rider.isAvailable = req.body.isAvailable !== undefined ? !!req.body.isAvailable : !rider.isAvailable;
    await rider.save();
    res.json({ success: true, rider });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not update availability.' });
  }
});

// ── DELETE /api/riders/:id — Soft-delete ─────────────────────
router.delete('/:id', protect, async (req, res) => {
  try {
    const rider = await Rider.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
    if (!rider) return res.status(404).json({ success: false, message: 'Rider not found.' });
    res.json({ success: true, message: 'Rider removed.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not remove rider.' });
  }
});

module.exports = router;

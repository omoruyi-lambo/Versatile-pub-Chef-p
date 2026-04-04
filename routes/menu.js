const express    = require('express');
const MenuItem   = require('../models/MenuItem');
const { protect } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/menu — All menu items (public) ───────────────────
router.get('/', async (req, res) => {
  try {
    const { category, available } = req.query;
    const filter = {};

    if (category && category !== 'all') filter.category = category;
    if (available !== undefined) filter.available = available === 'true';

    const items = await MenuItem.find(filter).sort({ sortOrder: 1, createdAt: 1 });
    res.json({ success: true, items });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch menu.' });
  }
});

// ── POST /api/menu — Add item (admin) ─────────────────────────
router.post('/', protect, async (req, res) => {
  try {
    const { name, description, price, category, image, available, badge, badgeText, sortOrder } = req.body;

    if (!name || !price || !category) {
      return res.status(400).json({ success: false, message: 'Name, price and category are required.' });
    }

    const item = await MenuItem.create({
      name, description, price: Number(price), category,
      image, available: available !== false,
      badge, badgeText, sortOrder: sortOrder || 0,
    });

    // Broadcast to all customer browsers — they will re-fetch the menu live
    const io = req.app.get('io');
    if (io) io.emit('menu_updated');

    res.status(201).json({ success: true, item });
  } catch (err) {
    console.error('Create menu item error:', err);
    res.status(500).json({ success: false, message: 'Could not create menu item.' });
  }
});

// ── PUT /api/menu/:id — Update item (admin) ───────────────────
router.put('/:id', protect, async (req, res) => {
  try {
    const item = await MenuItem.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!item) return res.status(404).json({ success: false, message: 'Menu item not found.' });
    const io = req.app.get('io');
    if (io) io.emit('menu_updated');
    res.json({ success: true, item });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not update menu item.' });
  }
});

// ── PATCH /api/menu/:id/toggle — Toggle availability (admin) ──
router.patch('/:id/toggle', protect, async (req, res) => {
  try {
    const item = await MenuItem.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Menu item not found.' });
    item.available = !item.available;
    await item.save();
    const io = req.app.get('io');
    if (io) io.emit('menu_updated');
    res.json({ success: true, item });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not toggle availability.' });
  }
});

// ── DELETE /api/menu/:id — Delete item (admin) ────────────────
router.delete('/:id', protect, async (req, res) => {
  try {
    const item = await MenuItem.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Menu item not found.' });
    const io = req.app.get('io');
    if (io) io.emit('menu_updated');
    res.json({ success: true, message: 'Item deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not delete menu item.' });
  }
});

module.exports = router;

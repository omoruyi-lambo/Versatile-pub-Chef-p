/**
 * routes/orders.js
 *
 * CHANGE LOG vs original
 * ─────────────────────────────────────────────────────────────────────────────
 * POST   /api/orders
 *   • Checks Settings.onlineOrderingEnabled — returns 503 if ordering is off
 *   • Immediately notifies all admins (OneSignal push)
 *
 * PATCH  /api/orders/:id/status
 *   • 'preparing'    → push to customer: "We're preparing your food!"
 *   • 'transporting' → pushes rider name + phone to customer
 *                      (requires riderId to be set on the order first)
 *   • 'delivered'    → push to customer: "Order delivered! Enjoy your meal."
 *
 * PATCH  /api/orders/:id/reject   ← NEW
 *   • Kitchen / admin rejects an order (e.g. item unavailable)
 *   • Sets status → 'rejected' and stores optional rejectionReason
 *   • Notifies the customer
 *
 * All other routes (GET list, GET stats, GET by id, DELETE) are unchanged.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const express  = require('express');
const jwt      = require('jsonwebtoken');
const Order    = require('../models/Order');
const Customer = require('../models/Customer');
const Settings = require('../models/Settings');
const { protect }          = require('../middleware/auth');
const { sendPush, getAdminPlayerIds, getCustomerPlayerId } = require('../utils/notify');

const router = express.Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Try to resolve the customer's OneSignal player ID from the order.
 * Priority: customerId ref → customerEmail lookup → customerPhone lookup.
 */
async function resolveCustomerPlayerId(order) {
  // 1. Check if player ID was stored directly on the order (guest customers)
  if (order.oneSignalPlayerId) return order.oneSignalPlayerId;

  // 2. If the order references a logged-in customer
  if (order.customerId) {
    const pid = await getCustomerPlayerId(order.customerId);
    if (pid) return pid;
  }

  // 3. Fall back to lookup by email or phone
  if (order.customerEmail || order.customerPhone) {
    const query = [];
    if (order.customerEmail) query.push({ email: new RegExp(`^${order.customerEmail}$`, 'i') });
    if (order.customerPhone) query.push({ phone: order.customerPhone });

    const customer = await Customer.findOne({ $or: query }).select('oneSignalPlayerId').lean();
    return customer?.oneSignalPlayerId ?? null;
  }

  return null;
}

// ─── GET /api/orders/my — Customer's own orders ───────────────────────────────
router.get('/my', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Not authenticated.' });
    }

    const token    = authHeader.split(' ')[1];
    const decoded  = jwt.verify(token, process.env.JWT_SECRET);
    const customer = await Customer.findById(decoded.id);
    if (!customer) {
      return res.status(401).json({ success: false, message: 'Account not found.' });
    }

    const orders = await Order.find({
      $or: [
        { customerEmail: { $regex: new RegExp(`^${customer.email}$`, 'i') } },
        { customerPhone: customer.phone },
        { customerId: customer._id },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    res.json({ success: true, orders });
  } catch (err) {
    res.status(401).json({ success: false, message: 'Invalid session.' });
  }
});

// ─── GET /api/orders/stats — Today's stats (admin) ───────────────────────────
router.get('/stats', protect, async (req, res) => {
  try {
    const today    = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

    const [todayOrders, statusCounts] = await Promise.all([
      Order.find({ createdAt: { $gte: today, $lt: tomorrow } }).lean(),
      Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    ]);

    const revenue = todayOrders.filter(o => o.isPaid).reduce((s, o) => s + o.grandTotal, 0);
    const pending = todayOrders.filter(o => ['new', 'preparing'].includes(o.status)).length;

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 6);
    weekAgo.setHours(0, 0, 0, 0);

    const weeklyRaw = await Order.aggregate([
      { $match: { createdAt: { $gte: weekAgo }, isPaid: true } },
      {
        $group: {
          _id:     { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue: { $sum: '$grandTotal' },
          count:   { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const statusMap = {};
    statusCounts.forEach(s => { statusMap[s._id] = s.count; });

    res.json({
      success: true,
      today: { orders: todayOrders.length, revenue, pending },
      statuses: statusMap,
      weekly: weeklyRaw,
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ success: false, message: 'Could not fetch stats.' });
  }
});

// ─── GET /api/orders — All orders (admin) ────────────────────────────────────
router.get('/', protect, async (req, res) => {
  try {
    const { status, date, limit = 100, skip = 0 } = req.query;
    const filter = {};

    if (status && status !== 'all') filter.status = status;
    if (date) {
      const start = new Date(date);
      const end   = new Date(date); end.setDate(end.getDate() + 1);
      filter.createdAt = { $gte: start, $lt: end };
    }

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate('riderId', 'name phoneNumber vehicleDetails')
        .sort({ createdAt: -1 })
        .limit(Number(limit))
        .skip(Number(skip))
        .lean(),
      Order.countDocuments(filter),
    ]);

    res.json({ success: true, total, orders });
  } catch (err) {
    console.error('Get orders error:', err);
    res.status(500).json({ success: false, message: 'Could not fetch orders.' });
  }
});

// ─── POST /api/orders — Place a new order (public) ────────────────────────────
router.post('/', async (req, res) => {
  try {
    // ── 1. Check if online ordering is enabled ────────────────
    const orderingEnabled = await Settings.get('onlineOrderingEnabled', true);
    if (!orderingEnabled) {
      return res.status(503).json({
        success: false,
        code:    'ORDERING_DISABLED',
        message: 'Online ordering is currently unavailable. Please call us to place your order.',
      });
    }

    // ── 2. Validate required fields ───────────────────────────
    const {
      customerName, customerEmail, customerPhone,
      items, subtotal, deliveryFee, grandTotal,
      isDelivery, deliveryAddress, isPaid, paystackRef,
      note, customerId, oneSignalPlayerId,
    } = req.body;

    if (!customerName || !customerPhone || !items?.length) {
      return res.status(400).json({ success: false, message: 'Name, phone and items are required.' });
    }

    // ── 3. Save the order ─────────────────────────────────────
    const ref = 'VPK-' + Date.now() + '-' + Math.floor(Math.random() * 9000 + 1000);

    const order = await Order.create({
      ref, customerId: customerId || null,
      customerName, customerEmail, customerPhone,
      items, subtotal, deliveryFee: deliveryFee || 0,
      grandTotal, isDelivery: !!isDelivery,
      deliveryAddress: deliveryAddress || '',
      isPaid: !!isPaid, paystackRef, note,
      oneSignalPlayerId: oneSignalPlayerId || null,
    });

    // ── 4. Real-time event → admin dashboard (Socket.IO) ─────
    const io = req.app.get('io');
    if (io) io.to('dashboard').emit('new_order', order);

    // ── 5. OneSignal push → all admins (fire-and-forget) ─────
    const adminIds = await getAdminPlayerIds();
    if (adminIds.length > 0) {
      sendPush(
        adminIds,
        '🛎️ New Order!',
        `New order received from ${customerName}. Total: ₦${Number(grandTotal).toLocaleString()}`
      ).catch(() => {}); // already logged inside sendPush
    }

    res.status(201).json({ success: true, order });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Duplicate order reference.' });
    }
    console.error('Create order error:', err);
    res.status(500).json({ success: false, message: 'Could not place order.' });
  }
});

// ─── GET /api/orders/:id — Single order (admin) ───────────────────────────────
router.get('/:id', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('riderId', 'name phoneNumber vehicleDetails')
      .lean();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch order.' });
  }
});

// ─── PATCH /api/orders/:id/status — Update status (admin) ────────────────────
router.patch('/:id/status', protect, async (req, res) => {
  try {
    const { status, riderId, rejectionReason } = req.body;
    const allowed = ['new', 'preparing', 'ready', 'transporting', 'delivered', 'cancelled', 'rejected'];

    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status.' });
    }

    // Build the update
    const update = { status };
    if (riderId && status === 'transporting') update.riderId = riderId;
    if (rejectionReason && ['rejected', 'cancelled'].includes(status)) {
      update.rejectionReason = rejectionReason.trim();
    }

    const order = await Order.findByIdAndUpdate(req.params.id, update, { new: true })
      .populate('riderId', 'name phoneNumber');

    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

    // ── Real-time update → dashboard ──────────────────────────
    const io = req.app.get('io');
    if (io) {
      io.to('dashboard').emit('order_updated', order);
      // Broadcast to ALL clients (profile page listens and filters by own orders)
      const orderObj = order.toObject ? order.toObject() : order;
      io.emit('order_updated', { ...orderObj, rejectionReason: rejectionReason || '' });
      // Also emit order_status_update for the profile page's dedicated listener
      io.emit('order_status_update', {
        orderId:         String(order._id),
        _id:             String(order._id),
        ref:             order.ref || '',
        status,
        rejectionReason: rejectionReason || '',
      });
    }

    // ── OneSignal push → customer ─────────────────────────────
    const customerPid = await resolveCustomerPlayerId(order);
    if (customerPid) {
      let pushTitle = 'Versatile Pub Update';
      let pushMsg;

      switch (status) {
        case 'preparing':
          pushTitle = '👨‍🍳 Preparing Your Order';
          pushMsg   = 'We\'re in the kitchen preparing your delicious food. It won\'t be long!';
          break;

        case 'transporting': {
          const rider = order.riderId;
          if (rider) {
            pushTitle = '🛵 Rider On The Way!';
            pushMsg   = `${rider.name} is heading to you right now! Contact: ${rider.phoneNumber}`;
          } else {
            pushTitle = '🛵 Out For Delivery!';
            pushMsg   = 'Your order is on the way! Our rider will arrive shortly.';
          }
          break;
        }

        case 'delivered':
          pushTitle = '🎉 Order Delivered!';
          pushMsg   = 'Your order has been delivered. Enjoy your meal! Thank you for choosing Versatile Pub 🍽️';
          break;

        case 'ready':
          pushTitle = '🔔 Order Ready!';
          pushMsg   = order.isDelivery
            ? 'Your order is ready and being picked up by our rider soon!'
            : 'Your order is ready for pickup. Come get it while it\'s hot!';
          break;

        case 'cancelled':
          pushTitle = '⚠️ Order Cancelled';
          pushMsg   = rejectionReason
            ? `Your order has been cancelled. Reason: ${rejectionReason}`
            : 'Your order has been cancelled. Please contact us if you have any questions.';
          break;

        case 'rejected':
          pushTitle = '❌ Order Rejected';
          pushMsg   = rejectionReason
            ? `We could not process your order. Reason: ${rejectionReason}`
            : 'We could not process your order. Please contact us for more information.';
          break;

        default:
          pushMsg = null;
      }

      if (pushMsg) {
        sendPush([customerPid], pushTitle, pushMsg).catch(() => {});
      }
    }

    res.json({ success: true, order });
  } catch (err) {
    console.error('Update order status error:', err);
    res.status(500).json({ success: false, message: 'Could not update order.' });
  }
});

// ─── PATCH /api/orders/:id/reject — Kitchen rejects an order (admin) ──────────
router.patch('/:id/reject', protect, async (req, res) => {
  try {
    const { reason = '' } = req.body;

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

    // Can only reject orders that haven't been delivered or already rejected
    const nonRejectableStatuses = ['delivered', 'rejected', 'cancelled'];
    if (nonRejectableStatuses.includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot reject an order with status "${order.status}".`,
      });
    }

    order.status          = 'rejected';
    order.rejectionReason = reason.trim();
    await order.save();

    // ── Real-time update → dashboard ──────────────────────────
    const io = req.app.get('io');
    if (io) {
      io.to('dashboard').emit('order_updated', order);
      io.emit('order_status_update', {
        orderId:         String(order._id),
        _id:             String(order._id),
        ref:             order.ref || '',
        status:          'rejected',
        rejectionReason: reason.trim(),
      });
    }

    // ── OneSignal push → customer ─────────────────────────────
    const customerPid = await resolveCustomerPlayerId(order);
    if (customerPid) {
      const reasonText = reason.trim()
        ? ` Reason: ${reason.trim()}`
        : ' Please contact us for more information.';

      sendPush(
        [customerPid],
        '❌ Order Could Not Be Processed',
        `Sorry, we were unable to process your order (Ref: ${order.ref}).${reasonText}`
      ).catch(() => {});
    }

    res.json({ success: true, order, message: 'Order rejected and customer notified.' });
  } catch (err) {
    console.error('Reject order error:', err);
    res.status(500).json({ success: false, message: 'Could not reject order.' });
  }
});

// ─── DELETE /api/orders/:id — Delete order (admin) ───────────────────────────
router.delete('/:id', protect, async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
    res.json({ success: true, message: 'Order deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not delete order.' });
  }
});

module.exports = router;

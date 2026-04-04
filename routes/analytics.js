const express = require('express');
const Order   = require('../models/Order');
const { protect } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/analytics — Full analytics (admin) ───────────────
router.get('/', protect, async (req, res) => {
  try {
    const { period = 'week' } = req.query;

    const daysMap = { today: 1, week: 7, month: 30, year: 365 };
    const days    = daysMap[period] || 7;

    const from = new Date();
    from.setDate(from.getDate() - (days - 1));
    from.setHours(0, 0, 0, 0);

    const orders = await Order.find({ createdAt: { $gte: from } });

    // ── Revenue by day ─────────────────────────────
    const dayBuckets = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(from);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().split('T')[0];
      dayBuckets[key] = { date: key, revenue: 0, orders: 0 };
    }

    orders.forEach(o => {
      const key = o.createdAt.toISOString().split('T')[0];
      if (dayBuckets[key]) {
        if (o.isPaid) dayBuckets[key].revenue += o.grandTotal;
        dayBuckets[key].orders++;
      }
    });

    const revenueByDay = Object.values(dayBuckets);
    const totalRevenue = revenueByDay.reduce((s, d) => s + d.revenue, 0);
    const totalOrders  = orders.length;
    const avgOrderVal  = totalOrders ? totalRevenue / totalOrders : 0;

    // ── Category breakdown ─────────────────────────
    const catMap = {};
    orders.forEach(o => {
      o.items.forEach(item => {
        // Try to infer category from item name (fallback if no category stored)
        const key = item.category || 'other';
        if (!catMap[key]) catMap[key] = { revenue: 0, count: 0 };
        catMap[key].revenue += item.price * item.qty;
        catMap[key].count   += item.qty;
      });
    });

    // ── Top selling items ──────────────────────────
    const itemMap = {};
    orders.forEach(o => {
      o.items.forEach(item => {
        if (!itemMap[item.name]) itemMap[item.name] = { name: item.name, qty: 0, revenue: 0 };
        itemMap[item.name].qty     += item.qty;
        itemMap[item.name].revenue += item.price * item.qty;
      });
    });
    const topItems = Object.values(itemMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // ── Order type split ───────────────────────────
    const delivery = orders.filter(o => o.isDelivery).length;
    const pickup   = orders.filter(o => !o.isDelivery).length;

    // ── Payment method split ───────────────────────
    const paid = orders.filter(o => o.isPaid).length;
    const pod  = orders.filter(o => !o.isPaid).length;

    // ── Peak hours ─────────────────────────────────
    const hourMap = Array(24).fill(0);
    orders.forEach(o => {
      const hour = new Date(o.createdAt).getHours();
      hourMap[hour]++;
    });

    res.json({
      success: true,
      period,
      summary: {
        totalRevenue,
        totalOrders,
        avgOrderVal: Math.round(avgOrderVal),
        paidOrders: paid,
        podOrders:  pod,
      },
      revenueByDay,
      categoryBreakdown: catMap,
      topItems,
      orderTypes:   { delivery, pickup },
      peakHours:    hourMap,
    });
  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).json({ success: false, message: 'Could not fetch analytics.' });
  }
});

module.exports = router;

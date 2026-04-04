const express = require('express');
const axios   = require('axios');
const Order   = require('../models/Order');
const { sendPush, getAdminPlayerIds } = require('../utils/notify');

const router = express.Router();

// ── POST /api/paystack/verify — Verify payment & save order ───
// Called from the frontend after Paystack callback
router.post('/verify', async (req, res) => {
  try {
    const { reference, orderData } = req.body;

    if (!reference) {
      return res.status(400).json({ success: false, message: 'Payment reference is required.' });
    }

    // Verify with Paystack API
    const paystackRes = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const { data } = paystackRes.data;

    if (data.status !== 'success') {
      // If Paystack says not successful but we have orderData, still save with pending status
      return res.status(402).json({ success: false, message: 'Payment not confirmed by Paystack yet. Please contact us with your reference.', paystackStatus: data.status });
    }

    // Amount check (data.amount is in kobo)
    const paidAmount = data.amount / 100;
    if (orderData?.grandTotal && paidAmount < orderData.grandTotal) {
      return res.status(402).json({ success: false, message: 'Payment amount mismatch.' });
    }

    // Create the confirmed order
    const ref = reference.toUpperCase();
    const order = await Order.create({
      ref,
      customerName:    orderData.customerName    || data.customer?.name  || 'Customer',
      customerEmail:   orderData.customerEmail   || data.customer?.email || '',
      customerPhone:   orderData.customerPhone   || '',
      items:           orderData.items           || [],
      subtotal:        orderData.subtotal        || paidAmount,
      deliveryFee:     orderData.deliveryFee     || 0,
      grandTotal:      paidAmount,
      isDelivery:      orderData.isDelivery      || false,
      deliveryAddress: orderData.deliveryAddress || '',
      isPaid:          true,
      paystackRef:     reference,
    });

    // Emit real-time event to admin dashboard
    const io = req.app.get('io');
    if (io) io.to('dashboard').emit('new_order', order);

    // Push notification to all admins (works even if dashboard tab is closed)
    const adminIds = await getAdminPlayerIds();
    if (adminIds.length > 0) {
      sendPush(
        adminIds,
        '💳 New Paid Order!',
        `${order.customerName} paid ₦${Number(paidAmount).toLocaleString()} via ${data.channel || 'card'}. Ref: ${ref}`
      ).catch(() => {});
    }

    res.json({ success: true, order, payment: { amount: paidAmount, channel: data.channel } });
  } catch (err) {
    // Paystack API error
    if (err.response?.status === 404) {
      return res.status(404).json({ success: false, message: 'Transaction not found on Paystack.' });
    }
    console.error('Paystack verify error:', err.message);
    res.status(500).json({ success: false, message: 'Could not verify payment.' });
  }
});

// ── POST /api/paystack/order — Save cash/POD order ────────────
// For pay-on-delivery orders (no Paystack involved)
router.post('/order', async (req, res) => {
  try {
    const {
      customerName, customerEmail, customerPhone,
      items, subtotal, deliveryFee, grandTotal,
      isDelivery, deliveryAddress, note, oneSignalPlayerId,
    } = req.body;

    if (!customerName || !customerPhone || !items?.length) {
      return res.status(400).json({ success: false, message: 'Missing required fields.' });
    }

    const ref = 'POD-' + Date.now() + '-' + Math.floor(Math.random() * 9000 + 1000);

    const order = await Order.create({
      ref, customerName, customerEmail, customerPhone,
      items, subtotal: subtotal || 0,
      deliveryFee: deliveryFee || 0,
      grandTotal: grandTotal || 0,
      isDelivery: !!isDelivery,
      deliveryAddress: deliveryAddress || '',
      isPaid: false,
      note,
      oneSignalPlayerId: oneSignalPlayerId || null,
    });

    const io = req.app.get('io');
    if (io) io.to('dashboard').emit('new_order', order);

    // Push notification to all admins for POD orders too
    const adminIds = await getAdminPlayerIds();
    if (adminIds.length > 0) {
      sendPush(
        adminIds,
        '🔔 New Order! (Cash on Delivery)',
        `${customerName} placed an order — ₦${Number(grandTotal || 0).toLocaleString()}. ${isDelivery ? 'Delivery' : 'Pickup'}.`
      ).catch(() => {});
    }

    res.status(201).json({ success: true, order });
  } catch (err) {
    console.error('Save POD order error:', err);
    res.status(500).json({ success: false, message: 'Could not save order.' });
  }
});

module.exports = router;

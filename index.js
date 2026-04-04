// ═══════════════════════════════════════════════════════
//  Versatile Pub / Chef P's Kitchen — Backend Server
//  Stack: Node.js · Express · MongoDB · Socket.IO
// ═══════════════════════════════════════════════════════

require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const connectDB  = require('./config/db');
const User       = require('./models/User');
const Staff      = require('./models/Staff');
const MenuItem   = require('./models/MenuItem');

// ── Routes ────────────────────────────────────────────
const authRoutes         = require('./routes/auth');
const orderRoutes        = require('./routes/orders');
const reservationRoutes  = require('./routes/reservations');
const menuRoutes         = require('./routes/menu');
const staffRoutes        = require('./routes/staff');
const paystackRoutes     = require('./routes/paystack');
const analyticsRoutes    = require('./routes/analytics');
const customerAuthRoutes = require('./routes/customer-auth');
// ── New routes ────────────────────────────────────────
const riderRoutes        = require('./routes/riders');
const settingsRoutes     = require('./routes/settings');

// ══════════════════════════════════════════════════════
//  App setup
// ══════════════════════════════════════════════════════
const app    = express();
const server = http.createServer(app);

// ── Socket.IO (real-time dashboard) ──────────────────
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST'],
  },
});

app.set('io', io); // make io available in routes via req.app.get('io')

io.on('connection', (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}`);

  // Dashboard joins the "dashboard" room to receive order/reservation events
  socket.on('join_dashboard', (token) => {
    socket.join('dashboard');
    console.log(`📊 Dashboard joined: ${socket.id}`);
  });

  // ── Admin broadcasts an announcement to all customers ─────────
  socket.on('send_announcement', (data) => {
    // Emit to every connected socket (customers on site)
    io.emit('announcement', data);
    io.emit('customer_announcement', data);
    console.log(`📢 Announcement broadcast: ${data.title}`);
  });

  // ── Admin updates an order status (real-time to customer) ─────
  socket.on('update_order_status', (data) => {
    // Broadcast to all sockets so the customer's profile page updates live
    io.emit('order_updated', data);
    console.log(`📦 Order status updated via socket: ${data.orderId} → ${data.status}`);
  });

  // ── Admin changes delivery/payment settings ───────────────────
  socket.on('settings_update', (data) => {
    // Broadcast to all customer-facing pages
    io.emit('settings_changed', data);
    console.log(`⚙️ Settings update broadcast:`, data.keys);
  });

  socket.on('disconnect', () => {
    console.log(`❌ Socket disconnected: ${socket.id}`);
  });
});

// ══════════════════════════════════════════════════════
//  Global Middleware
// ══════════════════════════════════════════════════════
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// General rate limit — 200 req / 15 min per IP
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Serve frontend files from /public
app.use(express.static(path.join(__dirname, 'public')));

// ══════════════════════════════════════════════════════
//  API Routes
// ══════════════════════════════════════════════════════
app.use('/api/auth',          authRoutes);
app.use('/api/customer-auth', customerAuthRoutes);
app.use('/api/orders',        orderRoutes);
app.use('/api/reservations',  reservationRoutes);
app.use('/api/menu',          menuRoutes);
app.use('/api/staff',         staffRoutes);
app.use('/api/paystack',      paystackRoutes);
app.use('/api/analytics',     analyticsRoutes);
// ── New routes ────────────────────────────────────────
app.use('/api/riders',        riderRoutes);
app.use('/api/settings',      settingsRoutes);
app.use('/api/notify',        settingsRoutes); // /notify/all, /notify/customer, /notify/admin

// ── Health check ───────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Versatile Pub API is running 🍽️',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
  });
});

// ── 404 handler ────────────────────────────────────────
app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found.` });
});

// ── Global error handler ───────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Server error.' : err.message,
  });
});

// ══════════════════════════════════════════════════════
//  Database seed (first run only)
// ══════════════════════════════════════════════════════
async function seedDatabase() {
  // ── Admin user ──────────────────────────────────────
  const existingAdmin = await User.findOne({ username: process.env.ADMIN_USERNAME || 'admin' });
  if (!existingAdmin) {
    await User.create({
      username:    process.env.ADMIN_USERNAME    || 'admin',
      password:    process.env.ADMIN_PASSWORD    || 'ChefP2026!',
      displayName: 'Restaurant Owner',
      role:        'owner',
    });
    console.log('✅ Admin user created — username: admin');
  }

  // ── Default staff ───────────────────────────────────
  const staffCount = await Staff.countDocuments();
  if (staffCount === 0) {
    await Staff.insertMany([
      { firstName: 'Chef',  lastName: 'Patrick',  role: 'chef',    phone: '0905 215 5013', status: 'online',  ordersHandled: 0, hoursOnDuty: 0 },
      { firstName: 'Mary',  lastName: 'Okonkwo',  role: 'cashier', phone: '0812 345 6789', status: 'online',  ordersHandled: 0, hoursOnDuty: 0 },
      { firstName: 'Emeka', lastName: 'Eze',       role: 'waiter',  phone: '0703 456 7890', status: 'offline', ordersHandled: 0, hoursOnDuty: 0 },
    ]);
    console.log('✅ Default staff seeded');
  }

  // ── Default menu items ──────────────────────────────
  const menuCount = await MenuItem.countDocuments();
  if (menuCount === 0) {
    await MenuItem.insertMany([
      { name: 'Pork Spare Ribs',         description: 'Tender slow-cooked ribs in rich house glaze',          price: 4500, category: 'main',    available: true,  badge: 'popular', badgeText: "Chef's Pick",    sortOrder: 1,  image: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=600&q=80' },
      { name: 'Singapore Noodles',       description: 'Classic stir-fried noodles with fresh veggies',        price: 3200, category: 'rice',    available: true,  sortOrder: 2,  image: 'https://images.unsplash.com/photo-1585032226651-759b368d7246?w=600&q=80' },
      { name: 'Chef P Stir-Fry Chicken', description: 'Wok-fried chicken with colorful peppers',              price: 3800, category: 'main',    available: true,  badge: 'sig', badgeText: 'Signature',        sortOrder: 3,  image: 'https://images.unsplash.com/photo-1603133872878-684f208fb84b?w=600&q=80' },
      { name: 'Chinese Fried Rice',      description: 'Fluffy fried rice with eggs and special seasoning',    price: 2800, category: 'rice',    available: true,  sortOrder: 4,  image: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=600&q=80' },
      { name: 'Grilled Salmon',          description: 'Atlantic salmon with pepper glaze',                    price: 6500, category: 'main',    available: true,  sortOrder: 5,  image: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=600&q=80' },
      { name: 'Spring Rolls',            description: 'Crispy rolls stuffed with vegetables',                 price: 1500, category: 'starter', available: true,  sortOrder: 6,  image: 'https://images.unsplash.com/photo-1606755962773-d324e0a13086?w=600&q=80' },
      { name: 'Prawn Fried Rice',        description: 'Tiger prawns in aromatic fried rice',                  price: 4200, category: 'rice',    available: true,  sortOrder: 7,  image: 'https://images.unsplash.com/photo-1569050467447-ce54b3bbc37d?w=600&q=80' },
      { name: 'Beef Suya Skewers',       description: 'Spiced suya with peanut spice mix',                    price: 2500, category: 'starter', available: true,  sortOrder: 8,  image: 'https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?w=600&q=80' },
      { name: 'Mango Smoothie',          description: 'Fresh mango blended with yoghurt',                     price: 1200, category: 'drink',   available: true,  sortOrder: 9,  image: 'https://images.unsplash.com/photo-1546173159-315724a31696?w=600&q=80' },
      { name: 'Matcha Latte',            description: 'Premium matcha with steamed milk',                     price: 1500, category: 'drink',   available: true,  sortOrder: 10, image: 'https://images.unsplash.com/photo-1515823662972-da6a2e4d3002?w=600&q=80' },
      { name: 'Mochi Ice Cream',         description: 'Japanese mochi with creamy ice cream',                 price: 2000, category: 'dessert', available: true,  sortOrder: 11, image: 'https://images.unsplash.com/photo-1563805042-7684c019e1cb?w=600&q=80' },
      { name: 'Jollof Rice & Chicken',   description: 'Nigerian jollof with grilled chicken',                 price: 3500, category: 'main',    available: true,  badge: 'popular', badgeText: 'Fan Favourite', sortOrder: 12, image: 'https://images.unsplash.com/photo-1604329760661-e71dc83f8f26?w=600&q=80' },
      { name: 'Puff Puff',               description: 'Soft golden Nigerian puff puff balls, lightly sweetened and fried fresh to order', price: 1000, category: 'dessert', available: true, badge: 'sig', badgeText: 'Signature', sortOrder: 13, image: 'https://images.unsplash.com/photo-1551024601-bec78aea704b?w=600&q=80' },
    ]);
    console.log('✅ Menu items seeded (13 items)');
  }
}

// ══════════════════════════════════════════════════════
//  Start
// ══════════════════════════════════════════════════════
const PORT = process.env.PORT || 5000;

connectDB().then(async () => {
  await seedDatabase();
  server.listen(PORT, () => {
    console.log('\n╔══════════════════════════════════════╗');
    console.log(`║  🍽️  Versatile Pub API               ║`);
    console.log(`║  Running on http://localhost:${PORT}   ║`);
    console.log(`║  Environment: ${process.env.NODE_ENV?.padEnd(22)}║`);
    console.log('╚══════════════════════════════════════╝\n');
  });
});

module.exports = { app, server, io };

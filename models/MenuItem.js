const mongoose = require('mongoose');

const menuItemSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  price:       { type: Number, required: true, min: 0 },
  category: {
    type: String,
    enum: ['main', 'rice', 'starter', 'drink', 'dessert'],
    required: true,
  },
  image:       { type: String },  // URL
  available:   { type: Boolean, default: true },
  badge:       { type: String },           // 'new', 'popular', 'sig'
  badgeText:   { type: String },           // e.g. "Chef's Pick"
  sortOrder:   { type: Number, default: 0 },
  salesCount:  { type: Number, default: 0 },
}, {
  timestamps: true,
});

menuItemSchema.index({ category: 1, available: 1 });

module.exports = mongoose.model('MenuItem', menuItemSchema);

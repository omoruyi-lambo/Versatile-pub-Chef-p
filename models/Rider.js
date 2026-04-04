/**
 * models/Rider.js
 * Delivery riders for EJ Cuisine.
 * When an order status changes to 'transporting', the rider's
 * name and phone number are pushed to the customer.
 */

const mongoose = require('mongoose');

const riderSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true, trim: true },
    phoneNumber: { type: String, required: true, trim: true },

    vehicleDetails: {
      type:        { type: String, trim: true, default: 'Motorcycle' }, // e.g. Motorcycle, Bicycle
      plateNumber: { type: String, trim: true, default: '' },
      color:       { type: String, trim: true, default: '' },
    },

    isAvailable: { type: Boolean, default: true },
    active:      { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Rider', riderSchema);

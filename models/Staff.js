const mongoose = require('mongoose');

const staffSchema = new mongoose.Schema({
  firstName: { type: String, required: true, trim: true },
  lastName:  { type: String, required: true, trim: true },
  role: {
    type: String,
    enum: ['owner', 'chef', 'cashier', 'waiter'],
    required: true,
  },
  phone:  { type: String, trim: true },
  status: {
    type: String,
    enum: ['online', 'offline', 'busy'],
    default: 'offline',
  },
  ordersHandled: { type: Number, default: 0 },
  hoursOnDuty:   { type: Number, default: 0 },
  active:        { type: Boolean, default: true },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
});

staffSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

module.exports = mongoose.model('Staff', staffSchema);

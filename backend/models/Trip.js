import mongoose from 'mongoose';

const tripSchema = new mongoose.Schema({
  bus: { type: mongoose.Schema.Types.ObjectId, ref: 'Bus', required: true },
  driver: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', required: true },
  route: { type: mongoose.Schema.Types.ObjectId, ref: 'Route', default: null },
  // 'return' = the same route driven back from its last stop to its first (not a separate route).
  direction: { type: String, enum: ['outbound', 'return'], default: 'outbound' },
  startTime: { type: Date, required: true },
  endTime: { type: Date, default: null },
  // The scheduled departure this trip was matched to (for delay calculation), if any.
  scheduledDeparture: { type: Date, default: null },
  status: { type: String, enum: ['active', 'completed', 'cancelled'], default: 'active' },
  startLocation: { lat: Number, lng: Number },
  endLocation: { lat: Number, lng: Number },
  totalDistance: { type: Number, default: 0 }, // meters
  delayMinutes: { type: Number, default: 0 }, // positive = late
  breakdownReported: { type: Boolean, default: false },
  breakdownReason: { type: String, default: null },
  locationWarnings: { type: Number, default: 0 }
}, {
  timestamps: true
});

tripSchema.index({ driver: 1, status: 1 });
tripSchema.index({ startTime: -1 });

const Trip = mongoose.model('Trip', tripSchema);

export default Trip;

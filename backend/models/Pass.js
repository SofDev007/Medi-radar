import mongoose from 'mongoose';
import { PASS_PLANS, PAYMENT_METHODS } from '../../shared/passes.js';

// One purchased bus pass. The collection doubles as the passenger's purchase history.
// Payment is simulated (demo): every purchase is recorded as paid.
const passSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  plan: { type: String, enum: Object.keys(PASS_PLANS), required: true },
  amount: { type: Number, required: true }, // ₹
  validFrom: { type: Date, required: true },
  validUntil: { type: Date, required: true },
  method: { type: String, enum: PAYMENT_METHODS, required: true },
  transactionId: { type: String, required: true, unique: true }
}, { timestamps: true });

passSchema.index({ user: 1, validUntil: -1 });

/**
 * A passenger's passes: { active, coveredUntil, history, plans }.
 * active = the pass valid right now; coveredUntil = end of the last pass still to run (passes bought
 * in advance stack after the current one); history = every purchase, newest first.
 */
passSchema.statics.statusFor = async function (userId, now = new Date()) {
  const history = await this.find({ user: userId }).sort({ createdAt: -1 }).lean();
  const active = history
    .filter((p) => p.validFrom <= now && p.validUntil > now)
    .sort((a, b) => a.validFrom - b.validFrom)[0] || null;
  const coveredUntil = history.reduce((max, p) => (p.validUntil > now && (!max || p.validUntil > max) ? p.validUntil : max), null);
  return { active, coveredUntil, history, plans: PASS_PLANS };
};

const Pass = mongoose.model('Pass', passSchema);
export default Pass;

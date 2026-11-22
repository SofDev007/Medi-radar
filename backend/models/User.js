import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    phone: { type: String, trim: true, default: '' },
    // Required for email/password accounts only; Google accounts have none.
    password: {
      type: String,
      minlength: 6,
      required: function () { return this.authProvider === 'local'; }
    },
    authProvider: { type: String, enum: ['local', 'google'], default: 'local' },
    googleId: { type: String, default: undefined },
    avatarUrl: { type: String, default: '' },
    role: { type: String, default: 'user' },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null }, // last sign-in or app open (admin Passengers page)
    pushTokens: { type: [String], default: [] }
  },
  { timestamps: true }
);

userSchema.index({ googleId: 1 }, { unique: true, sparse: true });

userSchema.pre('save', async function (next) {
  if (!this.password || !this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.password;
    delete ret.pushTokens;
    return ret;
  }
});

const User = mongoose.model('User', userSchema);

export default User;

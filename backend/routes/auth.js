import express from 'express';
import { body } from 'express-validator';
import { validate } from '../middleware/validate.js';
import Admin from '../models/Admin.js';
import Driver from '../models/Driver.js';
import User from '../models/User.js';
import { authenticateUser, authenticateDriver, signToken, verifyToken } from '../middleware/auth.js';
import { loginLimiter, rateLimit } from '../middleware/rateLimit.js';
import { verifyGoogleIdToken, isGoogleConfigured } from '../services/google.js';
import { parseImageDataUrl, saveDocument } from '../services/storage.js';
import { emitToAdmins } from '../services/realtime.js';
import { isExpoPushToken } from '../services/push.js';
import { getRoute } from '../services/liveTracker.js';

const router = express.Router();

const userJson = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  avatarUrl: user.avatarUrl,
  authProvider: user.authProvider,
  role: 'user'
});

/** Passenger sign-in response; also records the sign-in time for the admin Passengers page. */
const userSession = async (user) => {
  await User.updateOne({ _id: user._id }, { lastLoginAt: new Date() });
  return { token: signToken(user._id, 'user'), user: userJson(user) };
};

const driverJson = (driver) => ({
  id: driver._id,
  name: driver.name,
  email: driver.email,
  phone: driver.phone,
  assignedBus: driver.assignedBus,
  role: 'driver'
});

const MIN_DRIVER_AGE = () => Number(process.env.MIN_DRIVER_AGE || 21);

const ageOn = (dob, now = new Date()) => {
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
};

// ---------- Admin ----------

router.post('/admin/login', loginLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], validate, async (req, res) => {
  const { email, password } = req.body;
  const admin = await Admin.findOne({ email });
  if (!admin || !(await admin.comparePassword(password))) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }
  res.json({
    token: signToken(admin._id, 'admin'),
    user: { id: admin._id, username: admin.username, email: admin.email, role: 'admin' }
  });
});

// ---------- Driver ----------

/** Status of a self-registered application (applicant token from register or a blocked login). */
const applicationJson = (driver) => ({
  status: driver.status,
  name: driver.name,
  reviewNote: driver.status === 'rejected' ? driver.reviewNote : '',
  submittedAt: driver.createdAt,
  reviewedAt: driver.reviewedAt
});

router.post('/driver/login', loginLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], validate, async (req, res) => {
  const { email, password } = req.body;
  const driver = await Driver.findOne({ email });
  if (!driver || !(await driver.comparePassword(password))) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  if (driver.status !== 'approved') {
    return res.status(403).json({
      code: driver.status === 'pending' ? 'APPLICATION_PENDING' : 'APPLICATION_REJECTED',
      message: driver.status === 'pending'
        ? 'Your application is still under review.'
        : 'Your application was not approved.',
      applicationToken: signToken(driver._id, 'applicant', '90d'),
      application: applicationJson(driver)
    });
  }
  if (!driver.isActive) {
    return res.status(403).json({ code: 'SUSPENDED', message: 'Driver account is inactive' });
  }

  res.json({ token: signToken(driver._id, 'driver'), user: driverJson(driver) });
});

const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, message: 'Too many registrations from this network. Try again later.' });

router.post('/driver/register', registerLimiter, [
  body('name').trim().isLength({ min: 2, max: 80 }).withMessage('Enter your full name'),
  body('email').isEmail().withMessage('Enter a valid email').normalizeEmail(),
  body('phone').trim().matches(/^\+?[0-9\s-]{10,15}$/).withMessage('Enter a valid phone number'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('dateOfBirth').isISO8601().withMessage('Enter your date of birth'),
  body('gender').optional({ values: 'falsy' }).isIn(['male', 'female', 'other']),
  body('address').trim().isLength({ min: 5, max: 200 }).withMessage('Enter your address'),
  body('city').trim().isLength({ min: 2, max: 60 }).withMessage('Enter your city'),
  body('state').trim().isLength({ min: 2, max: 60 }).withMessage('Enter your state'),
  body('licenseNumber').trim().isLength({ min: 5, max: 30 }).withMessage('Enter your driving licence number'),
  body('licenseClass').trim().isLength({ min: 1, max: 40 }).withMessage('Enter your licence class'),
  body('licenseExpiry').isISO8601().withMessage('Enter your licence expiry date'),
  body('experienceYears').isInt({ min: 0, max: 60 }).withMessage('Enter years of driving experience'),
  body('emergencyContact.name').trim().isLength({ min: 2, max: 80 }).withMessage('Enter an emergency contact name'),
  body('emergencyContact.phone').trim().matches(/^\+?[0-9\s-]{10,15}$/).withMessage('Enter a valid emergency contact phone'),
  body('idType').trim().isLength({ min: 2, max: 40 }).withMessage('Choose an ID type'),
  body('documents.licenseFront').notEmpty().withMessage('Add a photo of the front of your licence'),
  body('documents.licenseBack').notEmpty().withMessage('Add a photo of the back of your licence'),
  body('documents.idProof').notEmpty().withMessage('Add a photo of your ID proof'),
  body('pushToken').optional().isString()
], validate, async (req, res) => {
  const b = req.body;
  const dob = new Date(b.dateOfBirth);
  if (ageOn(dob) < MIN_DRIVER_AGE()) {
    return res.status(400).json({ message: `Drivers must be at least ${MIN_DRIVER_AGE()} years old` });
  }
  if (new Date(b.licenseExpiry) <= new Date()) {
    return res.status(400).json({ message: 'Your driving licence has expired' });
  }
  if (await Driver.exists({ $or: [{ email: b.email }, { licenseNumber: b.licenseNumber }] })) {
    return res.status(400).json({ message: 'An account with this email or licence number already exists' });
  }

  let images;
  try {
    images = Object.fromEntries(['licenseFront', 'licenseBack', 'idProof']
      .map((k) => [k, parseImageDataUrl(b.documents[k])]));
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  const documents = {};
  for (const [k, image] of Object.entries(images)) documents[k] = await saveDocument(image);

  const driver = await Driver.create({
    name: b.name, email: b.email, phone: b.phone, password: b.password,
    licenseNumber: b.licenseNumber, licenseClass: b.licenseClass, licenseExpiry: b.licenseExpiry,
    dateOfBirth: dob, gender: b.gender || null, address: b.address, city: b.city, state: b.state,
    experienceYears: b.experienceYears, emergencyContact: b.emergencyContact, idType: b.idType,
    documents, status: 'pending',
    pushTokens: isExpoPushToken(b.pushToken) ? [b.pushToken] : []
  });

  emitToAdmins('application:new', { id: driver._id, name: driver.name, city: driver.city, createdAt: driver.createdAt });
  res.status(201).json({
    applicationToken: signToken(driver._id, 'applicant', '90d'),
    application: applicationJson(driver)
  });
});

router.get('/driver/application', async (req, res) => {
  const auth = verifyToken(req.header('Authorization')?.replace('Bearer ', ''));
  if (!auth || !['applicant', 'driver'].includes(auth.role)) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  const driver = await Driver.findById(auth.userId);
  if (!driver) return res.status(404).json({ message: 'Application not found' });
  res.json(applicationJson(driver));
});

// The signed-in driver with their bus and its route (shown before a trip starts).
router.get('/driver/me', authenticateDriver, async (req, res) => {
  const driver = await req.user.populate('assignedBus', 'busNumber plateNumber capacity route');
  const bus = driver.assignedBus;
  const route = bus?.route ? await getRoute(bus.route) : null;
  res.json({
    user: driverJson(driver),
    bus: bus ? { id: bus._id, busNumber: bus.busNumber, plateNumber: bus.plateNumber, capacity: bus.capacity } : null,
    route: route && {
      id: route.id, number: route.number, name: route.name, color: route.color, departures: route.departures,
      stops: route.stops.map(({ id, name, lat, lng, offsetMinutes }) => ({ id, name, lat, lng, offsetMinutes })),
      path: route.index ? route.index.points.map((p) => [p.lng, p.lat]) : []
    }
  });
});

router.post('/driver/push-token', authenticateDriver, [body('token').custom(isExpoPushToken)], validate, async (req, res) => {
  await Driver.updateOne({ _id: req.user._id }, { $addToSet: { pushTokens: req.body.token } });
  res.json({ message: 'Saved' });
});

// ---------- Passenger ----------

router.post('/user/register', loginLimiter, [
  body('name').notEmpty().trim(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('phone').optional().trim()
], validate, async (req, res) => {
  const { name, email, password, phone } = req.body;
  if (await User.exists({ email })) {
    return res.status(400).json({ message: 'Email already registered' });
  }
  const user = await User.create({ name, email, password, phone: phone || '', authProvider: 'local' });
  res.status(201).json(await userSession(user));
});

router.post('/user/login', loginLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], validate, async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user || !(await user.comparePassword(password))) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }
  if (!user.isActive) {
    return res.status(403).json({ message: 'User account is inactive' });
  }
  res.json(await userSession(user));
});

router.get('/google/config', (req, res) => {
  res.json({
    enabled: isGoogleConfigured(),
    webClientId: process.env.GOOGLE_WEB_CLIENT_ID || null,
    iosClientId: process.env.GOOGLE_IOS_CLIENT_ID || null
  });
});

router.post('/user/google', rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }), [
  body('idToken').isString().notEmpty()
], validate, async (req, res) => {
  if (!isGoogleConfigured()) {
    return res.status(503).json({ message: 'Google sign-in is not configured' });
  }
  let payload;
  try {
    payload = await verifyGoogleIdToken(req.body.idToken);
  } catch {
    return res.status(401).json({ message: 'Google sign-in failed' });
  }
  if (!payload?.sub || !payload.email || payload.email_verified === false) {
    return res.status(401).json({ message: 'Google account email is not verified' });
  }

  let user = await User.findOne({ googleId: payload.sub });
  if (!user) {
    // Link to an existing email/password account with the same verified email.
    user = await User.findOne({ email: payload.email.toLowerCase() });
    if (user) {
      user.googleId = payload.sub;
      if (!user.avatarUrl && payload.picture) user.avatarUrl = payload.picture;
      await user.save();
    } else {
      user = await User.create({
        name: payload.name || payload.email.split('@')[0],
        email: payload.email,
        googleId: payload.sub,
        avatarUrl: payload.picture || '',
        authProvider: 'google'
      });
    }
  }
  if (!user.isActive) {
    return res.status(403).json({ message: 'User account is inactive' });
  }
  res.json(await userSession(user));
});

router.get('/user/me', authenticateUser, async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { lastLoginAt: new Date() }); // app opened
  res.json({ user: userJson(req.user) });
});

export default router;

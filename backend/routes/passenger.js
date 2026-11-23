import express from 'express';
import { randomInt } from 'crypto';
import { body } from 'express-validator';
import User from '../models/User.js';
import Route from '../models/Route.js';
import Pass from '../models/Pass.js';
import { PASS_PLANS, PAYMENT_METHODS, passWindow } from '../../shared/passes.js';
import { authenticateUser } from '../middleware/auth.js';
import { validate, isObjectId } from '../middleware/validate.js';
import { isExpoPushToken } from '../services/push.js';
import { addArrivalWatch, removeArrivalWatch } from '../services/liveTracker.js';

const router = express.Router();
router.use(authenticateUser);

router.post('/push-token', [body('token').custom(isExpoPushToken)], validate, async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { $addToSet: { pushTokens: req.body.token } });
  res.json({ message: 'Saved' });
});

// "Notify me when my bus is N stops away" (push + in-app socket event)
router.post('/arrival-alerts', [
  body('routeId').custom(isObjectId),
  body('stopId').custom(isObjectId),
  body('stopsBefore').optional().isInt({ min: 0, max: 5 }),
  body('direction').optional().isIn(['outbound', 'return'])
], validate, async (req, res) => {
  const { routeId, stopId, stopsBefore = 2, direction = null } = req.body;
  if (!await Route.exists({ _id: routeId, 'stops.stop': stopId })) {
    return res.status(400).json({ message: 'That stop is not on this route' });
  }
  addArrivalWatch({ userId: req.user._id, routeId, stopId, stopsBefore: Number(stopsBefore), direction });
  res.status(201).json({ message: 'We will notify you when the bus is close' });
});

router.delete('/arrival-alerts/:stopId', (req, res) => {
  removeArrivalWatch(req.user._id, req.params.stopId);
  res.json({ message: 'Alert removed' });
});

// ---------- Bus pass (payment is simulated: every purchase succeeds) ----------

router.get('/pass', async (req, res) => {
  res.json(await Pass.statusFor(req.user._id));
});

router.post('/pass', [
  body('plan').isIn(Object.keys(PASS_PLANS)),
  body('method').isIn(PAYMENT_METHODS)
], validate, async (req, res) => {
  const { plan, method } = req.body;
  const { coveredUntil } = await Pass.statusFor(req.user._id);
  const pass = await Pass.create({
    user: req.user._id,
    plan,
    amount: PASS_PLANS[plan].price,
    method,
    transactionId: `TXN${Date.now()}${randomInt(1000, 9999)}`,
    ...passWindow(plan, coveredUntil)
  });
  res.status(201).json({ pass, ...(await Pass.statusFor(req.user._id)) });
});

export default router;

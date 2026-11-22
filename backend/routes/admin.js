import express from 'express';
import { authenticateAdmin } from '../middleware/auth.js';
import Bus from '../models/Bus.js';
import Driver from '../models/Driver.js';
import Route from '../models/Route.js';
import Stop from '../models/Stop.js';
import Incident from '../models/Incident.js';
import User from '../models/User.js';
import Pass from '../models/Pass.js';
import { getLiveBuses } from '../services/liveTracker.js';

const router = express.Router();
router.use(authenticateAdmin);

// Everything the dashboard header and sidebar badges need, in one request.
router.get('/summary', async (req, res) => {
  const [busStatus, drivers, pendingApplications, routes, stops, incidents] = await Promise.all([
    Bus.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Driver.countDocuments({ status: 'approved' }),
    Driver.countDocuments({ status: 'pending' }),
    Route.countDocuments(),
    Stop.countDocuments(),
    Incident.aggregate([{ $match: { status: { $ne: 'resolved' } } }, { $group: { _id: '$type', n: { $sum: 1 } } }])
  ]);
  const buses = Object.fromEntries(busStatus.map((b) => [b._id, b.n]));
  const openIncidents = Object.fromEntries(incidents.map((i) => [i._id, i.n]));
  const live = getLiveBuses();
  res.json({
    buses: { total: Object.values(buses).reduce((a, b) => a + b, 0), ...buses },
    drivers,
    pendingApplications,
    routes,
    stops,
    activeTrips: live.length,
    delayedBuses: live.filter((b) => b.delayMinutes > 5).length,
    offRouteBuses: live.filter((b) => b.offRoute).length,
    openIncidents: { total: Object.values(openIncidents).reduce((a, b) => a + b, 0), ...openIncidents }
  });
});

// Passenger accounts with their pass status, most recently active first.
router.get('/passengers', async (req, res) => {
  const now = new Date();
  const [users, passes] = await Promise.all([
    User.find().select('name email authProvider avatarUrl isActive lastLoginAt createdAt').sort({ lastLoginAt: -1, createdAt: -1 }).lean(),
    Pass.aggregate([
      { $sort: { validUntil: -1 } },
      {
        $group: {
          _id: '$user',
          purchases: { $sum: 1 },
          totalSpent: { $sum: '$amount' },
          latestUntil: { $first: '$validUntil' },
          latestPlan: { $first: '$plan' },
          // The pass covering right now (if any)
          current: { $push: { $cond: [{ $and: [{ $lte: ['$validFrom', now] }, { $gt: ['$validUntil', now] }] }, { plan: '$plan', validUntil: '$validUntil' }, '$$REMOVE'] } }
        }
      }
    ])
  ]);
  const byUser = new Map(passes.map((p) => [String(p._id), p]));
  res.json(users.map((u) => {
    const p = byUser.get(String(u._id));
    const current = p?.current?.[0] || null;
    return {
      ...u,
      purchases: p?.purchases || 0,
      totalSpent: p?.totalSpent || 0,
      pass: current
        ? { status: 'active', plan: current.plan, validUntil: p.latestUntil } // until = end of any stacked passes too
        : p ? { status: 'expired', plan: p.latestPlan, validUntil: p.latestUntil } : { status: 'none' }
    };
  }));
});

export default router;

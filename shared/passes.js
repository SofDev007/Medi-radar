// Bus pass plans (prices in ₹). Plan ids are stored in the DB; the apps translate the names via i18n
// keys `pass.plans.<id>`, and the English labels here are the fallback (and admin display).

export const PASS_PLANS = {
  daily: { label: 'Day pass', days: 1, price: 30 },
  weekly: { label: 'Weekly pass', days: 7, price: 150 },
  monthly: { label: 'Monthly pass', days: 30, price: 500 }
};

export const PAYMENT_METHODS = ['upi', 'card'];

/** A new pass starts now, or when the current pass ends if one is still running (passes stack). */
export function passWindow(planId, activeUntil, now = new Date()) {
  const from = activeUntil && new Date(activeUntil) > now ? new Date(activeUntil) : now;
  return { validFrom: from, validUntil: new Date(from.getTime() + PASS_PLANS[planId].days * 86400000) };
}

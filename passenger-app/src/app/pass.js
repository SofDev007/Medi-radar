// Bus pass: current pass, buy a pass (simulated payment), purchase history.
// An active pass unlocks live tracking on the home map.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { PASS_PLANS } from 'transit-shared/passes.js';
import Screen from 'transit-shared/native/Screen';
import Sheet from 'transit-shared/native/Sheet';
import T from 'transit-shared/native/T';
import { Ticket, Stamp, Button, Banner } from 'transit-shared/native/ui';
import { useTheme, stocks, stockInk, neon } from 'transit-shared/native/theme';
import { useAuth } from '../lib/auth';
import { api, errorText } from '../lib/api';

const PROCESSING_MS = 1500; // feels like a real payment step
const DAY = 86400000;

export default function PassScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { user, pass, hasPass, refreshPass, setPass } = useAuth();
  const [buying, setBuying] = useState(null); // plan id
  const [method, setMethod] = useState('upi');
  const [payment, setPayment] = useState({ stage: 'choose', error: '', txn: '' }); // choose | processing | done

  useEffect(() => { if (user) refreshPass(); }, [user, refreshPass]);

  const date = (d) => new Date(d).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' });
  const planName = (id) => t(`pass.plans.${id}`, { defaultValue: PASS_PLANS[id]?.label || id });
  const accent = theme.night ? neon.cyan : theme.ink;

  const openPay = (plan) => { setBuying(plan); setMethod('upi'); setPayment({ stage: 'choose', error: '', txn: '' }); };
  const closePay = () => { if (payment.stage !== 'processing') setBuying(null); };
  const pay = async () => {
    setPayment({ stage: 'processing', error: '', txn: '' });
    try {
      const [res] = await Promise.all([api.post('/passenger/pass', { plan: buying, method }), new Promise((r) => setTimeout(r, PROCESSING_MS))]);
      setPass(res);
      setPayment({ stage: 'done', error: '', txn: res.pass.transactionId });
    } catch (e) {
      setPayment({ stage: 'choose', error: errorText(e, t), txn: '' });
    }
  };

  const back = (
    <Pressable onPress={() => router.back()} hitSlop={12} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20 }} accessibilityRole="button">
      <Ionicons name="chevron-back" size={22} color={theme.ink} />
      <T variant="bodyStrong">{t('passenger.backToMap')}</T>
    </Pressable>
  );

  if (!user) {
    return (
      <Screen>
        {back}
        <T variant="headline" style={{ marginBottom: 14 }}>{t('pass.title')}</T>
        <Banner tone="info">{t('pass.signInFirst')}</Banner>
        <Button title={t('passenger.signInTitle')} style={{ marginTop: 14 }} onPress={() => router.push('/signin')} />
      </Screen>
    );
  }

  const active = hasPass ? pass.active : null;
  const daysLeft = pass?.coveredUntil ? Math.max(1, Math.ceil((new Date(pass.coveredUntil) - Date.now()) / DAY)) : 0;
  const history = pass?.history || [];

  return (
    <Screen>
      {back}
      <T variant="headline">{t('pass.title')}</T>

      {/* Current pass */}
      <View style={{ marginTop: 18 }}>
        {!pass ? <ActivityIndicator color={theme.ink} /> : active ? (
          <Ticket
            stubStock={stocks.mint}
            stub={(
              <View style={{ alignItems: 'center' }}>
                <T variant="displaySm" color={stockInk(stocks.mint, theme)}>{daysLeft}</T>
                <T variant="small" weight={600} color={stockInk(stocks.mint, theme)}>{t('pass.days', { count: daysLeft })}</T>
              </View>
            )}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <T variant="title">{planName(active.plan)}</T>
              <Stamp kind="approved">{t('pass.active')}</Stamp>
            </View>
            <T variant="body" color={theme.inkSoft} style={{ marginTop: 6 }}>
              {new Date(pass.coveredUntil) > new Date(active.validUntil)
                ? t('pass.coveredUntil', { date: date(pass.coveredUntil) })
                : t('pass.validUntil', { date: date(active.validUntil) })}
            </T>
          </Ticket>
        ) : (
          <Ticket>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <T variant="title">{t('pass.none')}</T>
              {history.length > 0 && <Stamp kind="stale">{t('pass.expired')}</Stamp>}
            </View>
            <T variant="body" color={theme.inkSoft} style={{ marginTop: 6 }}>{t('pass.noneBody')}</T>
          </Ticket>
        )}
      </View>

      {/* Buy */}
      <T variant="title" style={{ marginTop: 26, marginBottom: 10 }}>{t('pass.choose')}</T>
      {active && <T variant="small" color={theme.inkFaint} style={{ marginBottom: 10 }}>{t('pass.extendNote')}</T>}
      <View style={{ gap: 12 }}>
        {Object.entries(PASS_PLANS).map(([id, p]) => (
          <Ticket
            key={id}
            onPress={() => openPay(id)}
            stubStock={id === 'monthly' ? stocks.buff : stocks.sky}
            stub={<T variant="displaySm" style={{ fontSize: 26, lineHeight: 30 }} color={stockInk(id === 'monthly' ? stocks.buff : stocks.sky, theme)}>₹{p.price}</T>}
          >
            <T variant="title">{planName(id)}</T>
            <T variant="small" color={theme.inkFaint}>{t('pass.days', { count: p.days })}</T>
          </Ticket>
        ))}
      </View>

      {/* Future scope: NFC card */}
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginTop: 18, padding: 14, borderRadius: theme.night ? 14 : 8, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.rule }}>
        <Ionicons name="card-outline" size={24} color={theme.inkSoft} />
        <View style={{ flex: 1 }}>
          <T variant="bodyStrong">{t('pass.nfcTitle')}</T>
          <T variant="small" color={theme.inkFaint}>{t('pass.nfcBody')}</T>
        </View>
      </View>

      {/* History */}
      <T variant="title" style={{ marginTop: 26, marginBottom: 6 }}>{t('pass.history')}</T>
      {pass && history.length === 0 && <T variant="small" color={theme.inkFaint}>{t('pass.noHistory')}</T>}
      {history.map((h) => (
        <View key={h._id} style={{ flexDirection: 'row', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: theme.rule }}>
          <Ionicons name="receipt-outline" size={20} color={theme.inkSoft} style={{ marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <T variant="bodyStrong">{planName(h.plan)}</T>
            <T variant="small" color={theme.inkSoft}>{t('pass.period', { from: date(h.validFrom), to: date(h.validUntil) })}</T>
            <T variant="small" color={theme.inkFaint}>{t('pass.paidVia', { method: t(`pass.${h.method}`) })} · {t('pass.txn', { txn: h.transactionId })}</T>
          </View>
          <T variant="bodyStrong">₹{h.amount}</T>
        </View>
      ))}

      {/* Payment (simulated) */}
      <Sheet visible={Boolean(buying)} onClose={closePay} dismissable={payment.stage !== 'processing'}
        title={buying ? t('pass.payTitle', { plan: planName(buying) }) : ''}>
        {buying && payment.stage === 'done' ? (
          <View style={{ gap: 14 }}>
            <View style={{ alignItems: 'center', gap: 8, paddingVertical: 8 }}>
              <Ionicons name="checkmark-circle" size={56} color={theme.night ? neon.lime : stocks.mint.ink} />
              <T variant="title">{t('pass.success')}</T>
              <T variant="body" color={theme.inkSoft} style={{ textAlign: 'center' }}>{t('pass.successBody', { plan: planName(buying), txn: payment.txn })}</T>
            </View>
            <Button title={t('common.done')} onPress={() => setBuying(null)} />
          </View>
        ) : buying ? (
          <View style={{ gap: 12 }}>
            {payment.error ? <Banner tone="danger">{payment.error}</Banner> : null}
            <T variant="label" color={theme.inkFaint}>{t('pass.payWith')}</T>
            {[['upi', 'phone-portrait-outline', 'pass.upiHint'], ['card', 'card-outline', 'pass.cardHint']].map(([id, icon, hint]) => {
              const on = method === id;
              return (
                <Pressable key={id} onPress={() => setMethod(id)} disabled={payment.stage === 'processing'} accessibilityRole="radio" accessibilityState={{ checked: on }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 14, borderRadius: theme.night ? 14 : 8,
                    borderWidth: on ? 2 : 1, borderColor: on ? accent : theme.rule, backgroundColor: theme.night ? 'rgba(255,255,255,.05)' : theme.surface }}>
                  <Ionicons name={icon} size={22} color={theme.ink} />
                  <View style={{ flex: 1 }}>
                    <T variant="bodyStrong">{t(`pass.${id}`)}</T>
                    <T variant="small" color={theme.inkFaint}>{t(hint)}</T>
                  </View>
                  <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: on ? 7 : 2, borderColor: on ? accent : theme.rule }} />
                </Pressable>
              );
            })}
            <Button title={payment.stage === 'processing' ? t('pass.processing') : t('pass.pay', { amount: PASS_PLANS[buying].price })}
              loading={payment.stage === 'processing'} onPress={pay} style={{ marginTop: 4 }} />
            <T variant="small" color={theme.inkFaint} style={{ textAlign: 'center' }}>{t('pass.demoNote')}</T>
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}

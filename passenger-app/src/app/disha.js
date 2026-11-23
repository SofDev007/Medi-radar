// Disha: chat with the AI bus assistant. The server answers with our own journey planner and live data;
// this screen keeps the conversation (sent back each turn). Today's chat is saved on the device and shown
// again when Disha is reopened; a new session starts on the next day.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import Screen from 'transit-shared/native/Screen';
import T from 'transit-shared/native/T';
import { Button, Banner } from 'transit-shared/native/ui';
import { useTheme, glass, neon } from 'transit-shared/native/theme';
import { useAuth } from '../lib/auth';
import { usePosition } from '../lib/position';
import { api, errorText } from '../lib/api';

const SUGGESTIONS = ['route', 'nearest', 'features', 'pass'];
const chatKey = (userId) => `disha.chat.${userId}`;
const today = () => new Date().toDateString(); // local calendar day: the session
const KEEP = 100; // messages kept per session

// Android is edge-to-edge, so the window doesn't shrink for the keyboard: lift the input bar ourselves.
function useAndroidKeyboardHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const show = Keyboard.addListener('keyboardDidShow', (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return height;
}

function Bubble({ role, children }) {
  const theme = useTheme();
  const mine = role === 'user';
  const bg = mine ? (theme.night ? 'rgba(62,230,255,.16)' : theme.ink) : (theme.night ? 'rgba(255,255,255,.06)' : theme.surface);
  return (
    <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '86%', marginBottom: 10, paddingHorizontal: 14, paddingVertical: 10,
      borderRadius: theme.night ? 18 : 12, borderWidth: mine && !theme.night ? 0 : 1, borderColor: mine ? `${neon.cyan}66` : theme.night ? glass.border : theme.rule,
      backgroundColor: bg, ...(mine ? { borderBottomRightRadius: 4 } : { borderBottomLeftRadius: 4 }) }}>
      <T variant="body" color={mine && !theme.night ? theme.onPrimary : theme.ink} selectable>{children}</T>
    </View>
  );
}

export default function Disha() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const { position } = usePosition();
  const keyboard = useAndroidKeyboardHeight();
  const scroll = useRef(null);
  const firstName = String(user?.name || '').trim().split(/\s+/)[0];
  const [messages, setMessages] = useState([]); // [{ role: 'user'|'assistant', content }]
  const [day, setDay] = useState(today);
  const [restoredFor, setRestoredFor] = useState(null); // user whose saved chat is loaded
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Restore today's session; a chat from an earlier day is dropped.
  useEffect(() => {
    if (!user?.id) return;
    AsyncStorage.getItem(chatKey(user.id))
      .then((raw) => {
        const saved = raw ? JSON.parse(raw) : null;
        setMessages(saved?.day === today() && Array.isArray(saved.messages) ? saved.messages : []);
        setDay(today());
      })
      .catch(() => {})
      .finally(() => setRestoredFor(user.id));
  }, [user?.id]);
  useEffect(() => {
    if (!user?.id || restoredFor !== user.id) return; // never overwrite a saved chat before it is read
    AsyncStorage.setItem(chatKey(user.id), JSON.stringify({ day, messages: messages.slice(-KEEP) })).catch(() => {});
  }, [user?.id, restoredFor, day, messages]);

  const send = async (raw) => {
    const content = String(raw ?? text).trim();
    if (!content || busy) return;
    const newDay = day !== today(); // the screen stayed open past midnight: start today's session
    if (newDay) setDay(today());
    const next = [...(newDay ? [] : messages), { role: 'user', content }];
    setMessages(next);
    setText('');
    setError('');
    setBusy(true);
    try {
      const res = await api.post('/assistant/chat', {
        messages: next.slice(-12),
        language: i18n.language,
        ...(position && { location: { lat: position.lat, lng: position.lng } })
      }, { timeoutMs: 60000 });
      setMessages((m) => [...m, { role: 'assistant', content: res.reply }]);
    } catch (e) {
      setError(errorText(e, t) || t('disha.error')); // the server's reason, e.g. "Disha is not set up yet"
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
      <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('passenger.backToMap')}>
        <Ionicons name="chevron-back" size={26} color={theme.ink} />
      </Pressable>
      <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
        backgroundColor: theme.night ? 'rgba(62,230,255,.14)' : theme.ink }}>
        <Ionicons name="sparkles" size={22} color={theme.night ? neon.cyan : theme.onPrimary} />
      </View>
      <View style={{ flex: 1 }}>
        <T variant="title">{t('disha.name')}</T>
        <T variant="small" color={theme.inkFaint}>{t('disha.subtitle')}</T>
      </View>
    </View>
  );

  if (!user) {
    return (
      <Screen>
        {header}
        <Banner tone="info">{t('disha.signIn')}</Banner>
        <Button title={t('passenger.signInTitle')} style={{ marginTop: 14 }} onPress={() => router.push('/signin')} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} style={keyboard ? { paddingBottom: 12 } : null}>
      {header}
      <ScrollView ref={scroll} style={{ flex: 1 }} keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
        <Bubble role="assistant">{t('disha.greeting', { name: firstName })}</Bubble>
        {messages.length === 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {SUGGESTIONS.map((k) => (
              <Button key={k} size="sm" variant="secondary" title={t(`disha.suggestions.${k}`)} onPress={() => send(t(`disha.suggestions.${k}`))} />
            ))}
          </View>
        )}
        {messages.map((m, i) => <Bubble key={i} role={m.role}>{m.content}</Bubble>)}
        {busy && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <ActivityIndicator color={theme.night ? neon.cyan : theme.ink} />
            <T variant="small" color={theme.inkFaint}>{t('disha.thinking')}</T>
          </View>
        )}
        {error ? <View style={{ marginBottom: 10 }}><Banner tone="danger">{error}</Banner></View> : null}
      </ScrollView>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, marginBottom: keyboard }}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t('disha.placeholder')}
          placeholderTextColor={theme.inkFaint}
          maxLength={500}
          onSubmitEditing={() => send()}
          submitBehavior="submit"
          returnKeyType="send"
          accessibilityLabel={t('disha.placeholder')}
          style={{ flex: 1, height: 52, paddingHorizontal: 16, fontSize: 16, color: theme.ink,
            borderRadius: theme.night ? 18 : 10, borderWidth: 1, borderColor: theme.night ? glass.border : theme.rule,
            backgroundColor: theme.night ? 'rgba(255,255,255,.06)' : theme.surface }}
        />
        <Pressable onPress={() => send()} disabled={busy || !text.trim()} accessibilityRole="button" accessibilityLabel={t('disha.send')}
          style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center',
            backgroundColor: theme.night ? neon.cyan : theme.ink, opacity: busy || !text.trim() ? 0.45 : 1 }}>
          <Ionicons name="send" size={22} color={theme.night ? glass.bg.deep : theme.onPrimary} />
        </Pressable>
      </View>
    </Screen>
  );
}

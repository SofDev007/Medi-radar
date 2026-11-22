// Passengers can browse without an account; signing in adds arrival alerts, the bus pass and Disha.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { api, TOKEN_KEY } from './api';

const AuthContext = createContext(null);
const USER_KEY = 'userData';

async function registerPushToken() {
  try {
    if (Platform.OS === 'web') return;
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;
    const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.post('/passenger/push-token', { token: data });
  } catch {
    // push needs a development build; in-app alerts still work
  }
}

export function AuthProvider({ children }) {
  const [state, setState] = useState({ ready: false, user: null, token: null });
  const [pass, setPass] = useState(null); // { active, coveredUntil, history, plans } for the signed-in passenger

  const refreshPass = useCallback(() => api.get('/passenger/pass').then(setPass).catch(() => {}), []);
  useEffect(() => { if (state.token) refreshPass(); else setPass(null); }, [state.token, refreshPass]);

  useEffect(() => {
    (async () => {
      const [token, user] = await Promise.all([AsyncStorage.getItem(TOKEN_KEY), AsyncStorage.getItem(USER_KEY)]);
      if (!token) return setState({ ready: true, user: null, token: null });
      setState({ ready: true, user: JSON.parse(user || 'null'), token });
      // Validate the stored session quietly.
      api.get('/auth/user/me').then((r) => {
        AsyncStorage.setItem(USER_KEY, JSON.stringify(r.user));
        setState((s) => ({ ...s, user: r.user }));
      }).catch(async (e) => {
        if (e.status === 401) {
          await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
          setState({ ready: true, user: null, token: null });
        }
      });
    })();
  }, []);

  const accept = useCallback(async ({ token, user }) => {
    await AsyncStorage.multiSet([[TOKEN_KEY, token], [USER_KEY, JSON.stringify(user)]]);
    setState({ ready: true, user, token });
    registerPushToken();
  }, []);

  const signIn = useCallback((email, password) => api.post('/auth/user/login', { email, password }, { token: null }).then(accept), [accept]);
  const register = useCallback((payload) => api.post('/auth/user/register', payload, { token: null }).then(accept), [accept]);
  const signInWithGoogle = useCallback((idToken) => api.post('/auth/user/google', { idToken }, { token: null }).then(accept), [accept]);
  const signOut = useCallback(async () => {
    await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
    setState({ ready: true, user: null, token: null });
  }, []);

  // Live tracking needs a pass that is valid right now.
  const hasPass = Boolean(pass?.active && new Date(pass.active.validUntil).getTime() > Date.now());
  const value = useMemo(() => ({ ...state, signIn, register, signInWithGoogle, signOut, pass, hasPass, refreshPass, setPass }),
    [state, signIn, register, signInWithGoogle, signOut, pass, hasPass, refreshPass]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

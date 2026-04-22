import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getSupabaseClient } from '@/lib/auth';
import { debugIngest } from '@/lib/debug-ingest';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';

/**
 * Mirror backend's pinToAuthPassword: Supabase Auth requires ≥6 chars but
 * user PINs are 4 digits. We pad before calling signInWithPassword.
 * Must stay in sync with backend/service/src/admin-users/admin-users.service.ts.
 */
function pinToAuthPassword(pin: string): string {
  return `sb_${pin}`;
}

type ResolveLoginResult =
  | { ok: true; email: string }
  | { ok: false; errorHint: string };

/** Resolve a username to an email via the backend. */
async function resolveLogin(
  login: string,
  signal?: AbortSignal
): Promise<ResolveLoginResult> {
  const trimmed = login.trim();
  if (trimmed.includes('@')) return { ok: true, email: trimmed };
  try {
    const res = await fetch(`${API_URL}/api/v1/auth/resolve`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ login: trimmed }),
      signal,
    });
    const payload = (await res.json().catch(() => ({}))) as {
      message?: string | string[];
      email?: string;
    };
    const nestMsg = Array.isArray(payload.message)
      ? payload.message.join(', ')
      : (payload.message ?? '');
    // #region agent log
    debugIngest(
      '(auth)/login.tsx:resolveLogin',
      'resolve http',
      { status: res.status, ok: res.ok, hasEmail: !!payload.email },
      'L1b'
    );
    // #endregion
    if (!res.ok) {
      if (res.status === 404) {
        return {
          ok: false,
          errorHint:
            'User inexistent pe serverul la care e conectată aplicația. Dacă îl vezi în admin pe site, pune în .env.dev același EXPO_PUBLIC_API_URL ca domeniul admin (sau date de test în backend-ul local).',
        };
      }
      return {
        ok: false,
        errorHint:
          nestMsg || `Eroare API la rezolvare user (${res.status}).`,
      };
    }
    if (!payload.email) {
      return { ok: false, errorHint: 'Răspuns API invalid (fără email).' };
    }
    return { ok: true, email: payload.email };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e;
    const errMsg = e instanceof Error ? e.message : String(e);
    const origin = API_URL.replace(/\/$/, '') || '(lipsește EXPO_PUBLIC_API_URL)';
    const isLoopback = /127\.0\.0\.1|localhost/i.test(API_URL);
    // #region agent log
    debugIngest(
      '(auth)/login.tsx:resolveLogin',
      'resolve fetch threw',
      {
        errName: e instanceof Error ? e.name : 'unknown',
        errMsg: errMsg.slice(0, 160),
        isLoopback,
        hasApiUrl: API_URL.length > 0,
      },
      'L1c'
    );
    // #endregion
    if (!API_URL.trim()) {
      return {
        ok: false,
        errorHint:
          'Lipsește EXPO_PUBLIC_API_URL. Completează apps/mobile/.env.dev și repornește Metro.',
      };
    }
    if (isLoopback) {
      return {
        ok: false,
        errorHint:
          `Nu merge conexiunea la ${origin}. Pe telefon (USB): rulează „adb reverse tcp:3001 tcp:3001”, apoi pornește backend-ul pe Mac la portul 3001. Eroare rețea: ${errMsg}`,
      };
    }
    return {
      ok: false,
      errorHint: `Nu pot contacta API la ${origin}. Verifică Wi‑Fi/firewall și că backend-ul ascultă pe 0.0.0.0 (nu doar localhost). ${errMsg}`,
    };
  }
}

export default function LoginScreen() {
  const [login,        setLogin]        = useState('');
  const [password,     setPassword]     = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  const handleLogin = async () => {
    if (!login.trim() || !password.trim()) {
      setError('Username/email si parola sunt obligatorii');
      return;
    }

    setLoading(true);
    setError(null);

    const resolveTimeoutMs = 20_000;
    const ac = new AbortController();
    const resolveTimer = setTimeout(() => ac.abort(), resolveTimeoutMs);

    try {
      const trimmedLogin = login.trim();
      const isUsername = !trimmedLogin.includes('@');
      // #region agent log
      debugIngest(
        '(auth)/login.tsx:handleLogin',
        'resolve start',
        {
          hasApiUrl: API_URL.length > 0,
          isUsername,
        },
        'L1'
      );
      // #endregion

      let resolved: ResolveLoginResult;
      try {
        resolved = await resolveLogin(trimmedLogin, ac.signal);
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          // #region agent log
          debugIngest(
            '(auth)/login.tsx:handleLogin',
            'resolve aborted (timeout)',
            { resolveTimeoutMs },
            'L1'
          );
          // #endregion
          setError(
            'Nu ajung la serverul API (timeout). Verifică că backend-ul rulează, că telefonul e pe același Wi‑Fi ca Mac-ul, și că EXPO_PUBLIC_API_URL folosește IP-ul corect (ex. același prefix ca în Metro).'
          );
          return;
        }
        throw e;
      }

      // #region agent log
      debugIngest(
        '(auth)/login.tsx:handleLogin',
        'resolve done',
        { ok: resolved.ok },
        'L1'
      );
      // #endregion

      if (!resolved.ok) {
        setError(resolved.errorHint);
        return;
      }
      const email = resolved.email;

      // Operators/drivers log in with username + 4-digit PIN → pad to satisfy
      // Supabase Auth's min-6-char policy. Admins with email + long password
      // should pass through unchanged.
      const authPassword = isUsername ? pinToAuthPassword(password) : password;

      const supabase = getSupabaseClient();
      // #region agent log
      debugIngest('(auth)/login.tsx:handleLogin', 'signIn start', {}, 'L2');
      // #endregion
      const tSign0 = Date.now();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password: authPassword,
      });
      // #region agent log
      debugIngest(
        '(auth)/login.tsx:handleLogin',
        'signIn done',
        { ms: Date.now() - tSign0, authErr: !!authError },
        'L2'
      );
      // #endregion

      if (authError) {
        setError(authError.message);
      }
    } catch {
      setError('A aparut o eroare neasteptata');
    } finally {
      clearTimeout(resolveTimer);
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.content}
      >
        <View style={styles.brandHeader}>
          <Text style={styles.brandTitle}>StrawBoss</Text>
          <Text style={styles.brandSubtitle}>Agricultural Logistics</Text>
        </View>

        <View style={styles.card}>
          <TextInput
            style={styles.input}
            placeholder="Username sau Email"
            placeholderTextColor="#9CA3AF"
            value={login}
            onChangeText={setLogin}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="username"
            editable={!loading}
          />

          <View style={styles.passwordContainer}>
            <TextInput
              style={styles.passwordInput}
              placeholder="PIN sau parola"
              placeholderTextColor="#9CA3AF"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoComplete="current-password"
              editable={!loading}
            />
            <TouchableOpacity
              style={styles.eyeButton}
              onPress={() => setShowPassword((v) => !v)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={showPassword ? 'Ascunde parola' : 'Arată parola'}
            >
              <MaterialCommunityIcons
                name={showPassword ? 'eye' : 'eye-off'}
                size={22}
                color="#9CA3AF"
              />
            </TouchableOpacity>
          </View>

          {error && <Text style={styles.errorText}>{error}</Text>}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={() => { void handleLogin(); }}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Autentificare</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A5C36',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  brandHeader: {
    alignItems: 'center',
    marginBottom: 32,
  },
  brandTitle: {
    fontSize: 40,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  brandSubtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.75)',
    marginTop: 6,
    fontWeight: '500',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#111827',
    borderWidth: 1,
    borderColor: '#D7CCC8',
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D7CCC8',
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#111827',
  },
  eyeButton: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: '#C62828',
    fontSize: 14,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#0A5C36',
    borderRadius: 16,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});

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
import { getSupabaseClient } from '@/lib/auth';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';

/**
 * Mirror backend's pinToAuthPassword: Supabase Auth requires ≥6 chars but
 * user PINs are 4 digits. We pad before calling signInWithPassword.
 * Must stay in sync with backend/service/src/admin-users/admin-users.service.ts.
 */
function pinToAuthPassword(pin: string): string {
  return `sb_${pin}`;
}

/** Resolve a username to an email via the backend. Returns null on failure. */
async function resolveLogin(login: string): Promise<string | null> {
  if (login.includes('@')) return login;
  try {
    const res = await fetch(`${API_URL}/api/v1/auth/resolve`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ login }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { email?: string };
    return data.email ?? null;
  } catch {
    return null;
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

    try {
      const trimmedLogin = login.trim();
      const isUsername = !trimmedLogin.includes('@');
      const email = await resolveLogin(trimmedLogin);
      if (!email) {
        setError('Username inexistent. Verifica datele introduse.');
        setLoading(false);
        return;
      }

      // Operators/drivers log in with username + 4-digit PIN → pad to satisfy
      // Supabase Auth's min-6-char policy. Admins with email + long password
      // should pass through unchanged.
      const authPassword = isUsername ? pinToAuthPassword(password) : password;

      const supabase = getSupabaseClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password: authPassword,
      });

      if (authError) {
        setError(authError.message);
      }
    } catch {
      setError('A aparut o eroare neasteptata');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.content}
      >
        <View style={styles.header}>
          <Text style={styles.title}>StrawBoss</Text>
          <Text style={styles.subtitle}>Agricultural Logistics</Text>
        </View>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Username sau Email"
            placeholderTextColor="#999"
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
              placeholderTextColor="#999"
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
            >
              <Text style={styles.eyeText}>{showPassword ? 'O' : '*'}</Text>
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
    backgroundColor: '#F3DED8',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
  },
  title: {
    fontSize: 36,
    fontWeight: '700',
    color: '#0A5C36',
  },
  subtitle: {
    fontSize: 16,
    color: '#5D4037',
    marginTop: 8,
  },
  form: {
    gap: 16,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#000',
    borderWidth: 1,
    borderColor: '#D7CCC8',
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D7CCC8',
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#000',
  },
  eyeButton: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  eyeText: {
    fontSize: 18,
    color: '#666',
  },
  errorText: {
    color: '#C62828',
    fontSize: 14,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#0A5C36',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

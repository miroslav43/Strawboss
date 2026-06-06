/**
 * FM-17 — Tutorial de onboarding per rol
 *
 * Afișat o singură dată la prima autentificare a unui utilizator cu un anumit rol.
 * Starea „văzut" este persistată în SecureStore cu cheia `hasSeenOnboarding_${role}`.
 *
 * 3-4 slide-uri cu icon mare + titlu + text explicativ, adaptat per rol.
 * Butoane: „Sari peste" (oricând) + „Urmărorul" / „Am înțeles" (ultimul slide).
 *
 * Declanșat din AuthGate în `app/_layout.tsx` după ce rolul este cunoscut și
 * onboarding-ul nu a fost marcat ca văzut.
 */
import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { colors } from '@strawboss/ui-tokens';
import { useAuthStore } from '@/stores/auth-store';
import { mobileLogger } from '@/lib/logger';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ── Types ───────────────────────────────────────────────────────────────────

// Use a plain string for icon names so slide data literals are assignable.
// The icon name is cast at render time via the well-typed `name` prop.
type MCIconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

interface OnboardingSlide {
  icon: string;
  title: string;
  body: string;
}

// ── Slide content per role ──────────────────────────────────────────────────

const SLIDES_BY_ROLE: Record<string, OnboardingSlide[]> = {
  driver: [
    {
      icon: 'clipboard-list-outline',
      title: 'Task-urile tale',
      body: 'Pe ecranul principal vei vedea cursele asignate pentru ziua curentă. Cursele active sunt afișate în vârful listei.',
    },
    {
      icon: 'truck-outline',
      title: 'Fluxul de cursă',
      body: 'Fiecare cursă trece prin pași: Plecare → Sosire → Livrare. La plecare, introduci citirea odometrului și semnezi.',
    },
    {
      icon: 'gas-station-outline',
      title: 'Alimentare combustibil',
      body: 'Înregistrează alimentările din tabul „Combustibil". Poți fotografia bonul fiscal — acesta se trimite automat la server.',
    },
    {
      icon: 'wifi-off',
      title: 'Funcționează și offline',
      body: 'Toate înregistrările se salvează local pe telefon și se sincronizează cu serverul când revii la semnal.',
    },
  ],

  loader_operator: [
    {
      icon: 'clipboard-list-outline',
      title: 'Task-urile zilei',
      body: 'Pe ecranul principal vei vedea parcelele asignate pentru ziua curentă, în ordinea priorităților.',
    },
    {
      icon: 'barley',
      title: 'Încărcare baloți',
      body: 'Apasă „Încarcă baloți" pe ecranul principal. GPS-ul detectează automat parcela curentă. Introdu numărul de baloți și confirmă.',
    },
    {
      icon: 'map-marker-radius-outline',
      title: 'Geofence activ',
      body: 'Aplicația verifică dacă te aflii în interiorul parcelei asignate. Vei primi o notificare la intrare și la ieșire din câmp.',
    },
    {
      icon: 'wifi-off',
      title: 'Funcționează și offline',
      body: 'Toate înregistrările se salvează local și se sincronizează automat la reconectare. Harta parcelelor e disponibilă și fără internet.',
    },
  ],

  baler_operator: [
    {
      icon: 'clipboard-list-outline',
      title: 'Task-urile zilei',
      body: 'Pe ecranul principal vei vedea parcelele pe care trebuie să lucrezi astăzi, sortate după prioritate.',
    },
    {
      icon: 'barley',
      title: 'Înregistrare producție',
      body: 'Folosește tastatura numerică de pe ecranul „Producție" pentru a introduce numărul de baloți. Apasă „Salvează" după fiecare lot.',
    },
    {
      icon: 'package-variant-closed',
      title: 'Consumabile',
      body: 'Înregistrează consumul de sfoară, plasă sau alte consumabile din tabul „Consumabile". Poți fotografia bonul.',
    },
    {
      icon: 'wifi-off',
      title: 'Funcționează și offline',
      body: 'Toate datele se stochează local și se trimit la server automat când există semnal. Nu pierzi nicio înregistrare.',
    },
  ],

  geofence_maker: [
    {
      icon: 'map-outline',
      title: 'Desenează geofence-uri',
      body: 'Pe ecranul „Hartă", apasă „Câmp nou" și desenează conturul parcelei atingând punctele pe hartă.',
    },
    {
      icon: 'vector-polygon',
      title: 'Contur precis',
      body: 'Urmează marginile câmpului cât mai fidel. Apasă „Finalizează" când conturul e complet. Poți corecta înainte de salvare.',
    },
    {
      icon: 'domain',
      title: 'Ferme și parcele',
      body: 'Parcelele sunt organizate pe ferme. Selectează ferma potrivită înainte de a adăuga un geofence nou.',
    },
  ],
};

/** Slide set shown to admin / dispatcher / unknown roles. */
const SLIDES_DEFAULT: OnboardingSlide[] = [
  {
    icon: 'view-dashboard-outline',
    title: 'Bun venit în StrawBoss',
    body: 'Monitorizează cursele, producia de baloți și flotila de utilaje în timp real.',
  },
  {
    icon: 'sync',
    title: 'Date sincronizate',
    body: 'Toate datele de pe telefoanele operatorilor se sincronizează automat cu dashboard-ul web.',
  },
];

function getSlidesForRole(role: string | null): OnboardingSlide[] {
  if (!role) return SLIDES_DEFAULT;
  return SLIDES_BY_ROLE[role] ?? SLIDES_DEFAULT;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export const ONBOARDING_KEY_PREFIX = 'hasSeenOnboarding_';

export async function markOnboardingSeen(role: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(`${ONBOARDING_KEY_PREFIX}${role}`, '1');
  } catch (err) {
    mobileLogger.warn('onboarding: failed to mark seen', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function hasSeenOnboarding(role: string): Promise<boolean> {
  try {
    const val = await SecureStore.getItemAsync(`${ONBOARDING_KEY_PREFIX}${role}`);
    return val === '1';
  } catch {
    // On error treat as not-seen so onboarding can be shown. This is safe —
    // worst case the user sees it again after a SecureStore failure.
    return false;
  }
}

// ── Screen ──────────────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const router = useRouter();
  const role = useAuthStore((s) => s.role);
  const slides = getSlidesForRole(role);
  const [currentIndex, setCurrentIndex] = useState(0);

  const isLast = currentIndex === slides.length - 1;

  const finish = useCallback(async () => {
    if (role) {
      await markOnboardingSeen(role);
    }
    mobileLogger.flow('onboarding: completed', { role: role ?? 'unknown' });
    router.replace(
      (role === 'baler_operator'
        ? '/(baler)'
        : role === 'loader_operator'
          ? '/(loader)'
          : role === 'driver'
            ? '/(driver)'
            : role === 'geofence_maker'
              ? '/(geofence-maker)'
              : '/(tabs)') as Parameters<typeof router.replace>[0],
    );
  }, [role, router]);

  const skip = useCallback(async () => {
    if (role) {
      await markOnboardingSeen(role);
    }
    mobileLogger.flow('onboarding: skipped', { role: role ?? 'unknown', atSlide: currentIndex });
    router.replace(
      (role === 'baler_operator'
        ? '/(baler)'
        : role === 'loader_operator'
          ? '/(loader)'
          : role === 'driver'
            ? '/(driver)'
            : role === 'geofence_maker'
              ? '/(geofence-maker)'
              : '/(tabs)') as Parameters<typeof router.replace>[0],
    );
  }, [role, router, currentIndex]);

  const goNext = useCallback(() => {
    if (isLast) {
      void finish();
    } else {
      setCurrentIndex((i) => i + 1);
    }
  }, [isLast, finish]);

  const slide = slides[currentIndex];
  if (!slide) return null;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Skip button top-right */}
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => void skip()}
          style={styles.skipBtn}
          accessibilityRole="button"
          accessibilityLabel="Sari peste tutorial"
        >
          <Text style={styles.skipText}>Sari peste</Text>
        </TouchableOpacity>
      </View>

      {/* Slide content */}
      <ScrollView contentContainerStyle={styles.slideContainer} keyboardShouldPersistTaps="handled">
        <View style={styles.iconWrap}>
          <MaterialCommunityIcons
            name={slide.icon as MCIconName}
            size={96}
            color={colors.primary}
          />
        </View>
        <Text style={styles.slideTitle}>{slide.title}</Text>
        <Text style={styles.slideBody}>{slide.body}</Text>
      </ScrollView>

      {/* Step dots */}
      <View style={styles.dotsRow}>
        {slides.map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i === currentIndex ? styles.dotActive : styles.dotInactive]}
          />
        ))}
      </View>

      {/* Navigation */}
      <View style={styles.navRow}>
        {currentIndex > 0 ? (
          <TouchableOpacity
            style={styles.prevBtn}
            onPress={() => setCurrentIndex((i) => i - 1)}
            accessibilityRole="button"
            accessibilityLabel="Înapoi"
          >
            <MaterialCommunityIcons name="arrow-left" size={20} color={colors.primary} />
            <Text style={styles.prevBtnText}>Înapoi</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.prevBtnPlaceholder} />
        )}

        <TouchableOpacity
          style={styles.nextBtn}
          onPress={goNext}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={isLast ? 'Am înțeles' : 'Următorul'}
        >
          <Text style={styles.nextBtnText}>{isLast ? 'Am înțeles' : 'Următorul'}</Text>
          {!isLast && <MaterialCommunityIcons name="arrow-right" size={20} color={colors.white} />}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  skipBtn: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipText: {
    fontSize: 14,
    color: colors.neutral,
    fontWeight: '500',
  },
  slideContainer: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 24,
  },
  iconWrap: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(10,92,54,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
  },
  slideTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.primary,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 30,
  },
  slideBody: {
    fontSize: 16,
    color: '#4B5563',
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: SCREEN_WIDTH - 64,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    width: 24,
    backgroundColor: colors.primary,
  },
  dotInactive: {
    width: 8,
    backgroundColor: '#D1D5DB',
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingBottom: 16,
    gap: 12,
  },
  prevBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  prevBtnText: {
    fontSize: 15,
    color: colors.primary,
    fontWeight: '600',
  },
  prevBtnPlaceholder: {
    width: 100,
  },
  nextBtn: {
    flex: 1,
    maxWidth: 220,
    backgroundColor: colors.primary,
    borderRadius: 16,
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  nextBtnText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
  },
});

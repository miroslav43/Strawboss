import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, radii } from '@strawboss/ui-tokens';
import type { CurrentFieldParcel } from '@/hooks/useCurrentLoaderParcel';
import { useI18n } from '@/lib/i18n';

/** crop_type enum value → i18n key (reuses the parcel-detail crop labels). */
const CROP_LABEL_KEYS: Record<string, string> = {
  grau: 'parcel.detail.cropLabel.grau',
  orz: 'parcel.detail.cropLabel.orz',
  rapita: 'parcel.detail.cropLabel.rapita',
  plante_nutret: 'parcel.detail.cropLabel.planteNutret',
  altele: 'parcel.detail.cropLabel.altele',
};

/**
 * "Teren activ" card — shared by the loader and baler home screens.
 *
 * Driven by the role-agnostic `useCurrentLoaderParcel` hook, it resolves the
 * operator's current field by GPS + assigned tasks and shows live presence:
 *   • inside  → "Ești pe teren"
 *   • outside → "Mergi la teren · ~<distance> m"
 *   • unknown → "Verific poziția…"
 * plus the needs_start / multiple_active / unavailable prompt states with a
 * "Reîncearcă GPS" button. `onOpenParcel` is role-specific (each home routes to
 * its own parcel-detail screen).
 */
export function ActiveFieldCard({
  parcel,
  onOpenParcel,
}: {
  parcel: CurrentFieldParcel;
  onOpenParcel: (parcelId: string) => void;
}) {
  const { t } = useI18n();

  if (parcel.status === 'loading') {
    return (
      <View style={styles.parcelBanner}>
        <View style={styles.parcelHeader}>
          <MaterialCommunityIcons name="crosshairs-gps" size={20} color={colors.primary} />
          <Text style={styles.parcelLabel}>{t('shared.activeFieldCard.sectionLabel')}</Text>
        </View>
        <Text style={styles.parcelHint}>{t('shared.activeFieldCard.loading')}</Text>
      </View>
    );
  }

  if (parcel.status === 'resolved') {
    const isDepot = parcel.targetType === 'depot';
    // T9.3 — code is the canonical field/depot identifier; name only as a last resort.
    const title = isDepot
      ? (parcel.destinationCode ??
        parcel.destinationName ??
        t('shared.activeFieldCard.depotSectionLabel'))
      : (parcel.parcelCode ?? parcel.parcelName ?? t('shared.activeFieldCard.assignedField'));
    const cropLabel = parcel.cropType
      ? CROP_LABEL_KEYS[parcel.cropType]
        ? t(CROP_LABEL_KEYS[parcel.cropType])
        : parcel.cropType
      : null;
    // Depot targets have no farm/locality/crop context — those are parcel-only.
    const hasMeta = !isDepot && !!(parcel.farmName || parcel.municipality || cropLabel);

    return (
      <TouchableOpacity
        style={styles.parcelBanner}
        activeOpacity={isDepot ? 1 : 0.8}
        // Depot targets have no parcel-detail screen to open — navigation is a no-op.
        onPress={() => {
          if (!isDepot && parcel.parcelId) onOpenParcel(parcel.parcelId);
        }}
        disabled={isDepot || !parcel.parcelId}
        accessibilityRole="button"
        accessibilityLabel={t('shared.activeFieldCard.openFieldA11y')}
      >
        <View style={styles.parcelHeader}>
          <MaterialCommunityIcons
            name={isDepot ? 'warehouse' : 'map-marker-radius'}
            size={20}
            color={colors.primary}
          />
          <Text style={styles.parcelLabel}>
            {isDepot
              ? t('shared.activeFieldCard.depotSectionLabel')
              : t('shared.activeFieldCard.sectionLabel')}
          </Text>
        </View>
        <View style={styles.parcelNameRow}>
          <Text style={[styles.parcelName, { flex: 1 }]} numberOfLines={1} ellipsizeMode="tail">
            {title}
          </Text>
          {isDepot ? null : (
            <MaterialCommunityIcons name="chevron-right" size={24} color={colors.tertiary} />
          )}
        </View>

        {/* Depot tag chip — marks the source as a depot rather than a field. */}
        {isDepot ? (
          <View style={styles.depotTag}>
            <MaterialCommunityIcons name="warehouse" size={13} color="#92400E" />
            <Text style={styles.depotTagText}>{t('shared.activeFieldCard.depotTag')}</Text>
          </View>
        ) : null}

        {/* Farm · locality · crop — each rendered only when present. */}
        {hasMeta ? (
          <View style={styles.metaBlock}>
            {parcel.farmName ? (
              <View style={styles.metaRow}>
                <MaterialCommunityIcons name="barn" size={15} color={colors.tertiary} />
                <Text style={styles.metaText} numberOfLines={1} ellipsizeMode="tail">
                  {parcel.farmName}
                </Text>
              </View>
            ) : null}
            {parcel.municipality ? (
              <View style={styles.metaRow}>
                <MaterialCommunityIcons
                  name="map-marker-outline"
                  size={15}
                  color={colors.tertiary}
                />
                <Text style={styles.metaText} numberOfLines={1} ellipsizeMode="tail">
                  {parcel.municipality}
                </Text>
              </View>
            ) : null}
            {cropLabel ? (
              <View style={styles.cropChip}>
                <MaterialCommunityIcons name="sprout" size={13} color="#3F6212" />
                <Text style={styles.cropChipText}>{cropLabel}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {parcel.presence === 'inside' ? (
          <View style={[styles.presencePill, styles.presenceInside]}>
            <MaterialCommunityIcons name="check-circle" size={16} color="#0A5C36" />
            <Text style={styles.presenceInsideText}>
              {t('shared.activeFieldCard.presenceInside')}
            </Text>
          </View>
        ) : parcel.presence === 'outside' ? (
          <View style={[styles.presencePill, styles.presenceOutside]}>
            <MaterialCommunityIcons name="navigation-variant" size={16} color="#B7791F" />
            <Text style={styles.presenceOutsideText}>
              {parcel.distanceM != null
                ? t('shared.activeFieldCard.presenceOutsideWithDistance', {
                    distance: parcel.distanceM,
                  })
                : t('shared.activeFieldCard.presenceOutside')}
            </Text>
          </View>
        ) : (
          <View style={[styles.presencePill, styles.presenceUnknown]}>
            <MaterialCommunityIcons name="crosshairs-gps" size={16} color={colors.tertiary} />
            <Text style={styles.presenceUnknownText}>
              {t('shared.activeFieldCard.presenceUnknown')}
            </Text>
          </View>
        )}
        {isDepot ? null : (
          <Text style={styles.parcelHint}>{t('shared.activeFieldCard.tapForDetails')}</Text>
        )}
      </TouchableOpacity>
    );
  }

  // multiple_active / needs_start / unavailable — all force GPS-only resolution.
  // Candidate parcels are shown only as read-only context, never as a tappable
  // "start here" list. The operator must physically reach a parcel and press
  // "Reîncearcă GPS" to re-resolve.
  const isError = parcel.status === 'multiple_active' || parcel.status === 'needs_start';
  const headerColor = isError ? '#B7791F' : '#991B1B';
  const iconName: keyof typeof MaterialCommunityIcons.glyphMap =
    parcel.status === 'multiple_active'
      ? 'map-marker-question'
      : parcel.status === 'needs_start'
        ? 'map-marker-alert'
        : 'map-marker-off';
  const headerLabel =
    parcel.status === 'multiple_active' || parcel.status === 'needs_start'
      ? t('shared.activeFieldCard.gpsNoDetect')
      : t('shared.activeFieldCard.noFieldAssigned');
  const helpText =
    parcel.status === 'unavailable'
      ? t('shared.activeFieldCard.helpUnavailable')
      : t('shared.activeFieldCard.helpGpsError');

  return (
    <View style={isError ? styles.parcelBannerPrompt : styles.parcelBanner}>
      <View style={styles.parcelHeader}>
        <MaterialCommunityIcons name={iconName} size={20} color={headerColor} />
        <Text style={[styles.parcelLabel, { color: headerColor }]}>{headerLabel}</Text>
      </View>
      <Text style={styles.parcelHint}>{helpText}</Text>
      {isError && parcel.candidates.length > 0 ? (
        <View style={styles.parcelCandidatesInfo}>
          <Text style={styles.parcelCandidatesTitle}>
            {t('shared.activeFieldCard.candidatesTitle')}
          </Text>
          {parcel.candidates.map((task) => (
            <TouchableOpacity
              key={task.id}
              style={styles.parcelCandidateRow}
              activeOpacity={0.7}
              disabled={!task.parcelId}
              onPress={() => task.parcelId && onOpenParcel(task.parcelId)}
              accessibilityRole="button"
              accessibilityLabel={t('shared.activeFieldCard.openParcelA11y', {
                name:
                  task.parcelName ?? task.parcelCode ?? t('shared.activeFieldCard.parcelFallback'),
              })}
            >
              <MaterialCommunityIcons name="circle-small" size={18} color={colors.tertiary} />
              <Text
                style={[styles.parcelCandidateText, { flex: 1 }]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {task.parcelName ?? task.parcelCode ?? t('shared.activeFieldCard.parcelFallback')}
              </Text>
              {task.parcelId ? (
                <MaterialCommunityIcons name="chevron-right" size={18} color={colors.tertiary} />
              ) : null}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      {isError ? (
        <TouchableOpacity style={styles.refreshGpsBtn} onPress={parcel.refresh}>
          <MaterialCommunityIcons name="crosshairs-gps" size={16} color="#fff" />
          <Text style={styles.refreshGpsText}>{t('shared.activeFieldCard.retryGps')}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  parcelBanner: {
    backgroundColor: '#FFF',
    borderRadius: radii.lg,
    padding: 16,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  parcelBannerPrompt: {
    backgroundColor: '#FEF3C7',
    borderRadius: radii.lg,
    padding: 16,
    gap: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#B7791F',
  },
  parcelHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  parcelLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
    textTransform: 'uppercase',
  },
  parcelName: { fontSize: 20, fontWeight: '700', color: '#0A5C36', marginTop: 2 },
  parcelNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  parcelHint: { fontSize: 13, color: colors.textSecondary },

  // Farm / locality / crop meta block under the code title.
  metaBlock: { marginTop: 4, gap: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { flex: 1, fontSize: 14, color: colors.textSecondary },
  cropChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: '#ECFCCB',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    marginTop: 2,
  },
  cropChipText: { fontSize: 12, fontWeight: '700', color: '#3F6212' },
  depotTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    marginTop: 4,
  },
  depotTagText: { fontSize: 12, fontWeight: '700', color: '#92400E' },

  presencePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    marginTop: 4,
  },
  presenceInside: { backgroundColor: '#DCFCE7' },
  presenceInsideText: { fontSize: 13, fontWeight: '700', color: '#0A5C36' },
  presenceOutside: { backgroundColor: '#FEF3C7' },
  presenceOutsideText: { fontSize: 13, fontWeight: '700', color: '#B7791F' },
  presenceUnknown: { backgroundColor: '#F1F5F9' },
  presenceUnknownText: { fontSize: 13, fontWeight: '600', color: '#64748B' },
  parcelCandidatesInfo: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#FCE7B5',
  },
  parcelCandidatesTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#713F12',
    marginBottom: 2,
  },
  parcelCandidateRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  parcelCandidateText: { flexShrink: 1, fontSize: 13, color: '#92400E' },
  refreshGpsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radii.md,
    backgroundColor: '#0A5C36',
  },
  refreshGpsText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});

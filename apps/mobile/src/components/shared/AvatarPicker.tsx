import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useModal } from '@/hooks/useModal';
import { AppModal } from '@/components/shared/AppModal';
import * as ImagePicker from 'expo-image-picker';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { User } from '@strawboss/types';
import { colors } from '@strawboss/ui-tokens';
import { fontScale, scale } from '@/utils/responsive';
import { mobileApiClient } from '@/lib/api-client';
import { uploadAvatar } from '@/lib/avatarUpload';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useI18n } from '@/lib/i18n';

interface AvatarPickerProps {
  /** Relative URL from `users.avatar_url` (we resolve to absolute internally). */
  avatarUrl: string | null | undefined;
  /** Used for the initials fallback when there's no picture. */
  fullName: string | null | undefined;
  /** Called with the freshly-updated user after a successful upload. */
  onUploaded?: (user: User) => void;
}

/**
 * Tappable circular avatar used in the mobile profile screen.
 *
 * - Shows the user's picture when present, falls back to first-letter initial.
 * - Tapping opens a 3-option sheet: take photo, pick from library, cancel.
 * - Upload is online-only; offline taps are met with a toast-style alert.
 * - After a successful upload the returned `User` is forwarded so callers can
 *   update their query cache without a second round-trip.
 */
export function AvatarPicker({ avatarUrl, fullName, onUploaded }: AvatarPickerProps) {
  const [uploading, setUploading] = useState(false);
  const { isConnected } = useNetworkStatus();
  const { modalProps, showModal, hideModal } = useModal();
  const { t } = useI18n();

  const resolvedUrl = mobileApiClient.resolveAssetUrl(avatarUrl);
  const initial = fullName?.trim().charAt(0)?.toUpperCase() || '?';

  const pickFromSource = async (source: 'camera' | 'library') => {
    // Permission gates: expo-image-picker prompts the user the first time.
    const perm =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      showModal({
        type: 'warning',
        title: t('shared.avatarPicker.permission.title'),
        message:
          source === 'camera'
            ? t('shared.avatarPicker.permission.camera')
            : t('shared.avatarPicker.permission.gallery'),
        onConfirm: hideModal,
      });
      return;
    }

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.9,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.9,
          });

    if (result.canceled || !result.assets?.length) return;

    setUploading(true);
    try {
      const user = await uploadAvatar(result.assets[0].uri);
      onUploaded?.(user);
    } catch (err) {
      Alert.alert(
        t('shared.avatarPicker.upload.failedTitle'),
        err instanceof Error ? err.message : t('shared.avatarPicker.upload.failedDefault'),
      );
    } finally {
      setUploading(false);
    }
  };

  const handlePress = () => {
    if (uploading) return;
    if (!isConnected) {
      Alert.alert(t('shared.avatarPicker.offline.title'), t('shared.avatarPicker.offline.message'));
      return;
    }
    Alert.alert(
      t('shared.avatarPicker.sheet.title'),
      t('shared.avatarPicker.sheet.subtitle'),
      [
        {
          text: t('shared.avatarPicker.sheet.takePhoto'),
          onPress: () => void pickFromSource('camera'),
        },
        {
          text: t('shared.avatarPicker.sheet.chooseFromGallery'),
          onPress: () => void pickFromSource('library'),
        },
        { text: t('shared.avatarPicker.sheet.cancel'), style: 'cancel' },
      ],
      { cancelable: true },
    );
  };

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={handlePress}
        accessibilityLabel={t('shared.avatarPicker.accessibilityLabel')}
        accessibilityRole="button"
        style={styles.wrapper}
      >
        <View style={styles.avatarCircle}>
          {resolvedUrl ? (
            <Image source={{ uri: resolvedUrl }} style={styles.image} />
          ) : (
            <Text style={styles.initial}>{initial}</Text>
          )}
          {uploading ? (
            <View style={styles.uploadingOverlay}>
              <ActivityIndicator color="#FFFFFF" />
            </View>
          ) : null}
        </View>
        <View style={styles.editBadge}>
          <MaterialCommunityIcons name="camera" size={14} color={colors.primary} />
        </View>
      </TouchableOpacity>
      <AppModal {...modalProps} />
    </>
  );
}

const AVATAR_SIZE = scale(88);
const AVATAR_RADIUS = scale(44);
const BADGE_SIZE = scale(26);
const BADGE_RADIUS = scale(13);

const styles = StyleSheet.create({
  wrapper: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    marginBottom: 4,
  },
  avatarCircle: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_RADIUS,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  initial: {
    fontSize: fontScale(36),
    fontWeight: '700',
    color: colors.white,
  },
  uploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  editBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_RADIUS,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
});

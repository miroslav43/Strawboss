import { useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { BigButton } from '../ui/BigButton';
import { colors } from '@strawboss/ui-tokens';

interface PhotoCaptureProps {
  onCapture: (uri: string) => void;
  label?: string;
}

export function PhotoCapture({ onCapture, label }: PhotoCaptureProps) {
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  const takePhoto = async () => {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (!result.canceled) {
      const uri = result.assets[0].uri;
      setPhotoUri(uri);
      onCapture(uri);
    }
  };

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      {photoUri ? (
        <View style={styles.previewContainer}>
          <Image source={{ uri: photoUri }} style={styles.preview} />
          <BigButton title="Retake Photo" variant="outline" onPress={takePhoto} />
        </View>
      ) : (
        <View style={styles.captureContainer}>
          <View style={styles.placeholder}>
            <Text style={styles.placeholderIcon}>{'\uD83D\uDCF7'}</Text>
            <Text style={styles.placeholderText}>No photo taken</Text>
          </View>
          <BigButton title="Take Photo" onPress={takePhoto} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.neutral,
  },
  captureContainer: {
    gap: 16,
  },
  placeholder: {
    height: 200,
    backgroundColor: colors.surface,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.neutral200,
    borderStyle: 'dashed',
  },
  placeholderIcon: {
    fontSize: 40,
    marginBottom: 8,
  },
  placeholderText: {
    fontSize: 14,
    color: colors.neutral,
  },
  previewContainer: {
    gap: 12,
  },
  preview: {
    height: 250,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
});

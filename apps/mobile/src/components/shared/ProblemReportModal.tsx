import { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { colors } from '@strawboss/ui-tokens';
import { BigButton } from '@/components/ui/BigButton';
import { mobileApiClient } from '@/lib/api-client';

interface ProblemReportModalProps {
  visible: boolean;
  onClose: () => void;
  machineId?: string;
}

interface AlertPayload {
  category: 'maintenance';
  severity: 'medium';
  title: string;
  description: string;
  machineId?: string;
}

type SubmitState = 'idle' | 'loading' | 'success' | 'error';

async function postAlert(payload: AlertPayload): Promise<void> {
  await mobileApiClient.post('/api/v1/alerts', payload);
}

export function ProblemReportModal({
  visible,
  onClose,
  machineId,
}: ProblemReportModalProps) {
  const [description, setDescription] = useState('');
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (description.trim().length === 0) {
      setErrorMessage('Te rugăm să descrii problema.');
      return;
    }

    setSubmitState('loading');
    setErrorMessage(null);

    const payload: AlertPayload = {
      category: 'maintenance',
      severity: 'medium',
      title: 'Problemă tehnică',
      description: description.trim(),
      ...(machineId !== undefined ? { machineId } : {}),
    };

    try {
      await postAlert(payload);
      setSubmitState('success');
      setTimeout(() => {
        setDescription('');
        setSubmitState('idle');
        onClose();
      }, 1500);
    } catch {
      setSubmitState('error');
      setErrorMessage('A apărut o eroare. Încearcă din nou.');
    }
  };

  const handleCancel = () => {
    setDescription('');
    setSubmitState('idle');
    setErrorMessage(null);
    onClose();
  };

  const isLoading = submitState === 'loading';
  const isSuccess = submitState === 'success';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleCancel}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.modalContent}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.title}>Raportează problemă</Text>

            {isSuccess ? (
              <View style={styles.successContainer}>
                <Text style={styles.successIcon}>{'✓'}</Text>
                <Text style={styles.successText}>
                  Problema a fost raportată cu succes!
                </Text>
              </View>
            ) : (
              <>
                <TextInput
                  style={styles.textInput}
                  placeholder="Descrie problema tehnică..."
                  placeholderTextColor={colors.neutral400}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                  value={description}
                  onChangeText={setDescription}
                  editable={!isLoading}
                />

                {errorMessage !== null && (
                  <Text style={styles.errorText}>{errorMessage}</Text>
                )}

                <View style={styles.buttonStack}>
                  <BigButton
                    title="Trimite"
                    onPress={handleSubmit}
                    loading={isLoading}
                    disabled={isLoading || isSuccess}
                  />
                  <BigButton
                    title="Anulează"
                    onPress={handleCancel}
                    variant="outline"
                    disabled={isLoading}
                  />
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 24,
    paddingBottom: 40,
    paddingHorizontal: 20,
  },
  scrollContent: {
    gap: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.black,
    textAlign: 'center',
    marginBottom: 4,
  },
  textInput: {
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.neutral100,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.black,
    minHeight: 110,
  },
  errorText: {
    fontSize: 13,
    color: colors.danger,
  },
  buttonStack: {
    gap: 12,
    marginTop: 4,
  },
  successContainer: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 12,
  },
  successIcon: {
    fontSize: 48,
    color: colors.success,
  },
  successText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.success,
    textAlign: 'center',
  },
});

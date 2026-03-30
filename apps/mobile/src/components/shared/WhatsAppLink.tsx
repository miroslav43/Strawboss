import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import * as Linking from 'expo-linking';
import { colors } from '@strawboss/ui-tokens';

interface WhatsAppLinkProps {
  phone: string;
  message?: string;
  label?: string;
}

const WHATSAPP_GREEN = '#25D366';
const WHATSAPP_GREEN_DARK = '#1DA851';

function buildWhatsAppUrl(phone: string, message: string): string {
  const encoded = encodeURIComponent(message);
  return `whatsapp://send?phone=${phone}&text=${encoded}`;
}

export function WhatsAppLink({
  phone,
  message = '',
  label = 'Contactează pe WhatsApp',
}: WhatsAppLinkProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handlePress = async () => {
    const url = buildWhatsAppUrl(phone, message);

    const canOpen = await Linking.canOpenURL(url);

    if (!canOpen) {
      setErrorMessage('WhatsApp nu este instalat pe acest dispozitiv.');
      return;
    }

    setErrorMessage(null);
    await Linking.openURL(url);
  };

  return (
    <View style={styles.wrapper}>
      <TouchableOpacity
        style={styles.button}
        onPress={handlePress}
        activeOpacity={0.7}
      >
        <Text style={styles.whatsappIcon}>{'💬'}</Text>
        <Text style={styles.label}>{label}</Text>
      </TouchableOpacity>
      {errorMessage !== null && (
        <Text style={styles.errorText}>{errorMessage}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 6,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: WHATSAPP_GREEN,
    borderRadius: 12,
    height: 56,
    gap: 10,
    paddingHorizontal: 20,
  },
  whatsappIcon: {
    fontSize: 22,
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.white,
  },
  errorText: {
    fontSize: 13,
    color: colors.danger,
    textAlign: 'center',
  },
});

export { WHATSAPP_GREEN, WHATSAPP_GREEN_DARK };

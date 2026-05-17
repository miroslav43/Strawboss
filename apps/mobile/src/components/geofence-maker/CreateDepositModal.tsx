import { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Switch,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface Props {
  visible: boolean;
  onSave: (data: {
    code: string;
    name: string;
    address: string;
    contactName: string;
    contactPhone: string;
    isDefault: boolean;
  }) => void;
  onClose: () => void;
  isSaving: boolean;
}

export function CreateDepositModal({ visible, onSave, onClose, isSaving }: Props) {
  const insets = useSafeAreaInsets();

  const [code, setCode]               = useState('');
  const [name, setName]               = useState('');
  const [address, setAddress]         = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [isDefault, setIsDefault]     = useState(false);
  const [error, setError]             = useState('');

  function reset() {
    setCode(''); setName(''); setAddress(''); setContactName('');
    setContactPhone(''); setIsDefault(false); setError('');
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleSave() {
    if (!code.trim()) { setError('Codul depozitului este obligatoriu.'); return; }
    if (!name.trim()) { setError('Numele depozitului este obligatoriu.'); return; }
    if (!address.trim()) { setError('Adresa depozitului este obligatorie.'); return; }
    setError('');
    onSave({ code: code.trim(), name: name.trim(), address: address.trim(), contactName: contactName.trim(), contactPhone: contactPhone.trim(), isDefault });
    reset();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={[styles.container, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 8 }]}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Depozit nou</Text>
            <TouchableOpacity onPress={handleClose} hitSlop={12}>
              <MaterialCommunityIcons name="close" size={24} color="#6B7280" />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.form}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Code */}
            <Text style={styles.label}>Cod depozit <Text style={styles.required}>*</Text></Text>
            <TextInput
              style={styles.input}
              value={code}
              onChangeText={setCode}
              placeholder="ex. DEP-01"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="characters"
              returnKeyType="next"
            />

            {/* Name */}
            <Text style={styles.label}>Nume depozit <Text style={styles.required}>*</Text></Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="ex. Depozit Central"
              placeholderTextColor="#9CA3AF"
              returnKeyType="next"
            />

            {/* Address */}
            <Text style={styles.label}>Adresă <Text style={styles.required}>*</Text></Text>
            <TextInput
              style={styles.input}
              value={address}
              onChangeText={setAddress}
              placeholder="Strada, orașul, județul"
              placeholderTextColor="#9CA3AF"
              returnKeyType="next"
            />

            {/* Contact name */}
            <Text style={styles.label}>Persoană de contact</Text>
            <TextInput
              style={styles.input}
              value={contactName}
              onChangeText={setContactName}
              placeholder="Nume și prenume (opțional)"
              placeholderTextColor="#9CA3AF"
              returnKeyType="next"
            />

            {/* Contact phone */}
            <Text style={styles.label}>Telefon contact</Text>
            <TextInput
              style={styles.input}
              value={contactPhone}
              onChangeText={setContactPhone}
              placeholder="ex. 0722 123 456 (opțional)"
              placeholderTextColor="#9CA3AF"
              keyboardType="phone-pad"
              returnKeyType="done"
            />

            {/* isDefault */}
            <View style={styles.switchRow}>
              <View style={styles.switchLabel}>
                <Text style={styles.label}>Depozit implicit</Text>
                <Text style={styles.switchHint}>Depozitul selectat automat pentru livrări</Text>
              </View>
              <Switch
                value={isDefault}
                onValueChange={setIsDefault}
                trackColor={{ false: '#D1D5DB', true: '#A7F3D0' }}
                thumbColor={isDefault ? '#0A5C36' : '#9CA3AF'}
              />
            </View>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={handleClose} disabled={isSaving}>
              <Text style={styles.cancelBtnText}>Anulează</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, isSaving && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.saveBtnText}>Salvează depozitul</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 20 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 20, fontWeight: '700', color: '#0A5C36' },
  form: { gap: 4, paddingBottom: 12 },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginTop: 12, marginBottom: 4 },
  required: { color: '#DC2626' },
  input: {
    borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: '#111827', backgroundColor: '#FAFAFA',
  },
  switchRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 12, paddingVertical: 4,
  },
  switchLabel: { flex: 1, marginRight: 16 },
  switchHint: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  errorText: { color: '#DC2626', fontSize: 13, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 12, paddingTop: 12 },
  cancelBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 10,
    borderWidth: 1, borderColor: '#D1D5DB', alignItems: 'center',
  },
  cancelBtnText: { fontSize: 15, fontWeight: '600', color: '#374151' },
  saveBtn: { flex: 2, paddingVertical: 14, borderRadius: 10, backgroundColor: '#1565C0', alignItems: 'center' },
  saveBtnDisabled: { backgroundColor: '#9CA3AF' },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});

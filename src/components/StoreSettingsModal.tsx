import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  getLocations,
  getStoreSettings,
  saveStoreSettings,
} from '../database';
import { colors, radius, spacing } from '../theme';
import type { Location } from '../types';
import { getErrorMessage } from '../utils';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
};

export function StoreSettingsModal({ visible, onClose, onSaved }: Props) {
  const db = useSQLiteContext();
  const [locations, setLocations] = useState<Location[]>([]);
  const [storeName, setStoreName] = useState('');
  const [storeNumber, setStoreNumber] = useState('');
  const [currencyCode, setCurrencyCode] = useState('AUD');
  const [taxRate, setTaxRate] = useState('10');
  const [defaultLocationId, setDefaultLocationId] = useState<number>();
  const [pricesIncludeTax, setPricesIncludeTax] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    Promise.all([getStoreSettings(db), getLocations(db)])
      .then(([settings, nextLocations]) => {
        setStoreName(settings.storeName);
        setStoreNumber(settings.storeNumber);
        setCurrencyCode(settings.currencyCode);
        setTaxRate((settings.defaultTaxRateBasisPoints / 100).toString());
        setDefaultLocationId(settings.defaultLocationId);
        setPricesIncludeTax(settings.pricesIncludeTax);
        setLocations(nextLocations);
      })
      .catch((error) =>
        Alert.alert('Could not load settings', getErrorMessage(error)),
      )
      .finally(() => setLoading(false));
  }, [db, visible]);

  const submit = async () => {
    const percent = Number(taxRate);
    if (!storeName.trim()) {
      Alert.alert('Store name required', 'Enter the name shown in DPOS.');
      return;
    }
    if (!/^[A-Za-z]{3}$/.test(currencyCode.trim())) {
      Alert.alert('Invalid currency', 'Use a three-letter code such as AUD or USD.');
      return;
    }
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      Alert.alert('Invalid tax rate', 'Tax rate must be between 0 and 100%.');
      return;
    }
    if (!defaultLocationId) {
      Alert.alert('Location required', 'Choose a default selling location.');
      return;
    }
    setSaving(true);
    try {
      await saveStoreSettings(db, {
        storeName: storeName.trim(),
        storeNumber: storeNumber.trim(),
        currencyCode: currencyCode.trim().toUpperCase(),
        defaultTaxRateBasisPoints: Math.round(percent * 100),
        defaultLocationId,
        pricesIncludeTax,
      });
      onSaved();
      onClose();
    } catch (error) {
      Alert.alert('Could not save settings', getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>Store settings</Text>
          <Pressable onPress={submit} disabled={saving || loading} hitSlop={12}>
            <Text style={[styles.save, (saving || loading) && styles.disabled]}>
              {saving ? 'Saving…' : 'Save'}
            </Text>
          </Pressable>
        </View>
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.hero}>
              <Ionicons name="storefront-outline" size={28} color={colors.primary} />
              <View style={styles.heroText}>
                <Text style={styles.heroTitle}>Business defaults</Text>
                <Text style={styles.heroBody}>
                  New installations start in AUD with 10% GST and Main Store.
                </Text>
              </View>
            </View>
            <Field label="Store name" value={storeName} onChangeText={setStoreName} />
            <Field
              label="Store number"
              value={storeNumber}
              onChangeText={setStoreNumber}
              placeholder="Optional"
            />
            <Text style={styles.sectionTitle}>Currency and tax</Text>
            <Field
              label="Currency code"
              value={currencyCode}
              onChangeText={setCurrencyCode}
              autoCapitalize="characters"
              maxLength={3}
            />
            <Field
              label="Default tax rate (%)"
              value={taxRate}
              onChangeText={setTaxRate}
              keyboardType="decimal-pad"
            />
            <Text style={styles.label}>Product prices include tax</Text>
            <View style={styles.options}>
              {[true, false].map((option) => (
                <Pressable
                  key={String(option)}
                  style={[
                    styles.option,
                    pricesIncludeTax === option && styles.optionSelected,
                  ]}
                  onPress={() => setPricesIncludeTax(option)}
                >
                  <Text
                    style={[
                      styles.optionText,
                      pricesIncludeTax === option && styles.optionTextSelected,
                    ]}
                  >
                    {option ? 'Yes' : 'No'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.sectionTitle}>Default location</Text>
            <Text style={styles.help}>
              Inventory and register sales use this location unless another is selected.
            </Text>
            <View style={styles.locationList}>
              {locations.map((location) => (
                <Pressable
                  key={location.id}
                  style={[
                    styles.location,
                    defaultLocationId === location.id && styles.locationSelected,
                  ]}
                  onPress={() => setDefaultLocationId(location.id)}
                >
                  <Ionicons
                    name={
                      defaultLocationId === location.id
                        ? 'radio-button-on'
                        : 'radio-button-off'
                    }
                    size={21}
                    color={colors.primary}
                  />
                  <View>
                    <Text style={styles.locationName}>{location.name}</Text>
                    <Text style={styles.locationCode}>{location.code}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function Field({
  label,
  ...props
}: React.ComponentProps<typeof TextInput> & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        style={styles.input}
        placeholderTextColor={colors.textMuted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    minHeight: 64,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  cancel: { color: colors.textMuted, fontSize: 16 },
  title: { color: colors.text, fontSize: 18, fontWeight: '800' },
  save: { color: colors.primary, fontSize: 16, fontWeight: '800' },
  disabled: { opacity: 0.5 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  hero: {
    padding: spacing.md,
    flexDirection: 'row',
    gap: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  heroText: { flex: 1 },
  heroTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  heroBody: { marginTop: 3, color: colors.textMuted, lineHeight: 19 },
  sectionTitle: {
    marginTop: spacing.sm,
    color: colors.primaryDark,
    fontSize: 17,
    fontWeight: '900',
  },
  field: { gap: spacing.sm },
  label: { color: colors.text, fontSize: 14, fontWeight: '700' },
  input: {
    minHeight: 52,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  options: { flexDirection: 'row', gap: spacing.sm },
  option: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  optionSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  optionText: { color: colors.text, fontWeight: '700' },
  optionTextSelected: { color: colors.surface },
  help: { color: colors.textMuted, lineHeight: 19 },
  locationList: { gap: spacing.sm },
  location: {
    minHeight: 64,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  locationSelected: { borderColor: colors.primary, backgroundColor: colors.surfaceMuted },
  locationName: { color: colors.text, fontWeight: '800' },
  locationCode: { marginTop: 2, color: colors.textMuted, fontSize: 11 },
});

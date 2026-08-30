import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors, radius, spacing } from '../theme';
import type { Product, ProductInput } from '../types';
import { getErrorMessage, parseMoney } from '../utils';

type Props = {
  visible: boolean;
  product?: Product;
  onClose: () => void;
  onSave: (input: ProductInput, id?: number) => Promise<void>;
};

type FormState = {
  name: string;
  sku: string;
  price: string;
  stock: string;
  lowStockThreshold: string;
};

const emptyForm: FormState = {
  name: '',
  sku: '',
  price: '',
  stock: '0',
  lowStockThreshold: '5',
};

export function ProductFormModal({
  visible,
  product,
  onClose,
  onSave,
}: Props) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setForm(
      product
        ? {
            name: product.name,
            sku: product.sku,
            price: (product.priceCents / 100).toFixed(2),
            stock: String(product.stock),
            lowStockThreshold: String(product.lowStockThreshold),
          }
        : emptyForm,
    );
  }, [product, visible]);

  const update = (key: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = async () => {
    const priceCents = parseMoney(form.price);
    const stock = Number(form.stock);
    const lowStockThreshold = Number(form.lowStockThreshold);

    if (!form.name.trim() || !form.sku.trim()) {
      Alert.alert('Missing information', 'Name and SKU are required.');
      return;
    }
    if (!Number.isInteger(priceCents) || priceCents < 0) {
      Alert.alert('Invalid price', 'Enter a valid price of zero or more.');
      return;
    }
    if (!Number.isInteger(stock) || stock < 0) {
      Alert.alert('Invalid stock', 'Stock must be a whole number of zero or more.');
      return;
    }
    if (!Number.isInteger(lowStockThreshold) || lowStockThreshold < 0) {
      Alert.alert(
        'Invalid threshold',
        'Low-stock threshold must be a whole number of zero or more.',
      );
      return;
    }

    setSaving(true);
    try {
      await onSave(
        {
          name: form.name.trim(),
          sku: form.sku.trim(),
          priceCents,
          stock,
          lowStockThreshold,
        },
        product?.id,
      );
      onClose();
    } catch (error) {
      Alert.alert('Could not save product', getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}
      >
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>{product ? 'Edit product' : 'New product'}</Text>
          <Pressable onPress={submit} disabled={saving} hitSlop={12}>
            <Text style={[styles.save, saving && styles.disabled]}>
              {saving ? 'Saving…' : 'Save'}
            </Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.form}
          keyboardShouldPersistTaps="handled"
        >
          <Field
            label="Product name"
            value={form.name}
            onChangeText={(value) => update('name', value)}
            placeholder="e.g. House Blend Coffee"
            autoFocus={!product}
          />
          <Field
            label="SKU"
            value={form.sku}
            onChangeText={(value) => update('sku', value)}
            placeholder="e.g. COF-001"
            autoCapitalize="characters"
          />
          <Field
            label="Selling price"
            value={form.price}
            onChangeText={(value) => update('price', value)}
            placeholder="0.00"
            keyboardType="decimal-pad"
          />
          <Field
            label="Stock on hand"
            value={form.stock}
            onChangeText={(value) => update('stock', value)}
            placeholder="0"
            keyboardType="number-pad"
          />
          <Field
            label="Low-stock warning at"
            value={form.lowStockThreshold}
            onChangeText={(value) => update('lowStockThreshold', value)}
            placeholder="5"
            keyboardType="number-pad"
            help="The product is flagged when stock reaches this number."
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

type FieldProps = React.ComponentProps<typeof TextInput> & {
  label: string;
  help?: string;
};

function Field({ label, help, ...inputProps }: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...inputProps}
        style={styles.input}
        placeholderTextColor={colors.textMuted}
      />
      {help ? <Text style={styles.help}>{help}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    minHeight: 64,
    paddingHorizontal: spacing.md,
    paddingTop: Platform.OS === 'ios' ? 12 : spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  cancel: {
    color: colors.textMuted,
    fontSize: 16,
  },
  save: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.5,
  },
  form: {
    padding: spacing.md,
    gap: spacing.lg,
  },
  field: {
    gap: spacing.sm,
  },
  label: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 16,
  },
  help: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
});

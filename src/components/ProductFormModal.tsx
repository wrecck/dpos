import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import {
  Alert,
  Image,
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

import { persistProductImage } from '../productImages';
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
  imageUri: string;
  category: string;
  weight: string;
  dimensions: string;
  colors: string;
  sizes: string;
  brand: string;
  supplier: string;
  manufacturer: string;
  variants: string;
};

const emptyForm: FormState = {
  name: '',
  sku: '',
  price: '',
  stock: '0',
  lowStockThreshold: '5',
  imageUri: '',
  category: '',
  weight: '',
  dimensions: '',
  colors: '',
  sizes: '',
  brand: '',
  supplier: '',
  manufacturer: '',
  variants: '',
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
            imageUri: product.imageUri ?? '',
            category: product.category ?? '',
            weight: product.weight ?? '',
            dimensions: product.dimensions ?? '',
            colors: product.colors ?? '',
            sizes: product.sizes ?? '',
            brand: product.brand ?? '',
            supplier: product.supplier ?? '',
            manufacturer: product.manufacturer ?? '',
            variants: product.variants ?? '',
          }
        : emptyForm,
    );
  }, [product, visible]);

  const update = (key: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled) {
        const asset = result.assets[0];
        const imageUri = await persistProductImage(asset.uri, asset.fileName);
        update('imageUri', imageUri);
      }
    } catch (error) {
      Alert.alert('Could not select image', getErrorMessage(error));
    }
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
          imageUri: optionalValue(form.imageUri),
          category: optionalValue(form.category),
          weight: optionalValue(form.weight),
          dimensions: optionalValue(form.dimensions),
          colors: optionalValue(form.colors),
          sizes: optionalValue(form.sizes),
          brand: optionalValue(form.brand),
          supplier: optionalValue(form.supplier),
          manufacturer: optionalValue(form.manufacturer),
          variants: optionalValue(form.variants),
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
          <Text style={styles.sectionTitle}>Product details</Text>
          <View style={styles.imageRow}>
            <Pressable style={styles.imagePicker} onPress={pickImage}>
              {form.imageUri ? (
                <Image source={{ uri: form.imageUri }} style={styles.image} />
              ) : (
                <>
                  <Ionicons
                    name="image-outline"
                    size={32}
                    color={colors.primary}
                  />
                  <Text style={styles.imagePlaceholderText}>Add image</Text>
                </>
              )}
            </Pressable>
            <View style={styles.imageActions}>
              <Pressable style={styles.chooseImageButton} onPress={pickImage}>
                <Text style={styles.chooseImageText}>
                  {form.imageUri ? 'Change image' : 'Choose product image'}
                </Text>
              </Pressable>
              {form.imageUri ? (
                <Pressable onPress={() => update('imageUri', '')}>
                  <Text style={styles.removeImageText}>Remove image</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
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
          <Text style={styles.sectionTitle}>Optional catalog information</Text>
          <Field
            label="Category"
            value={form.category}
            onChangeText={(value) => update('category', value)}
            placeholder="e.g. Coffee, Clothing, Electronics"
          />
          <Field
            label="Brand"
            value={form.brand}
            onChangeText={(value) => update('brand', value)}
            placeholder="e.g. DPOS Roasters"
          />
          <Field
            label="Weight"
            value={form.weight}
            onChangeText={(value) => update('weight', value)}
            placeholder="e.g. 250 g or 1 kg"
          />
          <Field
            label="Dimensions"
            value={form.dimensions}
            onChangeText={(value) => update('dimensions', value)}
            placeholder="e.g. 20 × 10 × 5 cm"
          />
          <Field
            label="Colours"
            value={form.colors}
            onChangeText={(value) => update('colors', value)}
            placeholder="e.g. Black, White, Blue"
            help="Separate multiple options with commas."
          />
          <Field
            label="Sizes"
            value={form.sizes}
            onChangeText={(value) => update('sizes', value)}
            placeholder="e.g. Small, Medium, Large"
            help="Useful for drinks, clothing, and packaged goods."
          />
          <Field
            label="Variants"
            value={form.variants}
            onChangeText={(value) => update('variants', value)}
            placeholder="e.g. Decaf, Regular or 6-pack, 12-pack"
            help="Separate multiple options with commas."
          />
          <Field
            label="Supplier"
            value={form.supplier}
            onChangeText={(value) => update('supplier', value)}
            placeholder="Supplier or distributor"
          />
          <Field
            label="Manufacturer"
            value={form.manufacturer}
            onChangeText={(value) => update('manufacturer', value)}
            placeholder="Manufacturer name"
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function optionalValue(value: string) {
  return value.trim() || null;
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
  sectionTitle: {
    color: colors.primaryDark,
    fontSize: 16,
    fontWeight: '800',
  },
  imageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  imagePicker: {
    width: 112,
    height: 112,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  image: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  imagePlaceholderText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  imageActions: {
    flex: 1,
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  chooseImageButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
  },
  chooseImageText: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: '700',
  },
  removeImageText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '700',
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

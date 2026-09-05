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
  parentSku: string;
  sku: string;
  barcode: string;
  variantName: string;
  price: string;
  wholesalePrice: string;
  cost: string;
  taxRate: string;
  stock: string;
  lowStockThreshold: string;
  targetStock: string;
  imageUri: string;
  category: string;
  subcategory: string;
  description: string;
  weight: string;
  dimensions: string;
  colors: string;
  sizes: string;
  brand: string;
  supplier: string;
  supplierCode: string;
  unit: string;
  manufacturer: string;
  variants: string;
  batchTracking: boolean;
  expiryTracking: boolean;
  active: boolean;
  notes: string;
};

const emptyForm: FormState = {
  name: '',
  parentSku: '',
  sku: '',
  barcode: '',
  variantName: '',
  price: '',
  wholesalePrice: '',
  cost: '',
  taxRate: '10',
  stock: '0',
  lowStockThreshold: '5',
  targetStock: '0',
  imageUri: '',
  category: '',
  subcategory: '',
  description: '',
  weight: '',
  dimensions: '',
  colors: '',
  sizes: '',
  brand: '',
  supplier: '',
  supplierCode: '',
  unit: 'Each',
  manufacturer: '',
  variants: '',
  batchTracking: false,
  expiryTracking: false,
  active: true,
  notes: '',
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
            parentSku: product.parentSku,
            sku: product.sku,
            barcode: product.barcode ?? '',
            variantName: product.variantName ?? '',
            price: (product.priceCents / 100).toFixed(2),
            wholesalePrice:
              product.wholesalePriceIncTaxCents === null
                ? ''
                : (product.wholesalePriceIncTaxCents / 100).toFixed(2),
            cost: (product.costExTaxCents / 100).toFixed(2),
            taxRate: (product.taxRateBasisPoints / 100).toString(),
            stock: String(product.stock),
            lowStockThreshold: String(product.lowStockThreshold),
            targetStock: String(product.targetStock),
            imageUri: product.imageUri ?? '',
            category: product.category ?? '',
            subcategory: product.subcategory ?? '',
            description: product.description ?? '',
            weight: product.weight ?? '',
            dimensions: product.dimensions ?? '',
            colors: product.colors ?? '',
            sizes: product.sizes ?? '',
            brand: product.brand ?? '',
            supplier: product.supplier ?? '',
            supplierCode: product.supplierCode ?? '',
            unit: product.unit,
            manufacturer: product.manufacturer ?? '',
            variants: product.variants ?? '',
            batchTracking: product.batchTracking,
            expiryTracking: product.expiryTracking,
            active: product.active,
            notes: product.notes ?? '',
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
    const wholesalePriceCents = form.wholesalePrice.trim()
      ? parseMoney(form.wholesalePrice)
      : null;
    const costExTaxCents = parseMoney(form.cost || '0');
    const taxRate = Number(form.taxRate);
    const stock = Number(form.stock);
    const lowStockThreshold = Number(form.lowStockThreshold);
    const targetStock = Number(form.targetStock);

    if (!form.name.trim() || !form.sku.trim()) {
      Alert.alert('Missing information', 'Name and SKU are required.');
      return;
    }
    if (!Number.isInteger(priceCents) || priceCents < 0) {
      Alert.alert('Invalid price', 'Enter a valid price of zero or more.');
      return;
    }
    if (
      !Number.isInteger(costExTaxCents) ||
      costExTaxCents < 0 ||
      (wholesalePriceCents !== null &&
        (!Number.isInteger(wholesalePriceCents) || wholesalePriceCents < 0))
    ) {
      Alert.alert('Invalid cost or price', 'Enter non-negative currency amounts.');
      return;
    }
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      Alert.alert('Invalid tax rate', 'Tax rate must be between 0 and 100%.');
      return;
    }
    if (!Number.isFinite(stock) || stock < 0) {
      Alert.alert('Invalid stock', 'Stock must be a number of zero or more.');
      return;
    }
    if (
      !Number.isInteger(lowStockThreshold) ||
      lowStockThreshold < 0 ||
      !Number.isInteger(targetStock) ||
      targetStock < 0
    ) {
      Alert.alert(
        'Invalid stock target',
        'Reorder and target stock must be whole numbers of zero or more.',
      );
      return;
    }

    setSaving(true);
    try {
      await onSave(
        {
          name: form.name.trim(),
          parentSku: form.parentSku.trim() || form.sku.trim(),
          sku: form.sku.trim(),
          barcode: optionalValue(form.barcode),
          variantName: optionalValue(form.variantName),
          priceCents,
          retailPriceIncTaxCents: priceCents,
          wholesalePriceIncTaxCents: wholesalePriceCents,
          costExTaxCents,
          taxRateBasisPoints: Math.round(taxRate * 100),
          stock,
          lowStockThreshold,
          reorderPoint: lowStockThreshold,
          targetStock,
          imageUri: optionalValue(form.imageUri),
          category: optionalValue(form.category),
          subcategory: optionalValue(form.subcategory),
          description: optionalValue(form.description),
          weight: optionalValue(form.weight),
          dimensions: optionalValue(form.dimensions),
          colors: optionalValue(form.colors),
          sizes: optionalValue(form.sizes),
          brand: optionalValue(form.brand),
          supplier: optionalValue(form.supplier),
          supplierCode: optionalValue(form.supplierCode),
          unit: form.unit.trim() || 'Each',
          manufacturer: optionalValue(form.manufacturer),
          variants: optionalValue(form.variants),
          batchTracking: form.batchTracking,
          expiryTracking: form.expiryTracking,
          active: form.active,
          notes: optionalValue(form.notes),
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
            label="Parent SKU"
            value={form.parentSku}
            onChangeText={(value) => update('parentSku', value)}
            placeholder="Defaults to the SKU"
            autoCapitalize="characters"
            help="Use the same Parent SKU to group multiple sellable variants."
          />
          <Field
            label="SKU"
            value={form.sku}
            onChangeText={(value) => update('sku', value)}
            placeholder="e.g. COF-001"
            autoCapitalize="characters"
          />
          <Field
            label="Barcode"
            value={form.barcode}
            onChangeText={(value) => update('barcode', value)}
            placeholder="Optional unique barcode"
            keyboardType="number-pad"
          />
          <Field
            label="Variant name"
            value={form.variantName}
            onChangeText={(value) => update('variantName', value)}
            placeholder="e.g. 250 mL, Red / Large"
          />
          <Text style={styles.sectionTitle}>Pricing and tax</Text>
          <Field
            label="Cost ex tax"
            value={form.cost}
            onChangeText={(value) => update('cost', value)}
            placeholder="0.00"
            keyboardType="decimal-pad"
          />
          <Field
            label="Retail price inc tax"
            value={form.price}
            onChangeText={(value) => update('price', value)}
            placeholder="0.00"
            keyboardType="decimal-pad"
          />
          <Field
            label="Wholesale price inc tax"
            value={form.wholesalePrice}
            onChangeText={(value) => update('wholesalePrice', value)}
            placeholder="Optional"
            keyboardType="decimal-pad"
          />
          <Field
            label="Tax rate (%)"
            value={form.taxRate}
            onChangeText={(value) => update('taxRate', value)}
            placeholder="10"
            keyboardType="decimal-pad"
          />
          <Text style={styles.sectionTitle}>Inventory</Text>
          <Field
            label="Stock on hand"
            value={form.stock}
            onChangeText={(value) => update('stock', value)}
            placeholder="0"
            keyboardType="decimal-pad"
          />
          <Field
            label="Reorder point"
            value={form.lowStockThreshold}
            onChangeText={(value) => update('lowStockThreshold', value)}
            placeholder="5"
            keyboardType="number-pad"
            help="The product is flagged when stock reaches this number."
          />
          <Field
            label="Target stock"
            value={form.targetStock}
            onChangeText={(value) => update('targetStock', value)}
            placeholder="0"
            keyboardType="number-pad"
          />
          <Field
            label="Unit"
            value={form.unit}
            onChangeText={(value) => update('unit', value)}
            placeholder="Each, kg, mL, pack"
          />
          <ToggleField
            label="Batch tracking"
            value={form.batchTracking}
            onChange={(value) =>
              setForm((current) => ({ ...current, batchTracking: value }))
            }
          />
          <ToggleField
            label="Expiry tracking"
            value={form.expiryTracking}
            onChange={(value) =>
              setForm((current) => ({ ...current, expiryTracking: value }))
            }
          />
          <Text style={styles.sectionTitle}>Optional catalog information</Text>
          <Field
            label="Category"
            value={form.category}
            onChangeText={(value) => update('category', value)}
            placeholder="e.g. Coffee, Clothing, Electronics"
          />
          <Field
            label="Subcategory"
            value={form.subcategory}
            onChangeText={(value) => update('subcategory', value)}
            placeholder="e.g. Shampoo, Espresso, T-shirts"
          />
          <Field
            label="Description"
            value={form.description}
            onChangeText={(value) => update('description', value)}
            placeholder="Product description"
            multiline
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
            label="Supplier code"
            value={form.supplierCode}
            onChangeText={(value) => update('supplierCode', value)}
            placeholder="Supplier's code for this variant"
          />
          <Field
            label="Manufacturer"
            value={form.manufacturer}
            onChangeText={(value) => update('manufacturer', value)}
            placeholder="Manufacturer name"
          />
          <Field
            label="Notes"
            value={form.notes}
            onChangeText={(value) => update('notes', value)}
            placeholder="Internal notes"
            multiline
          />
          <ToggleField
            label="Active for sale"
            value={form.active}
            onChange={(value) =>
              setForm((current) => ({ ...current, active: value }))
            }
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

function ToggleField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.toggleField}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.toggleOptions}>
        {[true, false].map((option) => (
          <Pressable
            key={String(option)}
            style={[
              styles.toggleOption,
              value === option && styles.toggleOptionSelected,
            ]}
            onPress={() => onChange(option)}
          >
            <Text
              style={[
                styles.toggleText,
                value === option && styles.toggleTextSelected,
              ]}
            >
              {option ? 'Yes' : 'No'}
            </Text>
          </Pressable>
        ))}
      </View>
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
  toggleField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  toggleOptions: {
    flexDirection: 'row',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  toggleOption: {
    minWidth: 58,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  toggleOptionSelected: {
    backgroundColor: colors.primary,
  },
  toggleText: {
    color: colors.textMuted,
    fontWeight: '700',
  },
  toggleTextSelected: {
    color: colors.surface,
  },
});

import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import {
  getLocations,
  getProducts,
  getSuppliers,
  receiveSupplierStock,
} from '../database';
import { colors, radius, spacing } from '../theme';
import type { Location, Product, Supplier } from '../types';
import { formatMoney, getErrorMessage, parseMoney } from '../utils';

type ReceiptLine = {
  product: Product;
  quantity: string;
  cost: string;
  lotNumber: string;
  expiryDate: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onReceived: () => void;
};

export function StockReceiptModal({
  visible,
  onClose,
  onReceived,
}: Props) {
  const db = useSQLiteContext();
  const { height, width } = useWindowDimensions();
  const bottomClearance =
    Platform.OS === 'android' && Math.min(width, height) >= 600
      ? Math.round(height * 0.05)
      : 0;
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [supplierId, setSupplierId] = useState<number>();
  const [locationId, setLocationId] = useState<number>();
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    Promise.all([getSuppliers(db), getLocations(db)])
      .then(([nextSuppliers, nextLocations]) => {
        setSuppliers(nextSuppliers);
        setLocations(nextLocations);
        setSupplierId((current) => current ?? nextSuppliers[0]?.id);
        setLocationId(
          (current) =>
            current ?? nextLocations.find((location) => location.isDefault)?.id,
        );
      })
      .catch((error) =>
        Alert.alert('Could not prepare receipt', getErrorMessage(error)),
      );
  }, [db, visible]);

  useEffect(() => {
    if (!visible) return;
    const timeout = setTimeout(() => {
      getProducts(db, search, { locationId, limit: 100 })
        .then(setProducts)
        .catch((error) =>
          Alert.alert('Could not load products', getErrorMessage(error)),
        );
    }, 150);
    return () => clearTimeout(timeout);
  }, [db, locationId, search, visible]);

  const totalCost = useMemo(
    () =>
      lines.reduce((sum, line) => {
        const cost = parseMoney(line.cost);
        const quantity = Number(line.quantity);
        return Number.isInteger(cost) && Number.isFinite(quantity)
          ? sum + cost * quantity
          : sum;
      }, 0),
    [lines],
  );

  const resetAndClose = () => {
    if (saving) return;
    setReference('');
    setNotes('');
    setSearch('');
    setLines([]);
    onClose();
  };

  const addLine = (product: Product) => {
    setLines((current) =>
      current.some((line) => line.product.id === product.id)
        ? current
        : [
            ...current,
            {
              product,
              quantity: '1',
              cost: (product.costExTaxCents / 100).toFixed(2),
              lotNumber: '',
              expiryDate: '',
            },
          ],
    );
  };

  const updateLine = (
    productId: number,
    field: keyof Omit<ReceiptLine, 'product'>,
    value: string,
  ) => {
    setLines((current) =>
      current.map((line) =>
        line.product.id === productId ? { ...line, [field]: value } : line,
      ),
    );
  };

  const submit = async () => {
    if (!supplierId) {
      Alert.alert('Choose a supplier', 'A posted delivery needs a supplier.');
      return;
    }
    if (!locationId) {
      Alert.alert('Choose a location', 'Choose where this stock was received.');
      return;
    }
    if (lines.length === 0) {
      Alert.alert('Add products', 'Add at least one product to this delivery.');
      return;
    }
    const receiptLines = lines.map((line) => ({
      variantId: line.product.id,
      quantity: Number(line.quantity),
      costExTaxCents: parseMoney(line.cost),
      supplierCode: line.product.supplierCode ?? undefined,
      lotNumber: line.lotNumber.trim() || undefined,
      expiryDate: line.expiryDate.trim() || undefined,
    }));
    if (
      receiptLines.some(
        (line) =>
          !Number.isFinite(line.quantity) ||
          line.quantity <= 0 ||
          !Number.isInteger(line.costExTaxCents) ||
          line.costExTaxCents < 0,
      )
    ) {
      Alert.alert(
        'Check receipt lines',
        'Each line needs a positive quantity and valid cost.',
      );
      return;
    }
    setSaving(true);
    try {
      const deliveryId = await receiveSupplierStock(db, {
        supplierId,
        locationId,
        supplierReference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        lines: receiptLines,
      });
      onReceived();
      setReference('');
      setNotes('');
      setSearch('');
      setLines([]);
      onClose();
      Alert.alert(
        'Stock received',
        `Delivery #${deliveryId} posted with ${lines.length} line${lines.length === 1 ? '' : 's'}.`,
      );
    } catch (error) {
      Alert.alert('Could not receive stock', getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={resetAndClose}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Pressable onPress={resetAndClose} hitSlop={12}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>Receive delivery</Text>
          <Pressable onPress={submit} disabled={saving} hitSlop={12}>
            <Text style={[styles.post, saving && styles.disabled]}>
              {saving ? 'Posting…' : 'Post'}
            </Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.sectionTitle}>Delivery details</Text>
          {suppliers.length ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
              {suppliers.map((supplier) => (
                <Chip
                  key={supplier.id}
                  label={supplier.name}
                  selected={supplierId === supplier.id}
                  onPress={() => setSupplierId(supplier.id)}
                />
              ))}
            </ScrollView>
          ) : (
            <View style={styles.notice}>
              <Ionicons name="information-circle-outline" size={20} color={colors.warning} />
              <Text style={styles.noticeText}>
                No suppliers yet. Add a supplier to a product or import a supplier column first.
              </Text>
            </View>
          )}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
          >
            {locations.map((location) => (
              <Chip
                key={location.id}
                label={location.name}
                selected={locationId === location.id}
                onPress={() => setLocationId(location.id)}
              />
            ))}
          </ScrollView>
          <TextInput
            value={reference}
            onChangeText={setReference}
            style={styles.input}
            placeholder="Supplier invoice or delivery reference"
            placeholderTextColor={colors.textMuted}
          />
          <TextInput
            value={notes}
            onChangeText={setNotes}
            style={styles.input}
            placeholder="Delivery notes (optional)"
            placeholderTextColor={colors.textMuted}
          />

          <Text style={styles.sectionTitle}>Add products</Text>
          <View style={styles.searchBox}>
            <Ionicons name="search-outline" size={20} color={colors.textMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              style={styles.searchInput}
              placeholder="Search name, SKU, or barcode"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
            />
          </View>
          <View style={styles.results}>
            {products.slice(0, 12).map((product) => {
              const added = lines.some((line) => line.product.id === product.id);
              return (
                <Pressable
                  key={product.id}
                  style={styles.result}
                  onPress={() => addLine(product)}
                  disabled={added}
                >
                  <View style={styles.resultInfo}>
                    <Text style={styles.resultName} numberOfLines={1}>
                      {product.name}{product.variantName ? ` · ${product.variantName}` : ''}
                    </Text>
                    <Text style={styles.resultSku}>{product.sku}</Text>
                  </View>
                  <Ionicons
                    name={added ? 'checkmark-circle' : 'add-circle-outline'}
                    size={24}
                    color={added ? colors.success : colors.primary}
                  />
                </Pressable>
              );
            })}
          </View>

          {lines.length ? (
            <>
              <View style={styles.linesTitleRow}>
                <Text style={styles.sectionTitle}>Receipt lines</Text>
                <Text style={styles.totalCost}>{formatMoney(totalCost)} ex tax</Text>
              </View>
              {lines.map((line) => (
                <View key={line.product.id} style={styles.line}>
                  <View style={styles.lineHeader}>
                    <View style={styles.lineNameBlock}>
                      <Text style={styles.lineName}>
                        {line.product.name}
                        {line.product.variantName ? ` · ${line.product.variantName}` : ''}
                      </Text>
                      <Text style={styles.resultSku}>{line.product.sku}</Text>
                    </View>
                    <Pressable
                      onPress={() =>
                        setLines((current) =>
                          current.filter((item) => item.product.id !== line.product.id),
                        )
                      }
                    >
                      <Ionicons name="trash-outline" size={20} color={colors.danger} />
                    </Pressable>
                  </View>
                  <View style={styles.lineFields}>
                    <MiniField
                      label="Quantity"
                      value={line.quantity}
                      onChangeText={(value) => updateLine(line.product.id, 'quantity', value)}
                    />
                    <MiniField
                      label="Cost ex tax"
                      value={line.cost}
                      onChangeText={(value) => updateLine(line.product.id, 'cost', value)}
                    />
                  </View>
                  {line.product.batchTracking || line.product.expiryTracking ? (
                    <View style={styles.lineFields}>
                      {line.product.batchTracking ? (
                        <MiniField
                          label="Lot / batch"
                          value={line.lotNumber}
                          onChangeText={(value) =>
                            updateLine(line.product.id, 'lotNumber', value)
                          }
                          keyboardType="default"
                        />
                      ) : null}
                      {line.product.expiryTracking ? (
                        <MiniField
                          label="Expiry YYYY-MM-DD"
                          value={line.expiryDate}
                          onChangeText={(value) =>
                            updateLine(line.product.id, 'expiryDate', value)
                          }
                          keyboardType="default"
                        />
                      ) : null}
                    </View>
                  ) : null}
                </View>
              ))}
            </>
          ) : null}
        </ScrollView>

        <View
          style={[
            styles.footer,
            { paddingBottom: spacing.md + bottomClearance },
          ]}
        >
          <Pressable
            style={[styles.postButton, (saving || !supplierId || !lines.length) && styles.disabled]}
            onPress={submit}
            disabled={saving || !supplierId || !lines.length}
          >
            {saving ? <ActivityIndicator color={colors.surface} /> : (
              <Ionicons name="archive-outline" size={21} color={colors.surface} />
            )}
            <Text style={styles.postButtonText}>
              {saving ? 'Posting delivery…' : `Receive ${lines.length} line${lines.length === 1 ? '' : 's'}`}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={onPress}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

function MiniField({
  label,
  keyboardType = 'decimal-pad',
  ...props
}: React.ComponentProps<typeof TextInput> & { label: string }) {
  return (
    <View style={styles.miniField}>
      <Text style={styles.miniLabel}>{label}</Text>
      <TextInput
        {...props}
        keyboardType={keyboardType}
        style={styles.miniInput}
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
  post: { color: colors.primary, fontSize: 16, fontWeight: '800' },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '900' },
  chips: { gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  chipText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  chipTextSelected: { color: colors.surface },
  notice: {
    padding: spacing.md,
    flexDirection: 'row',
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.warningSoft,
  },
  noticeText: { flex: 1, color: colors.text, lineHeight: 19 },
  input: {
    minHeight: 50,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  searchBox: {
    minHeight: 50,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, color: colors.text },
  results: { gap: spacing.xs },
  result: {
    minHeight: 54,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  resultInfo: { flex: 1 },
  resultName: { color: colors.text, fontWeight: '700' },
  resultSku: { marginTop: 2, color: colors.textMuted, fontSize: 11 },
  linesTitleRow: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  totalCost: { color: colors.primary, fontWeight: '900' },
  line: {
    padding: spacing.md,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  lineHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  lineNameBlock: { flex: 1 },
  lineName: { color: colors.text, fontSize: 14, fontWeight: '800' },
  lineFields: { flexDirection: 'row', gap: spacing.sm },
  miniField: { flex: 1, gap: spacing.xs },
  miniLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  miniInput: {
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    color: colors.text,
    backgroundColor: colors.background,
  },
  footer: {
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  postButton: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  postButtonText: { color: colors.surface, fontSize: 16, fontWeight: '800' },
  disabled: { opacity: 0.5 },
});

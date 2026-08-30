import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
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

import { completeSale, getProducts } from '../database';
import { colors, radius, spacing } from '../theme';
import type { CartItem, PaymentMethod, Product } from '../types';
import { formatMoney, getErrorMessage, parseMoney } from '../utils';

type Props = {
  revision: number;
  onDataChanged: () => void;
  onOpenInventory: () => void;
};

export function RegisterScreen({
  revision,
  onDataChanged,
  onOpenInventory,
}: Props) {
  const db = useSQLiteContext();
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [checkoutVisible, setCheckoutVisible] = useState(false);

  const load = useCallback(async () => {
    try {
      const currentProducts = await getProducts(db, search);
      setProducts(currentProducts);
      setCart((currentCart) =>
        currentCart
          .map((item) => {
            const current = currentProducts.find(
              (product) => product.id === item.id,
            );
            return current
              ? { ...current, quantity: Math.min(item.quantity, current.stock) }
              : undefined;
          })
          .filter((item): item is CartItem => Boolean(item && item.quantity > 0)),
      );
    } catch (error) {
      Alert.alert('Could not load products', getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [db, search]);

  useEffect(() => {
    const timeout = setTimeout(load, 150);
    return () => clearTimeout(timeout);
  }, [load, revision]);

  const addToCart = (product: Product) => {
    if (product.stock === 0) {
      Alert.alert('Out of stock', `${product.name} has no stock available.`);
      return;
    }
    setCart((current) => {
      const existing = current.find((item) => item.id === product.id);
      if (!existing) {
        return [...current, { ...product, quantity: 1 }];
      }
      if (existing.quantity >= product.stock) {
        Alert.alert(
          'Stock limit reached',
          `Only ${product.stock} unit${product.stock === 1 ? '' : 's'} available.`,
        );
        return current;
      }
      return current.map((item) =>
        item.id === product.id
          ? { ...item, quantity: item.quantity + 1 }
          : item,
      );
    });
  };

  const setQuantity = (productId: number, quantity: number) => {
    setCart((current) =>
      quantity <= 0
        ? current.filter((item) => item.id !== productId)
        : current.map((item) =>
            item.id === productId ? { ...item, quantity } : item,
          ),
    );
  };

  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const totalCents = cart.reduce(
    (sum, item) => sum + item.priceCents * item.quantity,
    0,
  );

  const handleCheckout = async (
    paymentMethod: PaymentMethod,
    amountTenderedCents: number,
  ) => {
    const result = await completeSale(
      db,
      cart,
      paymentMethod,
      amountTenderedCents,
    );
    setCheckoutVisible(false);
    setCart([]);
    onDataChanged();
    await load();

    const changeText =
      paymentMethod === 'cash'
        ? `\nChange: ${formatMoney(result.changeCents)}`
        : '';
    Alert.alert(
      'Sale complete',
      `Receipt ${result.receiptNumber}\nTotal: ${formatMoney(
        result.totalCents,
      )}${changeText}`,
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={20} color={colors.textMuted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          style={styles.searchInput}
          placeholder="Search products or SKU"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {search ? (
          <Pressable onPress={() => setSearch('')} hitSlop={10}>
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => String(item.id)}
          numColumns={2}
          columnWrapperStyle={styles.productRow}
          contentContainerStyle={[
            styles.productList,
            products.length === 0 && styles.emptyList,
            cart.length > 0 && styles.productListWithCart,
          ]}
          renderItem={({ item }) => (
            <ProductTile product={item} onPress={() => addToCart(item)} />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Ionicons
                  name={search ? 'search-outline' : 'storefront-outline'}
                  size={34}
                  color={colors.primary}
                />
              </View>
              <Text style={styles.emptyTitle}>
                {search ? 'No matching products' : 'Ready for your first product'}
              </Text>
              <Text style={styles.emptyText}>
                {search
                  ? 'Try another name or SKU.'
                  : 'Products you add to inventory will appear here.'}
              </Text>
              {!search ? (
                <Pressable style={styles.inventoryButton} onPress={onOpenInventory}>
                  <Text style={styles.inventoryButtonText}>Open inventory</Text>
                </Pressable>
              ) : null}
            </View>
          }
        />
      )}

      {cart.length > 0 ? (
        <Pressable
          style={styles.cartBar}
          onPress={() => setCheckoutVisible(true)}
        >
          <View style={styles.cartCount}>
            <Text style={styles.cartCountText}>{itemCount}</Text>
          </View>
          <View style={styles.cartLabel}>
            <Text style={styles.cartTitle}>View current sale</Text>
            <Text style={styles.cartSubtitle}>
              {itemCount} item{itemCount === 1 ? '' : 's'}
            </Text>
          </View>
          <Text style={styles.cartTotal}>{formatMoney(totalCents)}</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.surface} />
        </Pressable>
      ) : null}

      <CheckoutModal
        visible={checkoutVisible}
        cart={cart}
        onClose={() => setCheckoutVisible(false)}
        onSetQuantity={setQuantity}
        onCheckout={handleCheckout}
      />
    </View>
  );
}

function ProductTile({
  product,
  onPress,
}: {
  product: Product;
  onPress: () => void;
}) {
  const soldOut = product.stock === 0;
  const low = product.stock <= product.lowStockThreshold;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.productTile,
        soldOut && styles.soldOutTile,
        pressed && !soldOut && styles.pressedTile,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Add ${product.name} to cart`}
    >
      <View style={styles.productGlyph}>
        <Ionicons
          name="cube-outline"
          size={25}
          color={soldOut ? colors.textMuted : colors.primary}
        />
      </View>
      <Text style={styles.productName} numberOfLines={2}>
        {product.name}
      </Text>
      <Text style={styles.productSku} numberOfLines={1}>
        {product.sku}
      </Text>
      <View style={styles.tileBottom}>
        <Text style={styles.productPrice}>{formatMoney(product.priceCents)}</Text>
        <Text
          style={[
            styles.productStock,
            low && styles.lowStock,
            soldOut && styles.outOfStock,
          ]}
        >
          {soldOut ? 'Out' : `${product.stock} left`}
        </Text>
      </View>
    </Pressable>
  );
}

type CheckoutProps = {
  visible: boolean;
  cart: CartItem[];
  onClose: () => void;
  onSetQuantity: (productId: number, quantity: number) => void;
  onCheckout: (
    paymentMethod: PaymentMethod,
    amountTenderedCents: number,
  ) => Promise<void>;
};

function CheckoutModal({
  visible,
  cart,
  onClose,
  onSetQuantity,
  onCheckout,
}: CheckoutProps) {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [cashReceived, setCashReceived] = useState('');
  const [saving, setSaving] = useState(false);
  const totalCents = useMemo(
    () =>
      cart.reduce(
        (sum, item) => sum + item.priceCents * item.quantity,
        0,
      ),
    [cart],
  );
  const enteredCash = parseMoney(cashReceived);
  const validCash = Number.isFinite(enteredCash) ? enteredCash : 0;

  useEffect(() => {
    if (visible) {
      setMethod('cash');
      setCashReceived((totalCents / 100).toFixed(2));
    }
  }, [totalCents, visible]);

  const submit = async () => {
    const tendered = method === 'cash' ? validCash : totalCents;
    if (method === 'cash' && tendered < totalCents) {
      Alert.alert('Not enough cash', 'Cash received must cover the sale total.');
      return;
    }
    setSaving(true);
    try {
      await onCheckout(method, tendered);
    } catch (error) {
      Alert.alert('Could not complete sale', getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.checkoutContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.checkoutHeader}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.checkoutCancel}>Back</Text>
          </Pressable>
          <Text style={styles.checkoutTitle}>Current sale</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          style={styles.checkoutScroll}
          contentContainerStyle={styles.checkoutContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.cartItems}>
            {cart.map((item) => (
              <View key={item.id} style={styles.lineItem}>
                <View style={styles.lineInfo}>
                  <Text style={styles.lineName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.linePrice}>
                    {formatMoney(item.priceCents)} each
                  </Text>
                </View>
                <View style={styles.quantity}>
                  <Pressable
                    style={styles.quantityButton}
                    onPress={() => onSetQuantity(item.id, item.quantity - 1)}
                  >
                    <Ionicons name="remove" size={18} color={colors.text} />
                  </Pressable>
                  <Text style={styles.quantityText}>{item.quantity}</Text>
                  <Pressable
                    style={styles.quantityButton}
                    onPress={() =>
                      onSetQuantity(
                        item.id,
                        Math.min(item.quantity + 1, item.stock),
                      )
                    }
                  >
                    <Ionicons name="add" size={18} color={colors.text} />
                  </Pressable>
                </View>
                <Text style={styles.lineTotal}>
                  {formatMoney(item.priceCents * item.quantity)}
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.totalCard}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatMoney(totalCents)}</Text>
          </View>

          <View style={styles.paymentSection}>
            <Text style={styles.sectionLabel}>Payment method</Text>
            <View style={styles.paymentMethods}>
              {(['cash', 'card', 'other'] as PaymentMethod[]).map((option) => (
                <Pressable
                  key={option}
                  style={[
                    styles.paymentButton,
                    method === option && styles.paymentButtonSelected,
                  ]}
                  onPress={() => setMethod(option)}
                >
                  <Ionicons
                    name={
                      option === 'cash'
                        ? 'cash-outline'
                        : option === 'card'
                          ? 'card-outline'
                          : 'ellipsis-horizontal'
                    }
                    size={21}
                    color={
                      method === option ? colors.surface : colors.textMuted
                    }
                  />
                  <Text
                    style={[
                      styles.paymentButtonText,
                      method === option && styles.paymentButtonTextSelected,
                    ]}
                  >
                    {option[0].toUpperCase() + option.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {method === 'cash' ? (
            <View style={styles.cashSection}>
              <Text style={styles.sectionLabel}>Cash received</Text>
              <TextInput
                value={cashReceived}
                onChangeText={setCashReceived}
                style={styles.cashInput}
                keyboardType="decimal-pad"
                selectTextOnFocus
                placeholder="0.00"
                placeholderTextColor={colors.textMuted}
              />
              <View style={styles.changeRow}>
                <Text style={styles.changeLabel}>Change due</Text>
                <Text style={styles.changeValue}>
                  {formatMoney(Math.max(0, validCash - totalCents))}
                </Text>
              </View>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.checkoutFooter}>
          <Pressable
            style={[styles.completeButton, saving && styles.disabledButton]}
            onPress={submit}
            disabled={saving || cart.length === 0}
          >
            <Ionicons name="checkmark-circle" size={22} color={colors.surface} />
            <Text style={styles.completeButtonText}>
              {saving ? 'Completing…' : `Complete · ${formatMoney(totalCents)}`}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchBox: {
    minHeight: 48,
    margin: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productList: {
    padding: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  productListWithCart: {
    paddingBottom: 110,
  },
  emptyList: {
    flexGrow: 1,
  },
  productRow: {
    gap: spacing.sm,
  },
  productTile: {
    flex: 1,
    minHeight: 166,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  soldOutTile: {
    opacity: 0.58,
  },
  pressedTile: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceMuted,
  },
  productGlyph: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
    marginBottom: spacing.sm,
  },
  productName: {
    minHeight: 40,
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  productSku: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 11,
  },
  tileBottom: {
    marginTop: 'auto',
    paddingTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  productPrice: {
    flexShrink: 1,
    color: colors.primary,
    fontSize: 15,
    fontWeight: '800',
  },
  productStock: {
    color: colors.success,
    fontSize: 11,
    fontWeight: '700',
  },
  lowStock: {
    color: colors.warning,
  },
  outOfStock: {
    color: colors.danger,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
    marginBottom: spacing.md,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptyText: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  inventoryButton: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: 13,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  inventoryButtonText: {
    color: colors.surface,
    fontWeight: '700',
  },
  cartBar: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    minHeight: 68,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.primaryDark,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  cartCount: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
  },
  cartCountText: {
    color: colors.primaryDark,
    fontSize: 14,
    fontWeight: '900',
  },
  cartLabel: {
    flex: 1,
  },
  cartTitle: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: '700',
  },
  cartSubtitle: {
    marginTop: 2,
    color: '#BFD4C9',
    fontSize: 12,
  },
  cartTotal: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: '900',
  },
  checkoutContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  checkoutHeader: {
    minHeight: 64,
    paddingHorizontal: spacing.md,
    paddingTop: Platform.OS === 'ios' ? 12 : spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  checkoutCancel: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  checkoutTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  headerSpacer: {
    width: 36,
  },
  checkoutScroll: {
    flex: 1,
  },
  checkoutContent: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  cartItems: {
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  lineItem: {
    minHeight: 74,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  lineInfo: {
    flex: 1,
  },
  lineName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  linePrice: {
    marginTop: 3,
    color: colors.textMuted,
    fontSize: 12,
  },
  quantity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  quantityButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
  },
  quantityText: {
    minWidth: 18,
    color: colors.text,
    fontWeight: '700',
    textAlign: 'center',
  },
  lineTotal: {
    minWidth: 68,
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'right',
  },
  totalCard: {
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primaryDark,
    borderRadius: radius.md,
  },
  totalLabel: {
    color: '#BFD4C9',
    fontSize: 15,
    fontWeight: '600',
  },
  totalValue: {
    color: colors.surface,
    fontSize: 26,
    fontWeight: '900',
  },
  paymentSection: {
    gap: spacing.sm,
  },
  sectionLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  paymentMethods: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  paymentButton: {
    flex: 1,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  paymentButtonSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  paymentButtonText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  paymentButtonTextSelected: {
    color: colors.surface,
  },
  cashSection: {
    gap: spacing.sm,
  },
  cashInput: {
    minHeight: 54,
    paddingHorizontal: spacing.md,
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  changeRow: {
    paddingHorizontal: spacing.xs,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  changeLabel: {
    color: colors.textMuted,
    fontSize: 14,
  },
  changeValue: {
    color: colors.success,
    fontSize: 16,
    fontWeight: '800',
  },
  checkoutFooter: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  completeButton: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  disabledButton: {
    opacity: 0.55,
  },
  completeButtonText: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: '800',
  },
});

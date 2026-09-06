import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
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

import { completeSale, getProducts } from '../database';
import { colors, radius, spacing } from '../theme';
import type { CartItem, PaymentMethod, Product } from '../types';
import { formatMoney, getErrorMessage, parseMoney } from '../utils';

type Props = {
  revision: number;
  onDataChanged: () => void;
  onOpenInventory: () => void;
};

type ProductGroup = {
  parentId: number;
  parentSku: string;
  name: string;
  brand: string | null;
  category: string | null;
  variants: Product[];
};

export function RegisterScreen({
  revision,
  onDataChanged,
  onOpenInventory,
}: Props) {
  const db = useSQLiteContext();
  const { height, width } = useWindowDimensions();
  const isTablet = Math.min(width, height) >= 600;
  const saleBottomClearance =
    Platform.OS === 'android' && isTablet ? Math.round(height * 0.05) : 0;
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [checkoutVisible, setCheckoutVisible] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<ProductGroup>();

  const load = useCallback(async () => {
    try {
      const visibleProducts = await getProducts(db, search, { limit: 300 });
      setProducts(visibleProducts);
      setCart((currentCart) =>
        currentCart.map((item) => {
          const current = visibleProducts.find((product) => product.id === item.id);
          return current
            ? { ...current, quantity: Math.min(item.quantity, current.stock) }
            : item;
        }).filter((item) => item.quantity > 0),
      );
    } catch (error) {
      Alert.alert('Could not load products', getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [db, search]);

  const productGroups = useMemo(() => {
    const groups = new Map<number, ProductGroup>();
    for (const product of products) {
      const group = groups.get(product.parentId);
      if (group) {
        group.variants.push(product);
      } else {
        groups.set(product.parentId, {
          parentId: product.parentId,
          parentSku: product.parentSku,
          name: product.name,
          brand: product.brand,
          category: product.category,
          variants: [product],
        });
      }
    }
    return [...groups.values()];
  }, [products]);

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

  const selectGroup = (group: ProductGroup) => {
    if (group.variants.length === 1) {
      addToCart(group.variants[0]);
    } else {
      setSelectedGroup(group);
    }
  };

  const submitSearch = () => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) return;
    const exact = products.find(
      (product) =>
        product.sku.toLowerCase() === normalized ||
        product.barcode?.toLowerCase() === normalized,
    );
    if (exact) {
      addToCart(exact);
      setSearch('');
    }
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
      <View style={[styles.registerBody, isTablet && styles.registerBodyTablet]}>
        <View style={styles.productPane}>
          <View style={styles.searchBox}>
            <Ionicons name="search-outline" size={20} color={colors.textMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              style={styles.searchInput}
              placeholder="Search products, SKU, category, or brand"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              returnKeyType="search"
              onSubmitEditing={submitSearch}
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
              data={productGroups}
              keyExtractor={(item) => String(item.parentId)}
              numColumns={2}
              columnWrapperStyle={styles.productRow}
              contentContainerStyle={[
                styles.productList,
                productGroups.length === 0 && styles.emptyList,
                !isTablet && cart.length > 0 && styles.productListWithCart,
              ]}
              renderItem={({ item }) => (
                <ProductGroupTile group={item} onPress={() => selectGroup(item)} />
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
                    {search
                      ? 'No matching products'
                      : 'Ready for your first product'}
                  </Text>
                  <Text style={styles.emptyText}>
                    {search
                      ? 'Try another name, SKU, category, or brand.'
                      : 'Products you add to inventory will appear here.'}
                  </Text>
                  {!search ? (
                    <Pressable
                      style={styles.inventoryButton}
                      onPress={onOpenInventory}
                    >
                      <Text style={styles.inventoryButtonText}>
                        Open inventory
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              }
            />
          )}
        </View>

        {isTablet ? (
          <TabletCartPanel
            cart={cart}
            itemCount={itemCount}
            totalCents={totalCents}
            bottomClearance={saleBottomClearance}
            onSetQuantity={setQuantity}
            onCheckout={() => setCheckoutVisible(true)}
          />
        ) : null}
      </View>

      {!isTablet && cart.length > 0 ? (
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
        bottomClearance={saleBottomClearance}
      />
      <VariantSelectorModal
        group={selectedGroup}
        onClose={() => setSelectedGroup(undefined)}
        onSelect={(product) => {
          addToCart(product);
          setSelectedGroup(undefined);
        }}
      />
    </View>
  );
}

function TabletCartPanel({
  cart,
  itemCount,
  totalCents,
  bottomClearance,
  onSetQuantity,
  onCheckout,
}: {
  cart: CartItem[];
  itemCount: number;
  totalCents: number;
  bottomClearance: number;
  onSetQuantity: (productId: number, quantity: number) => void;
  onCheckout: () => void;
}) {
  return (
    <View style={styles.tabletCart}>
      <View style={styles.tabletCartHeader}>
        <View>
          <Text style={styles.tabletCartTitle}>Current sale</Text>
          <Text style={styles.tabletCartSubtitle}>
            {itemCount} item{itemCount === 1 ? '' : 's'}
          </Text>
        </View>
        <View style={styles.tabletCartCount}>
          <Text style={styles.tabletCartCountText}>{itemCount}</Text>
        </View>
      </View>

      <ScrollView
        style={styles.tabletCartScroll}
        contentContainerStyle={[
          styles.tabletCartItems,
          cart.length === 0 && styles.tabletCartEmptyContainer,
        ]}
      >
        {cart.length === 0 ? (
          <View style={styles.tabletCartEmpty}>
            <Ionicons name="cart-outline" size={38} color={colors.textMuted} />
            <Text style={styles.tabletCartEmptyTitle}>Cart is empty</Text>
            <Text style={styles.tabletCartEmptyText}>
              Tap products on the left to add multiple items.
            </Text>
          </View>
        ) : (
          cart.map((item) => (
            <View key={item.id} style={styles.tabletCartItem}>
              <View style={styles.tabletLineTop}>
                <View style={styles.lineInfo}>
                  <Text style={styles.lineName} numberOfLines={1}>
                    {item.name}{item.variantName ? ` · ${item.variantName}` : ''}
                  </Text>
                  <Text style={styles.linePrice}>
                    {formatMoney(item.priceCents)} each
                  </Text>
                </View>
                <Text style={styles.lineTotal}>
                  {formatMoney(item.priceCents * item.quantity)}
                </Text>
              </View>
              <View style={styles.tabletQuantityRow}>
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
                <Pressable
                  style={styles.removeLineButton}
                  onPress={() => onSetQuantity(item.id, 0)}
                >
                  <Ionicons name="trash-outline" size={17} color={colors.danger} />
                </Pressable>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <View
        style={[
          styles.tabletCartFooter,
          { paddingBottom: spacing.md + bottomClearance },
        ]}
      >
        <View style={styles.tabletTotalRow}>
          <Text style={styles.tabletTotalLabel}>Total</Text>
          <Text style={styles.tabletTotalValue}>{formatMoney(totalCents)}</Text>
        </View>
        <Pressable
          style={[
            styles.tabletCheckoutButton,
            cart.length === 0 && styles.disabledButton,
          ]}
          onPress={onCheckout}
          disabled={cart.length === 0}
        >
          <Text style={styles.tabletCheckoutText}>
            Continue to payment
          </Text>
          <Ionicons name="arrow-forward" size={20} color={colors.surface} />
        </Pressable>
      </View>
    </View>
  );
}

function ProductGroupTile({
  group,
  onPress,
}: {
  group: ProductGroup;
  onPress: () => void;
}) {
  const totalStock = group.variants.reduce((sum, variant) => sum + variant.stock, 0);
  const sellable = group.variants.filter((variant) => variant.stock > 0);
  const soldOut = sellable.length === 0;
  const low = !soldOut && sellable.every(
    (variant) => variant.stock <= variant.lowStockThreshold,
  );
  const fromPrice = Math.min(...group.variants.map((variant) => variant.priceCents));
  const image = group.variants.find((variant) => variant.imageUri)?.imageUri;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.productTile,
        soldOut && styles.soldOutTile,
        pressed && !soldOut && styles.pressedTile,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Choose ${group.name}`}
    >
      {image ? (
        <Image
          source={{ uri: image }}
          style={styles.productImage}
          resizeMode="cover"
        />
      ) : (
        <View style={styles.productGlyph}>
          <Ionicons
            name="cube-outline"
            size={25}
            color={soldOut ? colors.textMuted : colors.primary}
          />
        </View>
      )}
      <Text style={styles.productName} numberOfLines={2}>
        {group.name}
      </Text>
      <Text style={styles.productSku} numberOfLines={1}>
        {[
          group.parentSku,
          group.category,
          group.variants.length > 1 ? `${group.variants.length} variants` : null,
        ].filter(Boolean).join(' · ')}
      </Text>
      <View style={styles.tileBottom}>
        <Text style={styles.productPrice}>
          {group.variants.length > 1 ? 'From ' : ''}{formatMoney(fromPrice)}
        </Text>
        <Text
          style={[
            styles.productStock,
            low && styles.lowStock,
            soldOut && styles.outOfStock,
          ]}
        >
          {soldOut ? 'Out' : `${totalStock} total`}
        </Text>
      </View>
    </Pressable>
  );
}

function VariantSelectorModal({
  group,
  onClose,
  onSelect,
}: {
  group?: ProductGroup;
  onClose: () => void;
  onSelect: (product: Product) => void;
}) {
  return (
    <Modal
      visible={Boolean(group)}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.variantOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.variantSheet}>
          <View style={styles.variantHeader}>
            <View style={styles.variantHeaderText}>
              <Text style={styles.variantTitle}>{group?.name}</Text>
              <Text style={styles.variantSubtitle}>Choose a sellable variant</Text>
            </View>
            <Pressable style={styles.variantClose} onPress={onClose}>
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.variantList}>
            {group?.variants.map((variant) => {
              const soldOut = variant.stock <= 0;
              return (
                <Pressable
                  key={variant.id}
                  style={[styles.variantOption, soldOut && styles.soldOutTile]}
                  onPress={() => onSelect(variant)}
                  disabled={soldOut}
                >
                  {variant.imageUri ? (
                    <Image source={{ uri: variant.imageUri }} style={styles.variantImage} />
                  ) : (
                    <View style={styles.variantImagePlaceholder}>
                      <Ionicons name="cube-outline" size={20} color={colors.primary} />
                    </View>
                  )}
                  <View style={styles.variantInfo}>
                    <Text style={styles.variantName}>
                      {variant.variantName || variant.sku}
                    </Text>
                    <Text style={styles.variantSku}>
                      {variant.sku}{variant.barcode ? ` · ${variant.barcode}` : ''}
                    </Text>
                  </View>
                  <View style={styles.variantNumbers}>
                    <Text style={styles.variantPrice}>{formatMoney(variant.priceCents)}</Text>
                    <Text style={[styles.variantStock, soldOut && styles.outOfStock]}>
                      {soldOut ? 'Out of stock' : `${variant.stock} available`}
                    </Text>
                  </View>
                  <Ionicons name="add-circle" size={25} color={soldOut ? colors.border : colors.primary} />
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
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
  bottomClearance: number;
};

function CheckoutModal({
  visible,
  cart,
  onClose,
  onSetQuantity,
  onCheckout,
  bottomClearance,
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
                    {item.name}{item.variantName ? ` · ${item.variantName}` : ''}
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

        <View
          style={[
            styles.checkoutFooter,
            { paddingBottom: spacing.md + bottomClearance },
          ]}
        >
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
  registerBody: {
    flex: 1,
  },
  registerBodyTablet: {
    flexDirection: 'row',
  },
  productPane: {
    flex: 1,
    minWidth: 0,
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
  productImage: {
    width: '100%',
    height: 78,
    marginBottom: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
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
  variantOverlay: {
    flex: 1,
    padding: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11, 61, 44, 0.45)',
  },
  variantSheet: {
    width: '100%',
    maxWidth: 620,
    maxHeight: '78%',
    overflow: 'hidden',
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  variantHeader: {
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  variantHeaderText: { flex: 1 },
  variantTitle: { color: colors.text, fontSize: 20, fontWeight: '900' },
  variantSubtitle: { marginTop: 3, color: colors.textMuted, fontSize: 13 },
  variantClose: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: colors.surfaceMuted,
  },
  variantList: { padding: spacing.md, gap: spacing.sm },
  variantOption: {
    minHeight: 72,
    padding: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  variantImage: {
    width: 52,
    height: 52,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
  },
  variantImagePlaceholder: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
  },
  variantInfo: { flex: 1 },
  variantName: { color: colors.text, fontSize: 14, fontWeight: '800' },
  variantSku: { marginTop: 3, color: colors.textMuted, fontSize: 11 },
  variantNumbers: { alignItems: 'flex-end' },
  variantPrice: { color: colors.primary, fontSize: 14, fontWeight: '900' },
  variantStock: { marginTop: 3, color: colors.success, fontSize: 11, fontWeight: '700' },
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
  tabletCart: {
    width: '40%',
    minWidth: 280,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabletCartHeader: {
    minHeight: 72,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tabletCartTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  tabletCartSubtitle: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 12,
  },
  tabletCartCount: {
    minWidth: 34,
    height: 34,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
  },
  tabletCartCountText: {
    color: colors.primaryDark,
    fontSize: 14,
    fontWeight: '900',
  },
  tabletCartScroll: {
    flex: 1,
  },
  tabletCartItems: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  tabletCartEmptyContainer: {
    flexGrow: 1,
  },
  tabletCartEmpty: {
    flex: 1,
    minHeight: 220,
    padding: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabletCartEmptyTitle: {
    marginTop: spacing.sm,
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  tabletCartEmptyText: {
    marginTop: spacing.xs,
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  tabletCartItem: {
    padding: spacing.md,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  tabletLineTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tabletQuantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  removeLineButton: {
    width: 32,
    height: 32,
    marginLeft: 'auto',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabletCartFooter: {
    padding: spacing.md,
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabletTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tabletTotalLabel: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '700',
  },
  tabletTotalValue: {
    color: colors.primaryDark,
    fontSize: 24,
    fontWeight: '900',
  },
  tabletCheckoutButton: {
    minHeight: 52,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  tabletCheckoutText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: '800',
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

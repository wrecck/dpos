import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { ProductFormModal } from '../components/ProductFormModal';
import {
  deleteProduct,
  getProducts,
  saveProduct,
  setProductStock,
} from '../database';
import { colors, radius, spacing } from '../theme';
import type { Product, ProductInput } from '../types';
import { formatMoney, getErrorMessage } from '../utils';

type Props = {
  revision: number;
  onDataChanged: () => void;
};

export function InventoryScreen({ revision, onDataChanged }: Props) {
  const db = useSQLiteContext();
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product>();

  const load = useCallback(async () => {
    try {
      setProducts(await getProducts(db, search));
    } catch (error) {
      Alert.alert('Could not load inventory', getErrorMessage(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [db, search]);

  useEffect(() => {
    const timeout = setTimeout(load, 150);
    return () => clearTimeout(timeout);
  }, [load, revision]);

  const openNew = () => {
    setEditingProduct(undefined);
    setModalVisible(true);
  };

  const openEdit = (product: Product) => {
    setEditingProduct(product);
    setModalVisible(true);
  };

  const handleSave = async (input: ProductInput, id?: number) => {
    await saveProduct(db, input, id);
    onDataChanged();
    await load();
  };

  const changeStock = async (product: Product, difference: number) => {
    const nextStock = product.stock + difference;
    if (nextStock < 0) {
      return;
    }
    try {
      await setProductStock(db, product.id, nextStock);
      setProducts((current) =>
        current.map((item) =>
          item.id === product.id ? { ...item, stock: nextStock } : item,
        ),
      );
      onDataChanged();
    } catch (error) {
      Alert.alert('Could not update stock', getErrorMessage(error));
    }
  };

  const confirmDelete = (product: Product) => {
    Alert.alert(
      `Delete ${product.name}?`,
      'Past sales will be kept, but this product will be removed from inventory.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteProduct(db, product.id);
              onDataChanged();
              await load();
            } catch (error) {
              Alert.alert('Could not delete product', getErrorMessage(error));
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={20} color={colors.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search name or SKU"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {search ? (
            <Pressable onPress={() => setSearch('')} hitSlop={10}>
              <Ionicons name="close-circle" size={20} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
        <Pressable style={styles.addButton} onPress={openNew}>
          <Ionicons name="add" size={22} color={colors.surface} />
          <Text style={styles.addButtonText}>Add</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={[
            styles.list,
            products.length === 0 && styles.emptyList,
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              colors={[colors.primary]}
            />
          }
          renderItem={({ item }) => (
            <ProductRow
              product={item}
              onEdit={() => openEdit(item)}
              onDelete={() => confirmDelete(item)}
              onDecrease={() => changeStock(item, -1)}
              onIncrease={() => changeStock(item, 1)}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Ionicons
                  name={search ? 'search-outline' : 'cube-outline'}
                  size={34}
                  color={colors.primary}
                />
              </View>
              <Text style={styles.emptyTitle}>
                {search ? 'No matching products' : 'Your inventory is empty'}
              </Text>
              <Text style={styles.emptyText}>
                {search
                  ? 'Try a different name or SKU.'
                  : 'Add your first product to start making sales.'}
              </Text>
              {!search ? (
                <Pressable style={styles.emptyButton} onPress={openNew}>
                  <Text style={styles.emptyButtonText}>Add first product</Text>
                </Pressable>
              ) : null}
            </View>
          }
        />
      )}

      <ProductFormModal
        visible={modalVisible}
        product={editingProduct}
        onClose={() => setModalVisible(false)}
        onSave={handleSave}
      />
    </View>
  );
}

type ProductRowProps = {
  product: Product;
  onEdit: () => void;
  onDelete: () => void;
  onDecrease: () => void;
  onIncrease: () => void;
};

function ProductRow({
  product,
  onEdit,
  onDelete,
  onDecrease,
  onIncrease,
}: ProductRowProps) {
  const isLow = product.stock <= product.lowStockThreshold;

  return (
    <Pressable style={styles.product} onPress={onEdit}>
      <View style={styles.productTop}>
        {product.imageUri ? (
          <Image source={{ uri: product.imageUri }} style={styles.thumbnail} />
        ) : (
          <View style={styles.thumbnailPlaceholder}>
            <Ionicons name="cube-outline" size={22} color={colors.primary} />
          </View>
        )}
        <View style={styles.productInfo}>
          <Text style={styles.productName} numberOfLines={1}>
            {product.name}
          </Text>
          <Text style={styles.sku}>{product.sku}</Text>
          {product.category || product.brand ? (
            <Text style={styles.productMeta} numberOfLines={1}>
              {[product.category, product.brand].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
        </View>
        <Text style={styles.price}>{formatMoney(product.priceCents)}</Text>
      </View>

      <View style={styles.productBottom}>
        <View style={[styles.stockBadge, isLow && styles.lowStockBadge]}>
          <View style={[styles.dot, isLow && styles.lowDot]} />
          <Text style={[styles.stockText, isLow && styles.lowStockText]}>
            {product.stock} in stock{isLow ? ' · Low' : ''}
          </Text>
        </View>

        <View style={styles.actions}>
          <Pressable
            style={styles.iconButton}
            onPress={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            hitSlop={4}
          >
            <Ionicons name="trash-outline" size={19} color={colors.danger} />
          </Pressable>
          <Pressable
            style={styles.stockButton}
            onPress={(event) => {
              event.stopPropagation();
              onDecrease();
            }}
            disabled={product.stock === 0}
          >
            <Ionicons
              name="remove"
              size={18}
              color={product.stock === 0 ? colors.border : colors.text}
            />
          </Pressable>
          <Text style={styles.stockCount}>{product.stock}</Text>
          <Pressable
            style={styles.stockButton}
            onPress={(event) => {
              event.stopPropagation();
              onIncrease();
            }}
          >
            <Ionicons name="add" size={18} color={colors.text} />
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  toolbar: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  searchBox: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
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
  addButton: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
  },
  addButtonText: {
    color: colors.surface,
    fontWeight: '700',
    fontSize: 15,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  emptyList: {
    flexGrow: 1,
  },
  separator: {
    height: spacing.sm,
  },
  product: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  productTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  thumbnail: {
    width: 52,
    height: 52,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
  },
  thumbnailPlaceholder: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
  },
  productInfo: {
    flex: 1,
    gap: 3,
  },
  productName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  sku: {
    color: colors.textMuted,
    fontSize: 13,
  },
  productMeta: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  price: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '800',
  },
  productBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  stockBadge: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surfaceMuted,
  },
  lowStockBadge: {
    backgroundColor: colors.warningSoft,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  lowDot: {
    backgroundColor: colors.warning,
  },
  stockText: {
    color: colors.success,
    fontSize: 12,
    fontWeight: '700',
  },
  lowStockText: {
    color: colors.warning,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stockButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
  },
  stockCount: {
    minWidth: 24,
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
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
  emptyButton: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: 13,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
  },
  emptyButtonText: {
    color: colors.surface,
    fontWeight: '700',
  },
});

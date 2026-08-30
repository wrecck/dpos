import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { getDashboardStats, getRecentSales } from '../database';
import { colors, radius, spacing } from '../theme';
import type { DashboardStats, Sale } from '../types';
import { formatDate, formatMoney, getErrorMessage } from '../utils';

type Props = {
  revision: number;
};

const emptyStats: DashboardStats = {
  productCount: 0,
  stockUnits: 0,
  lowStockCount: 0,
  salesTodayCents: 0,
};

export function SalesScreen({ revision }: Props) {
  const db = useSQLiteContext();
  const [sales, setSales] = useState<Sale[]>([]);
  const [stats, setStats] = useState(emptyStats);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [recentSales, dashboardStats] = await Promise.all([
        getRecentSales(db),
        getDashboardStats(db),
      ]);
      setSales(recentSales);
      setStats(dashboardStats);
    } catch (error) {
      Alert.alert('Could not load activity', getErrorMessage(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [db]);

  useEffect(() => {
    load();
  }, [load, revision]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <FlatList
      data={sales}
      keyExtractor={(item) => String(item.id)}
      contentContainerStyle={[
        styles.list,
        sales.length === 0 && styles.emptyList,
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
      ListHeaderComponent={
        <>
          <Text style={styles.sectionTitle}>Today</Text>
          <View style={styles.statsGrid}>
            <StatCard
              icon="wallet-outline"
              label="Sales"
              value={formatMoney(stats.salesTodayCents)}
              emphasized
            />
            <StatCard
              icon="cube-outline"
              label="Stock units"
              value={String(stats.stockUnits)}
            />
            <StatCard
              icon="pricetags-outline"
              label="Products"
              value={String(stats.productCount)}
            />
            <StatCard
              icon="warning-outline"
              label="Low stock"
              value={String(stats.lowStockCount)}
              warning={stats.lowStockCount > 0}
            />
          </View>
          <Text style={[styles.sectionTitle, styles.historyTitle]}>
            Recent sales
          </Text>
        </>
      }
      renderItem={({ item }) => <SaleRow sale={item} />}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListEmptyComponent={
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Ionicons name="receipt-outline" size={34} color={colors.primary} />
          </View>
          <Text style={styles.emptyTitle}>No sales yet</Text>
          <Text style={styles.emptyText}>
            Completed sales will be stored here on this device.
          </Text>
        </View>
      }
    />
  );
}

function StatCard({
  icon,
  label,
  value,
  emphasized = false,
  warning = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  emphasized?: boolean;
  warning?: boolean;
}) {
  return (
    <View
      style={[
        styles.statCard,
        emphasized && styles.emphasizedCard,
        warning && styles.warningCard,
      ]}
    >
      <Ionicons
        name={icon}
        size={21}
        color={
          emphasized
            ? colors.surface
            : warning
              ? colors.warning
              : colors.primary
        }
      />
      <Text
        style={[
          styles.statValue,
          emphasized && styles.emphasizedText,
          warning && styles.warningText,
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      <Text
        style={[
          styles.statLabel,
          emphasized && styles.emphasizedLabel,
          warning && styles.warningText,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

function SaleRow({ sale }: { sale: Sale }) {
  return (
    <View style={styles.saleRow}>
      <View style={styles.receiptIcon}>
        <Ionicons name="receipt-outline" size={21} color={colors.primary} />
      </View>
      <View style={styles.saleInfo}>
        <Text style={styles.receiptNumber}>{sale.receiptNumber}</Text>
        <Text style={styles.saleMeta}>
          {formatDate(sale.createdAt)} · {sale.itemCount} item
          {sale.itemCount === 1 ? '' : 's'} · {sale.paymentMethod}
        </Text>
      </View>
      <Text style={styles.saleTotal}>{formatMoney(sale.totalCents)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  emptyList: {
    flexGrow: 1,
  },
  sectionTitle: {
    marginBottom: spacing.sm,
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  historyTitle: {
    marginTop: spacing.lg,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statCard: {
    width: '48.5%',
    minHeight: 116,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  emphasizedCard: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  warningCard: {
    borderColor: '#F0D58A',
    backgroundColor: colors.warningSoft,
  },
  statValue: {
    marginTop: spacing.sm,
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  emphasizedText: {
    color: colors.surface,
  },
  warningText: {
    color: colors.warning,
  },
  statLabel: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  emphasizedLabel: {
    color: '#C6DCD2',
  },
  separator: {
    height: spacing.sm,
  },
  saleRow: {
    minHeight: 74,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  receiptIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  saleInfo: {
    flex: 1,
  },
  receiptNumber: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  saleMeta: {
    marginTop: 4,
    color: colors.textMuted,
    fontSize: 11,
    textTransform: 'capitalize',
  },
  saleTotal: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '900',
  },
  empty: {
    flex: 1,
    minHeight: 240,
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
  },
  emptyText: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
});

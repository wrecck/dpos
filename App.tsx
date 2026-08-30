import { Ionicons } from '@expo/vector-icons';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { Suspense, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';

import { migrateDatabase } from './src/database';
import { InventoryScreen } from './src/screens/InventoryScreen';
import { RegisterScreen } from './src/screens/RegisterScreen';
import { SalesScreen } from './src/screens/SalesScreen';
import { colors, spacing } from './src/theme';

type Tab = 'register' | 'inventory' | 'activity';

const tabs: {
  id: Tab;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    id: 'register',
    label: 'Sell',
    icon: 'calculator-outline',
    activeIcon: 'calculator',
  },
  {
    id: 'inventory',
    label: 'Inventory',
    icon: 'cube-outline',
    activeIcon: 'cube',
  },
  {
    id: 'activity',
    label: 'Activity',
    icon: 'bar-chart-outline',
    activeIcon: 'bar-chart',
  },
];

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Suspense fallback={<LoadingScreen />}>
        <SQLiteProvider
          databaseName="dpos.db"
          onInit={migrateDatabase}
          useSuspense
        >
          <AppShell />
        </SQLiteProvider>
      </Suspense>
    </SafeAreaProvider>
  );
}

function AppShell() {
  const [activeTab, setActiveTab] = useState<Tab>('register');
  const [revision, setRevision] = useState(0);

  const dataChanged = () => setRevision((current) => current + 1);
  const title =
    activeTab === 'register'
      ? 'New sale'
      : activeTab === 'inventory'
        ? 'Inventory'
        : 'Business activity';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>DPOS</Text>
          <Text style={styles.title}>{title}</Text>
        </View>
        <View style={styles.offlineBadge}>
          <View style={styles.offlineDot} />
          <Text style={styles.offlineText}>Offline ready</Text>
        </View>
      </View>

      <View style={styles.content}>
        {activeTab === 'register' ? (
          <RegisterScreen
            revision={revision}
            onDataChanged={dataChanged}
            onOpenInventory={() => setActiveTab('inventory')}
          />
        ) : null}
        {activeTab === 'inventory' ? (
          <InventoryScreen
            revision={revision}
            onDataChanged={dataChanged}
          />
        ) : null}
        {activeTab === 'activity' ? (
          <SalesScreen revision={revision} />
        ) : null}
      </View>

      <View style={styles.navigation}>
        {tabs.map((tab) => {
          const selected = activeTab === tab.id;
          return (
            <Pressable
              key={tab.id}
              style={styles.navItem}
              onPress={() => setActiveTab(tab.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
            >
              <Ionicons
                name={selected ? tab.activeIcon : tab.icon}
                size={23}
                color={selected ? colors.primary : colors.textMuted}
              />
              <Text style={[styles.navLabel, selected && styles.navLabelActive]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

function LoadingScreen() {
  return (
    <View style={styles.loading}>
      <View style={styles.loadingMark}>
        <Ionicons name="storefront" size={30} color={colors.surface} />
      </View>
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.loadingText}>Preparing your register…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.primaryDark,
  },
  header: {
    minHeight: 84,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.primaryDark,
  },
  brand: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.7,
  },
  title: {
    marginTop: 2,
    color: colors.surface,
    fontSize: 24,
    fontWeight: '900',
  },
  offlineBadge: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 99,
    backgroundColor: '#174F3C',
  },
  offlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#62D49C',
  },
  offlineText: {
    color: '#C8E8D8',
    fontSize: 11,
    fontWeight: '700',
  },
  content: {
    flex: 1,
    backgroundColor: colors.background,
  },
  navigation: {
    minHeight: Platform.OS === 'android' ? 68 : 76,
    paddingBottom: Platform.OS === 'android' ? 6 : 14,
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  navLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  navLabelActive: {
    color: colors.primary,
    fontWeight: '800',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  loadingMark: {
    width: 64,
    height: 64,
    marginBottom: spacing.sm,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
});

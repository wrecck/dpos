import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { importProductsCsv, previewProductImportCsv } from '../productImport';
import { colors, radius, spacing } from '../theme';
import type { ProductImportPreview } from '../types';
import { formatMoney, getErrorMessage } from '../utils';

type Props = {
  visible: boolean;
  onClose: () => void;
  onImported: () => void;
};

export function ProductImportModal({
  visible,
  onClose,
  onImported,
}: Props) {
  const db = useSQLiteContext();
  const [fileName, setFileName] = useState('');
  const [csvText, setCsvText] = useState('');
  const [preview, setPreview] = useState<ProductImportPreview>();
  const [working, setWorking] = useState(false);

  const close = () => {
    if (working) return;
    setFileName('');
    setCsvText('');
    setPreview(undefined);
    onClose();
  };

  const chooseFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'text/plain'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      const text = await new File(asset.uri).text();
      setFileName(asset.name);
      setCsvText(text);
      setPreview(previewProductImportCsv(text));
    } catch (error) {
      Alert.alert('Could not read CSV', getErrorMessage(error));
    }
  };

  const runImport = async () => {
    if (!preview || preview.issues.some((issue) => issue.severity === 'error')) {
      return;
    }
    setWorking(true);
    try {
      const result = await importProductsCsv(db, csvText);
      onImported();
      Alert.alert(
        'Import complete',
        `${result.variantCount} variants across ${result.parentCount} products were processed.\n${result.openingStockUnits} opening stock units were added for new SKUs.`,
        [{ text: 'Done', onPress: close }],
      );
    } catch (error) {
      Alert.alert('Import failed', getErrorMessage(error));
    } finally {
      setWorking(false);
    }
  };

  const errors =
    preview?.issues.filter((issue) => issue.severity === 'error').length ?? 0;
  const warnings =
    preview?.issues.filter((issue) => issue.severity === 'warning').length ?? 0;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={close} hitSlop={12}>
            <Text style={styles.cancel}>Close</Text>
          </Pressable>
          <Text style={styles.title}>Import products</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.infoCard}>
            <Ionicons name="document-text-outline" size={28} color={colors.primary} />
            <View style={styles.infoText}>
              <Text style={styles.infoTitle}>DPOS product CSV</Text>
              <Text style={styles.infoBody}>
                One row per sellable variant. Existing SKUs update catalog data;
                opening stock is only applied to new SKUs.
              </Text>
            </View>
          </View>

          <Pressable style={styles.fileButton} onPress={chooseFile} disabled={working}>
            <Ionicons name="folder-open-outline" size={21} color={colors.surface} />
            <Text style={styles.fileButtonText}>
              {fileName ? 'Choose another CSV' : 'Choose CSV file'}
            </Text>
          </Pressable>

          {fileName ? (
            <View style={styles.fileRow}>
              <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              <Text style={styles.fileName} numberOfLines={1}>{fileName}</Text>
            </View>
          ) : null}

          {preview ? (
            <>
              <Text style={styles.sectionTitle}>Preview</Text>
              <View style={styles.metrics}>
                <Metric label="Rows" value={String(preview.rows.length)} />
                <Metric label="Products" value={String(preview.parentCount)} />
                <Metric label="Suppliers" value={String(preview.supplierCount)} />
                <Metric label="Locations" value={String(preview.locationCount)} />
              </View>
              <View style={styles.valueCard}>
                <Text style={styles.valueLabel}>Calculated opening inventory value</Text>
                <Text style={styles.value}>
                  {formatMoney(preview.calculatedInventoryValueCents)}
                </Text>
              </View>

              <View
                style={[
                  styles.validationCard,
                  errors > 0 ? styles.validationError : styles.validationSuccess,
                ]}
              >
                <Ionicons
                  name={errors > 0 ? 'alert-circle' : 'checkmark-circle'}
                  size={22}
                  color={errors > 0 ? colors.danger : colors.success}
                />
                <Text style={styles.validationText}>
                  {errors > 0
                    ? `${errors} error${errors === 1 ? '' : 's'} must be fixed`
                    : `${preview.validRowCount} rows ready`}
                  {warnings ? ` · ${warnings} warnings` : ''}
                </Text>
              </View>

              {preview.issues.slice(0, 20).map((issue, index) => (
                <View key={`${issue.row}-${issue.field}-${index}`} style={styles.issue}>
                  <Text style={styles.issueLocation}>
                    Row {issue.row}{issue.field ? ` · ${issue.field}` : ''}
                  </Text>
                  <Text style={styles.issueMessage}>{issue.message}</Text>
                </View>
              ))}
              {preview.issues.length > 20 ? (
                <Text style={styles.moreIssues}>
                  And {preview.issues.length - 20} more issues…
                </Text>
              ) : null}
            </>
          ) : null}
        </ScrollView>

        {preview ? (
          <View style={styles.footer}>
            <Pressable
              style={[styles.importButton, (errors > 0 || working) && styles.disabled]}
              onPress={runImport}
              disabled={errors > 0 || working}
            >
              {working ? (
                <ActivityIndicator color={colors.surface} />
              ) : (
                <Ionicons name="cloud-upload-outline" size={21} color={colors.surface} />
              )}
              <Text style={styles.importText}>
                {working ? 'Importing…' : `Import ${preview.rows.length} variants`}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
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
  cancel: { color: colors.primary, fontSize: 16, fontWeight: '700' },
  title: { color: colors.text, fontSize: 18, fontWeight: '800' },
  headerSpacer: { width: 42 },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  infoCard: {
    padding: spacing.md,
    flexDirection: 'row',
    gap: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  infoText: { flex: 1 },
  infoTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  infoBody: { marginTop: 4, color: colors.textMuted, lineHeight: 20 },
  fileButton: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  fileButtonText: { color: colors.surface, fontSize: 15, fontWeight: '800' },
  fileRow: {
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  fileName: { flex: 1, color: colors.text, fontWeight: '700' },
  sectionTitle: { marginTop: spacing.sm, color: colors.text, fontSize: 17, fontWeight: '900' },
  metrics: { flexDirection: 'row', gap: spacing.sm },
  metric: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  metricValue: { color: colors.primaryDark, fontSize: 20, fontWeight: '900' },
  metricLabel: { marginTop: 3, color: colors.textMuted, fontSize: 11 },
  valueCard: {
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.md,
    backgroundColor: colors.primaryDark,
  },
  valueLabel: { flex: 1, color: '#C8E8D8', fontSize: 13 },
  value: { color: colors.surface, fontSize: 18, fontWeight: '900' },
  validationCard: {
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
  },
  validationError: { backgroundColor: colors.dangerSoft },
  validationSuccess: { backgroundColor: colors.surfaceMuted },
  validationText: { flex: 1, color: colors.text, fontWeight: '800' },
  issue: {
    padding: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.danger,
    backgroundColor: colors.surface,
  },
  issueLocation: { color: colors.danger, fontSize: 12, fontWeight: '800' },
  issueMessage: { marginTop: 3, color: colors.text, lineHeight: 19 },
  moreIssues: { color: colors.textMuted, textAlign: 'center' },
  footer: {
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  importButton: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  importText: { color: colors.surface, fontSize: 16, fontWeight: '800' },
  disabled: { opacity: 0.5 },
});

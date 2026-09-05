import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File as ExpoFile, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  getProductImportRun,
  listProductImportRuns,
} from '../database';
import {
  executeProductPackageImport,
  importableRows,
  loadProductImportPackage,
  type LoadedProductPackage,
} from '../productPackageImport';
import { colors, radius, spacing } from '../theme';
import type {
  ProductImportMode,
  ProductImportRun,
  ProductImportRunSummary,
} from '../types';
import { formatMoney, getErrorMessage } from '../utils';

type Props = {
  visible: boolean;
  onClose: () => void;
  onImported: () => void;
};

type Page = 'package' | 'history' | 'report';

export function ProductImportModal({
  visible,
  onClose,
  onImported,
}: Props) {
  const db = useSQLiteContext();
  const [page, setPage] = useState<Page>('package');
  const [loaded, setLoaded] = useState<LoadedProductPackage>();
  const [mode, setMode] = useState<ProductImportMode>('strict');
  const [progress, setProgress] = useState('');
  const [working, setWorking] = useState(false);
  const [importError, setImportError] = useState('');
  const [history, setHistory] = useState<ProductImportRunSummary[]>([]);
  const [report, setReport] = useState<ProductImportRun>();

  const refreshHistory = async () => {
    setHistory(await listProductImportRuns(db, 50));
  };

  useEffect(() => {
    if (visible) {
      refreshHistory().catch(() => undefined);
    }
  }, [db, visible]);

  const close = () => {
    if (working) return;
    setPage('package');
    setLoaded(undefined);
    setMode('strict');
    setProgress('');
    setImportError('');
    setReport(undefined);
    onClose();
  };

  const choosePackage = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/zip', 'application/x-zip-compressed'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      setWorking(true);
      setLoaded(undefined);
      setImportError('');
      setProgress('Reading ZIP package…');
      const bytes =
        Platform.OS === 'web' && asset.file
          ? new Uint8Array(await asset.file.arrayBuffer())
          : await new ExpoFile(asset.uri).bytes();
      const next = await loadProductImportPackage(
        db,
        asset.name,
        bytes,
        setProgress,
      );
      setLoaded(next);
      setProgress('');
    } catch (error) {
      const message = getErrorMessage(error);
      setImportError(message);
      Alert.alert('Could not open package', message);
    } finally {
      setWorking(false);
    }
  };

  const rowsToImport = useMemo(
    () => (loaded ? importableRows(loaded, mode) : []),
    [loaded, mode],
  );
  const errors =
    loaded?.issues.filter((item) => item.severity === 'error').length ?? 0;
  const warnings =
    loaded?.issues.filter((item) => item.severity === 'warning').length ?? 0;

  const runImport = async () => {
    if (!loaded) return;
    setWorking(true);
    setImportError('');
    try {
      const outcome = await executeProductPackageImport(
        db,
        loaded,
        mode,
        setProgress,
      );
      onImported();
      await refreshHistory();
      const nextReport = await getProductImportRun(db, outcome.runId);
      if (nextReport) {
        setReport(nextReport);
        setPage('report');
      }
      setLoaded(undefined);
      setProgress('');
    } catch (error) {
      const message = getErrorMessage(error);
      setImportError(message);
      setProgress('');
      await refreshHistory().catch(() => undefined);
      Alert.alert('Import failed', message);
    } finally {
      setWorking(false);
    }
  };

  const openReport = async (id: number) => {
    setWorking(true);
    try {
      const next = await getProductImportRun(db, id);
      if (next) {
        setReport(next);
        setPage('report');
      }
    } catch (error) {
      Alert.alert('Could not open report', getErrorMessage(error));
    } finally {
      setWorking(false);
    }
  };

  const exportReport = async () => {
    if (!report) return;
    const csv = reportCsv(report);
    try {
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `dpos-import-report-${report.id}.csv`;
        anchor.click();
        URL.revokeObjectURL(url);
      } else {
        const file = new ExpoFile(
          Paths.cache,
          `dpos-import-report-${report.id}.csv`,
        );
        file.create({ overwrite: true, intermediates: true });
        file.write(csv);
        if (!(await Sharing.isAvailableAsync())) {
          throw new Error('File sharing is unavailable on this device.');
        }
        await Sharing.shareAsync(file.uri, {
          mimeType: 'text/csv',
          dialogTitle: 'Export DPOS import report',
        });
      }
    } catch (error) {
      Alert.alert('Could not export report', getErrorMessage(error));
    }
  };

  const title =
    page === 'history'
      ? 'Import history'
      : page === 'report'
        ? `Import report #${report?.id ?? ''}`
        : 'Import products';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable
            onPress={() => {
              if (page === 'package') close();
              else setPage(page === 'report' ? 'history' : 'package');
            }}
            hitSlop={12}
          >
            <Text style={styles.cancel}>{page === 'package' ? 'Close' : 'Back'}</Text>
          </Pressable>
          <Text style={styles.title}>{title}</Text>
          {page === 'package' ? (
            <Pressable onPress={() => setPage('history')} hitSlop={12}>
              <Ionicons name="time-outline" size={23} color={colors.primary} />
            </Pressable>
          ) : page === 'report' ? (
            <Pressable onPress={exportReport} hitSlop={12}>
              <Ionicons name="share-outline" size={23} color={colors.primary} />
            </Pressable>
          ) : (
            <View style={styles.headerSpacer} />
          )}
        </View>

        {page === 'package' ? (
          <PackagePage
            loaded={loaded}
            mode={mode}
            setMode={setMode}
            rowsToImport={rowsToImport.length}
            errors={errors}
            warnings={warnings}
            working={working}
            progress={progress}
            importError={importError}
            choosePackage={choosePackage}
            runImport={runImport}
          />
        ) : null}
        {page === 'history' ? (
          <HistoryPage
            history={history}
            working={working}
            onOpen={openReport}
          />
        ) : null}
        {page === 'report' && report ? (
          <ReportPage report={report} onExport={exportReport} />
        ) : null}
      </View>
    </Modal>
  );
}

function PackagePage({
  loaded,
  mode,
  setMode,
  rowsToImport,
  errors,
  warnings,
  working,
  progress,
  importError,
  choosePackage,
  runImport,
}: {
  loaded?: LoadedProductPackage;
  mode: ProductImportMode;
  setMode: (mode: ProductImportMode) => void;
  rowsToImport: number;
  errors: number;
  warnings: number;
  working: boolean;
  progress: string;
  importError: string;
  choosePackage: () => void;
  runImport: () => void;
}) {
  return (
    <>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.infoCard}>
          <Ionicons name="archive-outline" size={28} color={colors.primary} />
          <View style={styles.infoText}>
            <Text style={styles.infoTitle}>DPOS ZIP package</Text>
            <Text style={styles.infoBody}>
              Include manifest.json, dpos-products-import.csv and an images folder.
              The package is validated before anything is imported.
            </Text>
          </View>
        </View>
        <Pressable
          style={styles.fileButton}
          onPress={choosePackage}
          disabled={working}
        >
          <Ionicons name="folder-open-outline" size={21} color={colors.surface} />
          <Text style={styles.fileButtonText}>
            {loaded ? 'Choose another ZIP' : 'Choose ZIP package'}
          </Text>
        </Pressable>

        {working && !loaded ? (
          <View style={styles.progressCard}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.progressText}>{progress || 'Validating…'}</Text>
          </View>
        ) : null}

        {loaded ? (
          <>
            <View style={styles.fileRow}>
              <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              <View style={styles.fileDetails}>
                <Text style={styles.fileName} numberOfLines={1}>
                  {loaded.sourceFilename}
                </Text>
                <Text style={styles.fileMeta}>
                  Format v{loaded.manifest.version} · {loaded.sourceHash.slice(0, 12)}
                </Text>
              </View>
            </View>
            <Text style={styles.sectionTitle}>Package preview</Text>
            <View style={styles.metrics}>
              <Metric label="CSV rows" value={String(loaded.preview.rows.length)} />
              <Metric label="Products" value={String(loaded.preview.parentCount)} />
              <Metric label="Images" value={String(loaded.referencedImageCount)} />
              <Metric label="Locations" value={String(loaded.preview.locationCount)} />
            </View>
            <View style={styles.valueCard}>
              <Text style={styles.valueLabel}>Opening inventory value</Text>
              <Text style={styles.value}>
                {formatMoney(loaded.preview.calculatedInventoryValueCents)}
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
                {errors} errors · {warnings} warnings
              </Text>
            </View>

            <Text style={styles.sectionTitle}>Import mode</Text>
            <View style={styles.modeOptions}>
              <ModeButton
                label="Strict"
                help="Import nothing when any error exists."
                selected={mode === 'strict'}
                onPress={() => setMode('strict')}
              />
              <ModeButton
                label="Valid rows only"
                help="Skip invalid variants and report each reason."
                selected={mode === 'valid_rows'}
                onPress={() => setMode('valid_rows')}
              />
            </View>

            {loaded.issues.length ? (
              <>
                <Text style={styles.sectionTitle}>Validation report</Text>
                {loaded.issues.slice(0, 50).map((item, index) => (
                  <IssueRow
                    key={`${item.code}-${item.rowNumber}-${index}`}
                    severity={item.severity}
                    title={
                      item.rowNumber
                        ? `Row ${item.rowNumber}${item.sku ? ` · ${item.sku}` : ''}`
                        : 'Package'
                    }
                    message={item.message}
                  />
                ))}
                {loaded.issues.length > 50 ? (
                  <Text style={styles.moreIssues}>
                    {loaded.issues.length - 50} more issues will be saved in the report.
                  </Text>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      {loaded ? (
        <View style={styles.footer}>
          {importError ? (
            <View style={styles.importError}>
              <Ionicons name="alert-circle" size={19} color={colors.danger} />
              <Text style={styles.importErrorText}>{importError}</Text>
            </View>
          ) : null}
          {working ? (
            <Text style={styles.footerProgress}>{progress || 'Importing…'}</Text>
          ) : null}
          <Pressable
            style={[
              styles.importButton,
              working && styles.disabled,
            ]}
            onPress={runImport}
            disabled={working}
          >
            {working ? (
              <ActivityIndicator color={colors.surface} />
            ) : (
              <Ionicons name="archive-outline" size={21} color={colors.surface} />
            )}
            <Text style={styles.importText}>
              {working
                ? 'Importing package…'
                : rowsToImport === 0
                  ? 'Record validation failure'
                  : `Import ${rowsToImport} variant${rowsToImport === 1 ? '' : 's'}`}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

function HistoryPage({
  history,
  working,
  onOpen,
}: {
  history: ProductImportRunSummary[];
  working: boolean;
  onOpen: (id: number) => void;
}) {
  if (working && history.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {history.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="document-text-outline" size={38} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No import reports yet</Text>
          <Text style={styles.emptyText}>
            Completed and failed package imports will appear here.
          </Text>
        </View>
      ) : (
        history.map((item) => (
          <Pressable
            key={item.id}
            style={styles.historyCard}
            onPress={() => onOpen(item.id)}
          >
            <View style={styles.historyTop}>
              <View style={styles.historyNameBlock}>
                <Text style={styles.historyName} numberOfLines={1}>
                  {item.sourceFilename}
                </Text>
                <Text style={styles.historyDate}>
                  {new Date(item.completedAt).toLocaleString()}
                </Text>
              </View>
              <View
                style={[
                  styles.statusBadge,
                  item.status === 'completed'
                    ? styles.statusCompleted
                    : styles.statusFailed,
                ]}
              >
                <Text style={styles.statusText}>{item.status}</Text>
              </View>
            </View>
            <Text style={styles.historyCounts}>
              {item.variantsAdded} added · {item.variantsUpdated} updated ·{' '}
              {item.variantsSkipped} skipped · {item.errorCount} errors
            </Text>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

function ReportPage({
  report,
  onExport,
}: {
  report: ProductImportRun;
  onExport: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.reportHero}>
        <Ionicons
          name={report.status === 'completed' ? 'checkmark-circle' : 'alert-circle'}
          size={32}
          color={report.status === 'completed' ? colors.success : colors.danger}
        />
        <View style={styles.reportHeroText}>
          <Text style={styles.reportTitle}>
            Import {report.status}
          </Text>
          <Text style={styles.reportSubtitle}>{report.sourceFilename}</Text>
        </View>
      </View>
      <View style={styles.metrics}>
        <Metric label="Added" value={String(report.variantsAdded)} />
        <Metric label="Updated" value={String(report.variantsUpdated)} />
        <Metric label="Skipped" value={String(report.variantsSkipped)} />
        <Metric label="Images" value={String(report.imagesImported)} />
      </View>
      <View style={styles.reportDetails}>
        <Detail label="Mode" value={report.importMode === 'strict' ? 'Strict' : 'Valid rows'} />
        <Detail label="Parent products" value={String(report.parentProductCount)} />
        <Detail label="Images missing" value={String(report.imagesMissing)} />
        <Detail label="Warnings" value={String(report.warningCount)} />
        <Detail label="Errors" value={String(report.errorCount)} />
        <Detail label="Completed" value={new Date(report.completedAt).toLocaleString()} />
      </View>
      <Pressable style={styles.exportButton} onPress={onExport}>
        <Ionicons name="share-outline" size={20} color={colors.primary} />
        <Text style={styles.exportText}>Export report CSV</Text>
      </Pressable>
      <Text style={styles.sectionTitle}>Skipped rows and warnings</Text>
      {report.issues.length === 0 ? (
        <Text style={styles.noIssues}>No issues were recorded.</Text>
      ) : (
        report.issues.map((item) => (
          <IssueRow
            key={item.id}
            severity={item.severity}
            title={
              item.rowNumber
                ? `Row ${item.rowNumber}${item.sku ? ` · ${item.sku}` : ''}`
                : 'Package'
            }
            message={item.message}
          />
        ))
      )}
    </ScrollView>
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

function ModeButton({
  label,
  help,
  selected,
  onPress,
}: {
  label: string;
  help: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.modeButton, selected && styles.modeSelected]}
      onPress={onPress}
    >
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={20}
        color={colors.primary}
      />
      <View style={styles.modeTextBlock}>
        <Text style={styles.modeLabel}>{label}</Text>
        <Text style={styles.modeHelp}>{help}</Text>
      </View>
    </Pressable>
  );
}

function IssueRow({
  severity,
  title,
  message,
}: {
  severity: 'warning' | 'error';
  title: string;
  message: string;
}) {
  return (
    <View
      style={[
        styles.issue,
        severity === 'warning' && styles.issueWarning,
      ]}
    >
      <Text
        style={[
          styles.issueLocation,
          severity === 'warning' && styles.issueLocationWarning,
        ]}
      >
        {title}
      </Text>
      <Text style={styles.issueMessage}>{message}</Text>
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function reportCsv(report: ProductImportRun): string {
  const rows = [
    ['Report ID', report.id],
    ['Source file', report.sourceFilename],
    ['Source SHA-256', report.sourceHash],
    ['Status', report.status],
    ['Mode', report.importMode],
    ['Total CSV rows', report.totalCsvRows],
    ['Parent products', report.parentProductCount],
    ['Variants added', report.variantsAdded],
    ['Variants updated', report.variantsUpdated],
    ['Variants skipped', report.variantsSkipped],
    ['Images imported', report.imagesImported],
    ['Images missing', report.imagesMissing],
    ['Warnings', report.warningCount],
    ['Errors', report.errorCount],
    ['Started at', report.startedAt],
    ['Completed at', report.completedAt],
  ]
    .map((row) => row.map(csvCell).join(','))
    .join('\n');
  const issues = report.issues
    .map((item) =>
      [
        item.rowNumber,
        item.sku,
        item.severity,
        item.code,
        item.message,
      ]
        .map(csvCell)
        .join(','),
    )
    .join('\n');
  return `${rows}\n\n"Row","SKU","Severity","Code","Reason"\n${issues}\n`;
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
  headerSpacer: { width: 23 },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  progressCard: {
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  progressText: { color: colors.text, fontWeight: '700' },
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
  fileDetails: { flex: 1 },
  fileName: { color: colors.text, fontWeight: '800' },
  fileMeta: { marginTop: 3, color: colors.textMuted, fontSize: 11 },
  sectionTitle: {
    marginTop: spacing.sm,
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
  },
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
  metricLabel: { marginTop: 3, color: colors.textMuted, fontSize: 10 },
  valueCard: {
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.md,
    backgroundColor: colors.primaryDark,
  },
  valueLabel: { color: '#C8E8D8', fontSize: 13 },
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
  validationText: { color: colors.text, fontWeight: '800' },
  modeOptions: { gap: spacing.sm },
  modeButton: {
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  modeSelected: { borderColor: colors.primary, backgroundColor: colors.surfaceMuted },
  modeTextBlock: { flex: 1 },
  modeLabel: { color: colors.text, fontWeight: '800' },
  modeHelp: { marginTop: 2, color: colors.textMuted, fontSize: 12 },
  issue: {
    padding: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.danger,
    backgroundColor: colors.surface,
  },
  issueWarning: { borderLeftColor: colors.warning },
  issueLocation: { color: colors.danger, fontSize: 12, fontWeight: '800' },
  issueLocationWarning: { color: colors.warning },
  issueMessage: { marginTop: 3, color: colors.text, lineHeight: 19 },
  moreIssues: { color: colors.textMuted, textAlign: 'center' },
  footer: {
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  footerProgress: {
    marginBottom: spacing.sm,
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
  importError: {
    marginBottom: spacing.sm,
    padding: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.dangerSoft,
  },
  importErrorText: { flex: 1, color: colors.danger, fontSize: 12, fontWeight: '700' },
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
  empty: { paddingVertical: 80, alignItems: 'center' },
  emptyTitle: { marginTop: spacing.md, color: colors.text, fontSize: 18, fontWeight: '800' },
  emptyText: { marginTop: spacing.sm, color: colors.textMuted, textAlign: 'center' },
  historyCard: {
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  historyTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  historyNameBlock: { flex: 1 },
  historyName: { color: colors.text, fontSize: 15, fontWeight: '800' },
  historyDate: { marginTop: 3, color: colors.textMuted, fontSize: 11 },
  statusBadge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 99 },
  statusCompleted: { backgroundColor: colors.surfaceMuted },
  statusFailed: { backgroundColor: colors.dangerSoft },
  statusText: { color: colors.text, fontSize: 11, fontWeight: '800', textTransform: 'capitalize' },
  historyCounts: { color: colors.textMuted, fontSize: 12 },
  reportHero: {
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  reportHeroText: { flex: 1 },
  reportTitle: { color: colors.text, fontSize: 20, fontWeight: '900', textTransform: 'capitalize' },
  reportSubtitle: { marginTop: 3, color: colors.textMuted },
  reportDetails: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  detailRow: {
    padding: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  detailLabel: { color: colors.textMuted },
  detailValue: { color: colors.text, fontWeight: '800' },
  exportButton: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  exportText: { color: colors.primary, fontWeight: '800' },
  noIssues: { color: colors.textMuted, textAlign: 'center' },
});

import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import JSZip, { type JSZipObject } from 'jszip';
import { Platform } from 'react-native';

import {
  saveFailedProductImportRun,
  saveProductImportReport,
} from './database';
import {
  importProductRows,
  previewProductImportCsv,
  validateProductImportDatabaseConflicts,
} from './productImport';
import type {
  ProductImportMode,
  ProductImportPreview,
  ProductImportReportIssueInput,
  ProductImportResult,
  ProductImportRow,
} from './types';

const PACKAGE_FORMAT = 'dpos-product-import';
const SUPPORTED_VERSION = 1;
const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_CSV_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_ENTRY_COUNT = 20000;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 600 * 1024 * 1024;
const ALLOWED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

export type ProductPackageManifest = {
  format: typeof PACKAGE_FORMAT;
  version: number;
  createdAt?: string;
  productsFile: string;
  imagesDirectory: string;
};

export type ProductPackageIssue = ProductImportReportIssueInput & {
  field?: string;
};

export type LoadedProductPackage = {
  sourceFilename: string;
  sourceHash: string;
  manifest: ProductPackageManifest;
  preview: ProductImportPreview;
  issues: ProductPackageIssue[];
  archive: JSZip;
  imagesByFilename: Map<string, JSZipObject>;
  referencedImageCount: number;
};

export type ProductPackageImportOutcome = {
  runId: number;
  result: ProductImportResult;
  skippedCount: number;
  imagesImported: number;
  imagesMissing: number;
};

type LoadProgress = (message: string) => void;

function issue(
  severity: 'warning' | 'error',
  code: string,
  message: string,
  rowNumber: number | null = null,
  sku: string | null = null,
  field?: string,
): ProductPackageIssue {
  return { severity, code, message, rowNumber, sku, field };
}

function normalizedArchivePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
}

function unsafeEntryName(entry: JSZipObject): string {
  return String(
    (entry as JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ??
      entry.name,
  );
}

function extension(value: string): string {
  return value.split('.').pop()?.toLowerCase() ?? '';
}

function uncompressedSize(entry: JSZipObject): number {
  const internal = entry as JSZipObject & {
    _data?: { uncompressedSize?: number };
  };
  return Number(internal._data?.uncompressedSize ?? 0);
}

function isSymlink(entry: JSZipObject): boolean {
  const permissions = entry.unixPermissions;
  const mode =
    typeof permissions === 'string' ? Number.parseInt(permissions, 8) : permissions;
  return typeof mode === 'number' && (mode & 0o170000) === 0o120000;
}

function validateEntryPath(entry: JSZipObject): ProductPackageIssue | null {
  const original = unsafeEntryName(entry);
  const parts = original.replace(/\\/g, '/').split('/');
  if (
    original.startsWith('/') ||
    original.includes('\\') ||
    parts.some((part) => part === '..') ||
    /^[A-Za-z]:/.test(original) ||
    isSymlink(entry)
  ) {
    return issue(
      'error',
      'unsafe_archive_entry',
      `Unsafe ZIP entry is not allowed: ${original}`,
    );
  }
  return null;
}

function parseManifest(text: string, issues: ProductPackageIssue[]) {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    issues.push(issue('error', 'invalid_manifest', 'manifest.json is not valid JSON.'));
    return null;
  }
  if (!raw || typeof raw !== 'object') {
    issues.push(issue('error', 'invalid_manifest', 'manifest.json must contain an object.'));
    return null;
  }
  const value = raw as Record<string, unknown>;
  if (value.format !== PACKAGE_FORMAT) {
    issues.push(
      issue(
        'error',
        'unsupported_package_format',
        `Manifest format must be "${PACKAGE_FORMAT}".`,
      ),
    );
  }
  if (value.version !== SUPPORTED_VERSION) {
    issues.push(
      issue(
        'error',
        'unsupported_package_version',
        `Package version ${String(value.version)} is unsupported; expected ${SUPPORTED_VERSION}.`,
      ),
    );
  }
  const productsFile =
    typeof value.productsFile === 'string'
      ? normalizedArchivePath(value.productsFile)
      : '';
  const imagesDirectory =
    typeof value.imagesDirectory === 'string'
      ? normalizedArchivePath(value.imagesDirectory)
      : '';
  if (!productsFile || productsFile.includes('/')) {
    issues.push(
      issue(
        'error',
        'invalid_products_path',
        'Manifest productsFile must name a CSV at the ZIP root.',
      ),
    );
  }
  if (!imagesDirectory || imagesDirectory.includes('/')) {
    issues.push(
      issue(
        'error',
        'invalid_images_path',
        'Manifest imagesDirectory must name one root-level directory.',
      ),
    );
  }
  if (issues.some((item) => item.severity === 'error')) return null;
  return {
    format: PACKAGE_FORMAT,
    version: SUPPORTED_VERSION,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : undefined,
    productsFile,
    imagesDirectory,
  } satisfies ProductPackageManifest;
}

function validImageMagic(bytes: Uint8Array, ext: string): boolean {
  if (ext === 'png') {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    );
  }
  if (ext === 'jpg' || ext === 'jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
  }
  if (ext === 'webp') {
    return (
      bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
    );
  }
  return false;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const stableBytes = new Uint8Array(bytes.byteLength);
  stableBytes.set(bytes);
  const digest = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    stableBytes.buffer,
  );
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export async function loadProductImportPackage(
  db: SQLiteDatabase,
  sourceFilename: string,
  bytes: Uint8Array,
  onProgress?: LoadProgress,
): Promise<LoadedProductPackage> {
  const issues: ProductPackageIssue[] = [];
  if (!sourceFilename.toLowerCase().endsWith('.zip')) {
    issues.push(issue('error', 'invalid_file_type', 'Choose a .zip import package.'));
  }
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    issues.push(
      issue('error', 'archive_too_large', 'ZIP package exceeds the 250 MB limit.'),
    );
  }
  onProgress?.('Checking package integrity…');
  const sourceHash = await sha256(bytes);
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
  } catch {
    throw new Error('The selected file is not a readable ZIP package.');
  }
  const entries = Object.values(archive.files);
  if (entries.length > MAX_ENTRY_COUNT) {
    issues.push(
      issue(
        'error',
        'too_many_archive_entries',
        `ZIP contains ${entries.length} entries; maximum is ${MAX_ENTRY_COUNT}.`,
      ),
    );
  }
  let totalSize = 0;
  for (const entry of entries) {
    const pathIssue = validateEntryPath(entry);
    if (pathIssue) issues.push(pathIssue);
    totalSize += uncompressedSize(entry);
  }
  if (totalSize > MAX_TOTAL_UNCOMPRESSED_BYTES) {
    issues.push(
      issue(
        'error',
        'archive_expands_too_large',
        'ZIP expands beyond the 600 MB safety limit.',
      ),
    );
  }

  const manifestEntry = archive.file('manifest.json');
  if (!manifestEntry) {
    throw new Error('The ZIP must contain manifest.json at its root.');
  }
  if (uncompressedSize(manifestEntry) > MAX_MANIFEST_BYTES) {
    throw new Error('manifest.json exceeds the 1 MB safety limit.');
  }
  const manifestText = await manifestEntry.async('text');
  if (new TextEncoder().encode(manifestText).byteLength > MAX_MANIFEST_BYTES) {
    throw new Error('manifest.json exceeds the 1 MB safety limit.');
  }
  const manifest = parseManifest(manifestText, issues);
  if (!manifest) {
    return {
      sourceFilename,
      sourceHash,
      manifest: {
        format: PACKAGE_FORMAT,
        version: SUPPORTED_VERSION,
        productsFile: 'dpos-products-import.csv',
        imagesDirectory: 'images',
      },
      preview: previewProductImportCsv(''),
      issues,
      archive,
      imagesByFilename: new Map(),
      referencedImageCount: 0,
    };
  }

  onProgress?.('Validating product CSV…');
  const csvEntry = archive.file(manifest.productsFile);
  if (!csvEntry) {
    throw new Error(`The ZIP is missing ${manifest.productsFile}.`);
  }
  if (uncompressedSize(csvEntry) > MAX_CSV_BYTES) {
    throw new Error('Product CSV exceeds the 25 MB safety limit.');
  }
  const csvText = await csvEntry.async('text');
  if (new TextEncoder().encode(csvText).byteLength > MAX_CSV_BYTES) {
    issues.push(
      issue('error', 'csv_too_large', 'Product CSV exceeds the 25 MB limit.'),
    );
  }
  const preview = previewProductImportCsv(csvText);
  issues.push(
    ...preview.issues.map((item) =>
      issue(
        item.severity,
        'csv_validation',
        `${item.field ? `${item.field}: ` : ''}${item.message}`,
        item.row,
        preview.rows.find((row) => row.rowNumber === item.row)?.sku ?? null,
        item.field,
      ),
    ),
  );
  const databaseIssues = await validateProductImportDatabaseConflicts(
    db,
    preview.rows,
  );
  issues.push(
    ...databaseIssues.map((item) =>
      issue(
        item.severity,
        'database_conflict',
        item.message,
        item.row,
        preview.rows.find((row) => row.rowNumber === item.row)?.sku ?? null,
        item.field,
      ),
    ),
  );

  onProgress?.('Matching product images…');
  const imagePrefix = `${manifest.imagesDirectory}/`;
  const imagesByFilename = new Map<string, JSZipObject>();
  for (const entry of entries) {
    if (entry.dir || !entry.name.startsWith(imagePrefix)) continue;
    const relative = entry.name.slice(imagePrefix.length);
    if (!relative || relative.includes('/')) {
      issues.push(
        issue(
          'warning',
          'nested_image_ignored',
          `Nested image is ignored: ${entry.name}`,
        ),
      );
      continue;
    }
    const key = relative.toLowerCase();
    if (imagesByFilename.has(key)) {
      issues.push(
        issue(
          'error',
          'duplicate_image_filename',
          `Image filenames must be unique ignoring case: ${relative}`,
        ),
      );
      continue;
    }
    imagesByFilename.set(key, entry);
  }

  const referenced = new Set<string>();
  for (const row of preview.rows) {
    if (!row.imageFilename) continue;
    const key = row.imageFilename.toLowerCase();
    referenced.add(key);
    const entry = imagesByFilename.get(key);
    if (!entry) {
      issues.push(
        issue(
          'warning',
          'missing_image',
          `Image not found in ${manifest.imagesDirectory}/: ${row.imageFilename}`,
          row.rowNumber,
          row.sku,
          'Image Filename',
        ),
      );
      continue;
    }
    const ext = extension(row.imageFilename);
    if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
      issues.push(
        issue(
          'error',
          'unsupported_image_type',
          `Unsupported image type for ${row.imageFilename}; use JPG, PNG, or WebP.`,
          row.rowNumber,
          row.sku,
          'Image Filename',
        ),
      );
      continue;
    }
    if (uncompressedSize(entry) > MAX_IMAGE_BYTES) {
      issues.push(
        issue(
          'error',
          'image_too_large',
          `${row.imageFilename} exceeds the 12 MB image limit.`,
          row.rowNumber,
          row.sku,
          'Image Filename',
        ),
      );
      continue;
    }
    const imageBytes = await entry.async('uint8array');
    if (imageBytes.byteLength > MAX_IMAGE_BYTES) {
      issues.push(
        issue(
          'error',
          'image_too_large',
          `${row.imageFilename} exceeds the 12 MB image limit.`,
          row.rowNumber,
          row.sku,
          'Image Filename',
        ),
      );
      continue;
    }
    if (!validImageMagic(imageBytes.slice(0, 16), ext)) {
      issues.push(
        issue(
          'error',
          'invalid_image_content',
          `${row.imageFilename} does not match its image extension.`,
          row.rowNumber,
          row.sku,
          'Image Filename',
        ),
      );
    }
  }
  for (const [key, entry] of imagesByFilename) {
    if (!referenced.has(key)) {
      issues.push(
        issue(
          'warning',
          'unreferenced_image',
          `Unused image is ignored: ${entry.name.slice(imagePrefix.length)}`,
        ),
      );
    }
  }
  return {
    sourceFilename,
    sourceHash,
    manifest,
    preview,
    issues,
    archive,
    imagesByFilename,
    referencedImageCount: referenced.size,
  };
}

function mimeType(filename: string): string {
  const ext = extension(filename);
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function safeFilename(filename: string): string {
  return filename.replace(/[^A-Za-z0-9._-]/g, '-').slice(-120);
}

async function persistImages(
  loaded: LoadedProductPackage,
  rows: ProductImportRow[],
  onProgress?: LoadProgress,
): Promise<{ rows: ProductImportRow[]; files: File[]; imageCount: number }> {
  const files: File[] = [];
  const uris = new Map<string, string>();
  const needed = new Set(
    rows.map((row) => row.imageFilename?.toLowerCase()).filter(Boolean) as string[],
  );
  let completed = 0;
  const directory =
    Platform.OS === 'web'
      ? null
      : new Directory(Paths.document, 'product-images', 'package-imports');
  directory?.create({ idempotent: true, intermediates: true });
  for (const key of needed) {
    const entry = loaded.imagesByFilename.get(key);
    if (!entry) continue;
    completed += 1;
    onProgress?.(`Saving image ${completed} of ${needed.size}…`);
    if (Platform.OS === 'web') {
      const base64 = await entry.async('base64');
      uris.set(key, `data:${mimeType(key)};base64,${base64}`);
    } else {
      const bytes = await entry.async('uint8array');
      const destination = new File(
        directory!,
        `${loaded.sourceHash.slice(0, 12)}-${safeFilename(key)}`,
      );
      if (!destination.exists) {
        destination.create({ overwrite: false, intermediates: true });
        destination.write(bytes);
        files.push(destination);
      }
      uris.set(key, destination.uri);
    }
  }
  return {
    rows: rows.map((row) => ({
      ...row,
      imageUri: row.imageFilename
        ? (uris.get(row.imageFilename.toLowerCase()) ?? null)
        : null,
    })),
    files,
    imageCount: uris.size,
  };
}

function removeFiles(files: File[]) {
  for (const file of files) {
    try {
      if (file.exists) file.delete();
    } catch {
      // A failed cleanup should not hide the original import failure.
    }
  }
}

export function importableRows(
  loaded: LoadedProductPackage,
  mode: ProductImportMode,
): ProductImportRow[] {
  const errorRows = new Set(
    loaded.issues
      .filter((item) => item.severity === 'error' && item.rowNumber !== null)
      .map((item) => item.rowNumber),
  );
  if (mode === 'strict') {
    return loaded.issues.some((item) => item.severity === 'error')
      ? []
      : loaded.preview.rows;
  }
  if (
    loaded.issues.some(
      (item) => item.severity === 'error' && item.rowNumber === null,
    )
  ) {
    return [];
  }
  return loaded.preview.rows.filter((row) => !errorRows.has(row.rowNumber));
}

export async function executeProductPackageImport(
  db: SQLiteDatabase,
  loaded: LoadedProductPackage,
  mode: ProductImportMode,
  onProgress?: LoadProgress,
): Promise<ProductPackageImportOutcome> {
  const startedAt = new Date().toISOString();
  const rows = importableRows(loaded, mode);
  const skippedCount = loaded.preview.rows.length - rows.length;
  const missingImages = new Set(
    loaded.issues
      .filter((item) => item.code === 'missing_image' && item.sku)
      .map((item) => item.sku),
  ).size;
  const reportBase = {
    sourceFilename: loaded.sourceFilename,
    sourceHash: loaded.sourceHash,
    packageFormatVersion: String(loaded.manifest.version),
    importMode: mode,
    startedAt,
    totalCsvRows: loaded.preview.rows.length,
    parentProductCount: loaded.preview.parentCount,
    variantsSkipped: skippedCount,
    imagesMissing: missingImages,
    issues: loaded.issues.map(({ field: _field, ...item }) => item),
  };
  if (rows.length === 0) {
    const reason =
      mode === 'strict'
        ? 'Strict import stopped because validation errors were found.'
        : 'No valid product rows are available to import.';
    const runId = await saveFailedProductImportRun(db, {
      ...reportBase,
      variantsSkipped: loaded.preview.rows.length,
      issues: [
        ...reportBase.issues,
        issue('error', 'import_blocked', reason),
      ],
    });
    throw new Error(`${reason} Import report #${runId} was saved.`);
  }

  let staged: Awaited<ReturnType<typeof persistImages>> | null = null;
  let productsImported = false;
  try {
    staged = await persistImages(loaded, rows, onProgress);
    onProgress?.(`Importing ${rows.length} product variants…`);
    const result = await importProductRows(db, staged.rows);
    productsImported = true;
    const runId = await saveProductImportReport(db, {
      ...reportBase,
      status: 'completed',
      parentProductCount: result.parentCount,
      variantsAdded: result.variantsAdded,
      variantsUpdated: result.variantsUpdated,
      imagesImported: staged.imageCount,
    });
    return {
      runId,
      result,
      skippedCount,
      imagesImported: staged.imageCount,
      imagesMissing: missingImages,
    };
  } catch (error) {
    if (staged && !productsImported) removeFiles(staged.files);
    const message = error instanceof Error ? error.message : 'Package import failed.';
    await saveFailedProductImportRun(db, {
      ...reportBase,
      variantsSkipped: loaded.preview.rows.length,
      issues: [
        ...reportBase.issues,
        issue('error', 'import_failed', message),
      ],
    }).catch(() => undefined);
    throw error;
  }
}


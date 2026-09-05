import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

import type {
  ProductImportIssue,
  ProductImportPreview,
  ProductImportResult,
  ProductImportRow,
} from './types';

export const DPOS_IMPORT_HEADERS = [
  'External Variant ID',
  'Parent SKU',
  'SKU',
  'Barcode',
  'Product Name',
  'Variant Name',
  'Brand',
  'Category',
  'Subcategory',
  'Description',
  'Supplier',
  'Supplier Code',
  'Unit',
  'Cost ex Tax',
  'Retail Price inc Tax',
  'Wholesale Price inc Tax',
  'Tax Rate',
  'Opening Stock',
  'Reorder Point',
  'Target Stock',
  'Stock Location',
  'Batch Tracking',
  'Expiry Tracking',
  'Active',
  'Image Filename',
  'Weight',
  'Dimensions',
  'Manufacturer',
  'Created At',
  'Notes',
] as const;

const aliases: Record<string, string> = {
  productid: 'External Variant ID',
  externalvariantid: 'External Variant ID',
  parentsku: 'Parent SKU',
  sku: 'SKU',
  barcode: 'Barcode',
  productname: 'Product Name',
  variant: 'Variant Name',
  variantname: 'Variant Name',
  brand: 'Brand',
  category: 'Category',
  subcategory: 'Subcategory',
  description: 'Description',
  supplier: 'Supplier',
  suppliercode: 'Supplier Code',
  unit: 'Unit',
  costexgst: 'Cost ex Tax',
  costextax: 'Cost ex Tax',
  retailpriceincgst: 'Retail Price inc Tax',
  retailpriceinctax: 'Retail Price inc Tax',
  wholesalepriceincgst: 'Wholesale Price inc Tax',
  wholesalepriceinctax: 'Wholesale Price inc Tax',
  gstrate: 'Tax Rate',
  taxrate: 'Tax Rate',
  openingstock: 'Opening Stock',
  reorderpoint: 'Reorder Point',
  targetstock: 'Target Stock',
  stocklocation: 'Stock Location',
  batchtracking: 'Batch Tracking',
  expirytracking: 'Expiry Tracking',
  active: 'Active',
  imagefilename: 'Image Filename',
  weight: 'Weight',
  dimensions: 'Dimensions',
  manufacturer: 'Manufacturer',
  createddate: 'Created At',
  createdat: 'Created At',
  notes: 'Notes',
  imagepath: 'Ignored Image Path',
  margin: 'Ignored Margin',
  inventoryvalue: 'Ignored Inventory Value',
};

function headerKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/%/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** RFC 4180-compatible parser, including escaped quotes and quoted newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  row.push(field);
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function optional(value: string | undefined): string | null {
  const result = value?.trim();
  return result ? result : null;
}

function parseMoney(
  value: string | undefined,
  row: number,
  field: string,
  issues: ProductImportIssue[],
  required: boolean,
): number | null {
  const source = value?.trim() ?? '';
  if (!source && !required) return null;
  const match = source.replace(/[$£€,\s]/g, '').match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) {
    issues.push({
      row,
      field,
      severity: 'error',
      message: `${field} must be a non-negative amount with at most two decimal places.`,
    });
    return required ? 0 : null;
  }
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) {
    issues.push({
      row,
      field,
      severity: 'error',
      message: `${field} is too large.`,
    });
    return required ? 0 : null;
  }
  return cents;
}

function parseWholeNumber(
  value: string | undefined,
  row: number,
  field: string,
  issues: ProductImportIssue[],
  fallback = 0,
): number {
  const source = value?.trim() ?? '';
  if (!source) return fallback;
  const result = Number(source);
  if (!Number.isSafeInteger(result) || result < 0) {
    issues.push({
      row,
      field,
      severity: 'error',
      message: `${field} must be a non-negative whole number.`,
    });
    return fallback;
  }
  return result;
}

function parseQuantity(
  value: string | undefined,
  row: number,
  field: string,
  issues: ProductImportIssue[],
): number {
  const source = value?.trim() ?? '';
  if (!source) return 0;
  const result = Number(source);
  if (!Number.isFinite(result) || result < 0) {
    issues.push({
      row,
      field,
      severity: 'error',
      message: `${field} must be a non-negative number.`,
    });
    return 0;
  }
  return result;
}

function parseBoolean(
  value: string | undefined,
  row: number,
  field: string,
  issues: ProductImportIssue[],
  fallback: boolean,
): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (['yes', 'true', '1', 'y'].includes(normalized)) return true;
  if (['no', 'false', '0', 'n'].includes(normalized)) return false;
  issues.push({
    row,
    field,
    severity: 'error',
    message: `${field} must be Yes or No.`,
  });
  return fallback;
}

function parseTaxRate(
  value: string | undefined,
  row: number,
  issues: ProductImportIssue[],
): number {
  const source = value?.trim() ?? '';
  if (!source) return 1000;
  const percent = source.endsWith('%');
  const numeric = Number(percent ? source.slice(0, -1) : source);
  const basisPoints = Math.round(
    percent || numeric > 1 ? numeric * 100 : numeric * 10000,
  );
  if (
    !Number.isFinite(numeric) ||
    numeric < 0 ||
    basisPoints < 0 ||
    basisPoints > 10000
  ) {
    issues.push({
      row,
      field: 'Tax Rate',
      severity: 'error',
      message: 'Tax Rate must be a decimal fraction (0.1), percent (10%), or percentage number (10).',
    });
    return 0;
  }
  return basisPoints;
}

function validIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) && !Number.isNaN(Date.parse(value));
}

export function previewProductImportCsv(csvText: string): ProductImportPreview {
  const issues: ProductImportIssue[] = [];
  let csvRows: string[][];
  try {
    csvRows = parseCsv(csvText);
  } catch (error) {
    return {
      rows: [],
      issues: [
        {
          row: 1,
          severity: 'error',
          message: error instanceof Error ? error.message : 'CSV could not be parsed.',
        },
      ],
      validRowCount: 0,
      parentCount: 0,
      supplierCount: 0,
      locationCount: 0,
      calculatedInventoryValueCents: 0,
    };
  }
  if (csvRows.length === 0) {
    return {
      rows: [],
      issues: [{ row: 1, severity: 'error', message: 'CSV is empty.' }],
      validRowCount: 0,
      parentCount: 0,
      supplierCount: 0,
      locationCount: 0,
      calculatedInventoryValueCents: 0,
    };
  }

  const columns = new Map<string, number>();
  csvRows[0].forEach((header, index) => {
    const canonical = aliases[headerKey(header)];
    if (canonical && !canonical.startsWith('Ignored ')) {
      if (columns.has(canonical)) {
        issues.push({
          row: 1,
          field: canonical,
          severity: 'error',
          message: `Duplicate ${canonical} column.`,
        });
      } else {
        columns.set(canonical, index);
      }
    }
  });
  for (const field of [
    'Parent SKU',
    'SKU',
    'Product Name',
    'Cost ex Tax',
    'Retail Price inc Tax',
  ]) {
    if (!columns.has(field)) {
      issues.push({
        row: 1,
        field,
        severity: 'error',
        message: `Missing required ${field} column.`,
      });
    }
  }
  const get = (row: string[], field: string) => {
    const index = columns.get(field);
    return index === undefined ? undefined : row[index];
  };
  const rows: ProductImportRow[] = [];
  const skus = new Map<string, number>();
  const barcodes = new Map<string, number>();
  const parents = new Map<
    string,
    { row: number; name: string; brand: string | null; category: string | null; subcategory: string | null }
  >();

  csvRows.slice(1).forEach((csvRow, zeroIndex) => {
    const rowNumber = zeroIndex + 2;
    const parentSku = get(csvRow, 'Parent SKU')?.trim() ?? '';
    const sku = get(csvRow, 'SKU')?.trim() ?? '';
    const barcode = get(csvRow, 'Barcode')?.trim() ?? '';
    const productName = get(csvRow, 'Product Name')?.trim() ?? '';
    for (const [field, value] of [
      ['Parent SKU', parentSku],
      ['SKU', sku],
      ['Product Name', productName],
    ]) {
      if (!value) {
        issues.push({
          row: rowNumber,
          field,
          severity: 'error',
          message: `${field} is required.`,
        });
      }
    }
    const duplicate = (
      value: string,
      field: string,
      seen: Map<string, number>,
    ) => {
      if (!value) return;
      const key = value.toLowerCase();
      const first = seen.get(key);
      if (first) {
        issues.push({
          row: rowNumber,
          field,
          severity: 'error',
          message: `Duplicate ${field}; first used on row ${first}.`,
        });
      } else {
        seen.set(key, rowNumber);
      }
    };
    duplicate(sku, 'SKU', skus);
    duplicate(barcode, 'Barcode', barcodes);

    const imageFilename = optional(get(csvRow, 'Image Filename'));
    if (imageFilename && /[\\/]/.test(imageFilename)) {
      issues.push({
        row: rowNumber,
        field: 'Image Filename',
        severity: 'error',
        message: 'Image Filename must be a filename only, without a path.',
      });
    }
    const createdAt = optional(get(csvRow, 'Created At'));
    if (createdAt && !validIsoDate(createdAt)) {
      issues.push({
        row: rowNumber,
        field: 'Created At',
        severity: 'error',
        message: 'Created At must be an ISO date such as 2026-09-05.',
      });
    }
    const cost = parseMoney(
      get(csvRow, 'Cost ex Tax'),
      rowNumber,
      'Cost ex Tax',
      issues,
      true,
    )!;
    const retail = parseMoney(
      get(csvRow, 'Retail Price inc Tax'),
      rowNumber,
      'Retail Price inc Tax',
      issues,
      true,
    )!;
    const wholesale = parseMoney(
      get(csvRow, 'Wholesale Price inc Tax'),
      rowNumber,
      'Wholesale Price inc Tax',
      issues,
      false,
    );
    const openingStock = parseQuantity(
      get(csvRow, 'Opening Stock'),
      rowNumber,
      'Opening Stock',
      issues,
    );
    const category = optional(get(csvRow, 'Category'));
    const subcategory = optional(get(csvRow, 'Subcategory'));
    const brand = optional(get(csvRow, 'Brand'));
    const parentKey = parentSku.toLowerCase();
    const parent = parents.get(parentKey);
    if (!parent && parentSku) {
      parents.set(parentKey, {
        row: rowNumber,
        name: productName,
        brand,
        category,
        subcategory,
      });
    } else if (
      parent &&
      (parent.name.toLowerCase() !== productName.toLowerCase() ||
        (parent.brand ?? '').toLowerCase() !== (brand ?? '').toLowerCase() ||
        (parent.category ?? '').toLowerCase() !== (category ?? '').toLowerCase() ||
        (parent.subcategory ?? '').toLowerCase() !==
          (subcategory ?? '').toLowerCase())
    ) {
      issues.push({
        row: rowNumber,
        field: 'Parent SKU',
        severity: 'error',
        message: `Parent fields differ from row ${parent.row} for ${parentSku}.`,
      });
    }
    rows.push({
      rowNumber,
      externalVariantId: optional(get(csvRow, 'External Variant ID')),
      parentSku,
      sku,
      barcode,
      productName,
      variantName: optional(get(csvRow, 'Variant Name')),
      brand,
      category,
      subcategory,
      description: optional(get(csvRow, 'Description')),
      supplier: optional(get(csvRow, 'Supplier')),
      supplierCode: optional(get(csvRow, 'Supplier Code')),
      unit: optional(get(csvRow, 'Unit')) ?? 'Each',
      costExTaxCents: cost,
      retailPriceIncTaxCents: retail,
      wholesalePriceIncTaxCents: wholesale,
      taxRateBasisPoints: parseTaxRate(
        get(csvRow, 'Tax Rate'),
        rowNumber,
        issues,
      ),
      openingStock,
      reorderPoint: parseWholeNumber(
        get(csvRow, 'Reorder Point'),
        rowNumber,
        'Reorder Point',
        issues,
      ),
      targetStock: parseWholeNumber(
        get(csvRow, 'Target Stock'),
        rowNumber,
        'Target Stock',
        issues,
      ),
      stockLocation: optional(get(csvRow, 'Stock Location')) ?? 'Main Store',
      batchTracking: parseBoolean(
        get(csvRow, 'Batch Tracking'),
        rowNumber,
        'Batch Tracking',
        issues,
        false,
      ),
      expiryTracking: parseBoolean(
        get(csvRow, 'Expiry Tracking'),
        rowNumber,
        'Expiry Tracking',
        issues,
        false,
      ),
      active: parseBoolean(
        get(csvRow, 'Active'),
        rowNumber,
        'Active',
        issues,
        true,
      ),
      imageFilename,
      weight: optional(get(csvRow, 'Weight')),
      dimensions: optional(get(csvRow, 'Dimensions')),
      manufacturer: optional(get(csvRow, 'Manufacturer')),
      notes: optional(get(csvRow, 'Notes')),
      createdAt,
    });
  });

  const badRows = new Set(
    issues.filter((issue) => issue.severity === 'error').map((issue) => issue.row),
  );
  return {
    rows,
    issues,
    validRowCount: rows.filter((row) => !badRows.has(row.rowNumber)).length,
    parentCount: new Set(rows.map((row) => row.parentSku.toLowerCase()).filter(Boolean))
      .size,
    supplierCount: new Set(
      rows.map((row) => row.supplier?.toLowerCase()).filter(Boolean),
    ).size,
    locationCount: new Set(
      rows.map((row) => row.stockLocation.toLowerCase()).filter(Boolean),
    ).size,
    calculatedInventoryValueCents: rows.reduce(
      (sum, row) => sum + row.costExTaxCents * row.openingStock,
      0,
    ),
  };
}

async function inTransaction<T>(
  db: SQLiteDatabase,
  task: (transaction: SQLiteDatabase) => Promise<T>,
): Promise<T> {
  let result: T | undefined;
  if (Platform.OS === 'web') {
    await db.withTransactionAsync(async () => {
      result = await task(db);
    });
  } else {
    await db.withExclusiveTransactionAsync(async (transaction) => {
      result = await task(transaction as SQLiteDatabase);
    });
  }
  return result as T;
}

function locationCode(name: string): string {
  const code = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return code || 'MAIN';
}

function sqlValue(value: string | number | boolean | null): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Import contains a non-finite number.');
    return String(value);
  }
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${value.replace(/'/g, "''")}'`;
}

async function importProductsSetBased(
  db: SQLiteDatabase,
  preview: ProductImportPreview,
): Promise<ProductImportResult> {
  const values = preview.rows
    .map((row) =>
      [
        row.rowNumber,
        row.externalVariantId,
        row.parentSku,
        row.sku,
        row.barcode,
        row.productName,
        row.variantName,
        row.brand,
        row.category,
        row.subcategory,
        row.description,
        row.supplier,
        row.supplierCode,
        row.unit,
        row.costExTaxCents,
        row.retailPriceIncTaxCents,
        row.wholesalePriceIncTaxCents,
        row.taxRateBasisPoints,
        row.openingStock,
        row.reorderPoint,
        row.targetStock,
        row.stockLocation,
        locationCode(row.stockLocation),
        row.batchTracking,
        row.expiryTracking,
        row.active,
        row.imageFilename,
        row.weight,
        row.dimensions,
        row.manufacturer,
        row.notes,
        row.createdAt,
      ]
        .map(sqlValue)
        .join(','),
    )
    .map((row) => `(${row})`)
    .join(',\n');

  await db.execAsync(`
    DROP TABLE IF EXISTS temp.dpos_import_rows;
    CREATE TEMP TABLE dpos_import_rows (
      row_number INTEGER,
      external_variant_id TEXT,
      parent_sku TEXT COLLATE NOCASE,
      sku TEXT COLLATE NOCASE,
      barcode TEXT COLLATE NOCASE,
      product_name TEXT,
      variant_name TEXT,
      brand TEXT,
      category TEXT COLLATE NOCASE,
      subcategory TEXT COLLATE NOCASE,
      description TEXT,
      supplier TEXT COLLATE NOCASE,
      supplier_code TEXT,
      unit TEXT,
      cost_cents INTEGER,
      retail_cents INTEGER,
      wholesale_cents INTEGER,
      tax_basis_points INTEGER,
      opening_stock REAL,
      reorder_point INTEGER,
      target_stock INTEGER,
      location_name TEXT COLLATE NOCASE,
      location_code TEXT COLLATE NOCASE,
      batch_tracking INTEGER,
      expiry_tracking INTEGER,
      active INTEGER,
      image_filename TEXT,
      weight TEXT,
      dimensions TEXT,
      manufacturer TEXT,
      notes TEXT,
      created_at TEXT,
      is_new INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO dpos_import_rows (
      row_number, external_variant_id, parent_sku, sku, barcode, product_name,
      variant_name, brand, category, subcategory, description, supplier,
      supplier_code, unit, cost_cents, retail_cents, wholesale_cents,
      tax_basis_points, opening_stock, reorder_point, target_stock,
      location_name, location_code, batch_tracking, expiry_tracking, active,
      image_filename, weight, dimensions, manufacturer, notes, created_at
    ) VALUES ${values};

    UPDATE dpos_import_rows
      SET is_new = NOT EXISTS (
        SELECT 1 FROM product_variants v
        WHERE v.sku = dpos_import_rows.sku COLLATE NOCASE
      );

    INSERT OR IGNORE INTO categories (parent_id, name)
      SELECT NULL, category FROM dpos_import_rows
      WHERE category IS NOT NULL AND TRIM(category) <> ''
      GROUP BY category COLLATE NOCASE;
    INSERT OR IGNORE INTO categories (parent_id, name)
      SELECT c.id, r.subcategory
      FROM dpos_import_rows r
      JOIN categories c ON c.parent_id IS NULL
        AND c.name = r.category COLLATE NOCASE
      WHERE r.subcategory IS NOT NULL AND TRIM(r.subcategory) <> ''
      GROUP BY c.id, r.subcategory COLLATE NOCASE;

    INSERT OR IGNORE INTO suppliers (name)
      SELECT supplier FROM dpos_import_rows
      WHERE supplier IS NOT NULL AND TRIM(supplier) <> ''
      GROUP BY supplier COLLATE NOCASE;
    INSERT OR IGNORE INTO locations (code, name)
      SELECT location_code, location_name FROM dpos_import_rows
      GROUP BY location_name COLLATE NOCASE;
    INSERT OR IGNORE INTO tax_profiles (code, name, rate_basis_points)
      SELECT 'TAX' || tax_basis_points,
        'Tax ' || (tax_basis_points / 100.0) || '%', tax_basis_points
      FROM dpos_import_rows r
      WHERE NOT EXISTS (
        SELECT 1 FROM tax_profiles t
        WHERE t.rate_basis_points = r.tax_basis_points AND t.active = 1
      )
      GROUP BY tax_basis_points;

    INSERT OR IGNORE INTO parent_products (
      parent_sku, name, brand, category_id, subcategory_id, description,
      manufacturer, notes, active, created_at, updated_at
    )
    SELECT r.parent_sku, r.product_name, r.brand, c.id, sc.id, r.description,
      r.manufacturer, r.notes, r.active,
      COALESCE(r.created_at, CURRENT_TIMESTAMP),
      COALESCE(r.created_at, CURRENT_TIMESTAMP)
    FROM dpos_import_rows r
    LEFT JOIN categories c ON c.parent_id IS NULL
      AND c.name = r.category COLLATE NOCASE
    LEFT JOIN categories sc ON sc.parent_id = c.id
      AND sc.name = r.subcategory COLLATE NOCASE
    GROUP BY r.parent_sku COLLATE NOCASE;

    UPDATE parent_products AS p SET
      name = (SELECT r.product_name FROM dpos_import_rows r
        WHERE r.parent_sku = p.parent_sku COLLATE NOCASE LIMIT 1),
      brand = (SELECT r.brand FROM dpos_import_rows r
        WHERE r.parent_sku = p.parent_sku COLLATE NOCASE LIMIT 1),
      category_id = (SELECT c.id FROM dpos_import_rows r
        LEFT JOIN categories c ON c.parent_id IS NULL
          AND c.name = r.category COLLATE NOCASE
        WHERE r.parent_sku = p.parent_sku COLLATE NOCASE LIMIT 1),
      subcategory_id = (SELECT sc.id FROM dpos_import_rows r
        LEFT JOIN categories c ON c.parent_id IS NULL
          AND c.name = r.category COLLATE NOCASE
        LEFT JOIN categories sc ON sc.parent_id = c.id
          AND sc.name = r.subcategory COLLATE NOCASE
        WHERE r.parent_sku = p.parent_sku COLLATE NOCASE LIMIT 1),
      description = (SELECT r.description FROM dpos_import_rows r
        WHERE r.parent_sku = p.parent_sku COLLATE NOCASE LIMIT 1),
      manufacturer = (SELECT r.manufacturer FROM dpos_import_rows r
        WHERE r.parent_sku = p.parent_sku COLLATE NOCASE LIMIT 1),
      notes = (SELECT r.notes FROM dpos_import_rows r
        WHERE r.parent_sku = p.parent_sku COLLATE NOCASE LIMIT 1),
      active = (SELECT r.active FROM dpos_import_rows r
        WHERE r.parent_sku = p.parent_sku COLLATE NOCASE LIMIT 1),
      updated_at = CURRENT_TIMESTAMP
    WHERE EXISTS (
      SELECT 1 FROM dpos_import_rows r
      WHERE r.parent_sku = p.parent_sku COLLATE NOCASE
    );

    UPDATE product_variants AS v SET
      parent_id = (SELECT p.id FROM dpos_import_rows r
        JOIN parent_products p ON p.parent_sku = r.parent_sku COLLATE NOCASE
        WHERE r.sku = v.sku COLLATE NOCASE LIMIT 1),
      external_variant_id = (SELECT r.external_variant_id FROM dpos_import_rows r
        WHERE r.sku = v.sku COLLATE NOCASE LIMIT 1),
      barcode = (SELECT NULLIF(r.barcode, '') FROM dpos_import_rows r
        WHERE r.sku = v.sku COLLATE NOCASE LIMIT 1),
      variant_name = (SELECT r.variant_name FROM dpos_import_rows r
        WHERE r.sku = v.sku COLLATE NOCASE LIMIT 1),
      unit = (SELECT r.unit FROM dpos_import_rows r
        WHERE r.sku = v.sku COLLATE NOCASE LIMIT 1),
      cost_ex_tax_cents = (SELECT r.cost_cents FROM dpos_import_rows r
        WHERE r.sku = v.sku COLLATE NOCASE LIMIT 1),
      retail_price_inc_tax_cents = (SELECT r.retail_cents FROM dpos_import_rows r
        WHERE r.sku = v.sku COLLATE NOCASE LIMIT 1),
      wholesale_price_inc_tax_cents = (SELECT r.wholesale_cents FROM dpos_import_rows r
        WHERE r.sku = v.sku COLLATE NOCASE LIMIT 1),
      tax_profile_id = (SELECT t.id FROM dpos_import_rows r
        JOIN tax_profiles t ON t.rate_basis_points = r.tax_basis_points AND t.active = 1
        WHERE r.sku = v.sku COLLATE NOCASE ORDER BY t.is_default DESC, t.id LIMIT 1),
      tax_rate_basis_points = (SELECT r.tax_basis_points FROM dpos_import_rows r
        WHERE r.sku = v.sku COLLATE NOCASE LIMIT 1),
      reorder_point = (SELECT r.reorder_point FROM dpos_import_rows r
        WHERE r.sku = v.sku COLLATE NOCASE LIMIT 1),
      target_stock = (SELECT r.target_stock FROM dpos_import_rows r
        WHERE r.sku = v.sku COLLATE NOCASE LIMIT 1),
      batch_tracking = (SELECT r.batch_tracking FROM dpos_import_rows r
        WHERE r.sku = v.sku COLLATE NOCASE LIMIT 1),
      expiry_tracking = (SELECT r.expiry_tracking FROM dpos_import_rows r
        WHERE r.sku = v.sku COLLATE NOCASE LIMIT 1),
      image_filename = (SELECT r.image_filename FROM dpos_import_rows r
        WHERE r.sku = v.sku COLLATE NOCASE LIMIT 1),
      weight = (SELECT r.weight FROM dpos_import_rows r
        WHERE r.sku = v.sku COLLATE NOCASE LIMIT 1),
      dimensions = (SELECT r.dimensions FROM dpos_import_rows r
        WHERE r.sku = v.sku COLLATE NOCASE LIMIT 1),
      active = (SELECT r.active FROM dpos_import_rows r
        WHERE r.sku = v.sku COLLATE NOCASE LIMIT 1),
      updated_at = CURRENT_TIMESTAMP
    WHERE EXISTS (
      SELECT 1 FROM dpos_import_rows r
      WHERE r.sku = v.sku COLLATE NOCASE AND r.is_new = 0
    );

    INSERT INTO product_variants (
      parent_id, external_variant_id, sku, barcode, variant_name, unit,
      cost_ex_tax_cents, retail_price_inc_tax_cents,
      wholesale_price_inc_tax_cents, tax_profile_id, tax_rate_basis_points,
      reorder_point, target_stock, batch_tracking, expiry_tracking,
      image_filename, weight, dimensions, active, created_at, updated_at
    )
    SELECT p.id, r.external_variant_id, r.sku, NULLIF(r.barcode, ''),
      r.variant_name, r.unit, r.cost_cents, r.retail_cents, r.wholesale_cents,
      (SELECT t.id FROM tax_profiles t
       WHERE t.rate_basis_points = r.tax_basis_points AND t.active = 1
       ORDER BY t.is_default DESC, t.id LIMIT 1),
      r.tax_basis_points, r.reorder_point, r.target_stock, r.batch_tracking,
      r.expiry_tracking, r.image_filename, r.weight, r.dimensions, r.active,
      COALESCE(r.created_at, CURRENT_TIMESTAMP),
      COALESCE(r.created_at, CURRENT_TIMESTAMP)
    FROM dpos_import_rows r
    JOIN parent_products p ON p.parent_sku = r.parent_sku COLLATE NOCASE
    WHERE r.is_new = 1;

    INSERT INTO variant_suppliers (
      variant_id, supplier_id, supplier_code, cost_ex_tax_cents, is_preferred
    )
    SELECT v.id, s.id, r.supplier_code, r.cost_cents, 1
    FROM dpos_import_rows r
    JOIN product_variants v ON v.sku = r.sku COLLATE NOCASE
    JOIN suppliers s ON s.name = r.supplier COLLATE NOCASE
    WHERE r.supplier IS NOT NULL AND TRIM(r.supplier) <> ''
    ON CONFLICT(variant_id, supplier_id) DO UPDATE SET
      supplier_code = excluded.supplier_code,
      cost_ex_tax_cents = excluded.cost_ex_tax_cents,
      is_preferred = 1,
      updated_at = CURRENT_TIMESTAMP;

    INSERT INTO stock_balances (variant_id, location_id, quantity)
    SELECT v.id, l.id, r.opening_stock
    FROM dpos_import_rows r
    JOIN product_variants v ON v.sku = r.sku COLLATE NOCASE
    JOIN locations l ON l.name = r.location_name COLLATE NOCASE
    WHERE r.is_new = 1;

    INSERT INTO stock_movements (
      variant_id, location_id, quantity_delta, movement_type,
      reference_type, reference_id, reason, created_at
    )
    SELECT v.id, l.id, r.opening_stock, 'opening', 'csv_import',
      r.sku || ':' || r.row_number, 'CSV opening stock',
      COALESCE(r.created_at, CURRENT_TIMESTAMP)
    FROM dpos_import_rows r
    JOIN product_variants v ON v.sku = r.sku COLLATE NOCASE
    JOIN locations l ON l.name = r.location_name COLLATE NOCASE
    WHERE r.is_new = 1 AND r.opening_stock > 0;
  `);

  const created = await db.getFirstAsync<{
    count: number;
    opening_stock: number;
  }>(
    `SELECT COUNT(*) AS count, COALESCE(SUM(opening_stock), 0) AS opening_stock
     FROM dpos_import_rows WHERE is_new = 1`,
  );
  await db.execAsync('DROP TABLE IF EXISTS temp.dpos_import_rows');
  return {
    parentCount: preview.parentCount,
    variantCount: preview.rows.length,
    supplierCount: preview.supplierCount,
    locationCount: preview.locationCount,
    openingStockUnits: created?.opening_stock ?? 0,
  };
}

export async function importProductsCsv(
  db: SQLiteDatabase,
  csvText: string,
): Promise<ProductImportResult> {
  const preview = previewProductImportCsv(csvText);
  const errors = preview.issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) {
    throw new Error(
      `Import has ${errors.length} error${errors.length === 1 ? '' : 's'}; first: row ${errors[0].row} ${errors[0].message}`,
    );
  }
  return inTransaction(db, async (transaction) => {
    await transaction.execAsync(`
      CREATE TEMP TABLE IF NOT EXISTS dpos_import_keys (
        sku TEXT COLLATE NOCASE, barcode TEXT COLLATE NOCASE
      );
      DELETE FROM dpos_import_keys;
    `);
    for (const row of preview.rows) {
      await transaction.runAsync(
        'INSERT INTO dpos_import_keys (sku, barcode) VALUES (?, ?)',
        row.sku,
        row.barcode,
      );
    }
    const conflict = await transaction.getFirstAsync<{ barcode: string }>(
      `SELECT k.sku, k.barcode FROM dpos_import_keys k
       WHERE EXISTS (
         SELECT 1 FROM product_variants v
         WHERE k.barcode <> ''
           AND v.barcode = k.barcode COLLATE NOCASE
           AND v.sku <> k.sku COLLATE NOCASE
       )
       LIMIT 1`,
    );
    if (conflict) {
      throw new Error(`Barcode ${conflict.barcode} belongs to another SKU.`);
    }
    if (Platform.OS === 'web') {
      await transaction.execAsync('DROP TABLE IF EXISTS temp.dpos_import_keys');
      return importProductsSetBased(transaction, preview);
    }

    const categories = new Map<string, number>();
    const suppliers = new Map<string, number>();
    const locations = new Map<string, number>();
    const parents = new Map<string, number>();
    const taxProfiles = new Map<number, number>();
    const getCategory = async (
      name: string | null,
      parentId: number | null,
    ): Promise<number | null> => {
      if (!name) return null;
      const key = `${parentId ?? 'root'}:${name.toLowerCase()}`;
      const cached = categories.get(key);
      if (cached) return cached;
      let record = await transaction.getFirstAsync<{ id: number }>(
        `SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND
          ((parent_id IS NULL AND ? IS NULL) OR parent_id = ?)`,
        name,
        parentId,
        parentId,
      );
      if (!record) {
        const inserted = await transaction.runAsync(
          'INSERT INTO categories (parent_id, name) VALUES (?, ?)',
          parentId,
          name,
        );
        record = { id: Number(inserted.lastInsertRowId) };
      }
      categories.set(key, record.id);
      return record.id;
    };
    const getSupplier = async (name: string): Promise<number> => {
      const key = name.toLowerCase();
      const cached = suppliers.get(key);
      if (cached) return cached;
      let record = await transaction.getFirstAsync<{ id: number }>(
        'SELECT id FROM suppliers WHERE name = ? COLLATE NOCASE',
        name,
      );
      if (!record) {
        const inserted = await transaction.runAsync(
          'INSERT INTO suppliers (name) VALUES (?)',
          name,
        );
        record = { id: Number(inserted.lastInsertRowId) };
      }
      suppliers.set(key, record.id);
      return record.id;
    };
    const getLocation = async (name: string): Promise<number> => {
      const key = name.toLowerCase();
      const cached = locations.get(key);
      if (cached) return cached;
      let record = await transaction.getFirstAsync<{ id: number }>(
        'SELECT id FROM locations WHERE name = ? COLLATE NOCASE',
        name,
      );
      if (!record) {
        const inserted = await transaction.runAsync(
          'INSERT INTO locations (code, name) VALUES (?, ?)',
          locationCode(name),
          name,
        );
        record = { id: Number(inserted.lastInsertRowId) };
      }
      locations.set(key, record.id);
      return record.id;
    };
    const getTaxProfile = async (rateBasisPoints: number): Promise<number> => {
      const cached = taxProfiles.get(rateBasisPoints);
      if (cached) return cached;
      let record = await transaction.getFirstAsync<{ id: number }>(
        `SELECT id FROM tax_profiles WHERE rate_basis_points = ? AND active = 1
         ORDER BY is_default DESC, id LIMIT 1`,
        rateBasisPoints,
      );
      if (!record) {
        const inserted = await transaction.runAsync(
          `INSERT INTO tax_profiles (code, name, rate_basis_points)
           VALUES (?, ?, ?)`,
          `TAX${rateBasisPoints}`,
          `Tax ${rateBasisPoints / 100}%`,
          rateBasisPoints,
        );
        record = { id: Number(inserted.lastInsertRowId) };
      }
      taxProfiles.set(rateBasisPoints, record.id);
      return record.id;
    };

    let openingStockUnits = 0;
    for (const row of preview.rows) {
      const categoryId = await getCategory(row.category, null);
      const subcategoryId = await getCategory(row.subcategory, categoryId);
      const parentKey = row.parentSku.toLowerCase();
      let parentId = parents.get(parentKey);
      if (!parentId) {
        const existing = await transaction.getFirstAsync<{ id: number }>(
          'SELECT id FROM parent_products WHERE parent_sku = ? COLLATE NOCASE',
          row.parentSku,
        );
        if (existing) {
          parentId = existing.id;
        } else {
          const inserted = await transaction.runAsync(
            `INSERT INTO parent_products
              (parent_sku, name, brand, category_id, subcategory_id, description,
               manufacturer, notes, active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP),
               COALESCE(?, CURRENT_TIMESTAMP))`,
            row.parentSku,
            row.productName,
            row.brand,
            categoryId,
            subcategoryId,
            row.description,
            row.manufacturer,
            row.notes,
            row.active ? 1 : 0,
            row.createdAt,
            row.createdAt,
          );
          parentId = Number(inserted.lastInsertRowId);
        }
        parents.set(parentKey, parentId);
      }
      await transaction.runAsync(
        `UPDATE parent_products SET name = ?, brand = ?, category_id = ?,
           subcategory_id = ?, description = ?, manufacturer = ?, notes = ?,
           active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        row.productName,
        row.brand,
        categoryId,
        subcategoryId,
        row.description,
        row.manufacturer,
        row.notes,
        row.active ? 1 : 0,
        parentId,
      );

      const existingVariant = await transaction.getFirstAsync<{ id: number }>(
        'SELECT id FROM product_variants WHERE sku = ? COLLATE NOCASE',
        row.sku,
      );
      const isNewVariant = !existingVariant;
      const taxProfileId = await getTaxProfile(row.taxRateBasisPoints);
      let variantId: number;
      if (existingVariant) {
        variantId = existingVariant.id;
        await transaction.runAsync(
          `UPDATE product_variants SET parent_id = ?, external_variant_id = ?,
             barcode = ?, variant_name = ?, unit = ?, cost_ex_tax_cents = ?,
             retail_price_inc_tax_cents = ?, wholesale_price_inc_tax_cents = ?,
             tax_profile_id = ?, tax_rate_basis_points = ?, reorder_point = ?, target_stock = ?,
             batch_tracking = ?, expiry_tracking = ?, image_filename = ?,
             active = ?, weight = ?, dimensions = ?,
             updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          parentId,
          row.externalVariantId,
          row.barcode,
          row.variantName,
          row.unit,
          row.costExTaxCents,
          row.retailPriceIncTaxCents,
          row.wholesalePriceIncTaxCents,
          taxProfileId,
          row.taxRateBasisPoints,
          row.reorderPoint,
          row.targetStock,
          row.batchTracking ? 1 : 0,
          row.expiryTracking ? 1 : 0,
          row.imageFilename,
          row.active ? 1 : 0,
          row.weight,
          row.dimensions,
          variantId,
        );
      } else {
        const variant = await transaction.runAsync(
          `INSERT INTO product_variants
            (parent_id, external_variant_id, sku, barcode, variant_name, unit,
             cost_ex_tax_cents, retail_price_inc_tax_cents,
             wholesale_price_inc_tax_cents, tax_profile_id, tax_rate_basis_points, reorder_point,
             target_stock, batch_tracking, expiry_tracking, image_filename,
             active, created_at, updated_at, weight, dimensions)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP), ?, ?)`,
          parentId,
          row.externalVariantId,
          row.sku,
          row.barcode,
          row.variantName,
          row.unit,
          row.costExTaxCents,
          row.retailPriceIncTaxCents,
          row.wholesalePriceIncTaxCents,
          taxProfileId,
          row.taxRateBasisPoints,
          row.reorderPoint,
          row.targetStock,
          row.batchTracking ? 1 : 0,
          row.expiryTracking ? 1 : 0,
          row.imageFilename,
          row.active ? 1 : 0,
          row.createdAt,
          row.createdAt,
          row.weight,
          row.dimensions,
        );
        variantId = Number(variant.lastInsertRowId);
      }
      if (row.supplier) {
        const supplierId = await getSupplier(row.supplier);
        await transaction.runAsync(
          `INSERT INTO variant_suppliers
            (variant_id, supplier_id, supplier_code, cost_ex_tax_cents, is_preferred)
           VALUES (?, ?, ?, ?, 1)
           ON CONFLICT(variant_id, supplier_id) DO UPDATE SET
             supplier_code = excluded.supplier_code,
             cost_ex_tax_cents = excluded.cost_ex_tax_cents,
             is_preferred = 1, updated_at = CURRENT_TIMESTAMP`,
          variantId,
          supplierId,
          row.supplierCode,
          row.costExTaxCents,
        );
      }
      const locationId = await getLocation(row.stockLocation);
      if (isNewVariant) {
        await transaction.runAsync(
          `INSERT INTO stock_balances (variant_id, location_id, quantity)
           VALUES (?, ?, ?)`,
          variantId,
          locationId,
          row.openingStock,
        );
        if (row.openingStock > 0) {
          await transaction.runAsync(
            `INSERT INTO stock_movements
              (variant_id, location_id, quantity_delta, movement_type,
               reference_type, reference_id, reason, created_at)
             VALUES (?, ?, ?, 'opening', 'csv_import', ?, 'CSV opening stock',
               COALESCE(?, CURRENT_TIMESTAMP))`,
            variantId,
            locationId,
            row.openingStock,
            `${row.sku}:${row.rowNumber}`,
            row.createdAt,
          );
        }
        openingStockUnits += row.openingStock;
      }
    }
    await transaction.execAsync('DROP TABLE IF EXISTS dpos_import_keys');
    return {
      parentCount: parents.size,
      variantCount: preview.rows.length,
      supplierCount: suppliers.size,
      locationCount: locations.size,
      openingStockUnits,
    };
  });
}

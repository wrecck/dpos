import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

import type {
  CartItem,
  DashboardStats,
  FailedProductImportReportInput,
  Location,
  PaymentMethod,
  Product,
  ProductImportReportInput,
  ProductImportReportIssue,
  ProductImportRun,
  ProductImportRunSummary,
  ProductInput,
  Sale,
  StockAdjustmentInput,
  StockReceiptInput,
  StoreSettings,
  Supplier,
} from './types';

type ProductRow = {
  id: number;
  parent_id: number;
  external_variant_id: string | null;
  parent_sku: string;
  sku: string;
  barcode: string | null;
  name: string;
  variant_name: string | null;
  retail_price_cents: number;
  wholesale_price_cents: number | null;
  cost_ex_tax_cents: number;
  tax_rate_basis_points: number;
  stock: number;
  reorder_point: number;
  target_stock: number;
  location_id: number;
  location: string;
  bin_location: string | null;
  image_uri: string | null;
  image_filename: string | null;
  category: string | null;
  subcategory: string | null;
  description: string | null;
  unit: string;
  weight: string | null;
  dimensions: string | null;
  colors: string | null;
  sizes: string | null;
  brand: string | null;
  supplier: string | null;
  supplier_code: string | null;
  manufacturer: string | null;
  variants: string | null;
  batch_tracking: number;
  expiry_tracking: number;
  active: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type SaleRow = {
  id: number;
  receipt_number: string;
  total_cents: number;
  payment_method: PaymentMethod;
  amount_tendered_cents: number;
  item_count: number;
  created_at: string;
};

const DEFAULT_PRODUCT_LIMIT = 500;

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

async function addColumnIfMissing(
  db: SQLiteDatabase,
  table: string,
  column: string,
  definition: string,
) {
  const columns = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${table})`,
  );
  if (!columns.some((item) => item.name === column)) {
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

const NORMALIZED_SCHEMA = `
  CREATE TABLE IF NOT EXISTS store_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL COLLATE NOCASE UNIQUE,
    name TEXT NOT NULL COLLATE NOCASE,
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
    name TEXT NOT NULL COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT COLLATE NOCASE,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    contact_name TEXT,
    email TEXT,
    phone TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tax_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL COLLATE NOCASE UNIQUE,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    rate_basis_points INTEGER NOT NULL CHECK (rate_basis_points BETWEEN 0 AND 10000),
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS parent_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_legacy_product_id INTEGER UNIQUE,
    parent_sku TEXT NOT NULL COLLATE NOCASE UNIQUE,
    name TEXT NOT NULL COLLATE NOCASE,
    brand TEXT,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    subcategory_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    description TEXT,
    manufacturer TEXT,
    notes TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS product_variants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER NOT NULL REFERENCES parent_products(id) ON DELETE RESTRICT,
    source_legacy_product_id INTEGER UNIQUE,
    external_variant_id TEXT,
    sku TEXT NOT NULL COLLATE NOCASE UNIQUE,
    barcode TEXT COLLATE NOCASE,
    variant_name TEXT,
    unit TEXT NOT NULL DEFAULT 'Each',
    cost_ex_tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_ex_tax_cents >= 0),
    retail_price_inc_tax_cents INTEGER NOT NULL CHECK (retail_price_inc_tax_cents >= 0),
    wholesale_price_inc_tax_cents INTEGER CHECK (wholesale_price_inc_tax_cents >= 0),
    tax_profile_id INTEGER REFERENCES tax_profiles(id) ON DELETE RESTRICT,
    tax_rate_basis_points INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_basis_points BETWEEN 0 AND 10000),
    reorder_point INTEGER NOT NULL DEFAULT 5 CHECK (reorder_point >= 0),
    target_stock INTEGER NOT NULL DEFAULT 0 CHECK (target_stock >= 0),
    batch_tracking INTEGER NOT NULL DEFAULT 0 CHECK (batch_tracking IN (0, 1)),
    expiry_tracking INTEGER NOT NULL DEFAULT 0 CHECK (expiry_tracking IN (0, 1)),
    image_filename TEXT,
    image_uri TEXT,
    bin_location TEXT,
    weight TEXT,
    dimensions TEXT,
    colors TEXT,
    sizes TEXT,
    legacy_variants TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS variant_suppliers (
    variant_id INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    supplier_code TEXT COLLATE NOCASE,
    cost_ex_tax_cents INTEGER CHECK (cost_ex_tax_cents >= 0),
    is_preferred INTEGER NOT NULL DEFAULT 0 CHECK (is_preferred IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (variant_id, supplier_id)
  );

  CREATE TABLE IF NOT EXISTS stock_balances (
    variant_id INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
    quantity REAL NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (variant_id, location_id)
  );

  CREATE TABLE IF NOT EXISTS deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE RESTRICT,
    location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
    supplier_reference TEXT,
    status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('draft', 'posted', 'void')),
    received_at TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS delivery_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delivery_id INTEGER NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
    variant_id INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    quantity REAL NOT NULL CHECK (quantity > 0),
    cost_ex_tax_cents INTEGER NOT NULL CHECK (cost_ex_tax_cents >= 0),
    supplier_code TEXT,
    lot_number TEXT,
    expiry_date TEXT
  );

  CREATE TABLE IF NOT EXISTS stock_lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    variant_id INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
    lot_number TEXT NOT NULL COLLATE NOCASE,
    expiry_date TEXT,
    quantity REAL NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (variant_id, location_id, lot_number)
  );

  CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    variant_id INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
    quantity_delta REAL NOT NULL CHECK (quantity_delta <> 0),
    movement_type TEXT NOT NULL CHECK (movement_type IN ('opening', 'sale', 'receipt', 'adjustment', 'transfer', 'return')),
    reference_type TEXT,
    reference_id TEXT,
    reason TEXT,
    notes TEXT,
    lot_id INTEGER REFERENCES stock_lots(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_root_name
    ON categories(name) WHERE parent_id IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_child_name
    ON categories(parent_id, name) WHERE parent_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_code
    ON suppliers(code) WHERE code IS NOT NULL AND code <> '';
  CREATE UNIQUE INDEX IF NOT EXISTS idx_variants_barcode
    ON product_variants(barcode) WHERE barcode IS NOT NULL AND barcode <> '';
  CREATE INDEX IF NOT EXISTS idx_parent_products_name ON parent_products(name);
  CREATE INDEX IF NOT EXISTS idx_parent_products_category ON parent_products(category_id, subcategory_id);
  CREATE INDEX IF NOT EXISTS idx_variants_parent ON product_variants(parent_id);
  CREATE INDEX IF NOT EXISTS idx_variants_external_id ON product_variants(external_variant_id);
  CREATE INDEX IF NOT EXISTS idx_variant_suppliers_supplier ON variant_suppliers(supplier_id);
  CREATE INDEX IF NOT EXISTS idx_stock_balances_location ON stock_balances(location_id, quantity);
  CREATE INDEX IF NOT EXISTS idx_stock_movements_variant_location_date
    ON stock_movements(variant_id, location_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_stock_movements_reference
    ON stock_movements(reference_type, reference_id);
  CREATE INDEX IF NOT EXISTS idx_deliveries_received_at ON deliveries(received_at DESC);
  CREATE INDEX IF NOT EXISTS idx_delivery_items_delivery ON delivery_items(delivery_id);
  CREATE INDEX IF NOT EXISTS idx_stock_lots_expiry ON stock_lots(expiry_date) WHERE expiry_date IS NOT NULL;
`;

export async function migrateDatabase(db: SQLiteDatabase) {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const version =
    (
      await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version')
    )?.user_version ?? 0;

  if (version < 1) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sku TEXT NOT NULL COLLATE NOCASE UNIQUE,
        name TEXT NOT NULL COLLATE NOCASE,
        price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
        stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
        low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        receipt_number TEXT NOT NULL UNIQUE,
        total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
        payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'card', 'other')),
        amount_tendered_cents INTEGER NOT NULL CHECK (amount_tendered_cents >= 0),
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sale_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
        sku TEXT NOT NULL,
        product_name TEXT NOT NULL,
        unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0)
      );
      CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
      CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
    `);
  }

  if (version < 2) {
    for (const column of [
      'image_uri',
      'category',
      'weight',
      'dimensions',
      'colors',
      'sizes',
      'brand',
      'supplier',
      'manufacturer',
      'variants',
    ]) {
      await addColumnIfMissing(db, 'products', column, 'TEXT');
    }
    await db.execAsync(
      'CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)',
    );
  }

  if (version < 3) {
    await inTransaction(db, async (transaction) => {
      await transaction.execAsync(NORMALIZED_SCHEMA);
      await addColumnIfMissing(
        transaction,
        'sale_items',
        'variant_id',
        'INTEGER REFERENCES product_variants(id) ON DELETE SET NULL',
      );
      await addColumnIfMissing(
        transaction,
        'sale_items',
        'parent_sku',
        'TEXT',
      );
      await addColumnIfMissing(
        transaction,
        'sale_items',
        'variant_name',
        'TEXT',
      );
      await addColumnIfMissing(transaction, 'sale_items', 'barcode', 'TEXT');
      await addColumnIfMissing(
        transaction,
        'sale_items',
        'tax_rate_basis_points',
        'INTEGER NOT NULL DEFAULT 0',
      );

      await transaction.execAsync(`
        INSERT OR IGNORE INTO locations (code, name, is_default)
        VALUES ('MAIN', 'Main Store', 1);
        INSERT OR IGNORE INTO store_settings (key, value) VALUES
          ('store_name', 'DPOS Store'),
          ('store_number', ''),
          ('currency_code', 'AUD'),
          ('default_tax_rate_basis_points', '1000'),
          ('prices_include_tax', 'true');
        INSERT OR IGNORE INTO tax_profiles
          (code, name, rate_basis_points, is_default) VALUES
          ('GST10', 'GST 10%', 1000, 1),
          ('GSTFREE', 'GST-free', 0, 0);
        INSERT OR IGNORE INTO tax_profiles
          (code, name, rate_basis_points)
        SELECT 'TAX' || tax_rate_basis_points,
          'Tax ' || (tax_rate_basis_points / 100.0) || '%',
          tax_rate_basis_points
        FROM product_variants v
        WHERE NOT EXISTS (
          SELECT 1 FROM tax_profiles t
          WHERE t.rate_basis_points = v.tax_rate_basis_points
        )
        GROUP BY tax_rate_basis_points;
        INSERT OR IGNORE INTO store_settings (key, value)
          SELECT 'default_tax_profile_id', CAST(id AS TEXT)
          FROM tax_profiles WHERE code = 'GST10';
        INSERT OR IGNORE INTO store_settings (key, value)
          SELECT 'default_location_id', CAST(id AS TEXT)
          FROM locations WHERE code = 'MAIN';

        INSERT OR IGNORE INTO categories (name)
          SELECT DISTINCT TRIM(category) FROM products
          WHERE category IS NOT NULL AND TRIM(category) <> '';
        INSERT OR IGNORE INTO suppliers (name)
          SELECT DISTINCT TRIM(supplier) FROM products
          WHERE supplier IS NOT NULL AND TRIM(supplier) <> '';

        INSERT OR IGNORE INTO parent_products
          (source_legacy_product_id, parent_sku, name, brand, category_id,
           manufacturer, active, created_at, updated_at)
        SELECT p.id, p.sku, p.name, p.brand,
          (SELECT c.id FROM categories c
           WHERE c.parent_id IS NULL AND c.name = p.category COLLATE NOCASE LIMIT 1),
          p.manufacturer, 1, p.created_at, p.updated_at
        FROM products p;

        INSERT OR IGNORE INTO product_variants
          (parent_id, source_legacy_product_id, sku, variant_name, unit,
           retail_price_inc_tax_cents, tax_profile_id, tax_rate_basis_points,
           reorder_point, image_uri, weight,
           dimensions, colors, sizes, legacy_variants, active, created_at, updated_at)
        SELECT pp.id, p.id, p.sku, COALESCE(NULLIF(TRIM(p.variants), ''), 'Default'),
          'Each', p.price_cents,
          (SELECT id FROM tax_profiles WHERE code = 'GST10'), 1000,
          p.low_stock_threshold, p.image_uri, p.weight,
          p.dimensions, p.colors, p.sizes, p.variants, 1, p.created_at, p.updated_at
        FROM products p
        JOIN parent_products pp ON pp.source_legacy_product_id = p.id;

        INSERT OR IGNORE INTO variant_suppliers
          (variant_id, supplier_id, is_preferred)
        SELECT v.id, s.id, 1
        FROM products p
        JOIN product_variants v ON v.source_legacy_product_id = p.id
        JOIN suppliers s ON s.name = p.supplier COLLATE NOCASE
        WHERE p.supplier IS NOT NULL AND TRIM(p.supplier) <> '';

        INSERT OR IGNORE INTO stock_balances (variant_id, location_id, quantity)
        SELECT v.id, l.id, p.stock
        FROM products p
        JOIN product_variants v ON v.source_legacy_product_id = p.id
        JOIN locations l ON l.code = 'MAIN';

        INSERT INTO stock_movements
          (variant_id, location_id, quantity_delta, movement_type,
           reference_type, reference_id, reason, created_at)
        SELECT v.id, l.id, p.stock, 'opening', 'legacy_product',
          CAST(p.id AS TEXT), 'Migrated opening balance', p.created_at
        FROM products p
        JOIN product_variants v ON v.source_legacy_product_id = p.id
        JOIN locations l ON l.code = 'MAIN'
        WHERE p.stock <> 0
          AND NOT EXISTS (
            SELECT 1 FROM stock_movements sm
            WHERE sm.reference_type = 'legacy_product'
              AND sm.reference_id = CAST(p.id AS TEXT)
              AND sm.variant_id = v.id
          );

        CREATE INDEX IF NOT EXISTS idx_sale_items_variant_id ON sale_items(variant_id);
        PRAGMA user_version = 3;
      `);
    });
  }

  if (version < 4) {
    await inTransaction(db, async (transaction) => {
      await transaction.execAsync(`
        CREATE TABLE IF NOT EXISTS tax_profiles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT NOT NULL COLLATE NOCASE UNIQUE,
          name TEXT NOT NULL COLLATE NOCASE UNIQUE,
          rate_basis_points INTEGER NOT NULL
            CHECK (rate_basis_points BETWEEN 0 AND 10000),
          is_default INTEGER NOT NULL DEFAULT 0
            CHECK (is_default IN (0, 1)),
          active INTEGER NOT NULL DEFAULT 1
            CHECK (active IN (0, 1)),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await addColumnIfMissing(
        transaction,
        'product_variants',
        'tax_profile_id',
        'INTEGER REFERENCES tax_profiles(id) ON DELETE RESTRICT',
      );
      await transaction.execAsync(`
        INSERT OR IGNORE INTO tax_profiles
          (code, name, rate_basis_points, is_default) VALUES
          ('GST10', 'GST 10%', 1000, 1),
          ('GSTFREE', 'GST-free', 0, 0);
        INSERT OR IGNORE INTO store_settings (key, value)
          SELECT 'default_tax_profile_id', CAST(id AS TEXT)
          FROM tax_profiles WHERE code = 'GST10';
        UPDATE product_variants
          SET tax_profile_id = (
            SELECT id FROM tax_profiles t
            WHERE t.rate_basis_points = product_variants.tax_rate_basis_points
              AND t.active = 1
            ORDER BY t.is_default DESC, t.id
            LIMIT 1
          )
          WHERE tax_profile_id IS NULL;
        PRAGMA user_version = 4;
      `);
    });
  }

  if (version < 5) {
    await inTransaction(db, async (transaction) => {
      await addColumnIfMissing(
        transaction,
        'product_variants',
        'bin_location',
        'TEXT',
      );
      await transaction.execAsync(`
        CREATE TABLE IF NOT EXISTS product_import_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_filename TEXT NOT NULL,
          source_hash TEXT,
          package_format_version TEXT NOT NULL,
          import_mode TEXT NOT NULL CHECK (import_mode IN ('strict', 'valid_rows')),
          status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'cancelled')),
          total_csv_rows INTEGER NOT NULL DEFAULT 0 CHECK (total_csv_rows >= 0),
          parent_product_count INTEGER NOT NULL DEFAULT 0 CHECK (parent_product_count >= 0),
          variants_added INTEGER NOT NULL DEFAULT 0 CHECK (variants_added >= 0),
          variants_updated INTEGER NOT NULL DEFAULT 0 CHECK (variants_updated >= 0),
          variants_skipped INTEGER NOT NULL DEFAULT 0 CHECK (variants_skipped >= 0),
          images_imported INTEGER NOT NULL DEFAULT 0 CHECK (images_imported >= 0),
          images_missing INTEGER NOT NULL DEFAULT 0 CHECK (images_missing >= 0),
          warning_count INTEGER NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
          error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
          started_at TEXT NOT NULL,
          completed_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS product_import_issues (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id INTEGER NOT NULL REFERENCES product_import_runs(id) ON DELETE CASCADE,
          csv_row_number INTEGER CHECK (csv_row_number IS NULL OR csv_row_number > 0),
          sku TEXT,
          severity TEXT NOT NULL CHECK (severity IN ('warning', 'error')),
          code TEXT NOT NULL,
          message TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_product_import_runs_started_at
          ON product_import_runs(started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_product_import_runs_status
          ON product_import_runs(status, started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_product_import_issues_run
          ON product_import_issues(run_id, id);
        CREATE INDEX IF NOT EXISTS idx_product_import_issues_run_severity
          ON product_import_issues(run_id, severity);
        CREATE INDEX IF NOT EXISTS idx_product_import_issues_code
          ON product_import_issues(code);
        PRAGMA user_version = 5;
      `);
    });
  }
}

const productSelect = (locationExpression = '?') => `
  SELECT v.id, v.parent_id, v.external_variant_id, p.parent_sku, v.sku,
    v.barcode, p.name, v.variant_name,
    v.retail_price_inc_tax_cents AS retail_price_cents,
    v.wholesale_price_inc_tax_cents AS wholesale_price_cents,
    v.cost_ex_tax_cents, v.tax_rate_basis_points,
    COALESCE(sb.quantity, 0) AS stock, v.reorder_point, v.target_stock,
    l.id AS location_id, l.name AS location, v.bin_location,
    v.image_uri, v.image_filename,
    c.name AS category, sc.name AS subcategory, p.description, v.unit,
    v.weight, v.dimensions, v.colors, v.sizes, p.brand,
    s.name AS supplier, vs.supplier_code, p.manufacturer,
    v.legacy_variants AS variants, v.batch_tracking, v.expiry_tracking,
    v.active, p.notes, v.created_at, v.updated_at
  FROM product_variants v
  JOIN parent_products p ON p.id = v.parent_id
  JOIN locations l ON l.id = ${locationExpression}
  LEFT JOIN stock_balances sb ON sb.variant_id = v.id AND sb.location_id = l.id
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN categories sc ON sc.id = p.subcategory_id
  LEFT JOIN variant_suppliers vs ON vs.variant_id = v.id AND vs.is_preferred = 1
  LEFT JOIN suppliers s ON s.id = vs.supplier_id
`;

const mapProduct = (row: ProductRow): Product => ({
  id: row.id,
  parentId: row.parent_id,
  externalVariantId: row.external_variant_id,
  parentSku: row.parent_sku,
  sku: row.sku,
  barcode: row.barcode,
  name: row.name,
  variantName: row.variant_name,
  priceCents: row.retail_price_cents,
  retailPriceIncTaxCents: row.retail_price_cents,
  wholesalePriceIncTaxCents: row.wholesale_price_cents,
  costExTaxCents: row.cost_ex_tax_cents,
  taxRateBasisPoints: row.tax_rate_basis_points,
  stock: row.stock,
  lowStockThreshold: row.reorder_point,
  reorderPoint: row.reorder_point,
  targetStock: row.target_stock,
  locationId: row.location_id,
  location: row.location,
  binLocation: row.bin_location,
  imageUri: row.image_uri,
  imageFilename: row.image_filename,
  category: row.category,
  subcategory: row.subcategory,
  description: row.description,
  unit: row.unit,
  weight: row.weight,
  dimensions: row.dimensions,
  colors: row.colors,
  sizes: row.sizes,
  brand: row.brand,
  supplier: row.supplier,
  supplierCode: row.supplier_code,
  manufacturer: row.manufacturer,
  variants: row.variants,
  batchTracking: row.batch_tracking === 1,
  expiryTracking: row.expiry_tracking === 1,
  active: row.active === 1,
  notes: row.notes,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

async function defaultLocationId(db: SQLiteDatabase): Promise<number> {
  const setting = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM store_settings WHERE key = 'default_location_id'`,
  );
  const parsed = Number(setting?.value);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  const location = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM locations WHERE is_default = 1 ORDER BY id LIMIT 1',
  );
  if (!location) throw new Error('No default stock location is configured.');
  return location.id;
}

export async function getProducts(
  db: SQLiteDatabase,
  search = '',
  options: { locationId?: number; limit?: number; offset?: number } = {},
): Promise<Product[]> {
  const locationId = options.locationId ?? (await defaultLocationId(db));
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_PRODUCT_LIMIT, 1), 10000);
  const offset = Math.max(options.offset ?? 0, 0);
  const term = search.trim();
  const where = term
    ? `AND (p.name LIKE ? OR v.sku LIKE ? OR v.barcode LIKE ?
       OR c.name LIKE ? OR p.brand LIKE ?)`
    : '';
  const args: (string | number)[] = [locationId];
  if (term) {
    const like = `%${term}%`;
    args.push(like, like, like, like, like);
  }
  args.push(limit, offset);
  const rows = await db.getAllAsync<ProductRow>(
    `${productSelect()} WHERE v.active = 1 AND p.active = 1 ${where}
     ORDER BY p.name COLLATE NOCASE, v.variant_name COLLATE NOCASE
     LIMIT ? OFFSET ?`,
    ...args,
  );
  return rows.map(mapProduct);
}

async function getProductById(
  db: SQLiteDatabase,
  id: number,
  locationId: number,
): Promise<Product | null> {
  const row = await db.getFirstAsync<ProductRow>(
    `${productSelect()} WHERE v.id = ? AND v.active = 1`,
    locationId,
    id,
  );
  return row ? mapProduct(row) : null;
}

async function findOrCreateCategory(
  db: SQLiteDatabase,
  name: string | null | undefined,
  parentId: number | null,
): Promise<number | null> {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  const existing = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM categories
     WHERE name = ? COLLATE NOCASE AND
       ((parent_id IS NULL AND ? IS NULL) OR parent_id = ?)`,
    trimmed,
    parentId,
    parentId,
  );
  if (existing) return existing.id;
  const result = await db.runAsync(
    'INSERT INTO categories (parent_id, name) VALUES (?, ?)',
    parentId,
    trimmed,
  );
  return Number(result.lastInsertRowId);
}

async function findOrCreateSupplier(
  db: SQLiteDatabase,
  name: string | null | undefined,
): Promise<number | null> {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  const existing = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM suppliers WHERE name = ? COLLATE NOCASE',
    trimmed,
  );
  if (existing) return existing.id;
  const result = await db.runAsync(
    'INSERT INTO suppliers (name) VALUES (?)',
    trimmed,
  );
  return Number(result.lastInsertRowId);
}

async function findOrCreateTaxProfile(
  db: SQLiteDatabase,
  rateBasisPoints: number,
): Promise<number> {
  const existing = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM tax_profiles
     WHERE rate_basis_points = ? AND active = 1
     ORDER BY is_default DESC, id LIMIT 1`,
    rateBasisPoints,
  );
  if (existing) return existing.id;
  const code = `TAX${rateBasisPoints}`;
  const result = await db.runAsync(
    `INSERT INTO tax_profiles (code, name, rate_basis_points)
     VALUES (?, ?, ?)`,
    code,
    `Tax ${rateBasisPoints / 100}%`,
    rateBasisPoints,
  );
  return Number(result.lastInsertRowId);
}

export async function saveProduct(
  db: SQLiteDatabase,
  input: ProductInput,
  id?: number,
) {
  if (!input.sku.trim() || !input.name.trim()) {
    throw new Error('Name and SKU are required.');
  }
  await inTransaction(db, async (transaction) => {
    const locationId = input.locationId ?? (await defaultLocationId(transaction));
    const categoryId = await findOrCreateCategory(
      transaction,
      input.category,
      null,
    );
    const subcategoryId = await findOrCreateCategory(
      transaction,
      input.subcategory,
      categoryId,
    );
    const supplierId = await findOrCreateSupplier(transaction, input.supplier);
    const retailPrice = input.retailPriceIncTaxCents ?? input.priceCents;
    const reorderPoint = input.reorderPoint ?? input.lowStockThreshold;
    const taxSetting = await transaction.getFirstAsync<{ value: string }>(
      `SELECT value FROM store_settings WHERE key = 'default_tax_rate_basis_points'`,
    );
    const taxRateBasisPoints =
      input.taxRateBasisPoints ?? Number(taxSetting?.value ?? 1000);
    const taxProfileId = await findOrCreateTaxProfile(
      transaction,
      taxRateBasisPoints,
    );
    let parentId: number;
    let variantId: number;

    if (id) {
      const current = await transaction.getFirstAsync<{ parent_id: number }>(
        'SELECT parent_id FROM product_variants WHERE id = ?',
        id,
      );
      if (!current) throw new Error('Product no longer exists.');
      parentId = current.parent_id;
      variantId = id;
      await transaction.runAsync(
        `UPDATE parent_products SET parent_sku = ?, name = ?, brand = ?,
           category_id = ?, subcategory_id = ?, description = ?,
           manufacturer = ?, notes = ?, active = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        (input.parentSku ?? input.sku).trim(),
        input.name.trim(),
        input.brand,
        categoryId,
        subcategoryId,
        input.description ?? null,
        input.manufacturer,
        input.notes ?? null,
        input.active === false ? 0 : 1,
        parentId,
      );
      await transaction.runAsync(
        `UPDATE product_variants SET external_variant_id = ?, sku = ?, barcode = ?,
           variant_name = ?, unit = ?, cost_ex_tax_cents = ?,
           retail_price_inc_tax_cents = ?, wholesale_price_inc_tax_cents = ?,
           tax_profile_id = ?, tax_rate_basis_points = ?, reorder_point = ?, target_stock = ?,
           batch_tracking = ?, expiry_tracking = ?, image_filename = ?,
           image_uri = ?, bin_location = ?, weight = ?, dimensions = ?, colors = ?, sizes = ?,
           legacy_variants = ?, active = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        input.externalVariantId ?? null,
        input.sku.trim(),
        input.barcode?.trim() || null,
        input.variantName ?? input.variants,
        input.unit ?? 'Each',
        input.costExTaxCents ?? 0,
        retailPrice,
        input.wholesalePriceIncTaxCents ?? null,
        taxProfileId,
        taxRateBasisPoints,
        reorderPoint,
        input.targetStock ?? 0,
        input.batchTracking ? 1 : 0,
        input.expiryTracking ? 1 : 0,
        input.imageFilename ?? null,
        input.imageUri,
        input.binLocation ?? null,
        input.weight,
        input.dimensions,
        input.colors,
        input.sizes,
        input.variants,
        input.active === false ? 0 : 1,
        variantId,
      );
    } else {
      const parentSku = (input.parentSku ?? input.sku).trim();
      const existingParent = await transaction.getFirstAsync<{ id: number }>(
        'SELECT id FROM parent_products WHERE parent_sku = ? COLLATE NOCASE',
        parentSku,
      );
      if (existingParent) {
        parentId = existingParent.id;
        await transaction.runAsync(
          `UPDATE parent_products SET name = ?, brand = ?, category_id = ?,
             subcategory_id = ?, description = ?, manufacturer = ?, notes = ?,
             active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          input.name.trim(),
          input.brand,
          categoryId,
          subcategoryId,
          input.description ?? null,
          input.manufacturer,
          input.notes ?? null,
          input.active === false ? 0 : 1,
          parentId,
        );
      } else {
        const parentResult = await transaction.runAsync(
          `INSERT INTO parent_products
            (parent_sku, name, brand, category_id, subcategory_id, description,
             manufacturer, notes, active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          parentSku,
          input.name.trim(),
          input.brand,
          categoryId,
          subcategoryId,
          input.description ?? null,
          input.manufacturer,
          input.notes ?? null,
          input.active === false ? 0 : 1,
        );
        parentId = Number(parentResult.lastInsertRowId);
      }
      const variantResult = await transaction.runAsync(
        `INSERT INTO product_variants
          (parent_id, external_variant_id, sku, barcode, variant_name, unit,
           cost_ex_tax_cents, retail_price_inc_tax_cents,
           wholesale_price_inc_tax_cents, tax_profile_id, tax_rate_basis_points, reorder_point,
           target_stock, batch_tracking, expiry_tracking, image_filename,
           image_uri, bin_location, weight, dimensions, colors, sizes,
           legacy_variants, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        parentId,
        input.externalVariantId ?? null,
        input.sku.trim(),
        input.barcode?.trim() || null,
        input.variantName ?? input.variants,
        input.unit ?? 'Each',
        input.costExTaxCents ?? 0,
        retailPrice,
        input.wholesalePriceIncTaxCents ?? null,
        taxProfileId,
        taxRateBasisPoints,
        reorderPoint,
        input.targetStock ?? 0,
        input.batchTracking ? 1 : 0,
        input.expiryTracking ? 1 : 0,
        input.imageFilename ?? null,
        input.imageUri,
        input.binLocation ?? null,
        input.weight,
        input.dimensions,
        input.colors,
        input.sizes,
        input.variants,
        input.active === false ? 0 : 1,
      );
      variantId = Number(variantResult.lastInsertRowId);
    }

    if (supplierId) {
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
        input.supplierCode ?? null,
        input.costExTaxCents ?? 0,
      );
      await transaction.runAsync(
        'UPDATE variant_suppliers SET is_preferred = 0 WHERE variant_id = ? AND supplier_id <> ?',
        variantId,
        supplierId,
      );
    }
    await setStockWithinTransaction(
      transaction,
      variantId,
      locationId,
      input.stock,
      'Product save',
    );
  });
}

export async function deleteProduct(db: SQLiteDatabase, id: number) {
  await db.runAsync(
    `UPDATE product_variants SET active = 0, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    id,
  );
}

async function setStockWithinTransaction(
  db: SQLiteDatabase,
  variantId: number,
  locationId: number,
  stock: number,
  reason: string,
) {
  if (!Number.isFinite(stock) || stock < 0) {
    throw new Error('Stock must be a number of zero or more.');
  }
  const current = await db.getFirstAsync<{ quantity: number }>(
    'SELECT quantity FROM stock_balances WHERE variant_id = ? AND location_id = ?',
    variantId,
    locationId,
  );
  const delta = stock - (current?.quantity ?? 0);
  await db.runAsync(
    `INSERT INTO stock_balances (variant_id, location_id, quantity)
     VALUES (?, ?, ?)
     ON CONFLICT(variant_id, location_id) DO UPDATE SET
       quantity = excluded.quantity, updated_at = CURRENT_TIMESTAMP`,
    variantId,
    locationId,
    stock,
  );
  if (delta !== 0) {
    await db.runAsync(
      `INSERT INTO stock_movements
        (variant_id, location_id, quantity_delta, movement_type, reason)
       VALUES (?, ?, ?, 'adjustment', ?)`,
      variantId,
      locationId,
      delta,
      reason,
    );
  }
}

export async function setProductStock(
  db: SQLiteDatabase,
  id: number,
  stock: number,
  locationId?: number,
) {
  await inTransaction(db, async (transaction) => {
    await setStockWithinTransaction(
      transaction,
      id,
      locationId ?? (await defaultLocationId(transaction)),
      stock,
      'Manual stock set',
    );
  });
}

export async function adjustStock(
  db: SQLiteDatabase,
  input: StockAdjustmentInput,
) {
  if (!Number.isFinite(input.quantityDelta) || input.quantityDelta === 0) {
    throw new Error('Adjustment must be a non-zero number.');
  }
  await inTransaction(db, async (transaction) => {
    const locationId = input.locationId ?? (await defaultLocationId(transaction));
    const result = await transaction.runAsync(
      `INSERT INTO stock_balances (variant_id, location_id, quantity)
       VALUES (?, ?, ?)
       ON CONFLICT(variant_id, location_id) DO UPDATE SET
         quantity = quantity + excluded.quantity, updated_at = CURRENT_TIMESTAMP`,
      input.variantId,
      locationId,
      input.quantityDelta,
    );
    if (result.changes !== 1) throw new Error('Could not update stock.');
    const balance = await transaction.getFirstAsync<{ quantity: number }>(
      'SELECT quantity FROM stock_balances WHERE variant_id = ? AND location_id = ?',
      input.variantId,
      locationId,
    );
    if (!balance || balance.quantity < 0) throw new Error('Insufficient stock.');
    let lotId: number | null = null;
    if (input.lotNumber) {
      await transaction.runAsync(
        `INSERT INTO stock_lots
          (variant_id, location_id, lot_number, expiry_date, quantity)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(variant_id, location_id, lot_number) DO UPDATE SET
           quantity = quantity + excluded.quantity,
           expiry_date = COALESCE(excluded.expiry_date, expiry_date),
           updated_at = CURRENT_TIMESTAMP`,
        input.variantId,
        locationId,
        input.lotNumber,
        input.expiryDate ?? null,
        input.quantityDelta,
      );
      const lot = await transaction.getFirstAsync<{ id: number; quantity: number }>(
        `SELECT id, quantity FROM stock_lots
         WHERE variant_id = ? AND location_id = ? AND lot_number = ? COLLATE NOCASE`,
        input.variantId,
        locationId,
        input.lotNumber,
      );
      if (!lot || lot.quantity < 0) throw new Error('Insufficient lot stock.');
      lotId = lot.id;
    }
    await transaction.runAsync(
      `INSERT INTO stock_movements
        (variant_id, location_id, quantity_delta, movement_type, reason, notes, lot_id)
       VALUES (?, ?, ?, 'adjustment', ?, ?, ?)`,
      input.variantId,
      locationId,
      input.quantityDelta,
      input.reason ?? 'Manual adjustment',
      input.notes ?? null,
      lotId,
    );
  });
}

export async function completeSale(
  db: SQLiteDatabase,
  cart: CartItem[],
  paymentMethod: PaymentMethod,
  amountTenderedCents: number,
  locationId?: number,
) {
  if (cart.length === 0) throw new Error('Add at least one item before checkout.');
  const quantities = new Map<number, number>();
  for (const item of cart) {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      throw new Error('Sale quantities must be positive whole numbers.');
    }
    quantities.set(item.id, (quantities.get(item.id) ?? 0) + item.quantity);
  }
  const receiptNumber = `POS-${Date.now()}-${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0')}`;

  return inTransaction(db, async (transaction) => {
    const saleLocationId = locationId ?? (await defaultLocationId(transaction));
    const ids = [...quantities.keys()];
    const placeholders = ids.map(() => '?').join(',');
    const rows = await transaction.getAllAsync<ProductRow>(
      `${productSelect()} WHERE v.id IN (${placeholders}) AND v.active = 1`,
      saleLocationId,
      ...ids,
    );
    if (rows.length !== ids.length) {
      throw new Error('One or more products are no longer available.');
    }
    const products = new Map(rows.map((row) => [row.id, mapProduct(row)]));
    let totalCents = 0;
    for (const [id, quantity] of quantities) {
      const product = products.get(id);
      if (!product) throw new Error('A product is no longer available.');
      if (product.stock < quantity) {
        throw new Error(
          `Only ${product.stock} ${product.name} item${product.stock === 1 ? '' : 's'} remain.`,
        );
      }
      totalCents += product.priceCents * quantity;
    }
    if (paymentMethod === 'cash' && amountTenderedCents < totalCents) {
      throw new Error('Cash received is less than the sale total.');
    }
    const sale = await transaction.runAsync(
      `INSERT INTO sales
        (receipt_number, total_cents, payment_method, amount_tendered_cents, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      receiptNumber,
      totalCents,
      paymentMethod,
      amountTenderedCents,
      new Date().toISOString(),
    );
    for (const [id, quantity] of quantities) {
      const product = products.get(id)!;
      const changed = await transaction.runAsync(
        `UPDATE stock_balances SET quantity = quantity - ?,
           updated_at = CURRENT_TIMESTAMP
         WHERE variant_id = ? AND location_id = ? AND quantity >= ?`,
        quantity,
        id,
        saleLocationId,
        quantity,
      );
      if (changed.changes !== 1) {
        throw new Error(`Stock changed for ${product.name}. Please try again.`);
      }
      await transaction.runAsync(
        `INSERT INTO sale_items
          (sale_id, product_id, variant_id, parent_sku, sku, barcode,
           product_name, variant_name, unit_price_cents, tax_rate_basis_points,
           quantity, line_total_cents)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        sale.lastInsertRowId,
        id,
        product.parentSku,
        product.sku,
        product.barcode,
        product.name,
        product.variantName,
        product.priceCents,
        product.taxRateBasisPoints,
        quantity,
        product.priceCents * quantity,
      );
      await transaction.runAsync(
        `INSERT INTO stock_movements
          (variant_id, location_id, quantity_delta, movement_type,
           reference_type, reference_id, reason)
         VALUES (?, ?, ?, 'sale', 'sale', ?, 'POS sale')`,
        id,
        saleLocationId,
        -quantity,
        String(sale.lastInsertRowId),
      );
    }
    return {
      receiptNumber,
      totalCents,
      changeCents:
        paymentMethod === 'cash' ? amountTenderedCents - totalCents : 0,
    };
  });
}

export async function receiveSupplierStock(
  db: SQLiteDatabase,
  input: StockReceiptInput,
): Promise<number> {
  if (input.lines.length === 0) throw new Error('A receipt needs at least one line.');
  return inTransaction(db, async (transaction) => {
    const locationId = input.locationId ?? (await defaultLocationId(transaction));
    const delivery = await transaction.runAsync(
      `INSERT INTO deliveries
        (supplier_id, location_id, supplier_reference, status, received_at, notes)
       VALUES (?, ?, ?, 'posted', ?, ?)`,
      input.supplierId,
      locationId,
      input.supplierReference ?? null,
      input.receivedAt ?? new Date().toISOString(),
      input.notes ?? null,
    );
    const deliveryId = Number(delivery.lastInsertRowId);
    for (const line of input.lines) {
      if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
        throw new Error('Receipt quantities must be positive numbers.');
      }
      if (!Number.isInteger(line.costExTaxCents) || line.costExTaxCents < 0) {
        throw new Error('Receipt costs must be non-negative integer cents.');
      }
      await transaction.runAsync(
        `INSERT INTO delivery_items
          (delivery_id, variant_id, quantity, cost_ex_tax_cents,
           supplier_code, lot_number, expiry_date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        deliveryId,
        line.variantId,
        line.quantity,
        line.costExTaxCents,
        line.supplierCode ?? null,
        line.lotNumber ?? null,
        line.expiryDate ?? null,
      );
      const costing = await transaction.getFirstAsync<{
        quantity: number;
        cost_ex_tax_cents: number;
      }>(
        `SELECT COALESCE(SUM(sb.quantity), 0) AS quantity,
           v.cost_ex_tax_cents
         FROM product_variants v
         LEFT JOIN stock_balances sb ON sb.variant_id = v.id
         WHERE v.id = ?
         GROUP BY v.id`,
        line.variantId,
      );
      if (!costing) throw new Error('A received product no longer exists.');
      const nextTotalQuantity = costing.quantity + line.quantity;
      const weightedCost = Math.round(
        (costing.quantity * costing.cost_ex_tax_cents +
          line.quantity * line.costExTaxCents) /
          nextTotalQuantity,
      );
      await transaction.runAsync(
        `UPDATE product_variants SET cost_ex_tax_cents = ?,
           updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        weightedCost,
        line.variantId,
      );
      await transaction.runAsync(
        `INSERT INTO stock_balances (variant_id, location_id, quantity)
         VALUES (?, ?, ?)
         ON CONFLICT(variant_id, location_id) DO UPDATE SET
           quantity = quantity + excluded.quantity, updated_at = CURRENT_TIMESTAMP`,
        line.variantId,
        locationId,
        line.quantity,
      );
      await transaction.runAsync(
        `INSERT INTO variant_suppliers
          (variant_id, supplier_id, supplier_code, cost_ex_tax_cents, is_preferred)
         VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(variant_id, supplier_id) DO UPDATE SET
           supplier_code = COALESCE(excluded.supplier_code, supplier_code),
           cost_ex_tax_cents = excluded.cost_ex_tax_cents,
           updated_at = CURRENT_TIMESTAMP`,
        line.variantId,
        input.supplierId,
        line.supplierCode ?? null,
        line.costExTaxCents,
      );
      let lotId: number | null = null;
      if (line.lotNumber) {
        await transaction.runAsync(
          `INSERT INTO stock_lots
            (variant_id, location_id, lot_number, expiry_date, quantity)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(variant_id, location_id, lot_number) DO UPDATE SET
             quantity = quantity + excluded.quantity,
             expiry_date = COALESCE(excluded.expiry_date, expiry_date),
             updated_at = CURRENT_TIMESTAMP`,
          line.variantId,
          locationId,
          line.lotNumber,
          line.expiryDate ?? null,
          line.quantity,
        );
        lotId =
          (
            await transaction.getFirstAsync<{ id: number }>(
              `SELECT id FROM stock_lots
               WHERE variant_id = ? AND location_id = ? AND lot_number = ? COLLATE NOCASE`,
              line.variantId,
              locationId,
              line.lotNumber,
            )
          )?.id ?? null;
      }
      await transaction.runAsync(
        `INSERT INTO stock_movements
          (variant_id, location_id, quantity_delta, movement_type,
           reference_type, reference_id, reason, lot_id)
         VALUES (?, ?, ?, 'receipt', 'delivery', ?, 'Supplier receipt', ?)`,
        line.variantId,
        locationId,
        line.quantity,
        String(deliveryId),
        lotId,
      );
    }
    return deliveryId;
  });
}

export async function getRecentSales(
  db: SQLiteDatabase,
  limit = 50,
): Promise<Sale[]> {
  const rows = await db.getAllAsync<SaleRow>(
    `SELECT s.id, s.receipt_number, s.total_cents, s.payment_method,
       s.amount_tendered_cents, s.created_at,
       COALESCE(SUM(si.quantity), 0) AS item_count
     FROM sales s LEFT JOIN sale_items si ON si.sale_id = s.id
     GROUP BY s.id ORDER BY s.created_at DESC LIMIT ?`,
    Math.min(Math.max(limit, 1), 500),
  );
  return rows.map((row) => ({
    id: row.id,
    receiptNumber: row.receipt_number,
    totalCents: row.total_cents,
    paymentMethod: row.payment_method,
    amountTenderedCents: row.amount_tendered_cents,
    itemCount: row.item_count,
    createdAt: row.created_at,
  }));
}

export async function getDashboardStats(
  db: SQLiteDatabase,
): Promise<DashboardStats> {
  const locationId = await defaultLocationId(db);
  const row = await db.getFirstAsync<{
    product_count: number;
    stock_units: number;
    low_stock_count: number;
    sales_today_cents: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM product_variants WHERE active = 1) AS product_count,
       (SELECT COALESCE(SUM(quantity), 0) FROM stock_balances
        WHERE location_id = ?) AS stock_units,
       (SELECT COUNT(*) FROM product_variants v
        LEFT JOIN stock_balances sb ON sb.variant_id = v.id AND sb.location_id = ?
        WHERE v.active = 1 AND COALESCE(sb.quantity, 0) <= v.reorder_point) AS low_stock_count,
       (SELECT COALESCE(SUM(total_cents), 0) FROM sales
        WHERE date(created_at, 'localtime') = date('now', 'localtime')) AS sales_today_cents`,
    locationId,
    locationId,
  );
  return {
    productCount: row?.product_count ?? 0,
    stockUnits: row?.stock_units ?? 0,
    lowStockCount: row?.low_stock_count ?? 0,
    salesTodayCents: row?.sales_today_cents ?? 0,
  };
}

export async function getLocations(db: SQLiteDatabase): Promise<Location[]> {
  const rows = await db.getAllAsync<{
    id: number;
    code: string;
    name: string;
    is_default: number;
    active: number;
  }>('SELECT id, code, name, is_default, active FROM locations ORDER BY is_default DESC, name');
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    isDefault: row.is_default === 1,
    active: row.active === 1,
  }));
}

export async function getSuppliers(db: SQLiteDatabase): Promise<Supplier[]> {
  const rows = await db.getAllAsync<{
    id: number;
    code: string | null;
    name: string;
    active: number;
  }>('SELECT id, code, name, active FROM suppliers WHERE active = 1 ORDER BY name');
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    active: row.active === 1,
  }));
}

export async function getStoreSettings(
  db: SQLiteDatabase,
): Promise<StoreSettings> {
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    'SELECT key, value FROM store_settings',
  );
  const settings = new Map(rows.map((row) => [row.key, row.value]));
  return {
    storeName: settings.get('store_name') ?? 'DPOS Store',
    storeNumber: settings.get('store_number') ?? '',
    currencyCode: settings.get('currency_code') ?? 'AUD',
    defaultTaxRateBasisPoints: Number(
      settings.get('default_tax_rate_basis_points') ?? 1000,
    ),
    defaultLocationId:
      Number(settings.get('default_location_id')) || (await defaultLocationId(db)),
    pricesIncludeTax: settings.get('prices_include_tax') !== 'false',
  };
}

export async function saveStoreSettings(
  db: SQLiteDatabase,
  settings: StoreSettings,
) {
  if (
    !Number.isInteger(settings.defaultTaxRateBasisPoints) ||
    settings.defaultTaxRateBasisPoints < 0 ||
    settings.defaultTaxRateBasisPoints > 10000
  ) {
    throw new Error('Tax rate must be between 0 and 10,000 basis points.');
  }
  await inTransaction(db, async (transaction) => {
    const location = await transaction.getFirstAsync<{ id: number }>(
      'SELECT id FROM locations WHERE id = ? AND active = 1',
      settings.defaultLocationId,
    );
    if (!location) throw new Error('The selected default location is unavailable.');
    const taxProfileId = await findOrCreateTaxProfile(
      transaction,
      settings.defaultTaxRateBasisPoints,
    );
    const values: Record<string, string> = {
      store_name: settings.storeName,
      store_number: settings.storeNumber,
      currency_code: settings.currencyCode.toUpperCase(),
      default_tax_rate_basis_points: String(settings.defaultTaxRateBasisPoints),
      default_tax_profile_id: String(taxProfileId),
      default_location_id: String(settings.defaultLocationId),
      prices_include_tax: String(settings.pricesIncludeTax),
    };
    for (const [key, value] of Object.entries(values)) {
      await transaction.runAsync(
        `INSERT INTO store_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value,
           updated_at = CURRENT_TIMESTAMP`,
        key,
        value,
      );
    }
    await transaction.runAsync(
      'UPDATE locations SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END',
      settings.defaultLocationId,
    );
    await transaction.runAsync(
      'UPDATE tax_profiles SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END',
      taxProfileId,
    );
  });
}

type ProductImportRunRow = {
  id: number;
  source_filename: string;
  source_hash: string | null;
  package_format_version: string;
  import_mode: ProductImportRunSummary['importMode'];
  status: ProductImportRunSummary['status'];
  total_csv_rows: number;
  parent_product_count: number;
  variants_added: number;
  variants_updated: number;
  variants_skipped: number;
  images_imported: number;
  images_missing: number;
  warning_count: number;
  error_count: number;
  started_at: string;
  completed_at: string;
};

type ProductImportIssueRow = {
  id: number;
  run_id: number;
  csv_row_number: number | null;
  sku: string | null;
  severity: ProductImportReportIssue['severity'];
  code: string;
  message: string;
};

const mapProductImportRun = (
  row: ProductImportRunRow,
): ProductImportRunSummary => ({
  id: row.id,
  sourceFilename: row.source_filename,
  sourceHash: row.source_hash,
  packageFormatVersion: row.package_format_version,
  importMode: row.import_mode,
  status: row.status,
  totalCsvRows: row.total_csv_rows,
  parentProductCount: row.parent_product_count,
  variantsAdded: row.variants_added,
  variantsUpdated: row.variants_updated,
  variantsSkipped: row.variants_skipped,
  imagesImported: row.images_imported,
  imagesMissing: row.images_missing,
  warningCount: row.warning_count,
  errorCount: row.error_count,
  startedAt: row.started_at,
  completedAt: row.completed_at,
});

const mapProductImportIssue = (
  row: ProductImportIssueRow,
): ProductImportReportIssue => ({
  id: row.id,
  runId: row.run_id,
  rowNumber: row.csv_row_number,
  sku: row.sku,
  severity: row.severity,
  code: row.code,
  message: row.message,
});

/**
 * Persists one final package-import report and all of its issues in a single
 * transaction. No in-progress row is created, so an interrupted import cannot
 * leave a dangling report.
 */
export async function saveProductImportReport(
  db: SQLiteDatabase,
  report: ProductImportReportInput,
): Promise<number> {
  return inTransaction(db, async (transaction) => {
    const warningCount = report.issues.filter(
      (issue) => issue.severity === 'warning',
    ).length;
    const errorCount = report.issues.length - warningCount;
    const result = await transaction.runAsync(
      `INSERT INTO product_import_runs
        (source_filename, source_hash, package_format_version, import_mode,
         status, total_csv_rows, parent_product_count, variants_added,
         variants_updated, variants_skipped, images_imported, images_missing,
         warning_count, error_count, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      report.sourceFilename,
      report.sourceHash,
      report.packageFormatVersion,
      report.importMode,
      report.status,
      report.totalCsvRows,
      report.parentProductCount,
      report.variantsAdded,
      report.variantsUpdated,
      report.variantsSkipped,
      report.imagesImported,
      report.imagesMissing,
      warningCount,
      errorCount,
      report.startedAt,
      report.completedAt ?? new Date().toISOString(),
    );
    const runId = Number(result.lastInsertRowId);
    for (const issue of report.issues) {
      await transaction.runAsync(
        `INSERT INTO product_import_issues
          (run_id, csv_row_number, sku, severity, code, message)
         VALUES (?, ?, ?, ?, ?, ?)`,
        runId,
        issue.rowNumber,
        issue.sku,
        issue.severity,
        issue.code,
        issue.message,
      );
    }
    return runId;
  });
}

export async function saveFailedProductImportRun(
  db: SQLiteDatabase,
  report: FailedProductImportReportInput,
): Promise<number> {
  return saveProductImportReport(db, {
    ...report,
    status: 'failed',
    totalCsvRows: report.totalCsvRows ?? 0,
    parentProductCount: report.parentProductCount ?? 0,
    variantsAdded: report.variantsAdded ?? 0,
    variantsUpdated: report.variantsUpdated ?? 0,
    variantsSkipped: report.variantsSkipped ?? 0,
    imagesImported: report.imagesImported ?? 0,
    imagesMissing: report.imagesMissing ?? 0,
  });
}

export async function listProductImportRuns(
  db: SQLiteDatabase,
  limit = 50,
): Promise<ProductImportRunSummary[]> {
  const rows = await db.getAllAsync<ProductImportRunRow>(
    `SELECT * FROM product_import_runs
     ORDER BY started_at DESC, id DESC LIMIT ?`,
    Math.min(Math.max(Math.trunc(limit), 1), 500),
  );
  return rows.map(mapProductImportRun);
}

export async function getProductImportRun(
  db: SQLiteDatabase,
  id: number,
): Promise<ProductImportRun | null> {
  const row = await db.getFirstAsync<ProductImportRunRow>(
    'SELECT * FROM product_import_runs WHERE id = ?',
    id,
  );
  if (!row) return null;
  const issueRows = await db.getAllAsync<ProductImportIssueRow>(
    `SELECT * FROM product_import_issues
     WHERE run_id = ?
     ORDER BY CASE severity WHEN 'error' THEN 0 ELSE 1 END,
       csv_row_number IS NULL DESC, csv_row_number, id`,
    id,
  );
  return {
    ...mapProductImportRun(row),
    issues: issueRows.map(mapProductImportIssue),
  };
}

export async function updateProductImageUriBySku(
  db: SQLiteDatabase,
  sku: string,
  imageUri: string | null,
): Promise<boolean> {
  const result = await db.runAsync(
    `UPDATE product_variants SET image_uri = ?, updated_at = CURRENT_TIMESTAMP
     WHERE sku = ? COLLATE NOCASE`,
    imageUri,
    sku.trim(),
  );
  return result.changes === 1;
}

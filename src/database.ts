import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  CartItem,
  DashboardStats,
  PaymentMethod,
  Product,
  ProductInput,
  Sale,
} from './types';

type ProductRow = {
  id: number;
  sku: string;
  name: string;
  price_cents: number;
  stock: number;
  low_stock_threshold: number;
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

const mapProduct = (row: ProductRow): Product => ({
  id: row.id,
  sku: row.sku,
  name: row.name,
  priceCents: row.price_cents,
  stock: row.stock,
  lowStockThreshold: row.low_stock_threshold,
});

export async function migrateDatabase(db: SQLiteDatabase) {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  const versionRow = await db.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version',
  );
  const version = versionRow?.user_version ?? 0;

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
      PRAGMA user_version = 1;
    `);
  }
}

export async function getProducts(
  db: SQLiteDatabase,
  search = '',
): Promise<Product[]> {
  const term = search.trim();
  const rows = term
    ? await db.getAllAsync<ProductRow>(
        `SELECT id, sku, name, price_cents, stock, low_stock_threshold
         FROM products
         WHERE name LIKE ? OR sku LIKE ?
         ORDER BY name COLLATE NOCASE`,
        `%${term}%`,
        `%${term}%`,
      )
    : await db.getAllAsync<ProductRow>(
        `SELECT id, sku, name, price_cents, stock, low_stock_threshold
         FROM products
         ORDER BY name COLLATE NOCASE`,
      );

  return rows.map(mapProduct);
}

export async function saveProduct(
  db: SQLiteDatabase,
  input: ProductInput,
  id?: number,
) {
  const values = [
    input.sku.trim(),
    input.name.trim(),
    input.priceCents,
    input.stock,
    input.lowStockThreshold,
  ] as const;

  if (id) {
    await db.runAsync(
      `UPDATE products
       SET sku = ?, name = ?, price_cents = ?, stock = ?,
           low_stock_threshold = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      ...values,
      id,
    );
    return;
  }

  await db.runAsync(
    `INSERT INTO products
      (sku, name, price_cents, stock, low_stock_threshold)
     VALUES (?, ?, ?, ?, ?)`,
    ...values,
  );
}

export async function deleteProduct(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM products WHERE id = ?', id);
}

export async function setProductStock(
  db: SQLiteDatabase,
  id: number,
  stock: number,
) {
  await db.runAsync(
    `UPDATE products
     SET stock = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    stock,
    id,
  );
}

export async function completeSale(
  db: SQLiteDatabase,
  cart: CartItem[],
  paymentMethod: PaymentMethod,
  amountTenderedCents: number,
) {
  if (cart.length === 0) {
    throw new Error('Add at least one item before checkout.');
  }

  const receiptNumber = `POS-${Date.now()}-${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0')}`;

  let totalCents = 0;

  await db.withExclusiveTransactionAsync(async (transaction) => {
    const verifiedItems: CartItem[] = [];

    for (const item of cart) {
      const row = await transaction.getFirstAsync<ProductRow>(
        `SELECT id, sku, name, price_cents, stock, low_stock_threshold
         FROM products WHERE id = ?`,
        item.id,
      );
      if (!row) {
        throw new Error(`${item.name} is no longer available.`);
      }
      if (row.stock < item.quantity) {
        throw new Error(
          `Only ${row.stock} ${row.name} item${row.stock === 1 ? '' : 's'} remain.`,
        );
      }
      verifiedItems.push({ ...mapProduct(row), quantity: item.quantity });
      totalCents += row.price_cents * item.quantity;
    }

    if (paymentMethod === 'cash' && amountTenderedCents < totalCents) {
      throw new Error('Cash received is less than the sale total.');
    }

    const saleResult = await transaction.runAsync(
      `INSERT INTO sales
        (receipt_number, total_cents, payment_method, amount_tendered_cents, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      receiptNumber,
      totalCents,
      paymentMethod,
      amountTenderedCents,
      new Date().toISOString(),
    );

    for (const item of verifiedItems) {
      const stockResult = await transaction.runAsync(
        `UPDATE products
         SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND stock >= ?`,
        item.quantity,
        item.id,
        item.quantity,
      );
      if (stockResult.changes !== 1) {
        throw new Error(`Stock changed for ${item.name}. Please try again.`);
      }

      await transaction.runAsync(
        `INSERT INTO sale_items
          (sale_id, product_id, sku, product_name, unit_price_cents, quantity, line_total_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        saleResult.lastInsertRowId,
        item.id,
        item.sku,
        item.name,
        item.priceCents,
        item.quantity,
        item.priceCents * item.quantity,
      );
    }
  });

  return {
    receiptNumber,
    totalCents,
    changeCents:
      paymentMethod === 'cash' ? amountTenderedCents - totalCents : 0,
  };
}

export async function getRecentSales(
  db: SQLiteDatabase,
  limit = 50,
): Promise<Sale[]> {
  const rows = await db.getAllAsync<SaleRow>(
    `SELECT s.id, s.receipt_number, s.total_cents, s.payment_method,
            s.amount_tendered_cents, s.created_at,
            COALESCE(SUM(si.quantity), 0) AS item_count
     FROM sales s
     LEFT JOIN sale_items si ON si.sale_id = s.id
     GROUP BY s.id
     ORDER BY s.created_at DESC
     LIMIT ?`,
    limit,
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
  const row = await db.getFirstAsync<{
    product_count: number;
    stock_units: number;
    low_stock_count: number;
    sales_today_cents: number;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM products) AS product_count,
      (SELECT COALESCE(SUM(stock), 0) FROM products) AS stock_units,
      (SELECT COUNT(*) FROM products WHERE stock <= low_stock_threshold) AS low_stock_count,
      (SELECT COALESCE(SUM(total_cents), 0) FROM sales
       WHERE date(created_at, 'localtime') = date('now', 'localtime')) AS sales_today_cents
  `);

  return {
    productCount: row?.product_count ?? 0,
    stockUnits: row?.stock_units ?? 0,
    lowStockCount: row?.low_stock_count ?? 0,
    salesTodayCents: row?.sales_today_cents ?? 0,
  };
}

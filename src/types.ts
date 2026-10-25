export type Product = {
  /** Sellable variant id. Kept as `id` for compatibility with the current UI. */
  id: number;
  parentId: number;
  externalVariantId: string | null;
  parentSku: string;
  sku: string;
  barcode: string | null;
  name: string;
  variantName: string | null;
  priceCents: number;
  retailPriceIncTaxCents: number;
  wholesalePriceIncTaxCents: number | null;
  costExTaxCents: number;
  taxRateBasisPoints: number;
  stock: number;
  lowStockThreshold: number;
  reorderPoint: number;
  targetStock: number;
  locationId: number;
  location: string;
  binLocation: string | null;
  imageUri: string | null;
  imageFilename: string | null;
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
  supplierCode: string | null;
  manufacturer: string | null;
  variants: string | null;
  batchTracking: boolean;
  expiryTracking: boolean;
  active: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * The original fields remain required so existing screens can save products.
 * Normalized DPOS fields are optional and receive safe defaults.
 */
export type ProductInput = Pick<
  Product,
  | 'sku'
  | 'name'
  | 'priceCents'
  | 'stock'
  | 'lowStockThreshold'
  | 'imageUri'
  | 'category'
  | 'weight'
  | 'dimensions'
  | 'colors'
  | 'sizes'
  | 'brand'
  | 'supplier'
  | 'manufacturer'
  | 'variants'
> &
  Partial<
    Omit<
      Product,
      | 'id'
      | 'parentId'
      | 'createdAt'
      | 'updatedAt'
      | 'priceCents'
      | 'lowStockThreshold'
    >
  >;

export type CartItem = Product & {
  quantity: number;
};

export type PaymentMethod = 'cash' | 'card' | 'other';

export type Sale = {
  id: number;
  receiptNumber: string;
  totalCents: number;
  paymentMethod: PaymentMethod;
  amountTenderedCents: number;
  itemCount: number;
  createdAt: string;
};

export type DashboardStats = {
  productCount: number;
  stockUnits: number;
  lowStockCount: number;
  salesTodayCents: number;
};

export type Location = {
  id: number;
  code: string;
  name: string;
  isDefault: boolean;
  active: boolean;
};

export type Supplier = {
  id: number;
  code: string | null;
  name: string;
  active: boolean;
};

export type StoreSettings = {
  storeName: string;
  storeNumber: string;
  currencyCode: string;
  defaultTaxRateBasisPoints: number;
  defaultLocationId: number;
  pricesIncludeTax: boolean;
};

export type StockAdjustmentInput = {
  variantId: number;
  locationId?: number;
  quantityDelta: number;
  reason?: string;
  notes?: string;
  lotNumber?: string;
  expiryDate?: string;
};

export type StockReceiptLine = {
  variantId: number;
  quantity: number;
  costExTaxCents: number;
  supplierCode?: string;
  lotNumber?: string;
  expiryDate?: string;
};

export type StockReceiptInput = {
  supplierId: number;
  locationId?: number;
  supplierReference?: string;
  receivedAt?: string;
  notes?: string;
  lines: StockReceiptLine[];
};

export type ProductImportIssue = {
  row: number;
  field?: string;
  severity: 'error' | 'warning';
  message: string;
};

export type ProductImportMode = 'strict' | 'valid_rows';

export type ProductImportRunStatus = 'completed' | 'failed' | 'cancelled';

export type ProductImportIssueSeverity = 'warning' | 'error';

export type ProductImportReportIssueInput = {
  rowNumber: number | null;
  sku: string | null;
  severity: ProductImportIssueSeverity;
  code: string;
  message: string;
};

export type ProductImportReportIssue = ProductImportReportIssueInput & {
  id: number;
  runId: number;
};

export type ProductImportRunSummary = {
  id: number;
  sourceFilename: string;
  sourceHash: string | null;
  packageFormatVersion: string;
  importMode: ProductImportMode;
  status: ProductImportRunStatus;
  totalCsvRows: number;
  parentProductCount: number;
  variantsAdded: number;
  variantsUpdated: number;
  variantsSkipped: number;
  imagesImported: number;
  imagesMissing: number;
  warningCount: number;
  errorCount: number;
  startedAt: string;
  completedAt: string;
};

export type ProductImportRunHistory = ProductImportRunSummary[];

export type ProductImportRun = ProductImportRunSummary & {
  issues: ProductImportReportIssue[];
};

export type ProductImportReportInput = Omit<
  ProductImportRunSummary,
  'id' | 'warningCount' | 'errorCount' | 'completedAt'
> & {
  completedAt?: string;
  issues: ProductImportReportIssueInput[];
};

export type FailedProductImportReportInput = Pick<
  ProductImportReportInput,
  | 'sourceFilename'
  | 'sourceHash'
  | 'packageFormatVersion'
  | 'importMode'
  | 'startedAt'
  | 'completedAt'
  | 'issues'
> &
  Partial<
    Pick<
      ProductImportReportInput,
      | 'totalCsvRows'
      | 'parentProductCount'
      | 'variantsAdded'
      | 'variantsUpdated'
      | 'variantsSkipped'
      | 'imagesImported'
      | 'imagesMissing'
    >
  >;

export type ProductImportRow = {
  rowNumber: number;
  externalVariantId: string | null;
  parentSku: string;
  sku: string;
  barcode: string;
  productName: string;
  variantName: string | null;
  brand: string | null;
  category: string | null;
  subcategory: string | null;
  description: string | null;
  supplier: string | null;
  supplierCode: string | null;
  unit: string;
  costExTaxCents: number;
  retailPriceIncTaxCents: number;
  wholesalePriceIncTaxCents: number | null;
  taxRateBasisPoints: number;
  openingStock: number;
  reorderPoint: number;
  targetStock: number;
  stockLocation: string;
  batchTracking: boolean;
  expiryTracking: boolean;
  active: boolean;
  imageFilename: string | null;
  imageUri?: string | null;
  binLocation?: string | null;
  weight: string | null;
  dimensions: string | null;
  manufacturer: string | null;
  notes: string | null;
  createdAt: string | null;
};

export type ProductImportPreview = {
  rows: ProductImportRow[];
  issues: ProductImportIssue[];
  validRowCount: number;
  parentCount: number;
  supplierCount: number;
  locationCount: number;
  calculatedInventoryValueCents: number;
};

export type ProductImportResult = {
  parentCount: number;
  variantCount: number;
  variantsAdded: number;
  variantsUpdated: number;
  supplierCount: number;
  locationCount: number;
  openingStockUnits: number;
};

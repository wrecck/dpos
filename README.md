# DPOS

An Android-first, offline point-of-sale and inventory app built with Expo,
React Native, TypeScript, and SQLite. The same codebase also supports iOS.

## MVP features

- Parent product catalog with independently sellable SKU/barcode variants
- Product images, brands, categories, descriptions, supplier codes, units,
  retail/wholesale prices, tax rates, and replenishment targets
- Searchable grouped register with variant selection and exact SKU/barcode entry
- Cart quantity controls and stock validation
- Cash, card, and other payment recording
- Atomic checkout that records the sale and deducts inventory together
- Multiple stock locations with Main Store as the default
- Supplier delivery receipts with weighted-average cost, batch, and expiry data
- Full stock movement ledger and per-location balances
- Validated, transactional CSV preview/import for large catalogs
- Configurable store name, currency, tax, and default location
- Sales activity dashboard and recent receipt history
- On-device SQLite persistence with no network connection required

## Run on Android

Requirements:

- Node.js and npm
- Android Studio/emulator, or an Android phone with Expo Go

```bash
npm install
npm run android
```

To use a physical device, start the development server with `npm start`, then
scan the QR code in Expo Go. The computer and phone need to be on the same
network for the development bundle; after the app is installed and loaded, POS
data operations themselves do not require connectivity.

## Local data

The database is named `dpos.db` and is stored in the app's private device
storage. WAL mode and foreign keys are enabled. Checkout, catalog import, stock
adjustment, and delivery posting are transactional, so partial writes roll back.

Uninstalling the app or clearing its Android app data deletes the local
database. Backup, restore, user accounts, cloud sync, camera barcode scanning,
discounts, and receipt printing are outside this release.

## Configuration

Prices are stored as integer cents and tax as basis points to avoid
floating-point rounding errors. New stores default to AUD, 10% GST,
tax-inclusive selling prices, and Main Store. Use the settings button in the
app header to change these values.

## Product package import

Create a ZIP containing
[`docs/dpos-import-manifest.json`](docs/dpos-import-manifest.json),
[`docs/dpos-product-import-template.csv`](docs/dpos-product-import-template.csv)
and an `images/` directory. The complete package structure, validation rules,
strict/partial modes and legacy GST-header aliases are documented in
[`docs/product-import-format.md`](docs/product-import-format.md). Re-importing an
existing SKU updates catalog data without resetting live stock. Persistent
reports list added, updated and skipped variants and can be exported as CSV.

## Checks

```bash
npm run typecheck
npx expo-doctor
```

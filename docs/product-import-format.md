# DPOS product import format

Use UTF-8 CSV with one row per sellable variant. Download
`dpos-product-import-template.csv` as the canonical header and example. CSV follows
RFC 4180: quote fields containing commas, quotes, or line breaks and escape a quote
as `""`.

## Required and unique values

`Parent SKU`, `SKU`, `Product Name`, `Cost ex Tax`, and
`Retail Price inc Tax` are required. SKU must be unique. A barcode is optional,
but when present it must be unique within the file and database. Variants with the same Parent SKU become variants of one
parent product; their parent name, brand, category, and subcategory must agree.

The importer also accepts these legacy sample names:

- `Product ID` for `External Variant ID`
- `Variant` for `Variant Name`
- `Cost ex GST`, `Retail Price inc GST`, `Wholesale Price inc GST`, and
  `GST Rate` for their Tax equivalents
- `Created Date` for `Created At`

Legacy `Image Path`, `Margin %`, and `Inventory Value` columns are ignored.
Margin and inventory value are always calculated from normalized prices, cost,
and stock. They are never trusted as source data.

## Columns

| Column | Rules |
| --- | --- |
| External Variant ID | Optional source-system identifier. |
| Parent SKU | Required grouping key for the parent product. |
| SKU | Required unique sellable-variant SKU. |
| Barcode | Optional unique barcode; retain leading zeroes by exporting it as text. |
| Product Name | Required parent product name. |
| Variant Name | Optional variant label, such as `250 mL`. |
| Brand, Category, Subcategory, Description | Optional parent attributes. |
| Supplier, Supplier Code | Optional preferred supplier and that supplier's code for this variant. |
| Unit | Defaults to `Each`. |
| Cost ex Tax | Non-negative decimal currency amount, at most two decimal places. |
| Retail Price inc Tax | Required non-negative decimal currency amount. |
| Wholesale Price inc Tax | Optional non-negative decimal currency amount. |
| Tax Rate | Decimal fraction (`0.1`), percentage (`10`), or percent (`10%`). Blank defaults to 10%. Stored as integer basis points. |
| Opening Stock | Non-negative quantity; decimals are supported for weighted goods. Blank is zero. |
| Reorder Point, Target Stock | Non-negative whole units; blank is zero. |
| Stock Location | Location name; blank means `Main Store`. New names create location records. |
| Batch Tracking, Expiry Tracking, Active | `Yes`/`No`; also accepts `true`/`false` and `1`/`0`. |
| Image Filename | Filename only, for example `item-01.png`; paths are rejected. |
| Weight, Dimensions, Manufacturer, Notes | Optional descriptive values. |
| Created At | Optional ISO date or timestamp, for example `2026-09-05`. |

Money is converted to integer cents and tax to integer basis points before any
database write. The import validates the complete file first, then writes parent
products, variants, categories, suppliers, locations, balances, and opening
ledger entries in one transaction. Any conflict rolls back the entire import.

## Images and extensions

Images are not embedded in the CSV. An optional ZIP may accompany the import;
its root filenames should exactly match `Image Filename`. The UI must unpack and
persist those files before assigning local image URIs.

Large or many-to-many supplier catalogs may use a future supplier extension CSV
with `SKU, Supplier, Supplier Code, Cost ex Tax, Preferred`. Lot opening balances
may use a future lot extension CSV with
`SKU, Stock Location, Lot Number, Expiry Date, Quantity`. The base importer does
not consume either extension yet; supplier receipts can already create supplier
links and lots through the backend API.

## Backend integration

- `previewProductImportCsv(csvText)` parses and validates without writing.
- `importProductsCsv(db, csvText)` revalidates and imports atomically.
- `receiveSupplierStock(db, receipt)` posts a delivery, balances, optional lots,
  supplier costs, and receipt movements.
- `adjustStock(db, adjustment)` records a balanced manual adjustment and
  optional lot.
- `getLocations`, `getSuppliers`, `getStoreSettings`, and `saveStoreSettings`
  support setup and stock-location selection.

Current register calls remain valid. To sell stock outside the configured
default location, pass its location ID to the optional final argument of
`completeSale`; pass the same location to `getProducts`.

# DPOS product import package

DPOS imports a versioned ZIP package so catalog data and local product images
arrive together.

```text
dpos-product-import.zip
├── manifest.json
├── dpos-products-import.csv
└── images/
    ├── SHAMPOO-01-250.png
    └── SHAMPOO-01-500.jpg
```

The ZIP must not be password protected. Files outside this structure are
ignored or reported. Nested image folders, symlinks, absolute paths and `..`
paths are rejected. Current limits are 250 MB compressed, 600 MB expanded,
20,000 entries, 25 MB for the CSV and 12 MB per image.

## Manifest

`manifest.json` must be at the ZIP root:

```json
{
  "format": "dpos-product-import",
  "version": 1,
  "createdAt": "2026-09-05T00:00:00Z",
  "productsFile": "dpos-products-import.csv",
  "imagesDirectory": "images"
}
```

The manifest version allows DPOS to reject unsupported future formats safely.

## CSV

Use UTF-8 CSV with one row per sellable variant. The canonical header and
example are in `dpos-product-import-template.csv`. CSV follows RFC 4180: quote
fields containing commas, quotes or line breaks and escape a quote as `""`.

`Parent SKU`, `SKU`, `Product Name`, `Cost ex Tax` and
`Retail Price inc Tax` are required. SKU must be unique. Barcode is optional,
but when present must be unique. Rows sharing a Parent SKU become variants of
one parent product and must agree on parent name, brand, category and
subcategory.

Legacy aliases remain accepted:

- `Product ID` → `External Variant ID`
- `Variant` → `Variant Name`
- `Cost ex GST`, `Retail Price inc GST`, `Wholesale Price inc GST`, `GST Rate`
  → their Tax equivalents
- `Created Date` → `Created At`

Legacy `Image Path`, `Margin %` and `Inventory Value` columns are ignored.
Margin and inventory value are calculated by DPOS.

## Important columns

| Column | Rules |
| --- | --- |
| Parent SKU | Required parent grouping key. |
| SKU | Required unique sellable-variant SKU. Existing SKUs are updated. |
| Barcode | Optional unique barcode; preserve leading zeroes as text. |
| Product Name, Variant Name | Parent name and optional variant label. |
| Cost ex Tax | Non-negative currency amount with at most two decimals. |
| Retail/Wholesale Price inc Tax | Retail required; wholesale optional. |
| Tax Rate | `0.1`, `10` or `10%`; blank defaults to 10%. |
| Opening Stock | Non-negative quantity. Applied only to new SKUs. |
| Stock Location | Store or warehouse, e.g. `Main Store`. |
| Bin Location | Shelf/bin inside that location, e.g. `A-02`. |
| Batch/Expiry Tracking, Active | Yes/No; true/false and 1/0 also work. |
| Image Filename | Filename only; must match a root file in `images/`. |
| Created At | Optional ISO date or timestamp. |

Supported image formats are JPG/JPEG, PNG and WebP. Filename matching is
case-insensitive, but duplicate names that differ only by case are rejected.
Several variants may reference the same image. Missing images are warnings:
the product can still import without an image.

## Validation and import modes

The complete package is validated before import.

- **Strict** imports nothing when any error exists.
- **Valid rows only** skips rows with errors and imports the remaining variants.
  Package-level safety or manifest errors always block the whole package.

Catalog and stock writes are transactional. New SKUs receive opening stock;
existing SKUs update catalog fields without resetting live stock. Images are
staged in private app storage and removed when the database import fails.

Every attempted import creates a persistent report containing package hash,
mode, parent count, variants added/updated/skipped, images imported/missing,
warnings and errors. Reports list row number, SKU and reason and can be exported
as CSV from Import History.

## Creating the ZIP

Place `manifest.json`, `dpos-products-import.csv` and `images/` together, select
those three items, and create a ZIP. They must be at the ZIP root—not inside an
extra enclosing folder.

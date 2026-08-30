# DPOS

An Android-first, offline point-of-sale and inventory app built with Expo,
React Native, TypeScript, and SQLite. The same codebase also supports iOS.

## MVP features

- Product catalog with SKU, selling price, stock, and low-stock threshold
- Searchable two-column register
- Cart quantity controls and stock validation
- Cash, card, and other payment recording
- Atomic checkout that records the sale and deducts inventory together
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
storage. WAL mode and foreign keys are enabled. Checkout uses an exclusive
transaction, so a failed stock update also rolls back the receipt and all line
items.

Uninstalling the app or clearing its Android app data deletes the local
database. Backup, restore, user accounts, cloud sync, tax, discounts, barcode
scanning, and receipt printing are intentionally outside this first MVP.

## Configuration

Prices are stored as integer cents to avoid floating-point rounding errors.
The display currency defaults to USD and can be changed in
`src/utils.ts` (`CURRENCY_CODE`).

## Checks

```bash
npm run typecheck
npx expo-doctor
```

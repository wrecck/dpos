export const CURRENCY_CODE = 'USD';

export function formatMoney(cents: number) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: CURRENCY_CODE,
  }).format(cents / 100);
}

export function parseMoney(value: string) {
  const amount = Number(value.replace(',', '.').trim());
  return Number.isFinite(amount) ? Math.round(amount * 100) : Number.NaN;
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (
      error.message.includes('UNIQUE constraint failed: products.sku') ||
      error.message.includes('products.sku')
    ) {
      return 'That SKU is already in use.';
    }
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}

export type Product = {
  id: number;
  sku: string;
  name: string;
  priceCents: number;
  stock: number;
  lowStockThreshold: number;
};

export type ProductInput = Omit<Product, 'id'>;

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

export type DeliveryOrderStatus = 'pending' | 'processing' | 'delivering' | 'completed' | 'cancelled';

export type DeliveryOrder = {
  id: string;
  code: string;
  trackingToken?: string;
  trackingUrl?: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  paymentMethod?: string;
  changeFor?: number;
  total: number;
  status: DeliveryOrderStatus | string;
  deliveryStartedAt?: string | null;
  deliveryFinishedAt?: string | null;
  updatedAt?: string;
  items?: Array<{
    productName: string;
    quantity: number;
    notes?: string;
  }>;
};

export type RoutePoint = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  speedMetersPerSecond?: number | null;
  headingDegrees?: number | null;
  recordedAt: string;
};

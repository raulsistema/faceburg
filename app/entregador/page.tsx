'use client';

import DashboardShell from '@/components/layout/DashboardShell';
import DeliveryDriverClient from '@/components/delivery/DeliveryDriverClient';

export default function EntregadorPage() {
  return (
    <DashboardShell>
      <DeliveryDriverClient />
    </DashboardShell>
  );
}

'use client';

import DashboardShell from '@/components/layout/DashboardShell';
import DeliveryDriversAdminClient from '@/components/delivery/DeliveryDriversAdminClient';

export default function EntregadoresPage() {
  return (
    <DashboardShell>
      <DeliveryDriversAdminClient />
    </DashboardShell>
  );
}

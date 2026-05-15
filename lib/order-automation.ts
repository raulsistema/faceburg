import { query, type DbExecutor } from '@/lib/db';
import { normalizeAutoAcceptOrders } from '@/lib/print-settings';

type OrderAutomationRow = {
  auto_accept_orders: boolean | null;
};

export type OrderAutomationConfig = {
  autoAcceptOrders: boolean;
};

export async function getOrderAutomationConfig(
  tenantId: string,
  executor: DbExecutor = { query },
): Promise<OrderAutomationConfig> {
  const result = await executor.query<OrderAutomationRow>(
    `SELECT auto_accept_orders
     FROM printer_agents
     WHERE tenant_id = $1
     LIMIT 1`,
    [tenantId],
  );

  return {
    autoAcceptOrders: normalizeAutoAcceptOrders(result.rows[0]?.auto_accept_orders),
  };
}

export function initialOrderStatusForAutomation(config: OrderAutomationConfig) {
  return config.autoAcceptOrders ? 'processing' : 'pending';
}

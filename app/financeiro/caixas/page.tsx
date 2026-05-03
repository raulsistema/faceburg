import DashboardShell from '@/components/layout/DashboardShell';
import CashRegistersView from '@/components/finance/CashRegistersView';

export default function FinanceiroCaixasPage() {
  return (
    <DashboardShell>
      <CashRegistersView />
    </DashboardShell>
  );
}

import DashboardShell from '@/components/layout/DashboardShell';
import FinancialMovementsView from '@/components/finance/FinancialMovementsView';

export default function FinanceiroMovimentacoesPage() {
  return (
    <DashboardShell>
      <FinancialMovementsView />
    </DashboardShell>
  );
}

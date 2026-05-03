import DashboardShell from '@/components/layout/DashboardShell';
import PaymentMethodsSettings from '@/app/settings/PaymentMethodsSettings';

export default function FinanceiroFormasPagamentoPage() {
  return (
    <DashboardShell>
      <div className="max-w-5xl space-y-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <h2 className="text-xl font-bold text-slate-900 mb-2">Formas de Pagamento</h2>
          <p className="text-sm text-slate-500">Cadastre taxa, prazo de recebimento e disponibilidade de cada forma.</p>
        </div>

        <PaymentMethodsSettings />
      </div>
    </DashboardShell>
  );
}

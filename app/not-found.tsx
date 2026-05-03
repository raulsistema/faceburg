import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-16 text-slate-900">
      <div className="mx-auto flex max-w-lg flex-col items-start gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">404</p>
        <h1 className="text-2xl font-black">Pagina nao encontrada</h1>
        <p className="text-sm text-slate-500">O endereco acessado nao existe ou foi movido dentro do Faceburg.</p>
        <Link href="/pedidos" className="btn-primary">
          Voltar para pedidos
        </Link>
      </div>
    </main>
  );
}

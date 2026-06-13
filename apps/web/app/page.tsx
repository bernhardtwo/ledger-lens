import { AccountPicker } from "../components/AccountPicker";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">LedgerLens</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Pick a demo account to explore. Synthetic data only.
        </p>
      </header>

      <section aria-label="Accounts">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-400">
          Demo accounts
        </h2>
        <AccountPicker />
      </section>

      <footer className="mt-12 text-xs text-zinc-400">
        Phase 6 · upload, transactions and chat arrive in Chunk C.
      </footer>
    </main>
  );
}

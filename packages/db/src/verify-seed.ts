/**
 * Post-seed verification (ADR-0012, spec 0007). A fail-closed assertion that the demo
 * world is actually present, so a no-op migrate/seed can never pass as green again —
 * the local compose verification job and the cloud ACA Job both run this after
 * seeding. Determinism-first: pure reads, no LLM.
 */
import { realpathSync } from "node:fs";
import { argv, stdout } from "node:process";
import { pathToFileURL } from "node:url";
import { getAccountById } from "./accounts.repository.js";
import { createDatabase } from "./client.js";
import { listTransactions } from "./repository.js";
import { SEED_ACCOUNTS } from "./seed.js";

/** Assert every seed account exists and at least one has transactions; throw otherwise. */
export async function verifySeed(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("DATABASE_URL is required to verify the seed");
  }
  const { db, client } = createDatabase(url);
  try {
    let withTransactions = 0;
    for (const account of SEED_ACCOUNTS) {
      if ((await getAccountById(db, account.id)) === null) {
        throw new Error(`seed verification failed: account ${account.id} is missing`);
      }
      const page = await listTransactions(db, { accountId: account.id, limit: 1, cursor: null });
      if (page.items.length > 0) {
        withTransactions += 1;
      }
    }
    if (withTransactions === 0) {
      throw new Error("seed verification failed: no transactions in any seed account");
    }
    // Live TLS check (ADR-0011, spec 0007). When the URL requests SSL, assert this
    // session is actually encrypted (pg_stat_ssl observes the backend's socket) and
    // log the server's enforcement setting. Fail-closed; no-op locally (dev/
    // testcontainers URLs carry no sslmode). Note: against a TLS-requiring managed
    // server, a URL that *drops* sslmode fails to connect at all — so plaintext can't
    // silently slip through even though this assertion is gated on the requested mode.
    const wantsSsl = /[?&]sslmode=(require|verify-ca|verify-full)/.test(url);
    const sslRows = await client<{ ssl: boolean }[]>`
      select ssl from pg_stat_ssl where pid = pg_backend_pid()`;
    const sslActive = sslRows[0]?.ssl === true;
    // require_secure_transport is an Azure Flexible Server parameter, absent on vanilla
    // PostgreSQL (local / testcontainers) — query it best-effort for enforcement
    // visibility without breaking the non-Azure path.
    let enforced = "n/a";
    try {
      const enforceRows = await client<{ require_secure_transport: string }[]>`
        show require_secure_transport`;
      enforced = enforceRows[0]?.require_secure_transport ?? "unknown";
    } catch {
      enforced = "n/a";
    }
    stdout.write(
      `db tls: session_ssl=${sslActive} server_require_secure_transport=${enforced} (sslmode requested: ${wantsSsl})\n`,
    );
    if (wantsSsl && !sslActive) {
      throw new Error(
        "expected a TLS session (sslmode=require) but pg_stat_ssl reports it is not encrypted",
      );
    }
    stdout.write(
      `seed verification ok: ${SEED_ACCOUNTS.length} accounts present, ${withTransactions} with transactions\n`,
    );
  } finally {
    await client.end();
  }
}

const entry = argv[1];
// Realpath so the guard fires through the pnpm-deploy symlink (ADR-0012).
if (entry !== undefined && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  await verifySeed();
}

// ════════════════════════════════════════════════════════════════
// STARTUP CHECKS — fail fast if production secrets are unset
// ════════════════════════════════════════════════════════════════
// In production we want the server to refuse to boot if required
// secrets are missing or set to baked-in defaults. In development
// we warn loudly but still boot so contributors aren't blocked.
// ════════════════════════════════════════════════════════════════

const PROD = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;

const REQUIRED_PROD: Array<{ name: string; bannedDefault?: string }> = [
  { name: 'JWT_SECRET' },
  { name: 'GEMINI_API_KEY' },
  { name: 'DASHBOARD_PASS', bannedDefault: '999999999' },
  { name: 'IP_HASH_SALT', bannedDefault: 'mvo-2026-rotate-this-eventually' },
  { name: 'STRIPE_SECRET_KEY' },
  { name: 'STRIPE_WEBHOOK_SECRET' },
];

export function runStartupChecks(): void {
  const fails: string[] = [];

  for (const { name, bannedDefault } of REQUIRED_PROD) {
    const v = process.env[name];
    if (!v) {
      fails.push(`${name} is unset`);
      continue;
    }
    if (bannedDefault && v === bannedDefault) {
      fails.push(`${name} is using the baked-in default — ROTATE before serving traffic`);
    }
  }

  if (fails.length === 0) {
    console.log('[startup] all required env vars present');
    return;
  }

  console.error('═══════════════════════════════════════════════════════');
  console.error(' STARTUP CHECK FAILED');
  console.error('═══════════════════════════════════════════════════════');
  for (const f of fails) console.error(`  ✗ ${f}`);
  console.error('═══════════════════════════════════════════════════════');

  if (PROD) {
    console.error(' Refusing to boot in production with missing/default secrets.');
    console.error(' Set the variables above in Railway → Project → Variables.');
    process.exit(1);
  } else {
    console.warn(' Continuing in dev mode — fix these before deploying.');
  }
}

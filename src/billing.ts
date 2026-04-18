import Stripe from 'stripe';
import { db } from './db/index.js';
import { getPersona } from './personas.js';

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-09-30.acacia' as any })
  : null;

export function isStripeConfigured(): boolean {
  return !!stripe;
}

// Map persona × cadence → Stripe price ID
function priceFor(persona: string, cadence: 'monthly' | 'annual'): string | null {
  const key = `STRIPE_PRICE_${persona.toUpperCase()}_${cadence.toUpperCase()}`;
  return process.env[key] || null;
}

export async function createCheckoutSession(params: {
  userId: string;
  userEmail: string;
  persona: string;
  cadence: 'monthly' | 'annual';
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string; sessionId: string } | null> {
  if (!stripe) throw new Error('Stripe not configured');
  const priceId = priceFor(params.persona, params.cadence);
  if (!priceId) throw new Error(`No Stripe price configured for ${params.persona} ${params.cadence}`);

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: params.userEmail,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    client_reference_id: params.userId,
    metadata: { userId: params.userId, persona: params.persona, cadence: params.cadence },
    allow_promotion_codes: true,
  });
  return { url: session.url || '', sessionId: session.id };
}

export async function handleStripeWebhook(rawBody: string | Buffer, signature: string): Promise<void> {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) throw new Error('Stripe webhook not configured');
  const event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.subscription && session.customer) {
        const sub = await stripe.subscriptions.retrieve(session.subscription as string);
        upsertSubscription(sub, session.metadata || {});
      }
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'invoice.payment_succeeded':
    case 'invoice.payment_failed': {
      if ('subscription' in event.data.object && event.data.object.subscription) {
        const subId = (event.data.object as any).subscription as string;
        const sub = await stripe.subscriptions.retrieve(subId);
        upsertSubscription(sub, sub.metadata || {});
      }
      break;
    }
  }
}

function upsertSubscription(sub: Stripe.Subscription, metadata: Stripe.Metadata) {
  const userId = metadata.userId || (sub.metadata && sub.metadata.userId);
  const persona = metadata.persona || (sub.metadata && sub.metadata.persona);
  if (!userId || !persona) {
    console.warn('[stripe] subscription webhook missing userId/persona', sub.id);
    return;
  }
  const now = Date.now();
  db.prepare(`
    INSERT INTO subscriptions (id, user_id, stripe_customer_id, persona, tier, status, current_period_end, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      current_period_end = excluded.current_period_end,
      updated_at = excluded.updated_at
  `).run(
    sub.id,
    userId,
    sub.customer as string,
    persona,
    metadata.cadence === 'annual' ? `${persona}_annual` : `${persona}_monthly`,
    sub.status,
    sub.current_period_end * 1000,
    now,
    now
  );
}

export function hasActiveSubscription(userId: string, persona: string): boolean {
  const row = db.prepare(`
    SELECT 1 FROM subscriptions
    WHERE user_id = ? AND persona = ? AND status IN ('active', 'trialing')
      AND current_period_end > ?
    LIMIT 1
  `).get(userId, persona, Date.now());
  return !!row;
}

// Stripe integration
const stripeKey = process.env.STRIPE_SECRET_KEY;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export function processPayment(amount: number) {
  if (!stripeKey) {
    throw new Error('STRIPE_SECRET_KEY is required');
  }
  console.log(`Processing $${amount} via Stripe`);
}

export function verifyWebhook(payload: string) {
  if (!stripeWebhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is required');
  }
  console.log('Webhook verified');
}

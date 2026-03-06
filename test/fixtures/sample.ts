// Sample source file used by EnvGuardian tests

// Dot access
const apiKey = process.env.API_KEY;
const dbUrl = process.env.DATABASE_URL;

// Bracket access (single quotes)
const redisHost = process.env['REDIS_HOST'];

// Bracket access (double quotes)
const sendgridKey = process.env["SENDGRID_KEY"];

// Dynamic access — should NOT be indexed
const dynamicVar = 'SECRET_TOKEN';
const dynamicAccess = process.env[dynamicVar]; // ignored

// Commented-out usage — IS indexed by design (may still be relevant)
// const stripeKey = process.env.STRIPE_SECRET_KEY;

export { apiKey, dbUrl, redisHost, sendgridKey, dynamicAccess };

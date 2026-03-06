// Database
export const dbUrl = process.env.DATABASE_URL;
const dbPoolSize = process.env.DB_POOL_SIZE || '10';

// Redis
const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = process.env.REDIS_PORT || '6379';

// Auth
const jwtSecret = process.env.JWT_SECRET;
const sessionTtl = process.env.SESSION_TTL || '3600';

export const config = {
  dbUrl,
  dbPoolSize: parseInt(dbPoolSize),
  redisHost,
  redisPort: parseInt(redisPort),
  jwtSecret,
  sessionTtl: parseInt(sessionTtl),
};

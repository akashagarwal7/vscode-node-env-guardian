import { config } from './config';
import { sendEmail } from './mailer';

const port = process.env.PORT || 3000;
const appName = process.env.APP_NAME || 'MyApp';

console.log(`Starting ${appName} on port ${port}`);
console.log(`Database: ${config.dbUrl}`);
console.log(`Redis: ${config.redisHost}:${config.redisPort}`);

sendEmail('admin@example.com', `${appName} started`);

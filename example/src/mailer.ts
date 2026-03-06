const smtpHost = process.env.SMTP_HOST;
const smtpPort = process.env.SMTP_PORT || '587';
const sendgridKey = process.env['SENDGRID_API_KEY'];

export function sendEmail(to: string, subject: string) {
  if (sendgridKey) {
    console.log(`Sending via SendGrid to ${to}: ${subject}`);
  } else if (smtpHost) {
    console.log(`Sending via SMTP ${smtpHost}:${smtpPort} to ${to}: ${subject}`);
  } else {
    console.warn('No email provider configured');
  }
}

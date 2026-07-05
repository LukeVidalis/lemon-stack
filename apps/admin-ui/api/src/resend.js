import axios from 'axios';

const apiKey = process.env.RESEND_API_KEY;

export async function sendInviteEmail({ to, name, recoveryLink }) {
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured');

  await axios.post(
    'https://api.resend.com/emails',
    {
      from: 'noreply@{{DOMAIN}}',
      to: [to],
      subject: "You've been invited to lemon-server",
      html: `<p>Hi ${name},</p>
<p>An account has been created for you on lemon-server. Click the link below to set your password and get started:</p>
<p><a href="${recoveryLink}">${recoveryLink}</a></p>
<p>This link expires after one use.</p>`,
    },
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );
}

export const isConfigured = () => Boolean(apiKey);

# Feedback email configuration

Feedback records are stored in SQLite before an email notification is attempted. On Render, use the HTTPS Resend provider because outbound SMTP connections can time out. Configure these variables:

```env
FEEDBACK_EMAIL_TO=statikgoapp@gmail.com
FEEDBACK_EMAIL_FROM=onboarding@resend.dev
RESEND_API_KEY=re_...
```

`FEEDBACK_EMAIL_FROM` must be a sender/domain permitted by Resend. The `onboarding@resend.dev` sender is suitable for initial testing under Resend's test restrictions; verify a domain for production delivery.

SMTP remains supported as a fallback for environments where outbound SMTP is available:

```env
FEEDBACK_EMAIL_TO=statikgoapp@gmail.com
FEEDBACK_EMAIL_FROM=your-verified-sender@example.com
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-username
SMTP_PASSWORD=your-smtp-password
```

`SMTP_PASSWORD` and the other values must be provided through Render environment variables or the local environment. They must not be committed to source control. If SMTP is unavailable, the feedback remains saved in the database and the server logs the notification error.
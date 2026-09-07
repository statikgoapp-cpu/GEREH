# Feedback email configuration

Feedback records are stored in SQLite before an email notification is attempted. Configure these environment variables on the production server to enable SMTP delivery:

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
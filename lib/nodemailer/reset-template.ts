/**
 * Password-reset email. Self-contained, responsive HTML (tables + inline styles
 * for broad email-client support). Placeholders: {{name}}, {{url}}.
 */
export const PASSWORD_RESET_EMAIL_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset your stockMania password</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0b12;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0b12;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#12141f;border:1px solid #242838;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:32px 32px 8px 32px;">
              <div style="display:inline-block;width:40px;height:40px;border-radius:11px;background:linear-gradient(135deg,#9d90ff,#5b50e8);text-align:center;line-height:40px;color:#ffffff;font-weight:700;">sM</div>
              <h1 style="margin:24px 0 0 0;color:#f5f7fb;font-size:22px;font-weight:700;">Reset your password</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 0 32px;">
              <p style="margin:0 0 16px 0;color:#c3c9d6;font-size:14px;line-height:22px;">
                Hi {{name}}, we received a request to reset your stockMania password.
                Click the button below to choose a new one. This link expires in 1 hour.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 8px 32px;">
              <a href="{{url}}" style="display:inline-block;background:linear-gradient(135deg,#8b7cff,#5b50e8);color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:13px 28px;border-radius:12px;">
                Reset password
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 32px 32px;">
              <p style="margin:0 0 8px 0;color:#8a91a6;font-size:12px;line-height:18px;">
                If the button doesn't work, paste this link into your browser:
              </p>
              <p style="margin:0 0 16px 0;word-break:break-all;color:#9d90ff;font-size:12px;">{{url}}</p>
              <p style="margin:0;color:#8a91a6;font-size:12px;line-height:18px;">
                Didn't request this? You can safely ignore this email — your password won't change.
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0 0;color:#5b6472;font-size:11px;">© stockMania</p>
      </td>
    </tr>
  </table>
</body>
</html>`;

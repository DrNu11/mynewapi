package common

import (
	"fmt"
	"html"
)

// BuildEmailVerificationMessage returns a self-contained transactional email
// that renders consistently across desktop and mobile email clients.
func BuildEmailVerificationMessage(systemName, code string, validMinutes int) (string, string) {
	safeSystemName := html.EscapeString(systemName)
	safeCode := html.EscapeString(code)
	subject := fmt.Sprintf("【%s】🔐 您的邮箱验证码", systemName)
	safeSubject := html.EscapeString(subject)

	body := fmt.Sprintf(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>%s</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f3ff;color:#1f2937;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">您正在进行邮箱安全验证，验证码将在 %d 分钟后失效。</div>
  <table role="presentation" width="100%%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f5f3ff;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background-color:#ffffff;border:1px solid #e9e5ff;border-radius:18px;overflow:hidden;box-shadow:0 12px 36px rgba(76,29,149,0.10);">
          <tr>
            <td style="background-color:#6d28d9;padding:24px 32px;color:#ffffff;">
              <div style="font-size:22px;font-weight:800;letter-spacing:0.2px;">%s</div>
              <div style="margin-top:6px;font-size:12px;letter-spacing:1.8px;color:#ddd6fe;">SECURE EMAIL · 安全验证</div>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 32px 28px;">
              <div style="font-size:28px;font-weight:800;line-height:1.35;color:#111827;">🔐 验证您的邮箱</div>
              <p style="margin:14px 0 0;font-size:16px;line-height:1.8;color:#4b5563;">👋 您好，欢迎使用 %s。请在验证页面输入下面的 6 位验证码，完成本次身份确认 ✨</p>

              <div style="margin:28px 0;padding:24px;border:1px solid #ddd6fe;border-radius:14px;background-color:#faf9ff;text-align:center;">
                <div style="font-size:13px;font-weight:700;letter-spacing:1.6px;color:#7c3aed;">您的验证码</div>
                <div style="margin-top:10px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;font-size:36px;font-weight:800;line-height:1.3;letter-spacing:8px;color:#4c1d95;word-break:break-all;">%s</div>
                <div style="margin-top:14px;font-size:14px;color:#6b7280;">⏱️ 此验证码将在 %d 分钟后失效</div>
              </div>

              <div style="padding:16px 18px;border-radius:12px;background-color:#fff7ed;border-left:4px solid #f97316;">
                <div style="font-size:15px;font-weight:800;color:#9a3412;">🛡️ 安全提醒</div>
                <div style="margin-top:6px;font-size:14px;line-height:1.7;color:#7c2d12;">请勿向任何人透露验证码。%s 工作人员不会通过私信、电话或聊天向您索取验证码。</div>
              </div>

              <p style="margin:22px 0 0;font-size:14px;line-height:1.8;color:#6b7280;">💡 如果这不是您本人发起的操作，请忽略本邮件，您的账户不会受到影响。</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;background-color:#fafafa;border-top:1px solid #f0f0f0;text-align:center;font-size:12px;line-height:1.7;color:#9ca3af;">
              此邮件由 %s 系统自动发送，请勿直接回复。<br>
              感谢您对 %s 的信任与支持 💜
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`, safeSubject, validMinutes, safeSystemName, safeSystemName, safeCode, validMinutes, safeSystemName, safeSystemName, safeSystemName)

	return subject, body
}

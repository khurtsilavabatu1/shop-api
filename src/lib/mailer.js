import nodemailer from 'nodemailer'

const host = process.env.SMTP_HOST
export const mailerEnabled = Boolean(host && process.env.SMTP_USER && process.env.SMTP_PASS)

const transporter = mailerEnabled
  ? nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null

const html = (code, minutes) => `
<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#111">
  <h1 style="font-size:20px;margin:0 0 8px">პაროლის აღდგენა</h1>
  <p style="margin:0 0 24px;color:#555;font-size:14px;line-height:1.6">
    თქვენ მოითხოვეთ პაროლის აღდგენა <strong>Cyber</strong>-ზე. შეიყვანეთ ეს კოდი:
  </p>
  <div style="font-size:34px;font-weight:700;letter-spacing:10px;text-align:center;
              padding:20px;background:#f4f4f5;border-radius:10px;margin-bottom:24px">
    ${code}
  </div>
  <p style="margin:0 0 8px;color:#555;font-size:14px">
    კოდი მოქმედებს <strong>${minutes} წუთი</strong>.
  </p>
  <p style="margin:0;color:#888;font-size:13px;line-height:1.6">
    თუ პაროლის აღდგენა არ მოგითხოვიათ, უბრალოდ იგნორირება გაუკეთეთ ამ წერილს —
    თქვენი პაროლი უცვლელი რჩება.
  </p>
</div>`

/**
 * აგზავნის აღდგენის კოდს.
 * SMTP კონფიგურაციის გარეშე მხოლოდ კონსოლში ბეჭდავს.
 * @returns {Promise<boolean>} გაიგზავნა თუ არა რეალური წერილი
 */
export async function sendResetCode(to, code, minutes) {
  if (!mailerEnabled) {
    console.log(`[reset-code] ${to} -> ${code} (valid ${minutes}m)  [SMTP გამორთულია]`)
    return false
  }

  try {
    await transporter.sendMail({
      from: process.env.MAIL_FROM || `Cyber <${process.env.SMTP_USER}>`,
      to,
      subject: `${code} — პაროლის აღდგენის კოდი`,
      text: `თქვენი პაროლის აღდგენის კოდია: ${code}\n\nკოდი მოქმედებს ${minutes} წუთი.\n\nთუ აღდგენა არ მოგითხოვიათ, იგნორირება გაუკეთეთ ამ წერილს.`,
      html: html(code, minutes),
    })
    console.log(`[reset-code] ${to} -> წერილი გაიგზავნა`)
    return true
  } catch (err) {
    // წერილის ჩავარდნამ მოთხოვნა არ უნდა გაანადგუროს
    console.error(`[reset-code] ${to} -> გაგზავნა ჩავარდა:`, err.message)
    console.log(`[reset-code] ${to} -> ${code} (valid ${minutes}m)  [fallback: კონსოლი]`)
    return false
  }
}

import nodemailer from 'nodemailer'

const BREVO_API_KEY = process.env.BREVO_API_KEY
const SMTP_HOST = process.env.SMTP_HOST

/**
 * გაგზავნის სამი რეჟიმი, პრიორიტეტის მიხედვით:
 *   1. Brevo HTTP API  — პორტი 443, PaaS-ები არ ბლოკავს  ✅ რეკომენდებული
 *   2. SMTP            — პორტი 587; Render-ის უფასო ინსტანსზე დაბლოკილია
 *   3. კონსოლი         — fallback, როცა არც ერთი არ არის კონფიგურირებული
 */
export const mailMode = BREVO_API_KEY ? 'api' : (SMTP_HOST ? 'smtp' : 'console')

const transporter = mailMode === 'smtp'
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
    })
  : null

/** "Cyber <no-reply@example.com>" → { name: "Cyber", email: "no-reply@example.com" } */
function parseFrom(raw) {
  const fallback = { name: 'Cyber', email: process.env.SMTP_USER || 'no-reply@example.com' }
  if (!raw) return fallback
  const m = raw.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/)
  if (m) return { name: m[1] || fallback.name, email: m[2] }
  return { name: fallback.name, email: raw.trim() }
}

/** წერილის ტექსტები ტიპის მიხედვით: პაროლის აღდგენა / გადახდის დადასტურება */
const TEMPLATES = {
  reset: {
    tag: 'reset-code',
    subject: (code) => `${code} — პაროლის აღდგენის კოდი`,
    title: 'პაროლის აღდგენა',
    intro: 'თქვენ მოითხოვეთ პაროლის აღდგენა <strong>Cyber</strong>-ზე. შეიყვანეთ ეს კოდი:',
    outro: 'თუ პაროლის აღდგენა არ მოგითხოვიათ, იგნორირება გაუკეთეთ ამ წერილს — თქვენი პაროლი უცვლელი რჩება.',
    text: (code, minutes) =>
      `თქვენი პაროლის აღდგენის კოდია: ${code}\n\nკოდი მოქმედებს ${minutes} წუთი.\n\nთუ აღდგენა არ მოგითხოვიათ, იგნორირება გაუკეთეთ ამ წერილს.`,
  },
  payment: {
    tag: 'payment-code',
    subject: (code) => `${code} — გადახდის დადასტურების კოდი`,
    title: 'გადახდის დადასტურება',
    intro: 'გადახდის დასასრულებლად <strong>Cyber</strong>-ზე შეიყვანეთ ეს კოდი:',
    outro: 'თუ ეს გადახდა თქვენ არ წამოგიწყიათ, იგნორირება გაუკეთეთ ამ წერილს — თანხა არ ჩამოიჭრება.',
    text: (code, minutes) =>
      `თქვენი გადახდის დადასტურების კოდია: ${code}\n\nკოდი მოქმედებს ${minutes} წუთი.\n\nთუ გადახდა თქვენ არ წამოგიწყიათ, იგნორირება გაუკეთეთ ამ წერილს.`,
  },
}

const htmlBody = (t, code, minutes) => `
<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#111">
  <h1 style="font-size:20px;margin:0 0 8px">${t.title}</h1>
  <p style="margin:0 0 24px;color:#555;font-size:14px;line-height:1.6">${t.intro}</p>
  <div style="font-size:34px;font-weight:700;letter-spacing:10px;text-align:center;
              padding:20px;background:#f4f4f5;border-radius:10px;margin-bottom:24px">${code}</div>
  <p style="margin:0 0 8px;color:#555;font-size:14px">კოდი მოქმედებს <strong>${minutes} წუთი</strong>.</p>
  <p style="margin:0;color:#888;font-size:13px;line-height:1.6">${t.outro}</p>
</div>`

async function sendViaApi({ to, subject, t, code, minutes }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': BREVO_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: parseFrom(process.env.MAIL_FROM),
      to: [{ email: to }],
      subject,
      htmlContent: htmlBody(t, code, minutes),
      textContent: t.text(code, minutes),
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Brevo API ${res.status}: ${detail.slice(0, 200)}`)
  }
}

async function sendViaSmtp({ to, subject, t, code, minutes }) {
  await transporter.sendMail({
    from: process.env.MAIL_FROM || `Cyber <${process.env.SMTP_USER}>`,
    to,
    subject,
    text: t.text(code, minutes),
    html: htmlBody(t, code, minutes),
  })
}

/**
 * აგზავნის ერთჯერად კოდს. ჩავარდნისას კოდი ლოგში იბეჭდება —
 * მოთხოვნა არასდროს ვარდება ელფოსტის გამო.
 * @returns {Promise<boolean>} გაიგზავნა თუ არა რეალური წერილი
 */
async function sendCode(kind, to, code, minutes) {
  const t = TEMPLATES[kind]
  const payload = { to, subject: t.subject(code), t, code, minutes }

  if (mailMode === 'console') {
    console.log(`[${t.tag}] ${to} -> ${code} (valid ${minutes}m)  [ელფოსტა გამორთულია]`)
    return false
  }

  try {
    if (mailMode === 'api') await sendViaApi(payload)
    else await sendViaSmtp(payload)
    console.log(`[${t.tag}] ${to} -> წერილი გაიგზავნა (${mailMode})`)
    return true
  } catch (err) {
    console.error(`[${t.tag}] ${to} -> გაგზავნა ჩავარდა (${mailMode}): ${err.message}`)
    console.log(`[${t.tag}] ${to} -> ${code} (valid ${minutes}m)  [fallback: კონსოლი]`)
    return false
  }
}

export const sendResetCode = (to, code, minutes) => sendCode('reset', to, code, minutes)
export const sendPaymentCode = (to, code, minutes) => sendCode('payment', to, code, minutes)

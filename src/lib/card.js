/**
 * ბარათის „ვითომ" დამუშავება. რეალური გადახდა არ ხდება და სრული ნომერი არსად ინახება —
 * შეკვეთაში მხოლოდ ბრენდი და ბოლო 4 ციფრი იწერება.
 *
 * სატესტო ბარათები (ნებისმიერი მომავალი ვადა და CVC):
 *   4242 4242 4242 4242 — წარმატებული გადახდა
 *   4000 0000 0000 0002 — ბანკი უარყოფს (402 CARD_DECLINED)
 * ნებისმიერი სხვა Luhn-ვალიდური ნომერიც გადის.
 */

export const DECLINED_CARD = '4000000000000002'

export const digitsOnly = (s) => String(s ?? '').replace(/[\s-]/g, '')

/** Luhn-ის ალგორითმი — ნამდვილი ბარათის ნომრის საკონტროლო ჯამი */
export function luhnValid(number) {
  if (!/^\d{13,19}$/.test(number)) return false
  let sum = 0
  for (let i = 0; i < number.length; i++) {
    let d = Number(number[number.length - 1 - i])
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9 }
    sum += d
  }
  return sum % 10 === 0
}

export function cardBrand(number) {
  if (/^4/.test(number)) return 'visa'
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(number)) return 'mastercard'
  if (/^3[47]/.test(number)) return 'amex'
  return 'card'
}

/** "MM/YY" → ვადა ჯერ არ გასულა? (ბარათი მოქმედებს თვის ბოლომდე) */
export function expiryValid(expiry) {
  const m = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(expiry)
  if (!m) return false
  const endOfMonth = new Date(2000 + Number(m[2]), Number(m[1]), 1)
  return endOfMonth > new Date()
}

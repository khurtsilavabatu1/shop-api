import { prisma } from '../db.js'

/** უფასო მიწოდება ამ ჯამიდან, ქვემოთ — ფიქსირებული საფასური */
export const FREE_SHIPPING_FROM = 100
export const SHIPPING_FEE = 5

export const money = (n) => Math.round(n * 100) / 100

const cartLine = (item) => ({
  id: item.id,
  productId: item.productId,
  qty: item.qty,
  product: {
    id: item.product.id,
    slug: item.product.slug,
    title: item.product.title,
    brand: item.product.brand,
    image: JSON.parse(item.product.images)[0],
    price: item.product.price,
    oldPrice: item.product.oldPrice,
    currency: item.product.currency,
    stock: item.product.stock,
    inStock: item.product.stock > 0,
  },
  lineTotal: money(item.product.price * item.qty),
})

/**
 * მომხმარებლის კალათა ჯამებით. ფასი ყოველთვის პროდუქტის მიმდინარე ფასია —
 * კალათა ფასს არ „ყინავს", ამას მხოლოდ შეკვეთა აკეთებს.
 */
export async function loadCart(userId) {
  const items = await prisma.cartItem.findMany({
    where: { userId },
    include: { product: true },
    orderBy: { createdAt: 'asc' },
  })
  const lines = items.map(cartLine)
  const subtotal = money(lines.reduce((s, l) => s + l.lineTotal, 0))
  return {
    items: lines,
    totalQty: lines.reduce((s, l) => s + l.qty, 0),
    subtotal,
    currency: 'GEL',
  }
}

/** მიწოდების საფასური და საბოლოო ჯამი — ერთი წყარო checkout-ისთვისაც და შეკვეთისთვისაც */
export function totals(subtotal) {
  const shippingFee = subtotal === 0 || subtotal >= FREE_SHIPPING_FROM ? 0 : SHIPPING_FEE
  return { subtotal, shippingFee, total: money(subtotal + shippingFee), currency: 'GEL' }
}

import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../db.js'
import { validate, requireAuth } from '../middleware.js'
import { loadCart, totals, money, FREE_SHIPPING_FROM } from '../lib/cart.js'
import { digitsOnly, luhnValid, cardBrand, expiryValid, DECLINED_CARD } from '../lib/card.js'
import { sendPaymentCode } from '../lib/mailer.js'

const router = Router()

const MAX_CODE_ATTEMPTS = 5
const CODE_TTL_MINUTES = 10
const RESEND_COOLDOWN_SECONDS = 30

const required = (label) => z.string({ required_error: `${label} is required` }).trim().min(1, `${label} is required`)

const shippingSchema = z.object({
  fullName: required('Full name').pipe(z.string().min(2, 'Full name must be at least 2 characters')),
  phone: required('Phone').pipe(z.string().regex(/^\+?[\d\s-]{9,20}$/, 'Enter a valid phone number')),
  city: required('City'),
  address: required('Address').pipe(z.string().min(5, 'Address must be at least 5 characters')),
})

const cardSchema = z.object({
  number: required('Card number').transform(digitsOnly)
    .pipe(z.string().refine(luhnValid, 'Enter a valid card number')),
  holder: required('Cardholder name').pipe(z.string().min(2, 'Cardholder name must be at least 2 characters')),
  expiry: required('Expiry date').pipe(z.string()
    .regex(/^(0[1-9]|1[0-2])\/\d{2}$/, 'Expiry must be in MM/YY format')
    .refine(expiryValid, 'This card has expired')),
  cvc: required('CVC').pipe(z.string().regex(/^\d{3,4}$/, 'CVC must be 3 or 4 digits')),
})

const createOrderSchema = z.object({ shipping: shippingSchema, card: cardSchema })

const confirmSchema = z.object({
  code: z.string({ required_error: 'Code is required' }).trim().regex(/^\d{6}$/, 'Code must be 6 digits'),
})

const publicOrder = (o) => ({
  id: o.id,
  status: o.status,
  items: o.items.map((i) => ({
    productId: i.productId,
    slug: i.slug,
    title: i.title,
    image: i.image,
    price: i.price,
    qty: i.qty,
    lineTotal: money(i.price * i.qty),
  })),
  subtotal: o.subtotal,
  shippingFee: o.shippingFee,
  total: o.total,
  currency: o.currency,
  shipping: { fullName: o.fullName, phone: o.phone, city: o.city, address: o.address },
  payment: { brand: o.cardBrand, last4: o.cardLast4 },
  createdAt: o.createdAt,
  paidAt: o.paidAt,
})

const newCode = () => String(Math.floor(100000 + Math.random() * 900000))
const exposeCode = () => process.env.DEV_EXPOSE_RESET_CODE === 'true'

/** მარაგს აღემატება? → [{ productId, title, requested, available }] */
const stockProblems = (lines) => lines
  .filter((l) => l.qty > l.product.stock)
  .map((l) => ({ productId: l.productId, title: l.product.title, requested: l.qty, available: l.product.stock }))

const insufficientStock = (res, items) => res.status(409).json({
  message: 'Some items are no longer available in the requested quantity',
  code: 'INSUFFICIENT_STOCK',
  items,
})

/** მხოლოდ საკუთარი შეკვეთა — სხვისი id-ზე 404, რომ არსებობა არ გამჟღავნდეს */
const findOwnOrder = (req) => prisma.order.findFirst({
  where: { id: req.params.id, userId: req.userId },
  include: { items: true },
})

const orderNotFound = (res) => res.status(404).json({ message: 'Order not found', code: 'ORDER_NOT_FOUND' })

/* GET /api/checkout — ჩექაუთის გვერდის მონაცემები: კალათა, ჯამები, პროფილიდან შევსებული მისამართი */
router.get('/checkout', requireAuth, async (req, res, next) => {
  try {
    const [cart, user] = await Promise.all([
      loadCart(req.userId),
      prisma.user.findUnique({ where: { id: req.userId } }),
    ])
    res.json({
      items: cart.items,
      totalQty: cart.totalQty,
      ...totals(cart.subtotal),
      freeShippingFrom: FREE_SHIPPING_FROM,
      shipping: { fullName: user.name, phone: user.phone ?? '', city: user.city ?? '', address: user.address ?? '' },
    })
  } catch (e) { next(e) }
})

/* POST /api/orders — ნაბიჯი 1: შეკვეთა კალათიდან + ბარათი → კოდი ელფოსტაზე */
router.post('/orders', requireAuth, validate(createOrderSchema), async (req, res, next) => {
  try {
    const { shipping, card } = req.body
    const cart = await loadCart(req.userId)
    if (!cart.items.length) return res.status(409).json({ message: 'Your cart is empty', code: 'CART_EMPTY' })

    const problems = stockProblems(cart.items)
    if (problems.length) return insufficientStock(res, problems)

    if (card.number === DECLINED_CARD) {
      return res.status(402).json({ message: 'Your card was declined', code: 'CARD_DECLINED' })
    }

    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    const code = newCode()
    const { subtotal, shippingFee, total, currency } = totals(cart.subtotal)

    // მიტოვებული წინა მცდელობები ისტორიაში არ უნდა დარჩეს
    await prisma.order.deleteMany({ where: { userId: req.userId, status: 'pending_payment' } })
    const order = await prisma.order.create({
      data: {
        userId: req.userId,
        status: 'pending_payment',
        subtotal, shippingFee, total, currency,
        ...shipping,
        cardBrand: cardBrand(card.number),
        cardLast4: card.number.slice(-4),
        codeHash: await bcrypt.hash(code, 10),
        codeExpiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
        items: {
          create: cart.items.map((l) => ({
            productId: l.productId,
            slug: l.product.slug,
            title: l.product.title,
            image: l.product.image,
            price: l.product.price,
            qty: l.qty,
          })),
        },
      },
    })

    await sendPaymentCode(user.email, code, CODE_TTL_MINUTES)
    const body = {
      orderId: order.id,
      status: order.status,
      total: order.total,
      currency: order.currency,
      message: 'We have sent a 6-digit confirmation code to your email.',
      expiresInMinutes: CODE_TTL_MINUTES,
    }
    if (exposeCode()) body.devCode = code
    res.status(201).json(body)
  } catch (e) { next(e) }
})

/* POST /api/orders/:id/resend-code */
router.post('/orders/:id/resend-code', requireAuth, async (req, res, next) => {
  try {
    const order = await findOwnOrder(req)
    if (!order) return orderNotFound(res)
    if (order.status !== 'pending_payment') {
      return res.status(409).json({ message: 'This order is already paid', code: 'ORDER_ALREADY_PAID' })
    }

    const sentAt = order.codeExpiresAt.getTime() - CODE_TTL_MINUTES * 60_000
    const waitSeconds = Math.ceil(RESEND_COOLDOWN_SECONDS - (Date.now() - sentAt) / 1000)
    if (waitSeconds > 0) {
      return res.status(429).json({
        message: `Please wait ${waitSeconds}s before requesting a new code`,
        code: 'RESEND_TOO_SOON',
        retryAfterSeconds: waitSeconds,
      })
    }

    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    const code = newCode()
    await prisma.order.update({
      where: { id: order.id },
      data: {
        codeHash: await bcrypt.hash(code, 10),
        codeExpiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
        codeAttempts: 0,
      },
    })
    await sendPaymentCode(user.email, code, CODE_TTL_MINUTES)
    const body = { message: 'A new code has been sent to your email.', expiresInMinutes: CODE_TTL_MINUTES }
    if (exposeCode()) body.devCode = code
    res.json(body)
  } catch (e) { next(e) }
})

/* POST /api/orders/:id/confirm — ნაბიჯი 2: კოდი → გადახდა, მარაგის ჩამოკლება, კალათის გასუფთავება */
router.post('/orders/:id/confirm', requireAuth, validate(confirmSchema), async (req, res, next) => {
  try {
    const order = await findOwnOrder(req)
    if (!order) return orderNotFound(res)
    if (order.status !== 'pending_payment') {
      return res.status(409).json({ message: 'This order is already paid', code: 'ORDER_ALREADY_PAID' })
    }

    const invalid = () => res.status(400).json({
      message: 'Invalid or expired code',
      code: 'INVALID_PAYMENT_CODE',
      errors: { code: 'Invalid or expired code' },
    })
    if (order.codeExpiresAt < new Date()) return invalid()
    if (order.codeAttempts >= MAX_CODE_ATTEMPTS) {
      return res.status(429).json({ message: 'Too many attempts. Request a new code.', code: 'TOO_MANY_ATTEMPTS' })
    }
    if (!(await bcrypt.compare(req.body.code, order.codeHash))) {
      await prisma.order.update({ where: { id: order.id }, data: { codeAttempts: { increment: 1 } } })
      return invalid()
    }

    // ყველაფერი ერთ ტრანზაქციაში: მარაგი ან ყველა პოზიციაზე ჩამოიჭრება, ან არცერთზე
    const shortages = []
    const paid = await prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        const { count } = item.productId
          ? await tx.product.updateMany({
              where: { id: item.productId, stock: { gte: item.qty } },
              data: { stock: { decrement: item.qty } },
            })
          : { count: 0 }
        if (!count) {
          const product = item.productId ? await tx.product.findUnique({ where: { id: item.productId } }) : null
          shortages.push({ productId: item.productId, title: item.title, requested: item.qty, available: product?.stock ?? 0 })
        }
      }
      if (shortages.length) throw Object.assign(new Error('stock'), { shortage: true })

      await tx.cartItem.deleteMany({ where: { userId: req.userId } })
      return tx.order.update({
        where: { id: order.id },
        data: { status: 'paid', paidAt: new Date(), codeHash: null, codeExpiresAt: null },
        include: { items: true },
      })
    }).catch((err) => {
      if (err.shortage) return null
      throw err
    })

    if (!paid) return insufficientStock(res, shortages)
    res.json({ order: publicOrder(paid) })
  } catch (e) { next(e) }
})

/* GET /api/orders — შეკვეთების ისტორია, ახალი პირველი */
router.get('/orders', requireAuth, async (req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      where: { userId: req.userId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ items: orders.map(publicOrder) })
  } catch (e) { next(e) }
})

/* GET /api/orders/:id */
router.get('/orders/:id', requireAuth, async (req, res, next) => {
  try {
    const order = await findOwnOrder(req)
    if (!order) return orderNotFound(res)
    res.json({ order: publicOrder(order) })
  } catch (e) { next(e) }
})

export default router

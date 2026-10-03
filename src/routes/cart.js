import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import { validate, requireAuth } from '../middleware.js'
import { loadCart } from '../lib/cart.js'

const router = Router()

/** ერთ პოზიციაზე მაქსიმალური რაოდენობა — მარაგის მიუხედავად */
const MAX_QTY = 99

// კალათის ყველა ოპერაცია ავტორიზაციას მოითხოვს
router.use(requireAuth)

const qty = z.number({ required_error: 'Quantity is required', invalid_type_error: 'Quantity must be a number' })
  .int('Quantity must be a whole number')
  .min(1, 'Quantity must be at least 1')
  .max(MAX_QTY, `Quantity cannot exceed ${MAX_QTY}`)

const addSchema = z.object({
  productId: z.string({ required_error: 'Product ID is required' }).min(1, 'Product ID is required'),
  qty: qty.default(1),
})

const updateSchema = z.object({ qty })

/** 409 — მოთხოვნილი რაოდენობა მარაგს აღემატება. available ფრონტენდს სტეპერის შესაზღუდად სჭირდება */
const notEnoughStock = (res, product) => res.status(409).json({
  message: product.stock === 0 ? 'This product is out of stock' : `Only ${product.stock} left in stock`,
  code: product.stock === 0 ? 'OUT_OF_STOCK' : 'INSUFFICIENT_STOCK',
  available: product.stock,
})

const itemNotFound = (res) => res.status(404).json({ message: 'Cart item not found', code: 'CART_ITEM_NOT_FOUND' })

/* GET /api/cart */
router.get('/', async (req, res, next) => {
  try {
    res.json(await loadCart(req.userId))
  } catch (e) { next(e) }
})

/* POST /api/cart/items — იგივე პროდუქტის ხელახლა დამატება რაოდენობას ზრდის */
router.post('/items', validate(addSchema), async (req, res, next) => {
  try {
    const { productId, qty } = req.body
    const product = await prisma.product.findUnique({ where: { id: productId } })
    if (!product) return res.status(404).json({ message: 'Product not found', code: 'PRODUCT_NOT_FOUND' })

    const existing = await prisma.cartItem.findUnique({
      where: { userId_productId: { userId: req.userId, productId } },
    })
    const newQty = (existing?.qty ?? 0) + qty
    if (newQty > MAX_QTY) {
      return res.status(422).json({
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        errors: { qty: `Quantity cannot exceed ${MAX_QTY}` },
      })
    }
    if (newQty > product.stock) return notEnoughStock(res, product)

    await prisma.cartItem.upsert({
      where: { userId_productId: { userId: req.userId, productId } },
      create: { userId: req.userId, productId, qty },
      update: { qty: newQty },
    })
    res.status(existing ? 200 : 201).json(await loadCart(req.userId))
  } catch (e) { next(e) }
})

/* PATCH /api/cart/items/:id — რაოდენობის დაყენება (გაზრდა / შემცირება) */
router.patch('/items/:id', validate(updateSchema), async (req, res, next) => {
  try {
    const item = await prisma.cartItem.findFirst({
      where: { id: req.params.id, userId: req.userId },
      include: { product: true },
    })
    if (!item) return itemNotFound(res)
    if (req.body.qty > item.product.stock) return notEnoughStock(res, item.product)

    await prisma.cartItem.update({ where: { id: item.id }, data: { qty: req.body.qty } })
    res.json(await loadCart(req.userId))
  } catch (e) { next(e) }
})

/* DELETE /api/cart/items/:id */
router.delete('/items/:id', async (req, res, next) => {
  try {
    const { count } = await prisma.cartItem.deleteMany({ where: { id: req.params.id, userId: req.userId } })
    if (!count) return itemNotFound(res)
    res.json(await loadCart(req.userId))
  } catch (e) { next(e) }
})

/* DELETE /api/cart — მთლიანი კალათის გასუფთავება */
router.delete('/', async (req, res, next) => {
  try {
    await prisma.cartItem.deleteMany({ where: { userId: req.userId } })
    res.json(await loadCart(req.userId))
  } catch (e) { next(e) }
})

export default router

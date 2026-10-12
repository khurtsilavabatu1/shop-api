import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import { validate, requireAuth } from '../middleware.js'
import { addressFields } from '../lib/address.js'

const router = Router()

/** ერთ მომხმარებელზე მაქსიმუმ ამდენი მისამართი */
const MAX_ADDRESSES = 10

router.use(requireAuth)

const label = z.string().trim().max(30, 'Label must be at most 30 characters')
  .transform((v) => v || null).nullable().optional()

const createSchema = z.object({
  label,
  ...addressFields,
  isDefault: z.boolean({ invalid_type_error: 'isDefault must be true or false' }).optional(),
})

const updateSchema = createSchema.partial().refine(
  (b) => Object.values(b).some((v) => v !== undefined),
  { message: 'Provide at least one field to update', path: ['_'] },
)

const publicAddress = (a) => ({
  id: a.id,
  label: a.label,
  fullName: a.fullName,
  phone: a.phone,
  city: a.city,
  address: a.address,
  isDefault: a.isDefault,
  createdAt: a.createdAt,
})

/** ნაგულისხმევი ყოველთვის პირველია, დანარჩენი — დამატების მიხედვით */
export const listAddresses = (userId) => prisma.address.findMany({
  where: { userId },
  orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
})

const notFound = (res) => res.status(404).json({ message: 'Address not found', code: 'ADDRESS_NOT_FOUND' })

/* GET /api/addresses */
router.get('/', async (req, res, next) => {
  try {
    res.json({ items: (await listAddresses(req.userId)).map(publicAddress) })
  } catch (e) { next(e) }
})

/* POST /api/addresses — პირველი მისამართი ავტომატურად ნაგულისხმევია */
router.post('/', validate(createSchema), async (req, res, next) => {
  try {
    const count = await prisma.address.count({ where: { userId: req.userId } })
    if (count >= MAX_ADDRESSES) {
      return res.status(409).json({
        message: `You can save up to ${MAX_ADDRESSES} addresses`,
        code: 'ADDRESS_LIMIT_REACHED',
      })
    }

    const { isDefault, ...data } = req.body
    const makeDefault = count === 0 || isDefault === true
    const address = await prisma.$transaction(async (tx) => {
      if (makeDefault) await tx.address.updateMany({ where: { userId: req.userId }, data: { isDefault: false } })
      return tx.address.create({ data: { ...data, userId: req.userId, isDefault: makeDefault } })
    })
    res.status(201).json({ address: publicAddress(address) })
  } catch (e) { next(e) }
})

/* PATCH /api/addresses/:id — isDefault: true ამ მისამართს ნაგულისხმევად აქცევს */
router.patch('/:id', validate(updateSchema), async (req, res, next) => {
  try {
    const existing = await prisma.address.findFirst({ where: { id: req.params.id, userId: req.userId } })
    if (!existing) return notFound(res)

    const { isDefault, ...data } = req.body
    // ნაგულისხმევის „მოხსნა" ცარიელ ადგილს დატოვებდა — სანაცვლოდ სხვას ვანიჭებთ isDefault: true
    if (isDefault === false && existing.isDefault) {
      return res.status(422).json({
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        errors: { isDefault: 'Set another address as default instead' },
      })
    }

    const address = await prisma.$transaction(async (tx) => {
      if (isDefault === true) await tx.address.updateMany({ where: { userId: req.userId }, data: { isDefault: false } })
      return tx.address.update({
        where: { id: existing.id },
        data: { ...data, ...(isDefault === true && { isDefault: true }) },
      })
    })
    res.json({ address: publicAddress(address) })
  } catch (e) { next(e) }
})

/* DELETE /api/addresses/:id — ნაგულისხმევის წაშლისას მისი ადგილი უძველესს გადაეცემა */
router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.address.findFirst({ where: { id: req.params.id, userId: req.userId } })
    if (!existing) return notFound(res)

    await prisma.$transaction(async (tx) => {
      await tx.address.delete({ where: { id: existing.id } })
      if (existing.isDefault) {
        const next = await tx.address.findFirst({ where: { userId: req.userId }, orderBy: { createdAt: 'asc' } })
        if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } })
      }
    })
    res.status(204).end()
  } catch (e) { next(e) }
})

export default router

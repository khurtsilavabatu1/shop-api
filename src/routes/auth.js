import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { prisma } from '../db.js'
import { validate, requireAuth } from '../middleware.js'
import { sendResetCode } from '../lib/mailer.js'

const router = Router()

const MAX_CODE_ATTEMPTS = 5
const CODE_TTL_MINUTES = 15

const email = z.string({ required_error: 'Email is required' }).trim().toLowerCase()
  .min(1, 'Email is required').email('Enter a valid email address')

const strongPassword = z.string({ required_error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one digit')

const registerSchema = z.object({
  name: z.string({ required_error: 'Name is required' }).trim().min(2, 'Name must be at least 2 characters'),
  email,
  password: strongPassword,
})

// შესვლაზე პაროლის სირთულე არ მოწმდება — მხოლოდ სავალდებულოობა
const loginSchema = z.object({
  email,
  password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required'),
})

const forgotSchema = z.object({ email })

const verifyCodeSchema = z.object({
  email,
  code: z.string({ required_error: 'Code is required' }).trim()
    .regex(/^\d{6}$/, 'Code must be 6 digits'),
})

const resetSchema = z.object({
  resetToken: z.string({ required_error: 'Reset token is required' }).min(1, 'Reset token is required'),
  password: strongPassword,
})

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, createdAt: u.createdAt })

function signAccessToken(userId) {
  return jwt.sign({ sub: userId, typ: 'access' }, process.env.JWT_SECRET, {
    expiresIn: process.env.ACCESS_TOKEN_TTL || '30m',
  })
}

/* POST /api/auth/register */
router.post('/register', validate(registerSchema), async (req, res, next) => {
  try {
    const { name, email, password } = req.body
    const exists = await prisma.user.findUnique({ where: { email } })
    if (exists) {
      return res.status(409).json({
        message: 'This email is already registered',
        code: 'EMAIL_TAKEN',
        errors: { email: 'This email is already registered' },
      })
    }
    const user = await prisma.user.create({
      data: { name, email, passwordHash: await bcrypt.hash(password, 10) },
    })
    res.status(201).json({ user: publicUser(user), accessToken: signAccessToken(user.id) })
  } catch (e) { next(e) }
})

/* POST /api/auth/login */
router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body
    const user = await prisma.user.findUnique({ where: { email } })
    // ერთი და იგივე პასუხი ორივე შემთხვევაზე — არ ვამხელთ, არსებობს თუ არა ანგარიში
    const ok = user && (await bcrypt.compare(password, user.passwordHash))
    if (!ok) {
      return res.status(401).json({ message: 'Invalid email or password', code: 'INVALID_CREDENTIALS' })
    }
    res.json({ user: publicUser(user), accessToken: signAccessToken(user.id) })
  } catch (e) { next(e) }
})

/* GET /api/auth/me */
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) return res.status(401).json({ message: 'User no longer exists', code: 'UNAUTHORIZED' })
    res.json({ user: publicUser(user) })
  } catch (e) { next(e) }
})

/* POST /api/auth/logout — ტოკენი stateless-ია, კლიენტი შლის ლოკალურად */
router.post('/logout', (req, res) => res.status(204).end())

/* POST /api/auth/forgot-password — ყოველთვის 200, რომ ანგარიშები არ ჩამოითვალოს */
router.post('/forgot-password', validate(forgotSchema), async (req, res, next) => {
  try {
    const { email } = req.body
    const user = await prisma.user.findUnique({ where: { email } })
    const body = {
      message: 'If an account exists for this email, we have sent a 6-digit code.',
      expiresInMinutes: CODE_TTL_MINUTES,
    }

    if (user) {
      const code = String(Math.floor(100000 + Math.random() * 900000))
      await prisma.passwordResetCode.deleteMany({ where: { userId: user.id, usedAt: null } })
      await prisma.passwordResetCode.create({
        data: {
          userId: user.id,
          codeHash: await bcrypt.hash(code, 10),
          expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
        },
      })
      await sendResetCode(email, code, CODE_TTL_MINUTES)
      if (process.env.DEV_EXPOSE_RESET_CODE === 'true') body.devCode = code
    }

    res.json(body)
  } catch (e) { next(e) }
})

/* POST /api/auth/verify-reset-code → აბრუნებს ხანმოკლე resetToken-ს */
router.post('/verify-reset-code', validate(verifyCodeSchema), async (req, res, next) => {
  try {
    const { email, code } = req.body
    const user = await prisma.user.findUnique({ where: { email } })
    const invalid = () => res.status(400).json({
      message: 'Invalid or expired code',
      code: 'INVALID_RESET_CODE',
      errors: { code: 'Invalid or expired code' },
    })
    if (!user) return invalid()

    const record = await prisma.passwordResetCode.findFirst({
      where: { userId: user.id, usedAt: null },
      orderBy: { createdAt: 'desc' },
    })
    if (!record || record.expiresAt < new Date()) return invalid()

    if (record.attempts >= MAX_CODE_ATTEMPTS) {
      return res.status(429).json({ message: 'Too many attempts. Request a new code.', code: 'TOO_MANY_ATTEMPTS' })
    }

    if (!(await bcrypt.compare(code, record.codeHash))) {
      await prisma.passwordResetCode.update({
        where: { id: record.id }, data: { attempts: { increment: 1 } },
      })
      return invalid()
    }

    const resetToken = jwt.sign(
      { sub: user.id, typ: 'reset', rid: record.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.RESET_TOKEN_TTL || '10m' },
    )
    res.json({ resetToken })
  } catch (e) { next(e) }
})

/* POST /api/auth/reset-password */
router.post('/reset-password', validate(resetSchema), async (req, res, next) => {
  try {
    const { resetToken, password } = req.body
    let payload
    try {
      payload = jwt.verify(resetToken, process.env.JWT_SECRET)
      if (payload.typ !== 'reset') throw new Error('wrong token type')
    } catch {
      return res.status(400).json({ message: 'Invalid or expired reset token', code: 'INVALID_RESET_TOKEN' })
    }

    const record = await prisma.passwordResetCode.findUnique({ where: { id: payload.rid } })
    if (!record || record.usedAt) {
      return res.status(400).json({ message: 'This reset token has already been used', code: 'RESET_TOKEN_USED' })
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: payload.sub },
        data: { passwordHash: await bcrypt.hash(password, 10) },
      }),
      prisma.passwordResetCode.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ])

    res.json({ message: 'Password has been reset. You can now sign in.' })
  } catch (e) { next(e) }
})

export default router

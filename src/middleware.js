import jwt from 'jsonwebtoken'

/** ხელოვნური დაყოვნება — რომ loading-მდგომარეობები აუცილებელი გახდეს, არა სასურველი */
export function latency(req, res, next) {
  const ms = Number(process.env.ARTIFICIAL_LATENCY_MS || 0)
  if (!ms) return next()
  setTimeout(next, ms)
}

/** ვალიდაცია Zod-სქემით. შეცდომა ყოველთვის 422 + { message, errors: { field: msg } } */
export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body)
    if (result.success) {
      req.body = result.data
      return next()
    }
    const errors = {}
    for (const issue of result.error.issues) {
      const field = issue.path.join('.') || '_'
      if (!errors[field]) errors[field] = issue.message
    }
    return res.status(422).json({ message: 'Validation failed', code: 'VALIDATION_ERROR', errors })
  }
}

/** Bearer-ტოკენის შემოწმება. ვადაგასულ ტოკენს აქვს ცალკე კოდი — TOKEN_EXPIRED */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) {
    return res.status(401).json({ message: 'Authentication required', code: 'UNAUTHORIZED' })
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    if (payload.typ !== 'access') throw new Error('wrong token type')
    req.userId = payload.sub
    next()
  } catch (err) {
    const expired = err.name === 'TokenExpiredError'
    return res.status(401).json({
      message: expired ? 'Access token expired' : 'Invalid access token',
      code: expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
    })
  }
}

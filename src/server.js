import 'dotenv/config'
import fs from 'node:fs'
import express from 'express'
import cors from 'cors'
import swaggerUi from 'swagger-ui-express'
import YAML from 'yaml'
import authRouter from './routes/auth.js'
import catalogRouter from './routes/catalog.js'
import { latency } from './middleware.js'
import { mailMode } from './lib/mailer.js'
import { prisma } from './db.js'
import { ensureCatalog } from '../prisma/seed/index.js'

const app = express()
const PORT = process.env.PORT || 4000

// CORS: ნაგულისხმევად ღიაა (სასწავლო API).
// CORS_ORIGINS=https://a.vercel.app,https://b.netlify.app — შეზღუდვისთვის
const origins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
app.use(cors({ origin: origins.length ? origins : true }))
app.use(express.json())
app.use(latency)

const specPath = new URL('../openapi.yaml', import.meta.url)
const openapi = YAML.parse(fs.readFileSync(specPath, 'utf8'))

app.get('/openapi.yaml', (_req, res) => res.type('text/yaml').sendFile(specPath.pathname))
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'Cyber API' }))

app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }))
app.use('/api/auth', authRouter)
app.use('/api', catalogRouter)

app.get('/', (_req, res) => res.redirect('/docs'))

app.use((_req, res) => res.status(404).json({ message: 'Not found', code: 'NOT_FOUND' }))

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ message: 'Internal server error', code: 'INTERNAL_ERROR' })
})

ensureCatalog(prisma).catch((e) => console.error('კატალოგის შევსება ჩავარდა:', e.message))

app.listen(PORT, () => {
  console.log(`Cyber API  →  http://localhost:${PORT}/api`)
  console.log(`Swagger UI →  http://localhost:${PORT}/docs`)
  console.log(`ელფოსტა    →  ${mailMode}`)
})

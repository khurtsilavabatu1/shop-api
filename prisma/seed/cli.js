import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { seedCatalog } from './index.js'

const prisma = new PrismaClient()

console.log('კატალოგის გენერაცია...')
seedCatalog(prisma)
  .then((r) => console.log(`\n✓ ${r.categories} კატეგორია, ${r.products} პროდუქტი, ${r.images} სურათი`))
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())

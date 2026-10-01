import 'dotenv/config'
import fs from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { categories } from './categories.js'

const prisma = new PrismaClient()

const PRODUCTS_PER_CATEGORY = 40
/** კატალოგის ვერსია — გაზრდისას პროდაქშენი ავტომატურად გადააგენერირებს */
export const CATALOG_VERSION = '5'
const IMAGES_PER_PRODUCT = 5

/**
 * სურათები public/images-შია (Pixabay, ხელით შერჩეული — იხ. public/images/CREDITS.json).
 * images.json: { [კატეგორია]: { banner, types: { [ტიპი]: [ფაილები] } } }
 */
const IMAGES = JSON.parse(fs.readFileSync(new URL('./images.json', import.meta.url), 'utf8'))

/** API-ის საჯარო მისამართი — სურათების აბსოლუტური URL-ებისთვის. Render-ზე RENDER_EXTERNAL_URL თავად ისმება. */
const imageBase = () =>
  (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 4000}`)
    .replace(/\/+$/, '')
const imageUrl = (file) => `${imageBase()}/images/${file}`

/** დეტერმინისტული RNG — ერთი და იგივე seed ყოველთვის ერთსა და იმავე კატალოგს იძლევა */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)]
const int = (rng, min, max) => min + Math.floor(rng() * (max - min + 1))
const round = (n, step) => Math.round(n / step) * step

/** ინგლისური სათაურიდან URL-ისთვის ვარგისი slug */
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

function makeProduct(cat, i, nextIndex) {
  const rng = mulberry32(hash(cat.slug) + i * 7919)

  const brand = pick(rng, cat.brands)
  const model = pick(rng, cat.models)
  const serial = int(rng, 2, 99)

  // თითო ფილტრიდან ერთი ოფცია: { value: 'sofa', label: 'დივანი' }
  const attrs = {}
  for (const f of cat.filters) attrs[f.key] = pick(rng, f.options)

  // სათაური ინგლისურია: ტიპის value + ბრენდი + მოდელი + ნომერი
  const typeWord = attrs.type ? attrs.type.value.replace(/-/g, ' ') : ''
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1)
  const title = [typeWord.split(' ').map(cap).join(' '), brand, model, serial]
    .filter(Boolean).join(' ').trim()
  const slug = slugify(title)

  const [pMin, pMax] = cat.price
  const raw = pMin + Math.pow(rng(), 1.6) * (pMax - pMin)
  const price = Math.max(pMin, round(raw, raw > 500 ? 10 : 1)) - 0.01 + 0.01

  const onSale = rng() < 0.35
  const oldPrice = onSale ? round(price * (1.12 + rng() * 0.35), 5) : null

  const specs = cat.specs(rng, attrs)
  const warrantyMonths = pick(rng, cat.warranty)
  if (warrantyMonths > 0) specs['გარანტია'] = `${warrantyMonths} თვე`

  const stock = rng() < 0.12 ? 0 : int(rng, 1, 140)

  const description =
    `${title} — ${cat.name.toLowerCase()}, ${brand}. ` +
    `${Object.entries(specs).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(', ')}. ` +
    (warrantyMonths > 0 ? `მოყვება ${warrantyMonths}-თვიანი გარანტია. ` : '') +
    `${pick(rng, [
      'პროდუქტი ხელმისაწვდომია მიწოდებით საქართველოს მასშტაბით.',
      'შეკვეთა მუშავდება 24 საათში.',
      'ორიგინალი პროდუქცია ოფიციალური იმპორტიორისგან.',
      'დაბრუნების შესაძლებლობა 14 დღის განმავლობაში.',
    ])}`

  // ფოტოების ჯგუფი: ტიპი (დივანს — დივნის), ან კატეგორიის imageGroup (iOS → iPhone, Apple → MacBook).
  // მთავარი ფოტო ჯგუფში რიგრიგობით ნაწილდება, დანარჩენები slug-ით არეულია — ცალკე RNG-ით,
  // რომ ძირითადი RNG-ის მიმდევრობა (ფასები, მარაგი...) არ შეიცვალოს.
  const pools = IMAGES[cat.slug].types
  const group = attrs.type?.value ?? cat.imageGroup?.(attrs, brand) ?? Object.keys(pools)[0]
  const pool = pools[group]
  const main = pool[nextIndex(group) % pool.length]
  const shuffleRng = mulberry32(hash(slug))
  const rest = pool.filter((f) => f !== main)
    .map((f) => [shuffleRng(), f]).sort((a, b) => a[0] - b[0]).map(([, f]) => f)
  const images = [main, ...rest].slice(0, IMAGES_PER_PRODUCT).map(imageUrl)

  return {
    slug,
    title,
    description,
    brand,
    price: Number(price.toFixed(2)),
    oldPrice: oldPrice ? Number(oldPrice.toFixed(2)) : null,
    currency: 'GEL',
    rating: Number((3.2 + rng() * 1.8).toFixed(1)),
    reviewsCount: int(rng, 0, 940),
    stock,
    warrantyMonths,
    images: JSON.stringify(images),
    specs: JSON.stringify(specs),
    attributes: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, v.value])),
  }
}

/** cuid-ის მსგავსი იდენტიფიკატორი — 25 სიმბოლო, ისევე როგორც Prisma-ს @default(cuid()) */
let counter = 0
const B36 = 'abcdefghijklmnopqrstuvwxyz0123456789'
const rand = (n) => Array.from({ length: n }, () => B36[Math.floor(Math.random() * B36.length)]).join('')
const makeId = () =>
  'c' + Date.now().toString(36) + (counter++).toString(36).padStart(4, '0') + rand(12)

/** აშენებს მთელ კატალოგს. `prisma` გარედან მოდის, რომ ორივე სცენარში გამოდგეს. */
export async function seedCatalog(prisma, { log = console.log } = {}) {
  await prisma.productAttribute.deleteMany()
  await prisma.product.deleteMany()
  await prisma.category.deleteMany()

  let total = 0
  let images = 0

  for (const [index, cat] of categories.entries()) {
    const category = await prisma.category.create({
      data: {
        slug: cat.slug,
        name: cat.name,
        nameEn: cat.nameEn,
        description: cat.description,
        image: imageUrl(IMAGES[cat.slug].banner),
        sortOrder: index,
        filters: JSON.stringify(cat.filters),
      },
    })

    const products = []
    const attributes = []
    const usedSlugs = new Map()
    const imageCursor = new Map()
    const nextIndex = (group) => {
      const n = imageCursor.get(group) ?? 0
      imageCursor.set(group, n + 1)
      return n
    }

    for (let i = 0; i < PRODUCTS_PER_CATEGORY; i++) {
      const { attributes: attrs, ...data } = makeProduct(cat, i, nextIndex)

      // დუბლიკატი slug-ს ემატება რიგითობა — ისევე, როგორც რეალურ CMS-ებში
      const seen = usedSlugs.get(data.slug) ?? 0
      usedSlugs.set(data.slug, seen + 1)
      if (seen > 0) data.slug = `${data.slug}-${seen + 1}`

      const id = makeId()
      products.push({ id, ...data, categoryId: category.id })
      for (const [key, value] of Object.entries(attrs)) {
        attributes.push({ id: makeId(), productId: id, key, value })
      }
    }

    await prisma.product.createMany({ data: products })
    await prisma.productAttribute.createMany({ data: attributes })

    total += products.length
    images += products.reduce((n, p) => n + JSON.parse(p.images).length, 0)
    log(`  ${cat.name.padEnd(28)} ${products.length} პროდუქტი`)
  }

  return { categories: categories.length, products: total, images }
}

/** ვერსია + სურათების მისამართი: API-ის დომენის შეცვლისას URL-ებიც განახლდება */
const catalogStamp = () => `${CATALOG_VERSION} ${imageBase()}`

/** ავსებს კატალოგს, თუ ის ცარიელია ან ვერსია შეიცვალა */
export async function ensureCatalog(prisma) {
  const [count, meta] = await Promise.all([
    prisma.category.count(),
    prisma.meta.findUnique({ where: { key: 'catalogVersion' } }).catch(() => null),
  ])

  if (count > 0 && meta?.value === catalogStamp()) {
    return { skipped: true, categories: count }
  }

  console.log(count === 0
    ? 'კატალოგი ცარიელია — ვავსებ...'
    : `კატალოგის ვერსია ${meta?.value ?? '?'} → ${catalogStamp()}, გადავაგენერირებ...`)

  const result = await seedCatalog(prisma)
  await prisma.meta.upsert({
    where: { key: 'catalogVersion' },
    create: { key: 'catalogVersion', value: catalogStamp() },
    update: { value: catalogStamp() },
  })

  console.log(`✓ ${result.categories} კატეგორია, ${result.products} პროდუქტი`)
  return result
}

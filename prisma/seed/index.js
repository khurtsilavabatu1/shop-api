import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { categories } from './categories.js'

const prisma = new PrismaClient()

const PRODUCTS_PER_CATEGORY = 40
/** კატალოგის ვერსია — გაზრდისას პროდაქშენი ავტომატურად გადააგენერირებს */
export const CATALOG_VERSION = '2'
const IMAGES_PER_PRODUCT = 5

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

const translit = (s) => s
  .toLowerCase()
  .replace(/[ა-ჰ]/g, (c) => 'abgdevzTiklmnopJrstufqRySCcZwWxjh'['აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰ'.indexOf(c)] || '-')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')

function makeProduct(cat, i) {
  const rng = mulberry32(hash(cat.slug) + i * 7919)

  const brand = pick(rng, cat.brands)
  const model = pick(rng, cat.models)
  const serial = int(rng, 2, 99)

  const attrs = {}
  for (const f of cat.filters) attrs[f.key] = pick(rng, f.options)

  const hasType = cat.filters.some((f) => f.key === 'type')
  const title = (hasType ? `${attrs.type} ${brand} ${model} ${serial}` : `${brand} ${model} ${serial}`).trim()
  const slug = translit(title)

  const [pMin, pMax] = cat.price
  const raw = pMin + Math.pow(rng(), 1.6) * (pMax - pMin)
  const price = Math.max(pMin, round(raw, raw > 500 ? 10 : 1)) - 0.01 + 0.01

  const onSale = rng() < 0.35
  const oldPrice = onSale ? round(price * (1.12 + rng() * 0.35), 5) : null

  const specs = cat.specs(rng, attrs)
  const warrantyMonths = pick(rng, cat.warranty)
  if (warrantyMonths > 0) specs['გარანტია'] = `${warrantyMonths} თვე`

  const images = Array.from({ length: IMAGES_PER_PRODUCT }, (_, n) =>
    `https://picsum.photos/seed/${slug}-${n + 1}/900/900`)

  const stock = rng() < 0.12 ? 0 : int(rng, 1, 140)

  const description =
    `${title} — ${cat.name.toLowerCase()} ${brand}-ისგან. ` +
    `${Object.entries(specs).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(', ')}. ` +
    (warrantyMonths > 0 ? `მოყვება ${warrantyMonths}-თვიანი გარანტია. ` : '') +
    `${pick(rng, [
      'პროდუქტი ხელმისაწვდომია მიწოდებით საქართველოს მასშტაბით.',
      'შეკვეთა მუშავდება 24 საათში.',
      'ორიგინალი პროდუქცია ოფიციალური იმპორტიორისგან.',
      'დაბრუნების შესაძლებლობა 14 დღის განმავლობაში.',
    ])}`

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
    attributes: attrs,
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

  for (const [index, cat] of categories.entries()) {
    const category = await prisma.category.create({
      data: {
        slug: cat.slug,
        name: cat.name,
        nameEn: cat.nameEn,
        description: cat.description,
        image: `https://picsum.photos/seed/cat-${cat.slug}/1200/500`,
        sortOrder: index,
        filters: JSON.stringify(cat.filters),
      },
    })

    const products = []
    const attributes = []
    const usedSlugs = new Map()

    for (let i = 0; i < PRODUCTS_PER_CATEGORY; i++) {
      const { attributes: attrs, ...data } = makeProduct(cat, i)

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
    log(`  ${cat.name.padEnd(28)} ${products.length} პროდუქტი`)
  }

  return { categories: categories.length, products: total }
}

/** ავსებს კატალოგს, თუ ის ცარიელია ან ვერსია შეიცვალა */
export async function ensureCatalog(prisma) {
  const [count, meta] = await Promise.all([
    prisma.category.count(),
    prisma.meta.findUnique({ where: { key: 'catalogVersion' } }).catch(() => null),
  ])

  if (count > 0 && meta?.value === CATALOG_VERSION) {
    return { skipped: true, categories: count }
  }

  console.log(count === 0
    ? 'კატალოგი ცარიელია — ვავსებ...'
    : `კატალოგის ვერსია ${meta?.value ?? '?'} → ${CATALOG_VERSION}, გადავაგენერირებ...`)

  const result = await seedCatalog(prisma)
  await prisma.meta.upsert({
    where: { key: 'catalogVersion' },
    create: { key: 'catalogVersion', value: CATALOG_VERSION },
    update: { value: CATALOG_VERSION },
  })

  console.log(`✓ ${result.categories} კატეგორია, ${result.products} პროდუქტი`)
  return result
}

import { Router } from 'express'
import { prisma } from '../db.js'

const router = Router()

const MAX_LIMIT = 60
const DEFAULT_LIMIT = 12

/** ველები, რომლებიც ფილტრაციისთვის არ ითვლება ატრიბუტად */
const RESERVED = new Set([
  'page', 'limit', 'sort', 'q', 'category', 'brand',
  'minPrice', 'maxPrice', 'minRating', 'inStock', 'onSale',
])

const SORTS = {
  newest: { createdAt: 'desc' },
  oldest: { createdAt: 'asc' },
  'price-asc': { price: 'asc' },
  'price-desc': { price: 'desc' },
  'rating-desc': { rating: 'desc' },
  popular: { reviewsCount: 'desc' },
  'title-asc': { title: 'asc' },
}

/** "a,b,c" → ["a","b","c"]; ასევე იღებს განმეორებად query-პარამეტრებს */
const list = (v) => (v === undefined ? [] : (Array.isArray(v) ? v : String(v).split(','))).map((s) => s.trim()).filter(Boolean)

const toProduct = (p) => ({
  id: p.id,
  slug: p.slug,
  title: p.title,
  description: p.description,
  brand: p.brand,
  price: p.price,
  oldPrice: p.oldPrice,
  discountPercent: p.oldPrice ? Math.round((1 - p.price / p.oldPrice) * 100) : null,
  currency: p.currency,
  rating: p.rating,
  reviewsCount: p.reviewsCount,
  stock: p.stock,
  inStock: p.stock > 0,
  warrantyMonths: p.warrantyMonths,
  image: JSON.parse(p.images)[0],
  images: JSON.parse(p.images),
  specs: JSON.parse(p.specs),
  attributes: p.attributes ? Object.fromEntries(p.attributes.map((a) => [a.key, a.value])) : undefined,
  category: p.category ? { slug: p.category.slug, name: p.category.name } : undefined,
  createdAt: p.createdAt,
})

/** სიისთვის — მსუბუქი. ფილტრები აქ არ სჭირდება: კატეგორიების გვერდზე ფილტრაცია არ ხდება. */
const toCategoryCard = (c) => ({
  id: c.id,
  slug: c.slug,
  name: c.name,
  nameEn: c.nameEn,
  description: c.description,
  image: c.image,
  productsCount: c._count?.products ?? 0,
})

/* ── GET /api/categories ───────────────────────────────────────────── */
router.get('/categories', async (_req, res, next) => {
  try {
    const cats = await prisma.category.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { products: true } } },
    })
    res.json({ items: cats.map(toCategoryCard) })
  } catch (e) { next(e) }
})

/* ── GET /api/categories/:slug ─────────────────────────────────────── */
router.get('/categories/:slug', async (req, res, next) => {
  try {
    const cat = await prisma.category.findUnique({
      where: { slug: req.params.slug },
      include: { _count: { select: { products: true } } },
    })
    if (!cat) return res.status(404).json({ message: 'Category not found', code: 'CATEGORY_NOT_FOUND' })

    const [agg, brandRows] = await Promise.all([
      prisma.product.aggregate({ where: { categoryId: cat.id }, _min: { price: true }, _max: { price: true } }),
      prisma.product.findMany({ where: { categoryId: cat.id }, distinct: ['brand'], select: { brand: true }, orderBy: { brand: 'asc' } }),
    ])

    // ერთი ერთიანი სია — ფრონტი ამ მასივზე გადის და ყველა ფილტრს ერთნაირად ხატავს
    const filters = [
      {
        key: 'brand',
        label: 'ბრენდი',
        type: 'checkbox',
        options: brandRows.map((b) => ({ value: b.brand, label: b.brand })),
      },
      {
        key: 'price',
        label: 'ფასი',
        type: 'range',
        min: Math.floor(agg._min.price ?? 0),
        max: Math.ceil(agg._max.price ?? 0),
        unit: '₾',
      },
      ...JSON.parse(cat.filters),
    ]

    res.json({ ...toCategoryCard(cat), filters })
  } catch (e) { next(e) }
})

/* ── GET /api/brands ───────────────────────────────────────────────── */
router.get('/brands', async (req, res, next) => {
  try {
    const where = req.query.category ? { category: { slug: String(req.query.category) } } : {}
    const rows = await prisma.product.findMany({ where, distinct: ['brand'], select: { brand: true }, orderBy: { brand: 'asc' } })
    res.json({ items: rows.map((r) => r.brand) })
  } catch (e) { next(e) }
})

/* ── GET /api/products ─────────────────────────────────────────────── */
router.get('/products', async (req, res, next) => {
  try {
    const q = req.query

    const page = Math.max(1, Number(q.page) || 1)
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(q.limit) || DEFAULT_LIMIT))

    const where = { AND: [] }

    const cats = list(q.category)
    if (cats.length) where.AND.push({ category: { slug: { in: cats } } })

    const brands = list(q.brand)
    if (brands.length) where.AND.push({ brand: { in: brands } })

    if (q.minPrice) where.AND.push({ price: { gte: Number(q.minPrice) } })
    if (q.maxPrice) where.AND.push({ price: { lte: Number(q.maxPrice) } })
    if (q.minRating) where.AND.push({ rating: { gte: Number(q.minRating) } })
    if (q.inStock === 'true') where.AND.push({ stock: { gt: 0 } })
    if (q.onSale === 'true') where.AND.push({ oldPrice: { not: null } })

    if (q.q) {
      const term = String(q.q).trim()
      if (term) {
        where.AND.push({
          OR: [
            { title: { contains: term } },
            { brand: { contains: term } },
            { description: { contains: term } },
          ],
        })
      }
    }

    // ატრიბუტების ფილტრები: ?color=შავი&storage=256GB,512GB
    for (const [key, raw] of Object.entries(q)) {
      if (RESERVED.has(key)) continue
      const values = list(raw)
      if (values.length) where.AND.push({ attributes: { some: { key, value: { in: values } } } })
    }

    const orderBy = SORTS[String(q.sort)] || SORTS.newest

    const [total, items] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: { category: { select: { slug: true, name: true } } },
      }),
    ])

    res.json({
      items: items.map(toProduct),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      sort: SORTS[String(q.sort)] ? String(q.sort) : 'newest',
    })
  } catch (e) { next(e) }
})

/* ── GET /api/products/:slug ───────────────────────────────────────── */
router.get('/products/:slug', async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({
      where: { slug: req.params.slug },
      include: { category: true, attributes: true },
    })
    if (!product) return res.status(404).json({ message: 'Product not found', code: 'PRODUCT_NOT_FOUND' })

    const related = await prisma.product.findMany({
      where: { categoryId: product.categoryId, id: { not: product.id } },
      orderBy: { rating: 'desc' },
      take: 8,
      include: { category: { select: { slug: true, name: true } } },
    })

    res.json({ ...toProduct(product), related: related.map(toProduct) })
  } catch (e) { next(e) }
})

export default router

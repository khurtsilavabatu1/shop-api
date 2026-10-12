/**
 * ერთჯერადი მიგრაცია: User.phone / city / address → Address (ნაგულისხმევი).
 *
 * ეშვება სერვერის ჩართვისას. გადატანის შემდეგ ძველი სვეტები ცარიელდება, რომ შემდეგ
 * deploy-ზე სქემიდან წაშლა `prisma db push`-მა მონაცემების დაკარგვის გაფრთხილების
 * გარეშე შეძლოს. სვეტების წაშლის შემდეგ ეს ფაილიც წაიშლება.
 */
export async function migrateLegacyAddresses(prisma) {
  const users = await prisma.user.findMany({
    where: { OR: [{ phone: { not: null } }, { city: { not: null } }, { address: { not: null } }] },
    include: { _count: { select: { addresses: true } } },
  })

  for (const u of users) {
    // ახალ მისამართში ოთხივე ველი სავალდებულოა — არასრულ ჩანაწერს არ ვქმნით
    const complete = u.phone && u.city && u.address
    await prisma.$transaction([
      ...(complete && u._count.addresses === 0
        ? [prisma.address.create({
            data: { userId: u.id, fullName: u.name, phone: u.phone, city: u.city, address: u.address, isDefault: true },
          })]
        : []),
      prisma.user.update({ where: { id: u.id }, data: { phone: null, city: null, address: null } }),
    ])
  }

  if (users.length) console.log(`მისამართების მიგრაცია: ${users.length} მომხმარებელი დამუშავდა`)
}

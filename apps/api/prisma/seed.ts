import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

await prisma.telegramUpdate.deleteMany();
await prisma.telegramDraftLaunch.deleteMany();
await prisma.notificationOutbox.deleteMany();
await prisma.draftEvent.deleteMany();
await prisma.draftOption.deleteMany();
await prisma.draftPlayer.deleteMany();
await prisma.draft.deleteMany();
await prisma.user.deleteMany();
await prisma.$disconnect();

console.info("Database reset. Create a draft from the Mini App.");

import { PrismaClient } from "@prisma/client";
import { encryptPasswordSync } from "@utils/crypto";
import { LOGGER } from "@utils/winston";

export async function seed(prisma: PrismaClient) {
    if (process.env.NODE_ENV === "production" && (process.env.GOD_PASSWORD ?? "").length < 8) {
        throw new Error("GOD_PASSWORD deve avere almeno 8 caratteri per il seed in production");
    }
    const email = process.env.GOD_EMAIL!;
    if (await prisma.user.findUnique({ where: { email } })) return;

    await prisma.user.create({
        data: {
            username: process.env.GOD_USERNAME!,
            email,
            password: encryptPasswordSync(process.env.GOD_PASSWORD!),
            isPlatformAdmin: true,
            emailVerifiedAt: new Date(),
        },
    });
    LOGGER.info("Platform admin created");
}

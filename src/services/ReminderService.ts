import { Service } from "fastify-decorators";
import { Cron } from "croner";
import { getPrismaClient } from "@utils/prisma";
import { LOGGER } from "@utils/winston";
import { EmailSenderService } from "@services/EmailSenderService";
import { deadlineReminderTemplate } from "../templates/email/deadlineReminderTemplate";

const WINDOW_MS = 72 * 3600 * 1000;

@Service()
export class ReminderService {
    private job?: Cron;

    constructor(private readonly email: EmailSenderService) {}

    /** Email a chi non ha una candidatura VALID nelle edizioni OPEN che chiudono entro 72 h. Restituisce il numero di email inviate. */
    async sendDeadlineReminders(now: Date): Promise<number> {
        const seasons = await getPrismaClient().season.findMany({
            where: { status: "OPEN", candidaturesCloseAt: { gt: now, lte: new Date(now.getTime() + WINDOW_MS) } },
            include: {
                participants: {
                    where: { candidatures: { none: { status: "VALID" } } },
                    include: { user: { select: { email: true } }, category: { select: { name: true } } },
                },
            },
        });
        const sends = seasons.flatMap(s => s.participants.map(p =>
            this.email.send(p.user.email, "Promemoria: candida il tuo film", deadlineReminderTemplate(s.name, p.category?.name ?? null, s.candidaturesCloseAt))));
        await Promise.all(sends);
        return sends.length;
    }

    // ponytail: il job gira in ogni processo; con più istanze i promemoria partono più volte. Oggi pm2 ne avvia una. Se si scala, spostare il job in un processo solo o aggiungere un lock su DB.
    start(): void {
        this.job = new Cron("0 9,18 * * *", { timezone: "Europe/Rome" }, () =>
            this.sendDeadlineReminders(new Date()).catch(err => LOGGER.error(`Errore promemoria scadenza: ${err}`)));
    }

    stop(): void {
        this.job?.stop();
    }
}

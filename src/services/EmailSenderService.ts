import nodemailer, { Transporter } from "nodemailer";
import { Service } from "fastify-decorators";
import process from "process";
import { LOGGER } from "@utils/winston";

export const TEST_OUTBOX: { to: string; subject: string; html: string }[] = [];

@Service()
export class EmailSenderService {
    // non readonly: i test lo sostituiscono per simulare SMTP giù
    transporter: Transporter = process.env.NODE_ENV === "test"
        ? nodemailer.createTransport({ jsonTransport: true })
        : nodemailer.createTransport({
            host: process.env.SMTP_HOST || "smtp.gmail.com",
            port: Number(process.env.SMTP_PORT) || 587,
            secure: false, // true for 465
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });

    /** Non lancia mai: un invio fallito non deve far fallire la richiesta HTTP. */
    async send(to: string, subject: string, html: string): Promise<void> {
        try {
            const info = await this.transporter.sendMail({
                from: process.env.SMTP_FROM || process.env.SMTP_USER,
                to,
                subject,
                html,
            });
            if (process.env.NODE_ENV === "test") TEST_OUTBOX.push({ to, subject, html });
            LOGGER.info(`Email inviata. Destinatario <${to}> ${info.messageId}`);
        } catch (error) {
            LOGGER.error(`Errore durante l'invio dell'email a <${to}>: ${error}`);
        }
    }
}

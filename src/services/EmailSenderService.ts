import nodemailer, { Transporter } from "nodemailer";
import { Service } from "fastify-decorators";
import process from "process";

export interface EmailOptions {
    from?: string;
    to: string;
    subject: string;
    text?: string;
    html?: string;
}

export const TEST_OUTBOX: { to: string; subject: string; html: string }[] = [];

@Service()
export class EmailSenderService {
    private transporter: Transporter = process.env.NODE_ENV === "test"
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

    public async sendEmail(options: EmailOptions): Promise<void> {
        try {
            const mailOptions = {
                from: options.from || process.env.SMTP_FROM || process.env.SMTP_USER,
                to: options.to,
                subject: options.subject,
                text: options.text,
                html: options.html,
            };

            const info = await this.transporter.sendMail(mailOptions);
            if (process.env.NODE_ENV === "test") {
                TEST_OUTBOX.push({ to: options.to, subject: options.subject, html: options.html ?? "" });
            }
            console.log(`Email inviata. Destinatario <${options.to}> ${info.messageId}`);
        } catch (error) {
            console.error("Errore durante l'invio dell'email:", error);
            throw error;
        }
    }
}

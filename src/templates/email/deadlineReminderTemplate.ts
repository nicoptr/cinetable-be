import { emailButton, emailFact, emailLayout, emailText } from "./layout";
import { escapeHtml } from "@utils/html";
import { formatDayTime } from "@utils/date";

export function deadlineReminderTemplate(seasonName: string, categoryName: string | null, closeAt: Date, url: string): string {
    return emailLayout("Promemoria", "Manca il tuo film",
        emailText(`Non hai ancora candidato un film per l'edizione <strong>${escapeHtml(seasonName)}</strong>.`) +
        (categoryName ? emailFact("La tua categoria", escapeHtml(categoryName)) : "") +
        emailText(`Le candidature chiudono ${formatDayTime(closeAt)}.`) +
        emailButton(url, "Candida il tuo film"));
}

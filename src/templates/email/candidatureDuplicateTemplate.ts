import { emailButton, emailLayout, emailText } from "./layout";
import { escapeHtml } from "@utils/html";
import { formatDayTime } from "@utils/date";

export function candidatureDuplicateTemplate(movieTitle: string, closeAt: Date, url: string): string {
    return emailLayout("Candidatura", "Scegli un altro film",
        emailText(`Anche un altro partecipante ha candidato <strong>${escapeHtml(movieTitle)}</strong>: per non rovinare la sorpresa, il film è escluso dall'edizione e la tua candidatura è annullata.`) +
        emailText(`Scegline un altro entro ${formatDayTime(closeAt)}.`) +
        emailButton(url, "Scegli un altro film"));
}

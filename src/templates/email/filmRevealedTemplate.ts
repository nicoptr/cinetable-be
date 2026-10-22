import { emailButton, emailFact, emailLayout, emailText } from "./layout";
import { escapeHtml } from "@utils/html";
import { formatDayTime } from "@utils/date";

export function filmRevealedTemplate(movieTitle: string, screeningAt: Date | null, location: string | null, url: string): string {
    const upcoming = screeningAt && location && screeningAt > new Date();
    return emailLayout("Svelato", "Ecco il prossimo film",
        emailText(`Il prossimo film in programma è <strong>${escapeHtml(movieTitle)}</strong>.`) +
        (upcoming ? emailFact("Quando", formatDayTime(screeningAt)) + emailFact("Dove", escapeHtml(location)) : "") +
        emailButton(url, "Vedi il programma"));
}

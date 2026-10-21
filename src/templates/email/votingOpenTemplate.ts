import { emailLayout } from "./layout";
import { escapeHtml } from "@utils/html";

export function votingOpenTemplate(movieTitle: string): string {
    return emailLayout("Si vota!", `<p>Il voto per <strong>${escapeHtml(movieTitle)}</strong> è aperto.</p>
<p>Accedi a Cinetable e assegna un voto da 0 a 100 a ogni premio.</p>`);
}

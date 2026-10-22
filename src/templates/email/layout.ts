import { escapeHtml } from "@utils/html";

const GOLD = "#c9a24a";
const INK = "#ece5dc";
const MUTED = "#b3aaa0";
const SANS = "Arial,Helvetica,sans-serif";

/** `bodyHtml` deve arrivare già escapato dal chiamante; `eyebrow` e `title` vengono escapati qui. */
export function emailLayout(eyebrow: string, title: string, bodyHtml: string): string {
    return `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"></head>
<body style="margin:0;padding:0;background:#0f0d0e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f0d0e"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#211d1e;border:1px solid #3b3324;border-radius:14px;color:${INK};font-family:${SANS};font-size:16px;line-height:1.55">
<tr><td style="height:10px;background:#6e1820;border-bottom:2px solid ${GOLD};border-radius:14px 14px 0 0;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:24px 28px 32px">
<p style="margin:0 0 28px;font:800 22px ${SANS};letter-spacing:-0.5px;color:${GOLD}">Cinetable<span style="color:#8a2028">.</span></p>
<p style="margin:0 0 6px;font:12px ${SANS};letter-spacing:3px;text-transform:uppercase;color:${GOLD}">${escapeHtml(eyebrow)}</p>
<h1 style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:28px;line-height:1.2;color:${INK}">${escapeHtml(title)}</h1>
${bodyHtml}
</td></tr></table>
<p style="max-width:560px;margin:16px auto 0;font:12px/1.5 ${SANS};color:#7d756d">Cinetable · il cineforum tra amici</p>
</td></tr></table>
</body></html>`;
}

export function emailText(html: string): string {
    return `<p style="margin:0 0 14px">${html}</p>`;
}

export function emailNote(html: string): string {
    return `<p style="margin:20px 0 0;font-size:14px;color:${MUTED}">${html}</p>`;
}

/** Riquadro con etichetta e valore, per i dati che contano (categoria, data, luogo). `valueHtml` già escapato. */
export function emailFact(label: string, valueHtml: string): string {
    return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px"><tr><td style="padding:10px 16px;background:#2a2425;border-left:3px solid ${GOLD};border-radius:4px">
<span style="display:block;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:${MUTED}">${escapeHtml(label)}</span>
<span style="font-family:Georgia,'Times New Roman',serif;font-size:19px;color:${INK}">${valueHtml}</span></td></tr></table>`;
}

export function emailButton(url: string, label: string): string {
    return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0"><tr><td style="background:${GOLD};border-radius:8px">
<a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 26px;color:#1a1718;text-decoration:none;font:bold 16px ${SANS}">${escapeHtml(label)}</a></td></tr></table>`;
}

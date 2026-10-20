import { escapeHtml } from "@utils/html";

/** `bodyHtml` deve arrivare già escapato dal chiamante; `title` viene escapato qui. */
export function emailLayout(title: string, bodyHtml: string): string {
    return `<!doctype html>
<html lang="it"><body style="margin:0;padding:24px;background:#1a1718;color:#ece5dc;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5">
<div style="max-width:520px;margin:0 auto">
<h1 style="font-family:Georgia,serif;font-weight:normal;color:#c9a24a;font-size:26px">${escapeHtml(title)}</h1>
${bodyHtml}
</div></body></html>`;
}

export function emailButton(url: string, label: string): string {
    return `<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 24px;background:#c9a24a;color:#1a1718;text-decoration:none;border-radius:4px;font-weight:bold">${escapeHtml(label)}</a></p>`;
}

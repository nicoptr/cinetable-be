import "module-alias/register";
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateToken, hashToken } from "@utils/tokens";
import { escapeHtml } from "@utils/html";

test("generateToken", () => {
    const { token, hash } = generateToken();
    assert.match(token, /^[0-9a-f]{64}$/);
    assert.equal(hash, hashToken(token));
    assert.notEqual(hash, token);
});

test("escapeHtml", () => {
    assert.equal(escapeHtml(`<img src=x onerror="a">&'`), "&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;");
});

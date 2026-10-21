import "module-alias/register";
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateToken, hashToken } from "@utils/tokens";
import { escapeHtml } from "@utils/html";
import { parseTrustProxy } from "@utils/proxy";
import fastify from "fastify";

test("generateToken", () => {
    const { token, hash } = generateToken();
    assert.match(token, /^[0-9a-f]{64}$/);
    assert.equal(hash, hashToken(token));
    assert.notEqual(hash, token);
});

test("escapeHtml", () => {
    assert.equal(escapeHtml(`<img src=x onerror="a">&'`), "&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;");
});

test("parseTrustProxy", () => {
    assert.equal(parseTrustProxy(undefined), false);
    assert.equal(parseTrustProxy("false"), false);
    assert.equal(parseTrustProxy("0"), 0);
    assert.equal(parseTrustProxy("2"), 2);
    assert.equal(parseTrustProxy("true"), null);
    assert.equal(parseTrustProxy("1.5"), null);
    assert.equal(parseTrustProxy("10.0.0.1"), null);
});

test("trustProxy hop count: 1 hop reads the rightmost X-Forwarded-For entry", async () => {
    const app = fastify({ trustProxy: 1 });
    app.get("/", async req => req.ip);
    const res = await app.inject({ url: "/", remoteAddress: "10.0.0.2", headers: { "x-forwarded-for": "6.6.6.6, 1.2.3.4" } });
    assert.equal(res.body, "1.2.3.4");
    const direct = await app.inject({ url: "/", remoteAddress: "10.0.0.2" });
    assert.equal(direct.body, "10.0.0.2");
    await app.close();
});

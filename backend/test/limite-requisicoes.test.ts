import assert from "node:assert/strict";
import test from "node:test";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { CONFIAR_NO_PROXY, LIMITE_GERAL } from "../src/app.js";

// O proxy do Easypanel é o "remoteAddress"; o IP real vem no X-Forwarded-For que ele acrescenta.
async function montar(max = 3) {
  const app = Fastify({ trustProxy: CONFIAR_NO_PROXY });
  await app.register(rateLimit, { ...LIMITE_GERAL, max });
  app.get("/api/v1/ping", async (request) => ({ ip: request.ip }));
  app.get("/assets/app.js", async () => "js");
  await app.ready();
  return app;
}

const pedir = (app: Awaited<ReturnType<typeof montar>>, url: string, xff: string) =>
  app.inject({ method: "GET", url, remoteAddress: "10.0.0.2", headers: { "x-forwarded-for": xff } });

test("cada pessoa atrás do proxy tem o seu próprio limite", async () => {
  const app = await montar();
  assert.equal((await pedir(app, "/api/v1/ping", "200.1.1.1")).json().ip, "200.1.1.1");
  for (let i = 0; i < 2; i += 1) await pedir(app, "/api/v1/ping", "200.1.1.1");
  assert.equal((await pedir(app, "/api/v1/ping", "200.1.1.1")).statusCode, 429);
  // Outra pessoa, mesmo proxy: continua passando.
  assert.equal((await pedir(app, "/api/v1/ping", "200.2.2.2")).statusCode, 200);
  await app.close();
});

test("X-Forwarded-For inventado pelo navegador não escapa do limite", async () => {
  const app = await montar();
  // O proxy acrescenta o IP real no fim; o começo (inventado) é ignorado.
  for (let i = 0; i < 3; i += 1) await pedir(app, "/api/v1/ping", `1.1.1.${i}, 200.3.3.3`);
  assert.equal((await pedir(app, "/api/v1/ping", "9.9.9.9, 200.3.3.3")).statusCode, 429);
  await app.close();
});

test("arquivos da tela não contam no limite", async () => {
  const app = await montar();
  for (let i = 0; i < 10; i += 1) assert.equal((await pedir(app, "/assets/app.js", "200.4.4.4")).statusCode, 200);
  assert.equal((await pedir(app, "/api/v1/ping", "200.4.4.4")).statusCode, 200);
  await app.close();
});

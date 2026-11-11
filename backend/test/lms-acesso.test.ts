import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../src/lib/errors.js";
import { criarAcessoLms } from "../src/lib/lms-acesso.js";

const pedido = {
  token: "token-de-teste",
  baseUrl: "https://cursos.exemplo",
  name: "Ana Souza",
  email: "Ana@Email.com",
};

function fetchQue(status: number, body: unknown) {
  const chamadas: { url: string; init: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    chamadas.push({ url: String(url), init: init ?? {} });
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetchImpl, chamadas };
}

test("sem token não chama o LMS", async () => {
  let chamou = false;
  await assert.rejects(
    () => criarAcessoLms({ ...pedido, token: "  ", fetchImpl: async () => { chamou = true; return new Response(); } }),
    (error: unknown) => error instanceof AppError && error.statusCode === 503 && error.code === "LMS_INDISPONIVEL",
  );
  assert.equal(chamou, false);
});

test("envia nome, e-mail e trilha sem gravar senha quando ela não foi informada", async () => {
  const { fetchImpl, chamadas } = fetchQue(200, { created: true });
  const resultado = await criarAcessoLms({ ...pedido, trails: ["primeiro-emprego"], fetchImpl });
  const enviada = JSON.parse(String(chamadas[0]?.init.body));
  assert.equal(chamadas[0]?.url, "https://cursos.exemplo/api/integracao/acessos");
  assert.equal(new Headers(chamadas[0]?.init.headers).get("authorization"), "Bearer token-de-teste");
  assert.deepEqual(enviada, { name: "Ana Souza", email: "ana@email.com", trails: ["primeiro-emprego"] });
  assert.equal(resultado.password, null);
  assert.equal(resultado.contaNova, true);
  assert.equal(resultado.loginUrl, "https://cursos.dnawork.ai/login");
});

test("devolve a senha só quando o LMS a definiu nesta chamada", async () => {
  const { fetchImpl } = fetchQue(200, { data: { password: "segredo-1" } });
  const resultado = await criarAcessoLms({ ...pedido, password: "segredo-1", resetPassword: true, fetchImpl });
  assert.equal(resultado.password, "segredo-1");
});

test("omite a trilha quando o operador só quer criar o aluno", async () => {
  const { fetchImpl, chamadas } = fetchQue(200, {});
  await criarAcessoLms({ ...pedido, trails: ["  "], fetchImpl });
  assert.deepEqual(JSON.parse(String(chamadas[0]?.init.body)), { name: "Ana Souza", email: "ana@email.com" });
});

test("traduz 401, 422 e 503 do LMS sem repassar o corpo", async () => {
  const casos: Array<[number, number, string]> = [
    [401, 502, "LMS_CREDENCIAL"],
    [422, 422, "TRILHA_INEXISTENTE"],
    [503, 503, "LMS_INDISPONIVEL"],
  ];
  for (const [status, esperado, code] of casos) {
    const { fetchImpl } = fetchQue(status, { password: "nao-mostrar", message: "falha" });
    await assert.rejects(
      () => criarAcessoLms({ ...pedido, fetchImpl }),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, esperado);
        assert.equal(error.code, code);
        assert.equal(JSON.stringify(error).includes("nao-mostrar"), false);
        return true;
      },
    );
  }
});

test("recusa senha curta antes de chamar o LMS", async () => {
  let chamou = false;
  await assert.rejects(
    () => criarAcessoLms({ ...pedido, password: "curta", fetchImpl: async () => { chamou = true; return new Response(); } }),
    (error: unknown) => error instanceof AppError && error.code === "SENHA_CURTA",
  );
  assert.equal(chamou, false);
});

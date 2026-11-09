import assert from "node:assert/strict";
import test from "node:test";
import { mensagemDaVaga } from "../src/lib/mensagem-vaga.js";

test("mensagem da vaga no formato do Notion", () => {
  assert.equal(
    mensagemDaVaga({
      cargo: "Ajudante de Padeiro",
      bairro: "Cidade Jardim Cumbica",
      cidade: "Guarulhos",
      salario: "2137,60",
      beneficios: "Auxílio Transporte — Mensal\nPremiação vale compras 200,00",
      horario: "Segunda à Domingo, das 13:00 às 21:20",
    }),
    "Encontramos oportunidades com o seu perfil. Dá uma olhada:\nAjudante de Padeiro\n📍 Cidade Jardim Cumbica / Guarulhos\n💰Salário: R$ 2.137,60 + Auxílio Transporte + Premiação vale compras 200,00.\n🕐 Segunda à Domingo, das 13:00 às 21:20.",
  );
});

test("benefício com valor, texto em várias linhas e salário a combinar", () => {
  assert.equal(
    mensagemDaVaga({
      cargo: "Suporte Comercial",
      bairro: "",
      cidade: "São Paulo",
      salario: "0,00",
      beneficios: "Auxílio Transporte — R$ 10,00 — Diário\nVR R$33,00 o dia.",
      horario: "Segunda a sexta, 13:00 às 22:00; sábado por escala, 09:00 às 13:00.\nHome Office.",
    }),
    "Encontramos oportunidades com o seu perfil. Dá uma olhada:\nSuporte Comercial\n📍 São Paulo\n💰Salário: a combinar + Auxílio Transporte R$ 10,00 + VR R$33,00 o dia.\n🕐 Segunda a sexta, 13:00 às 22:00; sábado por escala, 09:00 às 13:00. Home Office.",
  );
});

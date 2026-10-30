import assert from "node:assert/strict";
import test from "node:test";
import { distanciaKm } from "../src/lib/triagem-geo.js";
import { formatarHorario } from "../src/lib/triagem-horario.js";
import { fraseHorario, gradeDe, localDe, turnosDe, vagaDaLinha } from "../src/lib/triagem-notion.js";
import { horarioEspelho } from "../src/services/notion-sync.service.js";
import { msAteProximoSlot, slotDe } from "../src/lib/agenda-sync.js";
import { beneficiosDe, horarioDe } from "../src/services/vagas-abertas-sync.service.js";
import { moneyToNumber } from "../src/lib/money.js";

test("agrupa dias com o mesmo horário", () => {
  assert.equal(
    formatarHorario({ semanas_inicio: "Segunda Feira", semanas_fim: "Sexta Feira", horabase: "08:00", hora_saida_base: "17:00", texto_carga: "" }),
    "Segunda a sexta, 08:00 às 17:00",
  );
});

test("separa o dia com horário próprio", () => {
  assert.equal(
    formatarHorario({ semanas_inicio: "Segunda Feira", semanas_fim: "Sexta Feira", horabase: "06:00", hora_saida_base: "14:20", sab_saida: "15:20", texto_carga: "" }),
    "Segunda a sexta, 06:00 às 14:20; sábado, 06:00 às 15:20, com folga na semana",
  );
});

test("folga vem do texto_carga ou da jornada de 6 a 7 dias", () => {
  assert.equal(
    formatarHorario({ semanas_inicio: "Segunda Feira", semanas_fim: "Domingo", horabase: "07:00", hora_saida_base: "15:20", texto_carga: "Segunda à Domingo, das 07:00 às 15:20, com folgas alternadas." }),
    "Segunda a domingo, 07:00 às 15:20, com folgas alternadas",
  );
  assert.equal(
    formatarHorario({ semanas_inicio: "Segunda Feira", semanas_fim: "Sábado", horabase: "09:00", hora_saida_base: "15:00", texto_carga: "" }),
    "Segunda a sábado, 09:00 às 15:00, com folga na semana",
  );
});

test("início igual ao fim vale a semana inteira", () => {
  assert.equal(
    formatarHorario({ semanas_inicio: "Segunda Feira", semanas_fim: "Segunda Feira", horabase: "14:00", hora_saida_base: "22:20", segunda_entrada: "0", segunda_saida: "0" }),
    "Segunda a domingo, 14:00 às 22:20, com folga na semana",
  );
});

test("sem horário não monta texto", () => {
  assert.equal(formatarHorario({ semanas_inicio: "", semanas_fim: "", horabase: "", hora_saida_base: "" }), null);
});

test("distância em linha reta", () => {
  const km = distanciaKm({ lat: -23.5505, lng: -46.6333 }, { lat: -22.9068, lng: -43.1729 });
  assert.ok(km > 355 && km < 365, `distância SP-RJ fora do esperado: ${km}`);
});

test("Notion: horário da linha 🕐 com dias, horas e folga", () => {
  assert.equal(fraseHorario("🕐 Segunda Feira a Domingo das 11:00 ás 16:00, com uma folga alternada na semana."), "Segunda a domingo, 11:00 às 16:00 • Uma folga alternada na semana");
  assert.equal(fraseHorario("🕐Segunda à sexta 8h00 as 17h00"), "Segunda a sexta, 08:00 às 17:00");
  assert.equal(fraseHorario("🕐 Segunda á sexta 11h às 16h30 Sábado - 7h30 às 13h"), "Segunda a sexta, 11:00 às 16:30; sábado, 07:30 às 13:00");
  assert.equal(fraseHorario("🕐 6x1 das 13h30 ás 21h20."), "6x1 das 13:30 às 21:20");
});

test("Notion: local no formato Bairro - Cidade / UF", () => {
  assert.equal(localDe("📍 Bairro: Jardim Tango", "Bairro: Jardim Tango\nCidade: São Paulo/SP"), "Jardim Tango - São Paulo / SP");
  assert.equal(localDe("📍 Cidade Jardim Cumbica / Guarulhos", "Cidade: Guarulhos/SP"), "Cidade Jardim Cumbica - Guarulhos / SP");
  assert.equal(localDe("📍 Presidente Altino - Osasco / SP"), "Presidente Altino - Osasco / SP");
  assert.equal(localDe("📍 Bairro: Santo Antônio", "Endereço: Avenida Goiás, 3141 – Santo Antônio - São Caetano do Sul / SP"), "Santo Antônio - São Caetano do Sul / SP");
  assert.equal(localDe("📍 Vila Yara"), "Vila Yara");
});

test("Notion: linha da tabela com código em qualquer célula", () => {
  const linha = vagaDaLinha([
    "ZONA Leste",
    "Empresa: Bengala - mizq-4227\nCidade: São Paulo/SP",
    "Operador de Loja\n📍 Bairro: Jardim Tango\n💰 Bolsa: R$ 780.00\n🕐 Segunda Feira a Domingo das 11:00 ás 16:00",
  ]);
  assert.deepEqual(linha?.codigos, ["MIZQ-4227"]);
  assert.deepEqual(linha?.vaga.horarios, ["Segunda a domingo, 11:00 às 16:00"]);
  assert.equal(linha?.vaga.local, "Jardim Tango - São Paulo / SP");
  assert.deepEqual(linha?.vaga.localPartes, { bairro: "Jardim Tango", cidade: "São Paulo", uf: "SP" });
  assert.equal(vagaDaLinha(["Zona", "Endereços", "Mensagem"]), null);
});

test("sync: grade de segunda a domingo com folga", () => {
  const grade = gradeDe("🕐 Segunda à Domingo, das 14:00 ás 22:20, com folgas alternadas.");
  assert.deepEqual(grade, {
    semanasInicio: 2, semanasFim: 1, entrada: "14:00", saida: "22:20",
    texto: "Segunda a domingo, 14:00 às 22:20 • Folgas alternadas", refeicao: null, dias: [1, 2, 3, 4, 5, 6, 7],
    diasTexto: "Segunda a domingo", folga: "Folgas alternadas",
  });
});

test("sync: faixa que vira a semana e intervalo em minutos", () => {
  const grade = gradeDe("🕐 Sexta a segunda das 8h às 14h, com intervalo de 15 minutos a definir");
  assert.equal(grade?.semanasInicio, 6);
  assert.equal(grade?.semanasFim, 2);
  assert.deepEqual(grade?.dias, [1, 2, 6, 7]);
  assert.equal(grade?.refeicao, "00:15");
});

test("sync: texto sem dois dias e duas horas não vira grade", () => {
  assert.equal(gradeDe("🕐 6x1 das 13h30 ás 21h20"), null);
  assert.equal(gradeDe("🕐 Segunda Feira, Domingo e feriados das 15:30 às 21:30"), null);
  assert.equal(gradeDe("🕐 Manhã: 06:00 às 14:00"), null);
});

test("sync: ponto e vírgula do texto vira vírgula", () => {
  assert.equal(gradeDe("🕐 Segunda á sexta 11h às 16h30 Sábado - 7h30 às 13h")?.texto, "Segunda a sexta, 11:00 às 16:30, sábado, 07:30 às 13:00");
});

test("sync: horário no formato do espelho mantém o turno", () => {
  const turnos = turnosDe(["🕐 Segunda a sexta, 09:00 às 16:00"])!;
  assert.equal(
    horarioEspelho(turnos, "00:00", "Manha;2-6;00:00;1=;2=09:00-15:00;3=;4=;5=;6=;7=;texto=antigo"),
    "Manha;2-6;00:00;1=;2=09:00-16:00;3=09:00-16:00;4=09:00-16:00;5=09:00-16:00;6=09:00-16:00;7=;texto=Segunda a sexta, 09:00 às 16:00",
  );
});

test("sync: slots pelo relógio de São Paulo", () => {
  const as1310 = new Date("2026-10-29T16:10:00Z"); // 13:10 em São Paulo
  assert.equal(slotDe(as1310), "2026-10-29-12");
  assert.equal(msAteProximoSlot(as1310), (4 * 60 + 50) * 60 * 1000);
  assert.equal(slotDe(new Date("2026-10-30T02:59:00Z")), "2026-10-29-18");
  assert.equal(slotDe(new Date("2026-10-30T03:00:00Z")), "2026-10-30-00");
});

test("sync: dois turnos do Notion entram juntos, o primeiro vai para a grade", () => {
  const turnos = turnosDe(["🕐 Segunda à Domingo, das 07:00 às 15:20, com folgas alternadas.", "🕐 Segunda à Domingo, das 13:00 às 21:20, com folgas alternadas."])!;
  assert.equal(turnos.texto, "Segunda a domingo, 07:00 às 15:20 ou 13:00 às 21:20 • Folgas alternadas");
  assert.equal(turnos.principal.entrada, "07:00");
  assert.equal(turnos.turnos.length, 2);
});

test("sync: turnos em dias diferentes preenchem cada dia na grade", () => {
  const turnos = turnosDe(["🕐 Segunda a sexta, 08:00 às 17:00", "🕐 Sábado a sábado, 08:00 às 12:00"])!;
  assert.equal(turnos.texto, "Segunda a sexta, 08:00 às 17:00 ou Sábado, 08:00 às 12:00");
  assert.equal(
    horarioEspelho(turnos, "00:00", null),
    ";2-6;00:00;1=;2=08:00-17:00;3=08:00-17:00;4=08:00-17:00;5=08:00-17:00;6=08:00-17:00;7=08:00-12:00;texto=Segunda a sexta, 08:00 às 17:00 ou Sábado, 08:00 às 12:00",
  );
});

test("sync: linha 🕐 fora do padrão não gera turno", () => {
  assert.equal(turnosDe(["🕐 6x1 das 13h30 ás 21h20"]), null);
});

test("cópia: grade usa as colunas do dia e a base dentro da faixa", () => {
  assert.equal(
    horarioDe({ periodo: "", semanas_inicio: 4, semanas_fim: 5, horabase: "16:00", hora_saida_base: "01:30", texto_carga: "" }),
    ";4-5;00:00;1=;2=;3=;4=16:00-01:30;5=16:00-01:30;6=;7=",
  );
  assert.equal(
    horarioDe({ periodo: "Manha", semanas_inicio: 2, semanas_fim: 7, horabase: "12:00", hora_saida_base: "18:00", domindo_entrada: "0", domindo_saida: "0", segunda_entrada: "12:00", segunda_saida: "18:00", texto_carga: "Seg a sáb" }),
    "Manha;2-7;00:00;1=;2=12:00-18:00;3=12:00-18:00;4=12:00-18:00;5=12:00-18:00;6=12:00-18:00;7=12:00-18:00;texto=Seg a sáb",
  );
});

test("cópia: benefícios em ordem alfabética com valor e periodicidade", () => {
  assert.equal(
    beneficiosDe([{ nome: "Seguro de Vida", valor: "", tipo: "M" }, { nome: "Auxílio Transporte", valor: "10,00", tipo: "D" }]),
    "Auxílio Transporte — R$ 10,00 — Diário\nSeguro de Vida — Mensal",
  );
  assert.equal(beneficiosDe([]), null);
});

test("cópia: salário com ponto decimal não é multiplicado por 100", () => {
  for (const [bruto, esperado] of [["800.00", 800], ["2137.60", 2137.6], ["1800,00", 1800], ["1.800,00", 1800], ["3000.00", 3000]] as const) {
    assert.equal(moneyToNumber(bruto), esperado, bruto);
  }
});

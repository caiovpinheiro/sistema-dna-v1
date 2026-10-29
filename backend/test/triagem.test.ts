import assert from "node:assert/strict";
import test from "node:test";
import { distanciaKm } from "../src/lib/triagem-geo.js";
import { formatarHorario } from "../src/lib/triagem-horario.js";

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

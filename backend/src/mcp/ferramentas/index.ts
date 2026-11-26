import { RegistroFerramentas } from "../registro.js";
import { ferramentasCandidatos } from "./candidatos.js";
import { ferramentasConhecimento } from "./conhecimento.js";
import { ferramentasDossies } from "./dossies.js";
import { ferramentasEmpresas } from "./empresas.js";
import { ferramentasGestao } from "./gestao.js";
import { ferramentasProcessos } from "./processos.js";
import { ferramentasTriagem } from "./triagem.js";
import { ferramentasVagas } from "./vagas.js";

/** Todas as ferramentas que EXISTEM. Uma ferramenta só chega a um usuário se a integração a liberar (deny-by-default). */
export function criarRegistroPadrao(): RegistroFerramentas {
  const registro = new RegistroFerramentas();
  for (const f of [...ferramentasVagas, ...ferramentasEmpresas, ...ferramentasTriagem, ...ferramentasCandidatos, ...ferramentasDossies, ...ferramentasProcessos, ...ferramentasGestao, ...ferramentasConhecimento]) registro.registrar(f);
  return registro;
}

export type BloqueioRegua = {
  idEmpresa: string;
  bloqueado: boolean;
  motivo: string;
};

// Bloqueio temporário pelo id_empresa da matriz. Não altera o cadastro.
// HABA e Lumi têm o mesmo e-mail e IDs diferentes, então cada uma pode ser liberada sozinha.
export const BLOQUEIOS: BloqueioRegua[] = [
  { idEmpresa: "910764e4-d987-11ef-8737-028ceec87957", bloqueado: true, motivo: "Departamento pessoal no campo financeiro" },
  { idEmpresa: "2ab00548-cd80-11f1-9500-02437a0ac733", bloqueado: true, motivo: "Caixa de RH no campo financeiro" },
  { idEmpresa: "8e57ce2f-ef96-11ef-8737-028ceec87957", bloqueado: true, motivo: "Caixa de RH no campo financeiro" },
  { idEmpresa: "974292ab-d73f-11ef-8737-028ceec87957", bloqueado: true, motivo: "Caixa de RH no campo financeiro" },
  { idEmpresa: "877fd960-97ba-11ef-8737-028ceec87957", bloqueado: true, motivo: "Caixa de currículos no campo financeiro" },
  { idEmpresa: "db35435b-80ed-11ef-8737-028ceec87957", bloqueado: true, motivo: "Caixa de RH no campo financeiro" },
  { idEmpresa: "3cb6b7c4-05c1-11f0-8737-028ceec87957", bloqueado: true, motivo: "Caixa de RH no campo financeiro" },
];

export function estaBloqueado(idEmpresa: string | null | undefined, lista: BloqueioRegua[] = BLOQUEIOS) {
  const id = (idEmpresa ?? "").trim();
  return lista.some((item) => item.bloqueado && item.idEmpresa === id);
}

# Abrangência dos registros no MCP (Fase 4)

> Última revisão: 2026-11-26. Camada própria do MCP, **somada** às permissões do painel (que continuam sem controle por registro).

## Levantamento dos vínculos que existem no banco

Conferido nas migrations (`prisma/migrations`), no `database/schema/local-dev.sql` e nos repositories:

| Pergunta | Resultado |
|---|---|
| Candidato, processo seletivo, contratação ou dossiê têm responsável, dono, criador ou atendente (coluna ligada a `app_usuario`)? | **Não.** O JSON `atendimento` é texto de triagem (nome, CPF, resumos, `deal_id`...), sem usuário do painel. |
| Existe equipe, time ou grupo de colaboradores? | **Não.** Só existem grupos de empresas (cliente), que não são equipes. |
| Existe vínculo real entre as entidades? | **Sim:** processo e contratação ligam candidato, empresa e vaga (`id_candidato`, `id_empresa`, `id_vaga`); o candidato guarda o `deal_id` do CRM. |
| O acesso a uma página dá acesso a todos os registros dela? | **Sim** (o painel não filtra por registro). |

## Abrangências

| Abrangência | Estado | Como funciona |
|---|---|---|
| Sem acesso (`nenhuma`) | disponível, **padrão** | Ferramentas com dados de pessoas (e indicadores) não aparecem no catálogo e não executam. |
| Próprios registros | **indisponível** | Não há responsável registrado; implementar seria inventar atribuição. Rejeitada pela API (`ABRANGENCIA_INDISPONIVEL`). |
| Registros de uma equipe | **indisponível** | Não há equipes. Idem. |
| Registros autorizados (`autorizados`) | disponível | O administrador escolhe candidatos e empresas (só ids, validados contra o banco; máx. 100). Só consultas por id. |
| Todos os registros (`todos`) | disponível | Tudo que a página do painel permitir. |

Para liberar "próprios" ou "equipe" no futuro é preciso primeiro registrar o responsável/equipe no próprio painel (mudança de negócio, fora do escopo do MCP).

## Regras

- Interseção avaliada **a cada chamada**: página do painel ∧ integração ativa e ferramenta ligada ∧ ferramenta liberada ao colaborador ∧ abrangência ∧ escopo OAuth ∧ permissão individual. O MCP nunca concede mais que o painel.
- `lista` (buscar candidatos, listar processos, listar contratações) e `agregado` (dashboard, indicadores, origem, métricas) exigem `todos`; com `autorizados` ficam fora do catálogo, para que filtro, paginação ou outra ferramenta não contornem o limite.
- `registro` (consulta por id) com `autorizados`: o candidato precisa estar autorizado; processo e contratação valem se o candidato **ou** a empresa estiverem autorizados; `deal_id` e dossiê só se o `deal_id` levar a um candidato autorizado (sem vínculo verificável, nega). Fora da abrangência, a resposta é igual à de "não encontrado".
- Empresa autorizada libera processos e contratações dela, **não** a ficha dos candidatos.
- Catálogo de vagas, empresas e triagem segue só pela página do painel (não são dados individuais de pessoas).
- Indicadores gerenciais: administrador efetivo ou permissão individual `gestao:indicadores`, **e** abrangência `todos`. Métricas CLT/estágio: só administrador (e `todos`).
- Contato (celular/e-mail): só com `candidatos:contato`, independente da abrangência. CPF, RG, documentos, dados bancários e endereço completo continuam indisponíveis.
- Mudanças valem na próxima chamada com o mesmo token; revogar apaga as conexões.

## Matriz (ferramenta × condição)

| Grupo | Ferramentas | Página | Abrangência | Extra |
|---|---|---|---|---|
| Catálogo | vagas (6), empresas (3), triagem (3) | da área | não se aplica | — |
| Lista/busca | buscar_candidatos, listar_processos, listar_contratacoes | candidatos / processos / contratacoes | `todos` | contato só com `candidatos:contato` |
| Por id | consultar_candidato, consultar_perfil_profissional, consultar_historico_candidato, localizar_candidato_por_deal, consultar_dados_dossie, gerar_dossie, consultar_processo, consultar_contratacao | candidatos / triagem / processos / contratacoes | `todos` ou `autorizados` (confere o registro) | dossiê gera texto, não grava no CRM |
| Gerencial | consultar_dashboard, consultar_indicadores_contratacoes, consultar_origem_candidatos | painel / contratacoes | `todos` | admin efetivo ou `gestao:indicadores` |
| Administração | consultar_metricas_clt, consultar_metricas_estagio | — | `todos` | só administrador |
| Apoio | listar_registros_autorizados | — | qualquer | mostra só os registros autorizados do próprio usuário |

Testes: `backend/test/mcp-abrangencia.test.ts` e `backend/test/mcp-admin.test.ts`.

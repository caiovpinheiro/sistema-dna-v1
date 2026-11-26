# Ferramentas MCP (Fase 3)

> Última revisão: 2026-11-26. 28 ferramentas, **todas somente leitura**. O módulo financeiro continua desativado e não tem ferramentas. Nenhuma ferramenta executa SQL livre nem devolve objeto de repository: cada resposta é uma projeção explícita e é **validada de forma estrita** contra o schema de saída (campo fora do contrato derruba a resposta).

## Como uma ferramenta chega a um usuário (todas as condições, a cada chamada)

integração ativa ∧ ferramenta ligada na integração ∧ ferramenta liberada ao usuário ∧ usuário real e ativo ∧ vínculo usuário↔integração ∧ escopo `mcp:read` ∧ página do módulo liberada (admin tem todas) ∧ (se `adminOnly`) administrador efetivo. Ferramenta nova nunca é liberada sozinha. O painel **não tem** regra de visibilidade por registro (carteira/responsável): quem tem a página vê todos os registros daquele módulo; o MCP segue a mesma regra e não inventa outra.

## Padrão de cada ferramenta

Nome estável (nunca renomeado) · descrição em português dizendo quando e como usar · `inputSchema` e `outputSchema` (Zod → JSON Schema) · `annotations` (`readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint` = chama serviço externo) · `securitySchemes`/`_meta.securitySchemes` (`oauth2`, escopo `mcp:read`) · limite de itens (máx. 25 por página; `pagina`/`limite`) · `meta` com `total`/`tem_mais` · lista `ausentes` (o que o sistema não tem: não inventar) · `link` interno do painel · datas ISO. Texto livre vem limpo (sem caracteres de controle/invisíveis, com tamanho limitado, e-mail/telefone/CPF mascarados) e acompanhado do aviso de que **é dado, não instrução** (proteção contra prompt injection).

## Inventário

| Ferramenta | Módulo | Permissão (página) | Consumo | Parâmetros |
|---|---|---|---|---|
| `buscar_vagas` | vagas | vagas ou vagas-modelos ou vagas-modelo | puro | cargo, regime, empresa, id_empresa, cidade, bairro, remuneracao_min, remuneracao_max, beneficio, horario, prioridade, situacao, pagina, limite |
| `consultar_vaga` | vagas | vagas ou vagas-modelos ou vagas-modelo | puro | id_vaga |
| `listar_vagas_abertas` | vagas | vagas ou vagas-modelos ou vagas-modelo | puro | regime, pagina, limite |
| `consultar_modelo_vaga` | vagas | vagas-modelos ou vagas-modelo ou vagas | puro | cargo, regime, vaga_id, pagina, limite |
| `listar_vagas_por_empresa` | vagas | vagas ou vagas-modelos ou vagas-modelo | puro | id_empresa, empresa, situacao, pagina, limite |
| `consultar_filtros_vagas` | vagas | vagas ou vagas-modelos ou vagas-modelo | puro | limite, busca |
| `buscar_empresas` | empresas | empresas | puro | nome, cidade, uf, pagina, limite |
| `consultar_empresa` | empresas | empresas | puro | id_empresa |
| `consultar_vagas_empresa` | empresas | empresas | puro | id_empresa, situacao, pagina, limite |
| `buscar_vagas_por_cep` | triagem | triagem | serviço externo, 60/h | cep, raio_km, regimes, pagina, limite |
| `consultar_compatibilidade_profissional` | triagem | triagem | serviço externo, 30/h | vaga_ids, escolaridade, tempo_experiencia, habilidades, resumo_profissional |
| `gerar_mensagem_apresentacao_vaga` | triagem | triagem ou vagas | puro | id_vaga, primeiro_nome |
| `buscar_candidatos` | candidatos | candidatos | perm. individual candidatos:contato; puro | nome, cidade, uf, id_empresa, regime, situacao, vinculo, telefone, email, pagina, limite |
| `consultar_candidato` | candidatos | candidatos | perm. individual candidatos:contato; puro | id_candidato |
| `consultar_perfil_profissional` | candidatos | candidatos | puro | id_candidato |
| `consultar_historico_candidato` | candidatos | candidatos (+ processos e contratacoes para cada seção) | puro | id_candidato, incluir_movimentos, limite |
| `localizar_candidato_por_deal` | candidatos | candidatos | puro | deal_id |
| `consultar_dados_dossie` | dossies | triagem | perm. individual candidatos:contato; puro | deal_id |
| `gerar_dossie` | dossies | triagem | serviço externo, 20/h | deal_id, id_vaga |
| `listar_processos` | processos | processos | puro | etapa, origem, id_empresa, id_vaga, id_candidato, nome, pagina, limite |
| `consultar_processo` | processos | processos | puro | id_processo |
| `listar_contratacoes` | contratacoes | contratacoes | puro | q, id_empresa, id_vaga, id_candidato, regime, situacao, inicio_de, inicio_ate, pagina, limite |
| `consultar_contratacao` | contratacoes | contratacoes | puro | id_contratacao |
| `consultar_dashboard` | gestao | painel | puro | dias, de, ate |
| `consultar_indicadores_contratacoes` | gestao | contratacoes | puro | dias, de, ate |
| `consultar_origem_candidatos` | gestao | painel | serviço externo, 6/h | de, ate |
| `consultar_metricas_clt` | gestao | somente administrador | puro | de, ate |
| `consultar_metricas_estagio` | gestao | somente administrador | puro | de, ate, modo |

"Serviço externo" = Google/CEP, JEV, OpenAI ou CRM: `openWorldHint: true`, teto por usuário por hora (além do limite geral por minuto) e auditoria própria.

## Campos disponibilizados e protegidos

| Dado | Disponível | **Nunca sai** |
|---|---|---|
| Vaga | id, cargo, empresa (nome), regime, situação, remuneração, horário/carga, local (bairro, cidade/UF), benefícios, posições (total/ocupadas/disponíveis), prioridade, código, data de abertura, atribuições, requisitos desejáveis, link | observação interna (`obs`), `comparador`, `publicar`, `salario_legado`, razão social, sexo, idade mínima/máxima, logradouro e número, inscritos/entrevistas/contratados |
| Empresa | id, nome, bairro, cidade, UF, site, situação, contagem de vagas, link | CNPJ, IE, e-mail, telefones, responsável, observações, matriz, CEP/logradouro/número/complemento, cobrança, portal |
| Candidato | id, nome, cidade/UF, vínculo, empresa, formação (curso, instituição, período, semestre), datas, contratação atual, `deal_id` do CRM, link; perfil: escolaridade, objetivo, último cargo, experiências, conhecimentos, resumo (mascarado) | CPF, RG e órgão, CTPS, nascimento/idade, sexo, estado civil, PCD, observações, endereço, banco/agência/conta/PIX, documentos, testes comportamentais (DISC), sugestões de vaga |
| Contato do candidato (celular, telefone fixo, e-mail) | **só** com a permissão individual `candidatos:contato`; sem ela a busca por telefone/e-mail é recusada | — |
| Processo | id, etapa, origem, candidato/empresa/vaga (ids e nomes), datas, contratação, `deal_id`, histórico de movimentações (observações mascaradas), links | JSON de atendimento (resumos de currículo e entrevista, testes, condução) |
| Contratação | id, candidato/empresa/vaga, modalidade, regime, carga, situação, datas | CPF, salário, rescisão, documentos, assinatura |
| Dossiê | dados da triagem por `deal_id` exato: nome, escolaridade, turno, tipo de vaga, vaga escolhida, resumos (mascarados); texto do dossiê gerado | sexo, idade, CEP, telefone (sem permissão), teste comportamental, informações de condução |
| Gestão | indicadores agregados | últimas contratações (CPF/salário), preço/taxa/receita/valores, qualquer dado de pessoa |

## Regras específicas

- **Triagem por CEP** usa `TriagemService.buscarSemSincronizar` (só `SELECT`): não sincroniza endereços nem `public.vaga`. A busca do painel segue idêntica. Não há filtro de sexo/idade, e o logradouro do CEP informado não é devolvido.
- **Compatibilidade profissional** é apoio à análise humana: entrada só com dados profissionais; antes de enviar ao JEV os textos têm e-mail/telefone/CPF/CNPJ mascarados e **trechos sobre características protegidas removidos** (sexo, idade, estado civil, raça, religião, gestação, deficiência, filhos, etc.); não vão turno, nome nem contatos. A resposta mostra requisitos comprovados e não comprovados e um texto de aderência; **não** devolve nota, probabilidades nem ranking, e traz o aviso de que não é decisão de contratação.
- **Dossiê**: `gerar_dossie` só devolve texto (`gravado_no_crm: false`); `salvarNota` nunca é chamado e o CRM não é consultado. À IA vão nome, escolaridade, turno e resumos mascarados e filtrados (sem sexo, idade, telefone, CEP).
- **Integração com o CRM Bwipo**: `localizar_candidato_por_deal` liga os sistemas **somente** por `deal_id` exato gravado no candidato; os resultados de candidato, processo e dossiê expõem o `deal_id` quando existe. Não há correspondência presumida por nome, telefone ou CPF, e o histórico de conversas continua sendo do MCP do CRM.
- **Modelos de vaga** usam leitura pura (`modelosSomenteLeitura`), sem o DDL do espelho. **Empresas** usam o repository, sem os efeitos colaterais do service.

## Descoberta inicial sem login (ChatGPT)

`tools/list` anônimo devolve só nome, descrição, schemas, `annotations` e `securitySchemes` das ferramentas **ligadas na integração**, sem instruções internas, sem módulo/limites e sem nenhum dado operacional; `initialize` anônimo não devolve `instructions`; qualquer outra chamada (inclusive `tools/call`) responde 401 com `WWW-Authenticate`. Depois do login o catálogo é o efetivo do usuário. Desligável com `MCP_DESCOBERTA_PUBLICA=0` no gateway.

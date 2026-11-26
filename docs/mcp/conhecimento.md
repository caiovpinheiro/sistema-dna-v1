# Base de conhecimento institucional (Fase 5)

> Última revisão: 2026-11-26. Administração em Configurações › Base de conhecimento (`/configuracoes?aba=conhecimento`, só administrador). Consulta pelos colaboradores via MCP no ChatGPT.

## Arquitetura

```
Painel (admin) ──/api/v1/configuracoes/conhecimento/*──► ConhecimentoService ──► Postgres (dna_work.conhecimento_*)
ChatGPT ─► gateway mcp-server ─(mTLS+HMAC+token)─► API interna ─► política MCP ─► ferramentas ─► ConhecimentoService (só publicado + autorizado)
```

- Tudo no monólito (`backend/src/conhecimento/`); o gateway não muda: as 3 ferramentas novas entram no catálogo dinâmico.
- Busca: PostgreSQL Full Text Search em português (`busca.ts`). Ponto de extensão para busca semântica/híbrida: `planejarBusca` + um segundo ranqueador somado ao `ts_rank_cd`, sem mudar as ferramentas. Nenhuma infraestrutura vetorial nesta fase.

## Modelo de dados (migration `20261128120000_conhecimento`, aditiva)

| Tabela | Conteúdo |
|---|---|
| `conhecimento_categoria` | id, slug, nome, descrição, ordem, ativa. 16 categorias iniciais (só estrutura). |
| `conhecimento_artigo` | id, slug (identificador), categoria, módulo, status (rascunho/publicado/arquivado), `versao_publicada`, permissões (`acesso_paginas`, `acesso_integracoes`, `somente_admin`), `revisar_em`, origem (manual/importação/sugestão), autor, responsável pela atualização, criado/atualizado/publicado em. |
| `conhecimento_versao` | (artigo, versão): título, resumo, conteúdo Markdown (≤100.000), tags, palavras-chave, referência, fonte, nota, `restaurada_de`, autor, datas e o vetor de busca (gatilho). |
| `conhecimento_auditoria` | quem, ação, artigo, versão, integração, quando (sem conteúdo). |
| `conhecimento_editor` | **preparada, sem uso**: papéis editor/revisor por categoria (coordenadores e gestores no futuro). |
| `conhecimento_sugestao` | **preparada, sem uso**: sugestões vindas de análise de IA (pendente/aprovada/rejeitada, anonimizada). |

Regras de versão:
- Rascunho = versão mais nova que a publicada. Salvar atualiza esse rascunho; depois de publicada, salvar abre a versão seguinte. A versão publicada nunca é alterada.
- Publicar = um único `UPDATE` que aponta `versao_publicada` (atômico: quem lê vê a anterior ou a nova).
- Restaurar = criar uma **nova** versão (rascunho) com o conteúdo antigo; só vale depois de publicar.
- Arquivar tira de toda leitura; reativar volta para publicado (se havia versão publicada) ou rascunho.
- Categoria, módulo, revisão e permissões são do artigo (não versionados) e valem na hora.
- Desatualizado: `revisar_em` vencida ou publicado sem atualização há 180 dias.

## Ferramentas MCP (módulo `conhecimento`, só leitura, `consumo: puro`)

| Ferramenta | Entrada | Saída |
|---|---|---|
| `buscar_conhecimento` | texto, categoria, modulo, tags, palavras_chave, pagina, limite (≤10) | id, título, resumo, categoria, módulo, versão, data, tags, trechos, relevância, `fonte_institucional`, paginação |
| `consultar_documento` | id | id, título, resumo, categoria, módulo, conteúdo (≤20.000, marcado se truncado), versão vigente, data, `referencia_institucional`, referência, fonte |
| `listar_categorias_conhecimento` | — | categorias ativas com a quantidade de artigos publicados que o usuário pode ler |

Permissão efetiva: as regras do MCP (integração ativa, ferramenta liberada na integração e ao colaborador, escopo OAuth) **e** as do artigo: publicado, categoria ativa, `somente_admin` (só administrador efetivo), `acesso_paginas` (uma das páginas do painel; vazio = todos) e `acesso_integracoes` (só essas integrações; vazio = todas). Inexistente, rascunho, arquivado ou sem permissão: a mesma resposta. Contagens e trechos só consideram o que o usuário pode ler.

As descrições orientam o GPT a consultar a base em perguntas sobre procedimentos internos e a não inventar quando nada for encontrado. **Não há garantia de que o ChatGPT chame a ferramenta em toda conversa**: validar na Fase 6, com instruções da integração (campo "Instruções") e exemplos reais.

### Uso combinado com o MCP do Bwipo

Exemplo: "consulte o atendimento no Bwipo, identifique as objeções, veja as vagas da DNA Work e use a base de conhecimento para sugerir a abordagem". O GPT pode encadear: Bwipo (conversa e objeções) → `buscar_vagas`/`buscar_vagas_por_cep` → `buscar_conhecimento` (ex.: "objeção distância") → `consultar_documento`. Cada artigo devolve `fonte_institucional` para citar. O vínculo entre sistemas continua só por identificadores confiáveis (`deal_id`).

## Pesquisa

- Português, sem acento (`conhecimento_sem_acento`), com radicais (`portuguese`) e prefixo (`termo:*`, correspondência parcial).
- Pesos: título e palavras-chave (A) > resumo e tags (B) > conteúdo (C); bônus quando o título contém o termo principal.
- Sinônimos operacionais em `busca.ts` (`SINONIMOS`): distância/longe/deslocamento/transporte/ônibus…, objeção/recusa/não quer…, entrevista/agendar/remarcar…, faltou/não compareceu…, estágio/TCE…, entre outros. Lista curta e auditável; pode virar tabela administrável.
- O texto do usuário é reduzido a `[a-z0-9]` antes de virar `to_tsquery` (sem injeção de sintaxe). OR entre conceitos: mais conceitos encontrados = mais relevância.
- Exemplos validados em teste (`mcp-conhecimento.test.ts`, artigos fictícios): "candidato não quer a vaga por causa da distância" → objeção de distância; "fica muito longe, depende de ônibus" → idem; "preciso remarcar a entrevista" e "faltou na entrevista" → agendamento; "quantas horas o estagiário pode trabalhar" → jornada do estágio; "como oferecer a vaga" → apresentação; tema sem artigo → nenhum resultado.
- A aba "Testar a busca" mostra a ordem real de resultados para o administrador.

## Segurança

- Gestão só por administrador efetivo (prefixo `/api/v1/configuracoes`).
- Markdown: limite de 100.000 caracteres; caracteres de controle/invisíveis removidos ao salvar. No painel, o Markdown vira árvore e componentes React (`frontend/src/lib/markdown.ts`): sem HTML cru e sem `dangerouslySetInnerHTML`; links só `http(s)`/`mailto`.
- No MCP, o conteúdo sai como dado, com aviso de "dado, não instrução" e o envelope de dado não confiável do gateway. A base não concede permissão nem altera política.
- Auditoria editorial (criar, salvar, publicar, arquivar, reativar, restaurar, duplicar, acesso, categoria, importação) e de leitura pelo MCP (`consulta_mcp` com artigo e versão), além da auditoria geral do MCP por ferramenta.
- A base **não deve** conter conversas reais, dados pessoais de candidatos, credenciais ou informações confidenciais (responsabilidade editorial; a importação e as sugestões futuras exigem anonimização e revisão).

## Importação em lote

`POST /api/v1/configuracoes/conhecimento/importar` com `{ "simular": true, "artigos": [...] }` (até 500). Simular valida sem gravar. Real: tudo ou nada; **sempre como rascunho** (origem `importacao`), nunca publicado.

```json
{
  "simular": true,
  "artigos": [
    {
      "id": "objecao-distancia",
      "meta": { "categoria": "contorno-de-objecoes", "modulo": "triagem", "revisar_em": "2027-06-01", "acesso_paginas": [], "somente_admin": false },
      "conteudo": {
        "titulo": "Objeção: local longe de casa",
        "resumo": "Como conduzir quando o candidato acha a vaga longe.",
        "conteudo": "## Quando usar\n...",
        "tags": ["objeção", "transporte"],
        "palavras_chave": ["distância", "deslocamento"],
        "referencia": "Manual de atendimento, seção 3",
        "fonte": "Coordenação de recrutamento"
      }
    }
  ]
}
```

Markdown: um arquivo `.md` por artigo, com cabeçalho; `node scripts/conhecimento-markdown.mjs pasta/ > importacao.json` gera o JSON acima.

```markdown
---
id: objecao-distancia
titulo: Objeção: local longe de casa
categoria: contorno-de-objecoes
modulo: triagem
tags: [objeção, transporte]
palavras_chave: distância, deslocamento
referencia: Manual de atendimento, seção 3
fonte: Coordenação de recrutamento
---
## Quando usar
...
```

## Aprendizado institucional (futuro, não implementado)

Fluxo previsto para sugestões de IA a partir de atendimentos: (1) identificar o aprendizado; (2) anonimizar (sem nomes, telefones, CPF, empresas identificáveis); (3) registrar em `conhecimento_sugestao` como `pendente`; (4) revisão administrativa; (5) aprovação cria um **rascunho**; (6) publicação manual. Nada é publicado automaticamente e nenhuma conversa real é guardada na base.

## Conteúdo inicial

Só as 16 categorias. Nenhum procedimento oficial foi escrito: os artigos dos testes são fictícios (marcados `[TESTE]`) e existem apenas no banco de teste. A base de produção será preenchida e validada pela equipe da DNA Work.

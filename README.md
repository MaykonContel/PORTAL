# Obras Manager

Gestor de obras "estilo Smartsheet": uma única base de tarefas (hierarquia,
dependências, responsáveis, progresso) visualizada em **Grade**, **Gantt**,
**Kanban** e **Calendário** — mais um **Kanban Geral** entre todas as obras e
uma **Visão Geral** (dashboard).

Stack: **Node.js + Express + PostgreSQL (Neon)**, deploy no **Render** — mesmo
padrão do Romaneio de Etapas e do Contel Dashboard.

---

## 1. Deploy (você já tem Neon + Render)

1. **Neon**: crie um banco novo (ou reuse um) e copie a *connection string*.
2. Suba esta pasta para um repositório no GitHub (novo repo, `obras-manager`).
3. **Render** → New → Web Service → conecte o repositório:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment Variable: `DATABASE_URL` = connection string do Neon
4. Depois do primeiro deploy, aplique o schema uma vez. Duas formas:
   - Local, apontando pro banco do Neon: copie `.env.example` para `.env`, cole a `DATABASE_URL`, rode `npm install && npm run initdb`.
   - Ou pelo **Shell** do Render: `node scripts/initdb.js`.
5. Acesse a URL do Render — pronto. `schema.sql` usa `ADD COLUMN IF NOT EXISTS`, então rodar `initdb` de novo no futuro (após eu adicionar campos novos) é seguro, não duplica nem apaga nada.

## 2. Rodando localmente (teste antes de subir)

```bash
npm install
cp .env.example .env    # cole a DATABASE_URL do Neon
npm run initdb          # cria/atualiza as tabelas + 1 obra de exemplo (só na 1ª vez)
npm start                # http://localhost:3000
```

## 3. O que já funciona

**Obras**
- Criar/editar/excluir, com cliente, centro de custo (Sienge), responsável, status, cor, datas.
- Criar a partir de **modelo** (Torre metálica / Reforço estrutural) — a lista de etapas sugeridas é **editável antes de criar** (renomear, mudar duração, marcar marco, adicionar/remover linha).

**Tarefas**
- Hierarquia ilimitada (subtarefas). Tarefa com subtarefas vira uma **linha-resumo**: início, fim, duração, progresso e status são sempre calculados a partir das subtarefas (não editáveis à mão).
- **Dependências** ("Depende de"): a tarefa dependente herda automaticamente a data de início = fim da predecessora + 1 dia, preservando sua própria duração. Funciona em cadeia (A→B→C) e mesmo quando a predecessora é ela própria uma linha-resumo.
- **Bloqueio por dependência**: não deixa marcar "Concluído" (nem pelo modal, nem arrastando no Kanban) se a predecessora ainda não foi concluída.
- Campo **Duração (dias)** calcula o Fim sozinho (e vice-versa).
- Flag **Em risco** (🚩) e **Bloquear edição** (🔒).

**4 visualizações por obra**
- **Grade**: tabela editável, filtros (status/responsável/prioridade/em risco), exportar CSV.
- **Gantt**: SVG próprio, linha do "hoje", setas de dependência, marcos em losango.
- **Kanban**: mostra só as tarefas-folha (sem duplicar as linhas-resumo), cartão estilo Trello ao abrir.
- **Calendário**: visão mensal pelas datas de fim.

**Cartão estilo Trello** (ao abrir qualquer tarefa)
- Título editável, breadcrumb da obra/tarefa-pai, etiquetas (prioridade, marco, em risco, bloqueada) como chips.
- **Checklist simples**: itens soltos (texto + concluído), guardados dentro da própria tarefa — não criam subtarefas reais.
- **Comentários**: lista com autor/hora + campo pra comentar.

**Entre obras**
- **Visão Geral**: KPIs, progresso por obra, carga de trabalho por responsável, tarefas em risco.
- **Kanban Geral**: um card por **obra** (não por tarefa), colunas por status da obra (Planejamento/Em andamento/Pausado/Concluído). Clicar entra na obra.
- Progresso da obra sempre recalculado a partir da árvore de tarefas (nunca fica desatualizado quando uma subtarefa muda).

**Outros**
- Registro de atividade da sessão (painel lateral, com opção de excluir item ou limpar tudo).
- API REST completa em `/api/*` — pronta pra automações futuras.

## 4. Próximos passos possíveis (não implementados)

- Automações (ex: "se atrasado, notificar responsável") — tabela `comentarios` já serve de base.
- Registro de atividade **persistente** no banco (hoje é só da sessão do navegador).
- Upload de anexos — tabela `anexos` já existe no schema, falta a rota de upload.
- Colunas customizáveis pelo usuário.
- Formulários públicos, gerador de documentos, assistente de IA — exigem infraestrutura própria.
- Login/permissões por usuário.
- Importar o CONTEL_GERENCIAMENTO.xlsx pra popular obras automaticamente.

## 5. Estrutura do projeto

```
obras-manager/
├── server.js            # API REST (Express)
├── schema.sql            # Schema (obras, tarefas, comentarios, anexos) + migrações ADD COLUMN IF NOT EXISTS
├── scripts/initdb.js     # Aplica o schema + insere obra de exemplo (só se o banco estiver vazio)
├── package.json
├── .env.example
└── public/
    ├── index.html
    ├── app.js             # Toda a lógica (Grade, Gantt SVG, Kanban, Calendário, modal Trello)
    └── styles.css
```

## 6. Modelo de dados (resumo)

- `obras`: nome, cliente, centro_custo, responsavel, status, datas, cor.
- `tarefas`: nome, obra_id, **parent_id** (subtarefa), **predecessor_id** (dependência), responsavel, status, prioridade, datas, percentual, marco, em_risco, bloqueada, **checklist** (jsonb), observacoes.
- `comentarios`: tarefa_id, autor, texto, criado_em.
- `anexos`: modelada para uso futuro (upload de arquivo).

Veja `schema.sql` para os detalhes completos e índices.

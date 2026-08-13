-- ============================================================
-- CONTEL OBRAS MANAGER - Schema (PostgreSQL / Neon)
-- Estrutura estilo Smartsheet: obras -> tarefas hierarquicas
-- com dependencias, responsaveis, status e progresso.
-- ============================================================

CREATE TABLE IF NOT EXISTS obras (
    id            SERIAL PRIMARY KEY,
    nome          VARCHAR(200) NOT NULL,
    cliente       VARCHAR(120),              -- ATC, SBA, IHS, HLB, Neoenergia...
    centro_custo  VARCHAR(60),               -- vinculo com Sienge
    responsavel   VARCHAR(120),
    status        VARCHAR(30) DEFAULT 'Planejamento',   -- Planejamento, Em andamento, Pausado, Concluido
    data_inicio   DATE,
    data_fim      DATE,
    cor           VARCHAR(20) DEFAULT '#3B82F6',
    arquivada     BOOLEAN DEFAULT FALSE,
    criado_em     TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tarefas (
    id                SERIAL PRIMARY KEY,
    obra_id           INTEGER NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
    parent_id         INTEGER REFERENCES tarefas(id) ON DELETE CASCADE,  -- hierarquia (subtarefas)
    predecessor_id    INTEGER REFERENCES tarefas(id) ON DELETE SET NULL, -- dependencia (fim->inicio)
    nome              VARCHAR(300) NOT NULL,
    responsavel       VARCHAR(120),
    status            VARCHAR(30) DEFAULT 'Nao iniciado', -- Nao iniciado, Em andamento, Atrasado, Concluido
    prioridade        VARCHAR(20) DEFAULT 'Media',        -- Baixa, Media, Alta, Critica
    data_inicio       DATE,
    data_fim          DATE,
    percentual        INTEGER DEFAULT 0 CHECK (percentual BETWEEN 0 AND 100),
    marco             BOOLEAN DEFAULT FALSE,   -- milestone (losango no Gantt)
    em_risco          BOOLEAN DEFAULT FALSE,   -- formatacao condicional (linha vermelha)
    bloqueada         BOOLEAN DEFAULT FALSE,   -- trava edicao (bloquear linha)
    ordem             INTEGER DEFAULT 0,       -- posicao dentro do nivel (drag/drop)
    observacoes       TEXT,
    checklist         JSONB DEFAULT '[]'::jsonb, -- checklist simples do cartão: [{id,texto,concluido}], independente das subtarefas
    criado_em         TIMESTAMP DEFAULT NOW(),
    atualizado_em     TIMESTAMP DEFAULT NOW()
);

-- Migração leve para bancos já existentes (seguro rodar de novo)
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS checklist JSONB DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS comentarios (
    id          SERIAL PRIMARY KEY,
    tarefa_id   INTEGER NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
    autor       VARCHAR(120),
    texto       TEXT NOT NULL,
    criado_em   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS anexos (
    id          SERIAL PRIMARY KEY,
    tarefa_id   INTEGER NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
    nome_arquivo VARCHAR(300),
    url         TEXT,
    criado_em   TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tarefas_obra ON tarefas(obra_id);
CREATE INDEX IF NOT EXISTS idx_tarefas_parent ON tarefas(parent_id);
CREATE INDEX IF NOT EXISTS idx_tarefas_predecessor ON tarefas(predecessor_id);

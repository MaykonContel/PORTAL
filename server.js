require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// -------------------- OBRAS --------------------

app.get('/api/obras', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.*,
              COALESCE(t.total, 0) AS total_tarefas,
              COALESCE(t.media_pct, 0) AS progresso
       FROM obras o
       LEFT JOIN (
         SELECT obra_id, COUNT(*) AS total, ROUND(AVG(percentual)) AS media_pct
         FROM tarefas
         WHERE parent_id IS NULL
         GROUP BY obra_id
       ) t ON t.obra_id = o.id
       WHERE o.arquivada = FALSE
       ORDER BY o.criado_em DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/obras', async (req, res) => {
  try {
    const { nome, cliente, centro_custo, responsavel, status, data_inicio, data_fim, cor } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO obras (nome, cliente, centro_custo, responsavel, status, data_inicio, data_fim, cor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [nome, cliente, centro_custo, responsavel, status || 'Planejamento', data_inicio || null, data_fim || null, cor || '#3B82F6']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/obras/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const fields = ['nome', 'cliente', 'centro_custo', 'responsavel', 'status', 'data_inicio', 'data_fim', 'cor', 'arquivada'];
    const updates = [];
    const values = [];
    let i = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = $${i++}`);
        values.push(req.body[f]);
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    values.push(id);
    const { rows } = await pool.query(
      `UPDATE obras SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/obras/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM obras WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------- TAREFAS --------------------

app.get('/api/obras/:obraId/tarefas', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM tarefas WHERE obra_id = $1 ORDER BY parent_id NULLS FIRST, ordem ASC, id ASC`,
      [req.params.obraId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/obras/:obraId/tarefas', async (req, res) => {
  try {
    const { obraId } = req.params;
    const {
      parent_id, predecessor_id, nome, responsavel, status, prioridade,
      data_inicio, data_fim, percentual, marco, em_risco, bloqueada, ordem, observacoes, checklist
    } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO tarefas
        (obra_id, parent_id, predecessor_id, nome, responsavel, status, prioridade,
         data_inicio, data_fim, percentual, marco, em_risco, bloqueada, ordem, observacoes, checklist)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [
        obraId, parent_id || null, predecessor_id || null, nome,
        responsavel || null, status || 'Nao iniciado', prioridade || 'Media',
        data_inicio || null, data_fim || null, percentual || 0,
        marco || false, em_risco || false, bloqueada || false, ordem || 0, observacoes || null,
        JSON.stringify(checklist || [])
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tarefas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const fields = [
      'parent_id', 'predecessor_id', 'nome', 'responsavel', 'status', 'prioridade',
      'data_inicio', 'data_fim', 'percentual', 'marco', 'em_risco', 'bloqueada', 'ordem', 'observacoes', 'checklist'
    ];
    const updates = [];
    const values = [];
    let i = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = $${i++}`);
        values.push(f === 'checklist' ? JSON.stringify(req.body[f]) : req.body[f]);
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    updates.push(`atualizado_em = NOW()`);
    values.push(id);
    const { rows } = await pool.query(
      `UPDATE tarefas SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tarefas/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM tarefas WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Reordenar / mover em lote (usado no drag-and-drop da Grid e Kanban)
app.post('/api/tarefas/reordenar', async (req, res) => {
  const client = await pool.connect();
  try {
    const { itens } = req.body; // [{id, parent_id, ordem, status?}]
    await client.query('BEGIN');
    for (const it of itens) {
      const sets = ['parent_id = $1', 'ordem = $2'];
      const values = [it.parent_id || null, it.ordem];
      let i = 3;
      if (it.status !== undefined) {
        sets.push(`status = $${i++}`);
        values.push(it.status);
      }
      values.push(it.id);
      await client.query(`UPDATE tarefas SET ${sets.join(', ')} WHERE id = $${i}`, values);
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// -------------------- COMENTARIOS --------------------

app.get('/api/tarefas/:id/comentarios', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM comentarios WHERE tarefa_id = $1 ORDER BY criado_em ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tarefas/:id/comentarios', async (req, res) => {
  try {
    const { autor, texto } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO comentarios (tarefa_id, autor, texto) VALUES ($1,$2,$3) RETURNING *',
      [req.params.id, autor || 'Anonimo', texto]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------- HEALTH --------------------
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'connected' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Contel Obras Manager rodando na porta ${PORT}`);
});

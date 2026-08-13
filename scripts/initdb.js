require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  console.log('Aplicando schema.sql no banco...');
  await pool.query(sql);
  console.log('Schema aplicado com sucesso.');

  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM obras');
  if (rows[0].c === 0) {
    console.log('Inserindo obra de exemplo...');
    const obra = await pool.query(
      `INSERT INTO obras (nome, cliente, centro_custo, responsavel, status, data_inicio, data_fim, cor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      ['Torre Exemplo - Setor Sul', 'ATC', 'CC-0001', 'Maykon', 'Em andamento', '2026-08-01', '2026-10-15', '#3B82F6']
    );
    const obraId = obra.rows[0].id;

    const fase1 = await pool.query(
      `INSERT INTO tarefas (obra_id, nome, responsavel, status, prioridade, data_inicio, data_fim, percentual, ordem)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [obraId, 'Levantamento Tecnico', 'Equipe Campo', 'Concluido', 'Alta', '2026-08-01', '2026-08-05', 100, 1]
    );
    await pool.query(
      `INSERT INTO tarefas (obra_id, parent_id, nome, responsavel, status, prioridade, data_inicio, data_fim, percentual, ordem)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [obraId, fase1.rows[0].id, 'Vistoria de campo', 'Joao', 'Concluido', 'Media', '2026-08-01', '2026-08-02', 100, 1]
    );
    await pool.query(
      `INSERT INTO tarefas (obra_id, parent_id, nome, responsavel, status, prioridade, data_inicio, data_fim, percentual, ordem)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [obraId, fase1.rows[0].id, 'Relatorio fotografico', 'Joao', 'Concluido', 'Media', '2026-08-03', '2026-08-05', 100, 2]
    );

    const fase2 = await pool.query(
      `INSERT INTO tarefas (obra_id, predecessor_id, nome, responsavel, status, prioridade, data_inicio, data_fim, percentual, ordem)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [obraId, fase1.rows[0].id, 'Engenharia e Projeto', 'Equipe Projetos', 'Em andamento', 'Alta', '2026-08-06', '2026-08-20', 40, 2]
    );
    await pool.query(
      `INSERT INTO tarefas (obra_id, parent_id, nome, responsavel, status, prioridade, data_inicio, data_fim, percentual, ordem)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [obraId, fase2.rows[0].id, 'Projeto estrutural', 'Ana', 'Em andamento', 'Alta', '2026-08-06', '2026-08-15', 60, 1]
    );
    await pool.query(
      `INSERT INTO tarefas (obra_id, parent_id, nome, responsavel, status, prioridade, data_inicio, data_fim, percentual, ordem)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [obraId, fase2.rows[0].id, 'Aprovacao do cliente', 'Maykon', 'Nao iniciado', 'Critica', '2026-08-16', '2026-08-20', 0, 2]
    );

    await pool.query(
      `INSERT INTO tarefas (obra_id, predecessor_id, nome, responsavel, status, prioridade, data_inicio, data_fim, percentual, marco, ordem)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [obraId, fase2.rows[0].id, 'Entrega Final da Torre', 'Maykon', 'Nao iniciado', 'Critica', '2026-10-15', '2026-10-15', 0, true, 3]
    );
  }

  console.log('Pronto.');
  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

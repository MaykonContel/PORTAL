const API = '/api';

const STATUS_COLORS = {
  'Nao iniciado': { bg: '#22314F', fg: '#9FB0CC', border: '#324A6B' },
  'Em andamento': { bg: '#1E3A5F', fg: '#7BB8F5', border: '#2C5C87' },
  'Atrasado': { bg: '#4A1F26', fg: '#F19099', border: '#7A2E38' },
  'Concluido': { bg: '#173A2E', fg: '#5FDBA8', border: '#1F5B45' }
};
const PRIO_COLORS = {
  'Baixa': { bg: '#1A2740', fg: '#7C8AA3' },
  'Media': { bg: '#22314F', fg: '#7BB8F5' },
  'Alta': { bg: '#3A2A14', fg: '#E8A33D' },
  'Critica': { bg: '#4A1F26', fg: '#F19099' }
};

const TEMPLATES = {
  torre: [
    { nome: 'Levantamento Técnico', dias: 5, marco: false },
    { nome: 'Engenharia e Projeto', dias: 12, marco: false },
    { nome: 'Fabricação', dias: 20, marco: false },
    { nome: 'Montagem em campo', dias: 15, marco: false },
    { nome: 'Entrega Final', dias: 1, marco: true }
  ],
  reforco: [
    { nome: 'Diagnóstico estrutural', dias: 8, marco: false },
    { nome: 'Proposta técnica', dias: 6, marco: false },
    { nome: 'Execução do reforço', dias: 25, marco: false },
    { nome: 'Vistoria final', dias: 2, marco: true }
  ]
};
let tarefaInicialSeq = 1;

let state = {
  obras: [],
  obraAtual: null,
  tarefas: [],
  page: 'obra', // 'obra' | 'overview' | 'empty'
  editandoTarefaId: null,
  editandoObraId: null,
  templateSelecionado: 'nenhum',
  tarefasIniciais: [],
  checklistAtual: [],
  filtros: { status: '', responsavel: '', prioridade: '', apenasRisco: false },
  activity: [],
  calMes: new Date().getMonth(),
  calAno: new Date().getFullYear()
};

// ---------------- Helpers ----------------
function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
function toISO(d) { return d ? d.substring(0, 10) : null; }
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return toISO(d.toISOString());
}
function diasEntre(ini, fim) {
  if (!ini || !fim) return null;
  const a = new Date(ini + 'T00:00:00'), b = new Date(fim + 'T00:00:00');
  return Math.round((b - a) / 86400000) + 1;
}
function iniciais(nome) {
  if (!nome) return '?';
  return nome.trim().split(/\s+/).slice(0, 2).map(p => p[0].toUpperCase()).join('');
}

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Erro na requisição');
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---------------- Atividade (log de sessão) ----------------
let activitySeq = 1;
function logAtividade(texto) {
  state.activity.unshift({ id: activitySeq++, texto, hora: new Date() });
  if (state.activity.length > 60) state.activity.pop();
  renderActivity();
}
function excluirAtividade(id) {
  state.activity = state.activity.filter(a => a.id !== id);
  renderActivity();
}
function limparAtividades() {
  if (state.activity.length === 0) return;
  if (!confirm('Limpar todo o histórico de atividade desta sessão?')) return;
  state.activity = [];
  renderActivity();
}
function renderActivity() {
  const badge = document.getElementById('activity-badge');
  if (state.activity.length > 0) {
    badge.style.display = 'block';
    badge.textContent = state.activity.length > 99 ? '99+' : state.activity.length;
  } else {
    badge.style.display = 'none';
  }
  const list = document.getElementById('activity-list');
  if (!list) return;
  if (state.activity.length === 0) {
    list.innerHTML = '<div class="activity-empty">Nenhuma atividade ainda.</div>';
    return;
  }
  list.innerHTML = state.activity.map(a => `
    <div class="activity-item" data-id="${a.id}">
      <button class="activity-item-delete" data-id="${a.id}" title="Excluir este item">×</button>
      <div>${escapeHtml(a.texto)}</div>
      <div class="activity-item-time">${a.hora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
    </div>
  `).join('');
  list.querySelectorAll('.activity-item-delete').forEach(btn => {
    btn.onclick = () => excluirAtividade(Number(btn.dataset.id));
  });
}

// ---------------- Obras ----------------
// O progresso que vem do servidor usa o percentual "cru" salvo no banco para as
// tarefas de nível superior — mas quando a tarefa tem subtarefas, esse valor
// nunca é atualizado sozinho (o cálculo de agregação só acontece na hora de
// exibir). Por isso recalculamos aqui usando o mesmo buildTreeResumo da Grade,
// pra sidebar/Kanban Geral/Visão Geral mostrarem sempre o valor certo.
async function calcularProgressoReal(obraId) {
  const tarefas = await api(`/obras/${obraId}/tarefas`);
  const topo = buildTreeResumo(tarefas);
  if (topo.length === 0) return 0;
  return Math.round(topo.reduce((s, t) => s + (t.percentual || 0), 0) / topo.length);
}

async function carregarObras() {
  state.obras = await api('/obras');
  await Promise.all(state.obras.map(async (o) => {
    o.progresso = await calcularProgressoReal(o.id);
  }));
  renderObrasList();
  if (state.obraAtual) {
    const atual = state.obras.find(o => o.id === state.obraAtual.id);
    if (atual) state.obraAtual = atual;
  }
}

function renderObrasList() {
  const el = document.getElementById('obras-list');
  el.innerHTML = '';
  state.obras.forEach(o => {
    const div = document.createElement('div');
    div.className = 'obra-item' + (state.page === 'obra' && state.obraAtual && state.obraAtual.id === o.id ? ' active' : '');
    div.innerHTML = `
      <div class="obra-item-nome">${escapeHtml(o.nome)}</div>
      <div class="obra-item-meta"><span>${escapeHtml(o.cliente || '—')}</span><span>${o.progresso || 0}%</span></div>
      <div class="obra-bar"><div class="obra-bar-fill" style="width:${o.progresso || 0}%; background:${o.cor}"></div></div>
    `;
    div.onclick = () => selecionarObra(o.id);
    el.appendChild(div);
  });
  document.getElementById('nav-overview').classList.toggle('active', state.page === 'overview');
  document.getElementById('nav-kanban-geral').classList.toggle('active', state.page === 'kanban-geral');
}

async function selecionarObra(id) {
  state.page = 'obra';
  state.obraAtual = state.obras.find(o => o.id === id);
  document.getElementById('empty-obra').style.display = 'none';
  document.getElementById('overview-content').style.display = 'none';
  document.getElementById('kanban-geral-content').style.display = 'none';
  document.getElementById('obra-content').style.display = 'block';
  renderObrasList();
  renderObraHeader();
  await carregarTarefas();
}

function renderObraHeader() {
  const o = state.obraAtual;
  document.getElementById('obra-title').textContent = o.nome;
  const sc = { 'Planejamento': '#7BB8F5', 'Em andamento': '#E8A33D', 'Pausado': '#7C8AA3', 'Concluido': '#5FDBA8' };
  document.getElementById('obra-sub').innerHTML = `
    <span class="chip"><span class="chip-dot" style="background:${sc[o.status] || '#7C8AA3'}"></span>${escapeHtml(o.status)}</span>
    <span class="chip">${escapeHtml(o.cliente || 'Sem cliente')}</span>
    <span class="chip">CC ${escapeHtml(o.centro_custo || '—')}</span>
    <span class="chip">${escapeHtml(o.responsavel || 'Sem responsável')}</span>
    <span class="chip">${fmtDate(o.data_inicio)} → ${fmtDate(o.data_fim)}</span>
  `;
}

function abrirModalObra(obra) {
  state.editandoObraId = obra ? obra.id : null;
  state.templateSelecionado = 'nenhum';
  state.tarefasIniciais = [];
  document.getElementById('modal-obra-title').textContent = obra ? 'Editar obra' : 'Nova obra';
  document.getElementById('campo-modelo').style.display = obra ? 'none' : 'flex';
  document.getElementById('campo-modelo').style.flexDirection = 'column';
  document.getElementById('campo-tarefas-iniciais').style.display = obra ? 'none' : 'flex';
  document.getElementById('campo-tarefas-iniciais').style.flexDirection = 'column';
  document.querySelectorAll('.template-card').forEach(c => c.classList.toggle('selected', c.dataset.template === 'nenhum'));
  renderTarefasIniciais();
  document.getElementById('f-obra-nome').value = obra ? obra.nome : '';
  document.getElementById('f-obra-cliente').value = obra ? (obra.cliente || '') : '';
  document.getElementById('f-obra-cc').value = obra ? (obra.centro_custo || '') : '';
  document.getElementById('f-obra-resp').value = obra ? (obra.responsavel || '') : '';
  document.getElementById('f-obra-inicio').value = obra ? toISO(obra.data_inicio) : toISO(new Date().toISOString());
  document.getElementById('f-obra-fim').value = obra ? toISO(obra.data_fim) : '';
  document.getElementById('f-obra-status').value = obra ? obra.status : 'Planejamento';
  document.getElementById('f-obra-cor').value = obra ? obra.cor : '#4C9EEB';
  document.getElementById('btn-excluir-obra').style.display = obra ? 'inline-block' : 'none';
  document.getElementById('modal-obra').style.display = 'flex';
}

// ---------------- Lista editável de tarefas iniciais (modal Nova Obra) ----------------
function renderTarefasIniciais() {
  const wrap = document.getElementById('lista-tarefas-iniciais');
  if (state.tarefasIniciais.length === 0) {
    wrap.innerHTML = '<div class="tarefas-iniciais-empty">Nenhuma etapa ainda. Escolha um modelo acima ou adicione manualmente.</div>';
    return;
  }
  wrap.innerHTML = state.tarefasIniciais.map(t => `
    <div class="tarefa-inicial-row" data-id="${t.id}">
      <input type="text" placeholder="Nome da etapa" value="${escapeHtml(t.nome)}" data-campo="nome">
      <input type="number" min="1" value="${t.dias}" title="Duração em dias" data-campo="dias">
      <label class="marco-check" title="Marcar como marco"><input type="checkbox" data-campo="marco" ${t.marco ? 'checked' : ''}> marco</label>
      <button class="tarefa-inicial-remove" data-action="remove" title="Remover etapa">×</button>
    </div>
  `).join('');

  wrap.querySelectorAll('.tarefa-inicial-row').forEach(row => {
    const id = Number(row.dataset.id);
    row.querySelector('[data-campo="nome"]').oninput = (e) => atualizarTarefaInicial(id, 'nome', e.target.value);
    row.querySelector('[data-campo="dias"]').oninput = (e) => atualizarTarefaInicial(id, 'dias', Math.max(1, parseInt(e.target.value || '1', 10)));
    row.querySelector('[data-campo="marco"]').onchange = (e) => atualizarTarefaInicial(id, 'marco', e.target.checked);
    row.querySelector('[data-action="remove"]').onclick = () => {
      state.tarefasIniciais = state.tarefasIniciais.filter(t => t.id !== id);
      renderTarefasIniciais();
    };
  });
}

function atualizarTarefaInicial(id, campo, valor) {
  const t = state.tarefasIniciais.find(x => x.id === id);
  if (t) t[campo] = valor;
}

function adicionarTarefaInicialVazia() {
  state.tarefasIniciais.push({ id: tarefaInicialSeq++, nome: '', dias: 5, marco: false });
  renderTarefasIniciais();
  const inputs = document.querySelectorAll('#lista-tarefas-iniciais .tarefa-inicial-row [data-campo="nome"]');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

async function salvarObra() {
  const payload = {
    nome: document.getElementById('f-obra-nome').value.trim(),
    cliente: document.getElementById('f-obra-cliente').value.trim(),
    centro_custo: document.getElementById('f-obra-cc').value.trim(),
    responsavel: document.getElementById('f-obra-resp').value.trim(),
    data_inicio: document.getElementById('f-obra-inicio').value || null,
    data_fim: document.getElementById('f-obra-fim').value || null,
    status: document.getElementById('f-obra-status').value,
    cor: document.getElementById('f-obra-cor').value
  };
  if (!payload.nome) { alert('Informe o nome da obra.'); return; }

  if (state.editandoObraId) {
    await api(`/obras/${state.editandoObraId}`, { method: 'PUT', body: JSON.stringify(payload) });
    logAtividade(`Obra "${payload.nome}" atualizada`);
  } else {
    const nova = await api('/obras', { method: 'POST', body: JSON.stringify(payload) });
    state.obraAtual = nova;
    logAtividade(`Obra "${payload.nome}" criada`);
    const etapas = state.tarefasIniciais.filter(t => t.nome.trim());
    if (etapas.length > 0) {
      await criarTarefasIniciais(nova.id, etapas, payload.data_inicio || toISO(new Date().toISOString()));
    }
  }
  document.getElementById('modal-obra').style.display = 'none';
  await carregarObras();
  if (state.obraAtual) await selecionarObra(state.obraAtual.id);
}

async function criarTarefasIniciais(obraId, etapas, dataBase) {
  let cursor = dataBase;
  let ordem = 1;
  for (const passo of etapas) {
    const inicio = cursor;
    const fim = passo.marco ? inicio : addDays(inicio, Math.max(0, passo.dias - 1));
    await api(`/obras/${obraId}/tarefas`, {
      method: 'POST',
      body: JSON.stringify({
        nome: passo.nome.trim(), data_inicio: inicio, data_fim: fim,
        marco: !!passo.marco, ordem: ordem++, status: 'Nao iniciado', prioridade: 'Media'
      })
    });
    cursor = addDays(fim, 1);
  }
  logAtividade(`${etapas.length} tarefa(s) inicial(is) criada(s) na nova obra`);
}

async function excluirObra() {
  if (!confirm('Excluir esta obra e todas as suas tarefas? Esta ação não pode ser desfeita.')) return;
  const nome = state.obraAtual ? state.obraAtual.nome : '';
  await api(`/obras/${state.editandoObraId}`, { method: 'DELETE' });
  logAtividade(`Obra "${nome}" excluída`);
  document.getElementById('modal-obra').style.display = 'none';
  state.obraAtual = null;
  document.getElementById('obra-content').style.display = 'none';
  document.getElementById('empty-obra').style.display = 'block';
  await carregarObras();
}

// ---------------- Tarefas ----------------
async function carregarTarefas() {
  state.tarefas = await api(`/obras/${state.obraAtual.id}/tarefas`);
  popularFiltroResponsavel();
  renderAll();
}

function buildTree(lista) {
  const src = lista || state.tarefas;
  const map = {};
  src.forEach(t => map[t.id] = { ...t, filhos: [] });
  const roots = [];
  src.forEach(t => {
    if (t.parent_id && map[t.parent_id]) {
      map[t.parent_id].filhos.push(map[t.id]);
    } else {
      roots.push(map[t.id]);
    }
  });
  const sortFn = (a, b) => (a.ordem - b.ordem) || (a.id - b.id);
  const sortTree = nodes => { nodes.sort(sortFn); nodes.forEach(n => sortTree(n.filhos)); };
  sortTree(roots);
  return roots;
}

// Tarefas com subtarefas sempre mostram início/fim/duração/progresso/status como o
// somatório (intervalo mín-máx, média e status derivado) das subtarefas — como uma "linha resumo".
function agregarDatasEProgresso(nodes) {
  nodes.forEach(n => {
    if (n.filhos.length === 0) return;
    agregarDatasEProgresso(n.filhos);
    let inicio = null, fim = null, somaPct = 0, qtdPct = 0;
    let temAtrasado = false, temEmAndamento = false, todosConcluidos = true;
    n.filhos.forEach(f => {
      if (f.data_inicio && (!inicio || f.data_inicio < inicio)) inicio = f.data_inicio;
      if (f.data_fim && (!fim || f.data_fim > fim)) fim = f.data_fim;
      if (typeof f.percentual === 'number') { somaPct += f.percentual; qtdPct++; }
      if (f.status === 'Atrasado') temAtrasado = true;
      if (f.status === 'Em andamento') temEmAndamento = true;
      if (f.status !== 'Concluido') todosConcluidos = false;
    });
    if (inicio) n.data_inicio = inicio;
    if (fim) n.data_fim = fim;
    if (qtdPct > 0) n.percentual = Math.round(somaPct / qtdPct);

    if (todosConcluidos) n.status = 'Concluido';
    else if (temAtrasado) n.status = 'Atrasado';
    else if (temEmAndamento || n.percentual > 0) n.status = 'Em andamento';
    else n.status = 'Nao iniciado';

    n._resumo = true; // marca visual: valores calculados, não editáveis diretamente
  });
  return nodes;
}

// Reúne todos os nós (em qualquer nível) num mapa id -> nó, para localizar
// predecessoras em qualquer parte da árvore (não só irmãs).
function coletarPorId(nodes, map = {}) {
  nodes.forEach(n => {
    map[n.id] = n;
    if (n.filhos.length) coletarPorId(n.filhos, map);
  });
  return map;
}

// Tarefas (sem subtarefas) que dependem de outra herdam automaticamente a data
// de início = fim da predecessora + 1 dia, preservando sua própria duração.
function resolverDependencias(porId) {
  let changed = true;
  let iter = 0;
  const max = Object.keys(porId).length + 2;
  while (changed && iter < max) {
    changed = false;
    iter++;
    Object.values(porId).forEach(t => {
      if (t.filhos.length > 0) return; // tarefas-resumo já têm data por agregação
      if (!t.predecessor_id) return;
      const pred = porId[t.predecessor_id];
      if (!pred || !pred.data_fim) return;
      t._herdado = true;
      const novoInicio = addDays(pred.data_fim, 1);
      if (t.data_inicio !== novoInicio) {
        const duracaoAtual = diasEntre(t.data_inicio, t.data_fim) || 1;
        t.data_inicio = novoInicio;
        t.data_fim = addDays(novoInicio, duracaoAtual - 1);
        changed = true;
      }
    });
  }
}

function buildTreeResumo(lista) {
  const tree = buildTree(lista);
  agregarDatasEProgresso(tree);
  const porId = coletarPorId(tree);
  resolverDependencias(porId);
  return tree;
}

function flattenTree(roots, depth = 0, out = []) {
  roots.forEach(n => {
    out.push({ ...n, depth });
    if (n.filhos.length) flattenTree(n.filhos, depth + 1, out);
  });
  return out;
}

// ---------------- Filtros ----------------
function popularFiltroResponsavel() {
  const sel = document.getElementById('f-filtro-responsavel');
  const atual = sel.value;
  const nomes = [...new Set(state.tarefas.map(t => t.responsavel).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">Responsável: todos</option>' + nomes.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
  sel.value = atual;
}

function tarefaPassaFiltro(t) {
  const f = state.filtros;
  if (f.status && t.status !== f.status) return false;
  if (f.responsavel && t.responsavel !== f.responsavel) return false;
  if (f.prioridade && t.prioridade !== f.prioridade) return false;
  if (f.apenasRisco && !t.em_risco && t.status !== 'Atrasado') return false;
  return true;
}

function tarefasFiltradas() {
  const passaMap = {};
  state.tarefas.forEach(t => passaMap[t.id] = tarefaPassaFiltro(t));
  const temFiltroAtivo = state.filtros.status || state.filtros.responsavel || state.filtros.prioridade || state.filtros.apenasRisco;
  if (!temFiltroAtivo) return state.tarefas;

  const childrenOf = {};
  state.tarefas.forEach(t => {
    const p = t.parent_id || 'root';
    (childrenOf[p] = childrenOf[p] || []).push(t);
  });
  function descendentePassa(id) {
    const filhos = childrenOf[id] || [];
    return filhos.some(f => passaMap[f.id] || descendentePassa(f.id));
  }
  return state.tarefas.filter(t => passaMap[t.id] || descendentePassa(t.id));
}

function initFiltros() {
  document.getElementById('f-filtro-status').onchange = (e) => { state.filtros.status = e.target.value; renderAll(); };
  document.getElementById('f-filtro-responsavel').onchange = (e) => { state.filtros.responsavel = e.target.value; renderAll(); };
  document.getElementById('f-filtro-prioridade').onchange = (e) => { state.filtros.prioridade = e.target.value; renderAll(); };
  document.getElementById('f-filtro-risco').onclick = (e) => {
    state.filtros.apenasRisco = !state.filtros.apenasRisco;
    e.target.classList.toggle('active', state.filtros.apenasRisco);
    renderAll();
  };
  document.getElementById('btn-limpar-filtros').onclick = () => {
    state.filtros = { status: '', responsavel: '', prioridade: '', apenasRisco: false };
    document.getElementById('f-filtro-status').value = '';
    document.getElementById('f-filtro-responsavel').value = '';
    document.getElementById('f-filtro-prioridade').value = '';
    document.getElementById('f-filtro-risco').classList.remove('active');
    renderAll();
  };
}

function renderAll() {
  renderGrid();
  renderGantt();
  renderKanban();
  renderCalendar();
}

// ---------------- Grid view ----------------
function renderGrid() {
  const body = document.getElementById('grid-body');
  body.innerHTML = '';
  const flat = flattenTree(buildTreeResumo(tarefasFiltradas()));

  document.getElementById('grid-count-hint').textContent = `${flat.length} tarefa(s)`;

  if (flat.length === 0) {
    body.innerHTML = `<tr><td colspan="9"><div class="empty-state">Nenhuma tarefa encontrada. Ajuste os filtros ou clique em "+ Nova tarefa".</div></td></tr>`;
    return;
  }

  flat.forEach(t => {
    const tr = document.createElement('tr');
    const emRisco = t.em_risco || t.status === 'Atrasado';
    if (emRisco) tr.classList.add('row-risco');
    const sc = STATUS_COLORS[t.status] || STATUS_COLORS['Nao iniciado'];
    const pc = PRIO_COLORS[t.prioridade] || PRIO_COLORS['Media'];
    const dur = diasEntre(t.data_inicio, t.data_fim);
    tr.innerHTML = `
      <td>
        <div class="task-name-cell" style="padding-left:${t.depth * 20}px">
          ${t.em_risco ? '<span class="risk-flag" title="Em risco">🚩</span>' : ''}
          ${t.bloqueada ? '<span class="lock-icon active" title="Tarefa bloqueada">🔒</span>' : ''}
          ${t.marco ? '<span class="milestone-icon">◆</span>' : ''}
          <span title="${escapeHtml(t.nome)}">${escapeHtml(t.nome)}</span>
        </div>
      </td>
      <td>${escapeHtml(t.responsavel || '—')}</td>
      <td><span class="status-badge ${t._resumo ? 'cell-resumo' : ''}" style="background:${sc.bg};color:${sc.fg};border-color:${sc.border || sc.bg}" title="${t._resumo ? 'Calculado a partir das subtarefas' : ''}">${t.status}</span></td>
      <td><span class="prio-badge" style="background:${pc.bg};color:${pc.fg}">${t.prioridade}</span></td>
      <td class="mono ${t._resumo ? 'cell-resumo' : (t._herdado ? 'cell-herdado' : '')}" title="${t._resumo ? 'Calculado a partir das subtarefas' : (t._herdado ? 'Herdado do fim da tarefa predecessora' : '')}">${fmtDate(t.data_inicio)}</td>
      <td class="mono ${t._resumo ? 'cell-resumo' : ''}" title="${t._resumo ? 'Calculado a partir das subtarefas' : ''}">${fmtDate(t.data_fim)}</td>
      <td class="mono ${t._resumo ? 'cell-resumo' : ''}">${dur ? dur + 'd' : '—'}</td>
      <td>
        <div class="pct-wrap">
          <div class="pct-bar"><div class="pct-bar-fill" style="width:${t.percentual}%"></div></div>
          <span class="mono" style="font-size:11px">${t.percentual}%</span>
        </div>
      </td>
      <td>
        <div class="row-actions">
          <button class="btn btn-ghost btn-sm" data-action="edit" title="Editar">✎</button>
          <button class="btn btn-ghost btn-sm" data-action="add-sub" title="Nova subtarefa">+</button>
        </div>
      </td>
    `;
    tr.querySelector('[data-action="edit"]').onclick = () => abrirModalTarefa(t);
    tr.querySelector('[data-action="add-sub"]').onclick = () => abrirModalTarefa(null, t.id);
    body.appendChild(tr);
  });
}

// ---------------- Exportar CSV ----------------
function exportarCSV() {
  const flat = flattenTree(buildTreeResumo(tarefasFiltradas()));
  const headers = ['Tarefa', 'Responsavel', 'Status', 'Prioridade', 'Inicio', 'Fim', 'Duracao(dias)', 'Progresso(%)', 'Em risco', 'Bloqueada'];
  const linhas = flat.map(t => [
    '  '.repeat(t.depth) + t.nome,
    t.responsavel || '',
    t.status,
    t.prioridade,
    toISO(t.data_inicio) || '',
    toISO(t.data_fim) || '',
    diasEntre(t.data_inicio, t.data_fim) || '',
    t.percentual,
    t.em_risco ? 'Sim' : 'Nao',
    t.bloqueada ? 'Sim' : 'Nao'
  ]);
  const csvEscape = v => `"${String(v).replaceAll('"', '""')}"`;
  const csv = [headers, ...linhas].map(row => row.map(csvEscape).join(';')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(state.obraAtual.nome || 'obra').replace(/[^a-z0-9]+/gi, '_')}_tarefas.csv`;
  a.click();
  URL.revokeObjectURL(url);
  logAtividade(`Exportou CSV de "${state.obraAtual.nome}" (${flat.length} tarefas)`);
}

// ---------------- Gantt view ----------------
function renderGantt() {
  const wrap = document.getElementById('gantt-wrap');
  const flat = flattenTree(buildTreeResumo(tarefasFiltradas()));
  if (flat.length === 0) {
    wrap.innerHTML = `<div class="empty-state">Sem tarefas para exibir no Gantt.</div>`;
    return;
  }

  const dates = flat.flatMap(t => [t.data_inicio, t.data_fim]).filter(Boolean).map(d => new Date(d));
  if (dates.length === 0) {
    wrap.innerHTML = `<div class="empty-state">Defina datas de início/fim nas tarefas para ver o Gantt.</div>`;
    return;
  }
  let minDate = new Date(Math.min(...dates));
  let maxDate = new Date(Math.max(...dates));
  minDate.setDate(minDate.getDate() - 2);
  maxDate.setDate(maxDate.getDate() + 3);

  const dayMs = 86400000;
  const totalDays = Math.max(1, Math.round((maxDate - minDate) / dayMs));
  const dayWidth = 28;
  const rowHeight = 32;
  const labelWidth = 260;
  const chartWidth = totalDays * dayWidth;
  const chartHeight = flat.length * rowHeight + 40;
  const svgWidth = labelWidth + chartWidth;

  const xForDate = (d) => labelWidth + Math.round((new Date(d) - minDate) / dayMs) * dayWidth;

  let svg = `<svg width="${svgWidth}" height="${chartHeight}" xmlns="http://www.w3.org/2000/svg" font-family="Inter, sans-serif" font-size="11">`;

  for (let i = 0; i <= totalDays; i++) {
    const d = new Date(minDate.getTime() + i * dayMs);
    const x = labelWidth + i * dayWidth;
    const isWeekStart = d.getDay() === 1;
    svg += `<line x1="${x}" y1="0" x2="${x}" y2="${chartHeight}" stroke="${isWeekStart ? '#22314F' : '#1A2740'}" stroke-width="1"/>`;
    if (isWeekStart || i === 0) {
      svg += `<text x="${x + 3}" y="14" fill="#7C8AA3" font-family="JetBrains Mono, monospace" font-size="9.5">${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}</text>`;
    }
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (today >= minDate && today <= maxDate) {
    const xt = xForDate(toISO(today.toISOString()));
    svg += `<line x1="${xt}" y1="20" x2="${xt}" y2="${chartHeight}" class="gantt-today-line"/>`;
  }

  svg += `<rect x="0" y="0" width="${labelWidth}" height="${chartHeight}" fill="#121B2E"/>`;
  svg += `<line x1="${labelWidth}" y1="0" x2="${labelWidth}" y2="${chartHeight}" stroke="#22314F"/>`;

  const idToRow = {};
  flat.forEach((t, i) => { idToRow[t.id] = i; });

  flat.forEach((t, i) => {
    if (t.predecessor_id && idToRow[t.predecessor_id] !== undefined && t.data_inicio) {
      const pred = flat[idToRow[t.predecessor_id]];
      if (pred.data_fim) {
        const x1 = xForDate(pred.data_fim) + dayWidth;
        const y1 = 40 + idToRow[t.predecessor_id] * rowHeight + rowHeight / 2;
        const x2 = xForDate(t.data_inicio);
        const y2 = 40 + i * rowHeight + rowHeight / 2;
        svg += `<path d="M${x1},${y1} L${x1 + 8},${y1} L${x1 + 8},${y2} L${x2},${y2}" class="gantt-dep-line"/>`;
      }
    }
  });

  flat.forEach((t, i) => {
    const y = 40 + i * rowHeight;
    svg += `<rect x="0" y="${y}" width="${svgWidth}" height="${rowHeight}" fill="${i % 2 === 0 ? 'transparent' : '#0E1729'}"/>`;
    const sc = STATUS_COLORS[t.status] || STATUS_COLORS['Nao iniciado'];
    const riscoTxt = t.em_risco ? '🚩 ' : '';
    svg += `<text x="${12 + t.depth * 14}" y="${y + rowHeight / 2 + 4}" fill="#E6EDF5" font-size="12">${t.marco ? '◆ ' : ''}${riscoTxt}${escapeXml(truncate(t.nome, 26))}</text>`;

    if (!t.data_inicio || !t.data_fim) return;

    const corBorda = t.em_risco ? '#E5636B' : (sc.border || sc.bg);

    if (t.marco) {
      const x = xForDate(t.data_inicio);
      const cy = y + rowHeight / 2;
      svg += `<polygon points="${x},${cy - 7} ${x + 7},${cy} ${x},${cy + 7} ${x - 7},${cy}" fill="${sc.fg}" stroke="${corBorda}" stroke-width="${t.em_risco ? 2 : 1}" class="gantt-milestone"><title>${escapeXml(t.nome)}</title></polygon>`;
    } else {
      const x1 = xForDate(t.data_inicio);
      const x2 = xForDate(t.data_fim) + dayWidth;
      const w = Math.max(dayWidth, x2 - x1);
      const barY = y + 7;
      const barH = rowHeight - 14;
      svg += `<rect x="${x1}" y="${barY}" width="${w}" height="${barH}" fill="${sc.bg}" stroke="${corBorda}" stroke-width="${t.em_risco ? 2 : 1}" class="gantt-bar" rx="3"><title>${escapeXml(t.nome)} (${t.percentual}%)</title></rect>`;
      svg += `<rect x="${x1}" y="${barY}" width="${w * (t.percentual / 100)}" height="${barH}" fill="${sc.fg}" opacity="0.55" class="gantt-bar-progress" rx="3"/>`;
    }
  });

  svg += `</svg>`;
  wrap.innerHTML = svg;
}

function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function escapeXml(s) { return escapeHtml(s); }

// ---------------- Kanban view ----------------
const KANBAN_STATUSES = ['Nao iniciado', 'Em andamento', 'Atrasado', 'Concluido'];

function renderKanban() {
  const board = document.getElementById('kanban-board');
  board.innerHTML = '';
  // Só as tarefas-folha (sem subtarefas) viram card — tarefas-resumo (com
  // subtarefas) são só um agregado, não trabalho executável, e mostrar as duas
  // juntas duplicava/desalinhava o quadro (ex: "Homologação" 67% mas uma
  // subtarefa dela ainda "Não iniciado" aparecendo como se fosse outra coisa).
  const flat = flattenTree(buildTreeResumo(tarefasFiltradas())).filter(t => t.filhos.length === 0);
  const byId = {};
  state.tarefas.forEach(t => byId[t.id] = t);

  KANBAN_STATUSES.forEach(status => {
    const items = flat.filter(t => t.status === status);
    const col = document.createElement('div');
    col.className = 'kanban-col';
    col.innerHTML = `<div class="kanban-col-header"><span>${status}</span><span>${items.length}</span></div>
      <div class="kanban-col-body" data-status="${status}"></div>`;
    const colBody = col.querySelector('.kanban-col-body');

    items.forEach(t => {
      const card = document.createElement('div');
      card.className = 'kanban-card';
      card.draggable = !t.bloqueada;
      card.dataset.id = t.id;
      const pc = PRIO_COLORS[t.prioridade] || PRIO_COLORS['Media'];
      const parentNome = t.parent_id && byId[t.parent_id] ? byId[t.parent_id].nome : null;
      card.innerHTML = `
        ${parentNome ? `<div class="mono" style="font-size:10px;color:#7C8AA3;margin-bottom:4px">↳ ${escapeHtml(truncate(parentNome, 26))}</div>` : ''}
        <div class="kanban-card-title">${t.em_risco ? '🚩 ' : ''}${t.bloqueada ? '🔒 ' : ''}${t.marco ? '◆ ' : ''}${escapeHtml(t.nome)}</div>
        <div class="kanban-card-meta">
          <span style="color:${pc.fg}">${t.prioridade}</span>
          <span>${escapeHtml(t.responsavel || '—')}</span>
        </div>
        <div class="kanban-card-meta" style="margin-top:4px">
          <span>${fmtDate(t.data_inicio)} → ${fmtDate(t.data_fim)}</span>
          <span>${t.percentual}%</span>
        </div>
      `;
      if (t.em_risco) card.style.borderColor = 'var(--danger)';
      card.onclick = () => abrirModalTarefa(t);
      card.ondragstart = (e) => {
        e.dataTransfer.setData('text/plain', t.id);
        setTimeout(() => card.style.opacity = '0.4', 0);
      };
      card.ondragend = () => card.style.opacity = '1';
      colBody.appendChild(card);
    });

    colBody.ondragover = (e) => { e.preventDefault(); colBody.classList.add('drag-over'); };
    colBody.ondragleave = () => colBody.classList.remove('drag-over');
    colBody.ondrop = async (e) => {
      e.preventDefault();
      colBody.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      const t = byId[id];
      if (t && t.bloqueada) { alert('Esta tarefa está bloqueada para edição.'); return; }
      if (status === 'Concluido' && t) {
        const check = validarConclusaoPorDependencia(t.predecessor_id);
        if (!check.ok) {
          alert(`⛔ Não é possível concluir: a tarefa predecessora "${check.nomePred}" ainda não foi concluída.`);
          return;
        }
      }
      await api(`/tarefas/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
      logAtividade(`Status de "${t ? t.nome : id}" alterado para ${status}`);
      await carregarTarefas();
    };

    board.appendChild(col);
  });
}

// ---------------- Calendar view ----------------
const MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const DOW_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function renderCalendar() {
  const grid = document.getElementById('calendar-grid');
  if (!grid) return;
  const title = document.getElementById('calendar-title');
  title.textContent = `${MESES_PT[state.calMes]} ${state.calAno}`;

  const flat = flattenTree(buildTreeResumo(tarefasFiltradas()));
  const eventosPorDia = {};
  flat.forEach(t => {
    if (!t.data_fim) return;
    const dia = toISO(t.data_fim);
    (eventosPorDia[dia] = eventosPorDia[dia] || []).push(t);
  });

  const first = new Date(state.calAno, state.calMes, 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(state.calAno, state.calMes + 1, 0).getDate();
  const daysInPrevMonth = new Date(state.calAno, state.calMes, 0).getDate();
  const todayISO = toISO(new Date().toISOString());

  let cells = '';
  DOW_PT.forEach(d => cells += `<div class="calendar-dow">${d}</div>`);

  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - startOffset + 1;
    let dateObj, otherMonth = false;
    if (dayNum < 1) { dateObj = new Date(state.calAno, state.calMes - 1, daysInPrevMonth + dayNum); otherMonth = true; }
    else if (dayNum > daysInMonth) { dateObj = new Date(state.calAno, state.calMes + 1, dayNum - daysInMonth); otherMonth = true; }
    else { dateObj = new Date(state.calAno, state.calMes, dayNum); }
    const iso = toISO(dateObj.toISOString());
    const isToday = iso === todayISO;
    const eventos = eventosPorDia[iso] || [];
    cells += `<div class="calendar-day ${otherMonth ? 'other-month' : ''} ${isToday ? 'today' : ''}">
      <div class="calendar-day-num">${dateObj.getDate()}</div>
      ${eventos.slice(0, 3).map(ev => {
        const sc = STATUS_COLORS[ev.status] || STATUS_COLORS['Nao iniciado'];
        return `<div class="calendar-event" data-id="${ev.id}" style="background:${sc.bg};color:${sc.fg};border-color:${ev.em_risco ? 'var(--danger)' : sc.border}">${ev.marco ? '◆ ' : ''}${escapeHtml(truncate(ev.nome, 18))}</div>`;
      }).join('')}
      ${eventos.length > 3 ? `<div class="hint">+${eventos.length - 3} mais</div>` : ''}
    </div>`;
  }
  grid.innerHTML = cells;

  grid.querySelectorAll('.calendar-event').forEach(el => {
    el.onclick = () => {
      const t = state.tarefas.find(x => x.id === Number(el.dataset.id));
      if (t) abrirModalTarefa(t);
    };
  });
}

function initCalendarNav() {
  document.getElementById('btn-cal-prev').onclick = () => {
    state.calMes--; if (state.calMes < 0) { state.calMes = 11; state.calAno--; }
    renderCalendar();
  };
  document.getElementById('btn-cal-next').onclick = () => {
    state.calMes++; if (state.calMes > 11) { state.calMes = 0; state.calAno++; }
    renderCalendar();
  };
  document.getElementById('btn-cal-hoje').onclick = () => {
    const n = new Date(); state.calMes = n.getMonth(); state.calAno = n.getFullYear();
    renderCalendar();
  };
}

// ---------------- Visão Geral (Dashboard global) ----------------
async function abrirVisaoGeral() {
  state.page = 'overview';
  document.getElementById('empty-obra').style.display = 'none';
  document.getElementById('obra-content').style.display = 'none';
  document.getElementById('kanban-geral-content').style.display = 'none';
  document.getElementById('overview-content').style.display = 'block';
  renderObrasList();
  await renderOverview();
}

// ---------------- Kanban Geral (todas as obras) ----------------
async function abrirKanbanGeral() {
  state.page = 'kanban-geral';
  document.getElementById('empty-obra').style.display = 'none';
  document.getElementById('obra-content').style.display = 'none';
  document.getElementById('overview-content').style.display = 'none';
  document.getElementById('kanban-geral-content').style.display = 'block';
  renderObrasList();
  await renderKanbanGeral();
}

const OBRA_STATUSES = ['Planejamento', 'Em andamento', 'Pausado', 'Concluido'];
const OBRA_STATUS_COLORS = { 'Planejamento': '#7BB8F5', 'Em andamento': '#E8A33D', 'Pausado': '#7C8AA3', 'Concluido': '#5FDBA8' };

// Kanban Geral = um card por OBRA (não por tarefa). Cada coluna é o status da
// obra. Clicar num card entra na obra — lá dentro é que aparece o Kanban de
// tarefas dela (como se essa obra fosse o "quadro principal").
async function renderKanbanGeral() {
  const board = document.getElementById('kanban-geral-board');
  board.innerHTML = '';

  OBRA_STATUSES.forEach(status => {
    const items = state.obras.filter(o => o.status === status);
    const col = document.createElement('div');
    col.className = 'kanban-col';
    col.innerHTML = `<div class="kanban-col-header"><span>${status}</span><span>${items.length}</span></div>
      <div class="kanban-col-body" data-status="${status}"></div>`;
    const colBody = col.querySelector('.kanban-col-body');

    items.forEach(o => {
      const card = document.createElement('div');
      card.className = 'kanban-card';
      card.draggable = true;
      card.dataset.id = o.id;
      card.innerHTML = `
        <div class="kanban-card-obra-tag" style="border-color:${o.cor}"><span class="chip-dot" style="background:${o.cor}"></span>${escapeHtml(o.cliente || 'Sem cliente')}</div>
        <div class="kanban-card-title">${escapeHtml(o.nome)}</div>
        <div class="kanban-card-meta">
          <span>${escapeHtml(o.responsavel || '—')}</span>
          <span>${o.total_tarefas || 0} tarefa(s)</span>
        </div>
        <div class="pct-bar" style="margin-top:8px; width:100%;"><div class="pct-bar-fill" style="width:${o.progresso || 0}%; background:${o.cor}"></div></div>
        <div class="kanban-card-meta" style="margin-top:6px">
          <span>${fmtDate(o.data_inicio)} → ${fmtDate(o.data_fim)}</span>
          <span>${o.progresso || 0}%</span>
        </div>
      `;
      card.onclick = () => selecionarObra(o.id);
      card.ondragstart = (e) => {
        e.dataTransfer.setData('text/plain', o.id);
        setTimeout(() => card.style.opacity = '0.4', 0);
      };
      card.ondragend = () => card.style.opacity = '1';
      colBody.appendChild(card);
    });

    colBody.ondragover = (e) => { e.preventDefault(); colBody.classList.add('drag-over'); };
    colBody.ondragleave = () => colBody.classList.remove('drag-over');
    colBody.ondrop = async (e) => {
      e.preventDefault();
      colBody.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      await api(`/obras/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
      logAtividade(`Status da obra alterado para "${status}"`);
      await carregarObras();
      await renderKanbanGeral();
    };

    board.appendChild(col);
  });
}

async function renderOverview() {
  const todasTarefas = [];
  for (const o of state.obras) {
    const t = await api(`/obras/${o.id}/tarefas`);
    t.forEach(tt => todasTarefas.push({ ...tt, obra_nome: o.nome, obra_cor: o.cor }));
  }

  document.getElementById('overview-sub').textContent = `${state.obras.length} obra(s) · ${todasTarefas.length} tarefa(s) no total`;

  const emRisco = todasTarefas.filter(t => t.em_risco || t.status === 'Atrasado');
  const concluidas = todasTarefas.filter(t => t.status === 'Concluido');
  const progressoMedio = state.obras.length ? Math.round(state.obras.reduce((s, o) => s + (o.progresso || 0), 0) / state.obras.length) : 0;

  document.getElementById('overview-kpis').innerHTML = `
    <div class="kpi-card"><div class="kpi-value">${state.obras.length}</div><div class="kpi-label">Obras ativas</div></div>
    <div class="kpi-card"><div class="kpi-value">${todasTarefas.length}</div><div class="kpi-label">Tarefas no total</div></div>
    <div class="kpi-card danger"><div class="kpi-value">${emRisco.length}</div><div class="kpi-label">Em risco / atrasadas</div></div>
    <div class="kpi-card good"><div class="kpi-value">${concluidas.length}</div><div class="kpi-label">Concluídas</div></div>
    <div class="kpi-card"><div class="kpi-value">${progressoMedio}%</div><div class="kpi-label">Progresso médio</div></div>
  `;

  document.getElementById('overview-progress-bars').innerHTML = state.obras.map(o => `
    <div class="bar-row">
      <div class="bar-row-label">${escapeHtml(o.nome)}</div>
      <div class="bar-row-track"><div class="bar-row-fill" style="width:${o.progresso || 0}%; background:${o.cor}"></div></div>
      <div class="bar-row-value">${o.progresso || 0}%</div>
    </div>
  `).join('') || '<div class="hint">Nenhuma obra cadastrada ainda.</div>';

  const porResp = {};
  todasTarefas.forEach(t => {
    if (!t.responsavel) return;
    porResp[t.responsavel] = porResp[t.responsavel] || { total: 0, abertas: 0 };
    porResp[t.responsavel].total++;
    if (t.status !== 'Concluido') porResp[t.responsavel].abertas++;
  });
  const respOrdenado = Object.entries(porResp).sort((a, b) => b[1].abertas - a[1].abertas);
  const maxAbertas = Math.max(1, ...respOrdenado.map(([, v]) => v.abertas));
  document.getElementById('overview-workload').innerHTML = respOrdenado.map(([nome, v]) => `
    <div class="workload-item">
      <div class="workload-avatar">${escapeHtml(iniciais(nome))}</div>
      <div style="flex:1">
        <div style="display:flex; justify-content:space-between; font-size:12.5px; margin-bottom:4px;">
          <span>${escapeHtml(nome)}</span><span class="mono" style="color:var(--muted)">${v.abertas} aberta(s) · ${v.total} total</span>
        </div>
        <div class="bar-row-track"><div class="bar-row-fill" style="width:${(v.abertas / maxAbertas) * 100}%; background:var(--accent)"></div></div>
      </div>
    </div>
  `).join('') || '<div class="hint">Nenhum responsável atribuído ainda.</div>';

  const linhasRisco = emRisco.slice(0, 25).map(t => `
    <tr data-obra="${t.obra_id}" data-id="${t.id}">
      <td>${t.em_risco ? '🚩 ' : ''}${escapeHtml(t.nome)}</td>
      <td>${escapeHtml(t.obra_nome)}</td>
      <td>${escapeHtml(t.responsavel || '—')}</td>
      <td><span class="status-badge" style="background:${(STATUS_COLORS[t.status] || {}).bg};color:${(STATUS_COLORS[t.status] || {}).fg}">${t.status}</span></td>
      <td class="mono">${fmtDate(t.data_fim)}</td>
    </tr>
  `).join('');
  document.getElementById('overview-risk-body').innerHTML = linhasRisco || '<tr><td colspan="5" class="hint">Nenhuma tarefa em risco. 🎉</td></tr>';
  document.querySelectorAll('#overview-risk-body tr[data-obra]').forEach(tr => {
    tr.onclick = () => selecionarObra(Number(tr.dataset.obra));
  });
}

// ---------------- Modal Tarefa ----------------
function preencherSelectParent(excludeId) {
  const sel = document.getElementById('f-tarefa-parent');
  sel.innerHTML = '<option value="">— Nenhuma (tarefa de nível superior) —</option>';
  const flat = flattenTree(buildTree());
  flat.forEach(t => {
    if (t.id === excludeId) return;
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = '—'.repeat(t.depth) + ' ' + t.nome;
    sel.appendChild(opt);
  });
}
function preencherSelectPredecessor(excludeId) {
  const sel = document.getElementById('f-tarefa-predecessor');
  sel.innerHTML = '<option value="">— Nenhuma —</option>';
  state.tarefas.forEach(t => {
    if (t.id === excludeId) return;
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.nome;
    sel.appendChild(opt);
  });
}

let modalTemFilhosAtual = false;

function mapaDatasResolvidas() {
  const flat = flattenTree(buildTreeResumo(state.tarefas));
  const map = {};
  flat.forEach(t => map[t.id] = t);
  return map;
}

function recalcFimFromDuracao() {
  const inicio = document.getElementById('f-tarefa-inicio').value;
  const dur = parseInt(document.getElementById('f-tarefa-duracao').value || '', 10);
  if (inicio && dur > 0) {
    document.getElementById('f-tarefa-fim').value = addDays(inicio, dur - 1);
  }
}
function recalcDuracaoFromFim() {
  const inicio = document.getElementById('f-tarefa-inicio').value;
  const fim = document.getElementById('f-tarefa-fim').value;
  if (inicio && fim) {
    const d = diasEntre(inicio, fim);
    if (d && d > 0) document.getElementById('f-tarefa-duracao').value = d;
  }
}

function renderTrelloBreadcrumb(tarefa) {
  const el = document.getElementById('trello-breadcrumb');
  const obra = state.obraAtual;
  let html = `<span class="chip">${escapeHtml(obra ? obra.nome : '')}</span>`;
  if (tarefa && tarefa.parent_id) {
    const pai = state.tarefas.find(t => t.id === tarefa.parent_id);
    if (pai) html += ` <span class="chip">↳ ${escapeHtml(pai.nome)}</span>`;
  }
  el.innerHTML = html;
}

function sincronizarChipsTrello() {
  document.getElementById('chip-marco').classList.toggle('active-marco', document.getElementById('f-tarefa-marco').checked);
  document.getElementById('chip-risco').classList.toggle('active-risco', document.getElementById('f-tarefa-risco').checked);
  document.getElementById('chip-bloqueada').classList.toggle('active-bloqueada', document.getElementById('f-tarefa-bloqueada').checked);
}

function initTrelloChips() {
  const mapa = [
    { chipId: 'chip-marco', checkboxId: 'f-tarefa-marco', ativa: 'active-marco' },
    { chipId: 'chip-risco', checkboxId: 'f-tarefa-risco', ativa: 'active-risco' },
    { chipId: 'chip-bloqueada', checkboxId: 'f-tarefa-bloqueada', ativa: 'active-bloqueada' }
  ];
  mapa.forEach(({ chipId, checkboxId, ativa }) => {
    const chip = document.getElementById(chipId);
    const checkbox = document.getElementById(checkboxId);
    chip.onclick = () => {
      checkbox.checked = !checkbox.checked;
      chip.classList.toggle(ativa, checkbox.checked);
    };
  });
}

// ---------------- Checklist (lista simples do cartão — NÃO cria subtarefas) ----------------
// Fica guardado como um JSON dentro da própria tarefa (campo `checklist`),
// independente da hierarquia de subtarefas usada na Grade/Gantt/Kanban.
let checklistAtualSeq = 1;

function renderChecklistSimples() {
  const wrap = document.getElementById('checklist-items');
  const lista = state.checklistAtual || [];
  const total = lista.length;
  const done = lista.filter(i => i.concluido).length;
  document.getElementById('checklist-progress').textContent = total ? `${done}/${total}` : '';
  document.getElementById('checklist-bar-fill').style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';

  if (total === 0) {
    wrap.innerHTML = '<div class="hint" style="padding:6px 0;">Nenhum item ainda.</div>';
    return;
  }
  wrap.innerHTML = lista.map(item => `
    <div class="checklist-item ${item.concluido ? 'done' : ''}" data-id="${item.id}">
      <input type="checkbox" ${item.concluido ? 'checked' : ''}>
      <span class="checklist-item-nome">${escapeHtml(item.texto)}</span>
      <button class="checklist-item-del" title="Remover item">×</button>
    </div>
  `).join('');

  wrap.querySelectorAll('.checklist-item').forEach(row => {
    const id = Number(row.dataset.id);
    row.querySelector('input[type=checkbox]').onchange = (e) => {
      const item = state.checklistAtual.find(i => i.id === id);
      if (item) item.concluido = e.target.checked;
      renderChecklistSimples();
    };
    row.querySelector('.checklist-item-del').onclick = () => {
      state.checklistAtual = state.checklistAtual.filter(i => i.id !== id);
      renderChecklistSimples();
    };
  });
}

function adicionarItemChecklistSimples() {
  const input = document.getElementById('checklist-add-input');
  const texto = input.value.trim();
  if (!texto) return;
  state.checklistAtual.push({ id: checklistAtualSeq++, texto, concluido: false });
  input.value = '';
  renderChecklistSimples();
  input.focus();
}

// ---------------- Comentários ----------------
async function renderComentarios(tarefaId) {
  const list = document.getElementById('comentarios-list');
  list.innerHTML = '<div class="comentarios-empty">Carregando...</div>';
  try {
    const comentarios = await api(`/tarefas/${tarefaId}/comentarios`);
    if (!comentarios || comentarios.length === 0) {
      list.innerHTML = '<div class="comentarios-empty">Nenhum comentário ainda.</div>';
      return;
    }
    list.innerHTML = comentarios.map(c => `
      <div class="comentario-item">
        <div class="comentario-item-head">
          <span class="comentario-item-autor">${escapeHtml(c.autor || 'Anônimo')}</span>
          <span class="comentario-item-time">${new Date(c.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div>${escapeHtml(c.texto)}</div>
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = '<div class="comentarios-empty">Não foi possível carregar os comentários.</div>';
  }
}

async function enviarComentario(tarefaId) {
  const autorInput = document.getElementById('comentario-autor');
  const textoInput = document.getElementById('comentario-texto');
  const texto = textoInput.value.trim();
  if (!texto) return;
  const autor = autorInput.value.trim() || 'Anônimo';
  await api(`/tarefas/${tarefaId}/comentarios`, { method: 'POST', body: JSON.stringify({ autor, texto }) });
  textoInput.value = '';
  await renderComentarios(tarefaId);
  logAtividade(`Comentário adicionado em uma tarefa`);
}

function abrirModalTarefa(tarefa, parentIdPadrao) {
  if (tarefa && tarefa.bloqueada) {
    if (!confirm('🔒 Esta tarefa está bloqueada para edição.\n\nDeseja desbloqueá-la agora para poder editar?')) return;
  }
  state.editandoTarefaId = tarefa ? tarefa.id : null;
  renderTrelloBreadcrumb(tarefa);
  preencherSelectParent(tarefa ? tarefa.id : null);
  preencherSelectPredecessor(tarefa ? tarefa.id : null);

  const temFilhos = tarefa ? state.tarefas.some(t => t.parent_id === tarefa.id) : false;
  const temPredecessor = tarefa ? !!tarefa.predecessor_id : false;
  modalTemFilhosAtual = temFilhos;

  document.getElementById('aviso-tarefa-resumo').style.display = temFilhos ? 'block' : 'none';
  document.getElementById('aviso-tarefa-herdado').style.display = (!temFilhos && temPredecessor) ? 'block' : 'none';
  document.getElementById('f-tarefa-inicio').disabled = temFilhos || temPredecessor;
  document.getElementById('f-tarefa-fim').disabled = temFilhos;
  document.getElementById('f-tarefa-duracao').disabled = temFilhos;
  document.getElementById('f-tarefa-pct').disabled = temFilhos;
  document.getElementById('f-tarefa-status').disabled = temFilhos;

  document.getElementById('f-tarefa-nome').value = tarefa ? tarefa.nome : '';
  document.getElementById('f-tarefa-parent').value = tarefa ? (tarefa.parent_id || '') : (parentIdPadrao || '');
  document.getElementById('f-tarefa-predecessor').value = tarefa ? (tarefa.predecessor_id || '') : '';
  document.getElementById('f-tarefa-resp').value = tarefa ? (tarefa.responsavel || '') : '';
  document.getElementById('f-tarefa-prio').value = tarefa ? tarefa.prioridade : 'Media';
  document.getElementById('f-tarefa-inicio').value = tarefa ? toISO(tarefa.data_inicio) : '';
  document.getElementById('f-tarefa-fim').value = tarefa ? toISO(tarefa.data_fim) : '';
  document.getElementById('f-tarefa-duracao').value = (tarefa && tarefa.data_inicio && tarefa.data_fim) ? (diasEntre(tarefa.data_inicio, tarefa.data_fim) || '') : '';
  document.getElementById('f-tarefa-status').value = tarefa ? tarefa.status : 'Nao iniciado';
  document.getElementById('f-tarefa-pct').value = tarefa ? tarefa.percentual : 0;
  document.getElementById('f-tarefa-marco').checked = tarefa ? tarefa.marco : false;
  document.getElementById('f-tarefa-risco').checked = tarefa ? !!tarefa.em_risco : false;
  document.getElementById('f-tarefa-bloqueada').checked = false;
  document.getElementById('f-tarefa-obs').value = tarefa ? (tarefa.observacoes || '') : '';
  document.getElementById('btn-excluir-tarefa').style.display = tarefa ? 'inline-block' : 'none';
  sincronizarChipsTrello();

  const editando = !!tarefa;
  state.checklistAtual = (tarefa && Array.isArray(tarefa.checklist)) ? tarefa.checklist.map(i => ({ ...i })) : [];
  checklistAtualSeq = state.checklistAtual.length ? Math.max(...state.checklistAtual.map(i => i.id || 0)) + 1 : 1;

  document.getElementById('checklist-section-title').style.display = 'block';
  document.getElementById('checklist-wrap').style.display = 'block';
  document.getElementById('comentarios-section-title').style.display = editando ? 'block' : 'none';
  document.getElementById('comentarios-wrap').style.display = editando ? 'block' : 'none';
  document.getElementById('salve-para-checklist-hint').style.display = editando ? 'none' : 'block';
  renderChecklistSimples();
  if (editando) {
    renderComentarios(tarefa.id);
  }

  document.getElementById('modal-tarefa').style.display = 'flex';
}

// Verifica se a tarefa pode ser marcada como Concluída: bloqueia se ela tem uma
// predecessora que ainda não foi concluída (considerando o status já resolvido,
// inclusive de tarefas-resumo agregadas das subtarefas).
function validarConclusaoPorDependencia(predecessorId) {
  if (!predecessorId) return { ok: true };
  const pred = mapaDatasResolvidas()[Number(predecessorId)];
  if (pred && pred.status !== 'Concluido') {
    return { ok: false, nomePred: pred.nome };
  }
  return { ok: true };
}

async function salvarTarefa() {
  const payload = {
    nome: document.getElementById('f-tarefa-nome').value.trim(),
    parent_id: document.getElementById('f-tarefa-parent').value || null,
    predecessor_id: document.getElementById('f-tarefa-predecessor').value || null,
    responsavel: document.getElementById('f-tarefa-resp').value.trim(),
    prioridade: document.getElementById('f-tarefa-prio').value,
    data_inicio: document.getElementById('f-tarefa-inicio').value || null,
    data_fim: document.getElementById('f-tarefa-fim').value || null,
    status: document.getElementById('f-tarefa-status').value,
    percentual: parseInt(document.getElementById('f-tarefa-pct').value || '0', 10),
    marco: document.getElementById('f-tarefa-marco').checked,
    em_risco: document.getElementById('f-tarefa-risco').checked,
    bloqueada: document.getElementById('f-tarefa-bloqueada').checked,
    observacoes: document.getElementById('f-tarefa-obs').value.trim(),
    checklist: state.checklistAtual || []
  };
  if (!payload.nome) { alert('Informe o nome da tarefa.'); return; }
  if (payload.parent_id && state.editandoTarefaId && String(payload.parent_id) === String(state.editandoTarefaId)) {
    alert('Uma tarefa não pode ser subtarefa dela mesma.'); return;
  }
  if (payload.status === 'Concluido') {
    const check = validarConclusaoPorDependencia(payload.predecessor_id);
    if (!check.ok) {
      alert(`⛔ Não é possível concluir: a tarefa predecessora "${check.nomePred}" ainda não foi concluída.`);
      return;
    }
  }

  if (state.editandoTarefaId) {
    await api(`/tarefas/${state.editandoTarefaId}`, { method: 'PUT', body: JSON.stringify(payload) });
    logAtividade(`Tarefa "${payload.nome}" atualizada`);
  } else {
    payload.ordem = state.tarefas.filter(t => (t.parent_id || null) === (payload.parent_id || null)).length + 1;
    await api(`/obras/${state.obraAtual.id}/tarefas`, { method: 'POST', body: JSON.stringify(payload) });
    logAtividade(`Tarefa "${payload.nome}" criada`);
  }
  document.getElementById('modal-tarefa').style.display = 'none';
  await carregarTarefas();
  await carregarObras();
}

async function excluirTarefa() {
  if (!confirm('Excluir esta tarefa e todas as suas subtarefas?')) return;
  const t = state.tarefas.find(x => x.id === state.editandoTarefaId);
  await api(`/tarefas/${state.editandoTarefaId}`, { method: 'DELETE' });
  logAtividade(`Tarefa "${t ? t.nome : ''}" excluída`);
  document.getElementById('modal-tarefa').style.display = 'none';
  await carregarTarefas();
  await carregarObras();
}

// ---------------- Tabs ----------------
function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('view-' + tab.dataset.view).classList.add('active');
      document.getElementById('filter-bar').style.display = (tab.dataset.view === 'grid' || tab.dataset.view === 'kanban') ? 'flex' : 'none';
    };
  });
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

// ---------------- Init ----------------
function initEventos() {
  document.getElementById('btn-nova-obra').onclick = () => abrirModalObra(null);
  document.getElementById('btn-editar-obra').onclick = () => abrirModalObra(state.obraAtual);
  document.getElementById('btn-salvar-obra').onclick = salvarObra;
  document.getElementById('btn-cancelar-obra').onclick = () => document.getElementById('modal-obra').style.display = 'none';
  document.getElementById('btn-excluir-obra').onclick = excluirObra;

  document.getElementById('btn-nova-tarefa').onclick = () => abrirModalTarefa(null);
  document.getElementById('btn-salvar-tarefa').onclick = salvarTarefa;
  document.getElementById('btn-cancelar-tarefa').onclick = () => document.getElementById('modal-tarefa').style.display = 'none';
  document.getElementById('btn-excluir-tarefa').onclick = excluirTarefa;

  document.getElementById('nav-overview').onclick = abrirVisaoGeral;
  document.getElementById('nav-kanban-geral').onclick = abrirKanbanGeral;
  document.getElementById('btn-exportar-csv').onclick = exportarCSV;

  document.getElementById('btn-atividade').onclick = (e) => {
    e.stopPropagation();
    document.getElementById('activity-panel').classList.toggle('open');
  };
  document.getElementById('btn-fechar-atividade').onclick = () => {
    document.getElementById('activity-panel').classList.remove('open');
  };
  document.getElementById('btn-limpar-atividade').onclick = limparAtividades;

  // Fecha o painel de atividade ao clicar fora dele
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('activity-panel');
    if (!panel.classList.contains('open')) return;
    const toggleBtn = document.getElementById('btn-atividade');
    if (panel.contains(e.target) || toggleBtn.contains(e.target)) return;
    panel.classList.remove('open');
  });

  // Fecha com a tecla Esc
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.getElementById('activity-panel').classList.remove('open');
    }
  });

  document.querySelectorAll('.template-card').forEach(card => {
    card.onclick = () => {
      document.querySelectorAll('.template-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      state.templateSelecionado = card.dataset.template;
      const base = TEMPLATES[card.dataset.template];
      state.tarefasIniciais = base ? base.map(t => ({ ...t, id: tarefaInicialSeq++ })) : [];
      renderTarefasIniciais();
    };
  });
  document.getElementById('btn-add-tarefa-inicial').onclick = adicionarTarefaInicialVazia;

  // Sincronização Início / Duração / Fim + herança de data da predecessora
  document.getElementById('f-tarefa-inicio').oninput = recalcFimFromDuracao;
  document.getElementById('f-tarefa-duracao').oninput = recalcFimFromDuracao;
  document.getElementById('f-tarefa-fim').oninput = recalcDuracaoFromFim;
  document.getElementById('f-tarefa-predecessor').onchange = (e) => {
    const predId = e.target.value;
    const inicioInput = document.getElementById('f-tarefa-inicio');
    const avisoHerdado = document.getElementById('aviso-tarefa-herdado');
    if (predId) {
      const pred = mapaDatasResolvidas()[Number(predId)];
      if (pred && pred.data_fim) {
        inicioInput.value = addDays(pred.data_fim, 1);
        recalcFimFromDuracao();
      }
      inicioInput.disabled = true;
      avisoHerdado.style.display = modalTemFilhosAtual ? 'none' : 'block';
    } else {
      inicioInput.disabled = modalTemFilhosAtual;
      avisoHerdado.style.display = 'none';
    }
  };

  document.querySelectorAll('.modal-overlay').forEach(ov => {
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.style.display = 'none'; });
  });

  initTrelloChips();

  document.getElementById('btn-checklist-add').onclick = adicionarItemChecklistSimples;
  document.getElementById('checklist-add-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      adicionarItemChecklistSimples();
    }
  });

  document.getElementById('btn-comentar').onclick = () => {
    if (state.editandoTarefaId) enviarComentario(state.editandoTarefaId);
  };
  document.getElementById('comentario-texto').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (state.editandoTarefaId) enviarComentario(state.editandoTarefaId);
    }
  });

  initTabs();
  initFiltros();
  initCalendarNav();
}

async function init() {
  initEventos();
  renderActivity();
  await carregarObras();
  if (state.obras.length > 0) {
    await selecionarObra(state.obras[0].id);
  } else {
    document.getElementById('empty-obra').style.display = 'block';
  }
}

init();

/**
 * script.js — Dark Souls II Boss Tracker
 *
 * Algoritmo:
 *  1. Layout Sugiyama simplificado: longest-path (PHP) + barycenter (JS, 15 it.)
 *  2. Arestas curtas (diff=1): bezier vertical simples
 *  3. Arestas longas (diff≥2): roteadas por faixas laterais à direita do grafo,
 *     sem cruzar nenhum nó intermediário
 *  4. Port spreading: múltiplas arestas num mesmo nó saem/chegam em x levemente
 *     diferentes, evitando sobreposição nos pontos de conexão
 */
'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTES DE LAYOUT
// ═══════════════════════════════════════════════════════════════════════════════

const NODE_W     = 155;   // largura do nó
const NODE_H     = 60;    // altura do nó
const H_GAP      = 28;    // espaço horizontal entre nós no mesmo nível
const V_GAP      = 92;    // espaço vertical entre níveis
const PAD_X      = 52;    // margem esquerda/direita do SVG
const PAD_Y      = 44;    // margem superior/inferior
const PORT_W     = 13;    // deslocamento entre portas do mesmo nó (port spreading)
const LANE_SEP   = 22;    // espaço entre faixas de roteamento lateral
const LANE_START = 18;    // distância da borda direita dos nós até a 1ª faixa

// ═══════════════════════════════════════════════════════════════════════════════
// ESTADO
// ═══════════════════════════════════════════════════════════════════════════════

const GRAPH_DATA    = window.GRAPH_DATA    || { nodes: [], edges: [] };
const BOSS_PARENTS  = window.BOSS_PARENTS  || {};
const INITIAL_STATS = window.INITIAL_STATS || {};

const defeatedSet = new Set(
    GRAPH_DATA.nodes.filter(n => n.defeated).map(n => n.id)
);

const counters = {
    main: { total: INITIAL_STATS.main_total || 0, defeated: INITIAL_STATS.main_defeated || 0 },
    opt:  { total: INITIAL_STATS.opt_total  || 0, defeated: INITIAL_STATS.opt_defeated  || 0 },
    dlc:  { total: INITIAL_STATS.dlc_total  || 0, defeated: INITIAL_STATS.dlc_defeated  || 0 },
};

const nodeById = {};
GRAPH_DATA.nodes.forEach(n => { nodeById[n.id] = n; });

let detailNodeId = null;

// ═══════════════════════════════════════════════════════════════════════════════
// LÓGICA DE DESBLOQUEIO
// ═══════════════════════════════════════════════════════════════════════════════

function isUnlocked(bossId) {
    if (bossId === 0) return true;                      // Majula
    const parents = BOSS_PARENTS[bossId];
    if (!parents || parents.length === 0) return true;  // raiz
    return parents.some(pid => defeatedSet.has(pid));
}

function getBossType(bossId) {
    const cb = document.querySelector(`.boss-checkbox[data-id="${bossId}"]`);
    if (cb && cb.dataset.type === 'dlc') return 'dlc';
    const n = nodeById[bossId];
    return n ? (n.type === 'optional' ? 'opt' : 'main') : null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ALGORITMO DE LAYOUT
// ═══════════════════════════════════════════════════════════════════════════════

function computeLayout() {
    const nodes = GRAPH_DATA.nodes;
    const edges = GRAPH_DATA.edges;

    // ── Adjacência ─────────────────────────────────────────────────────────
    const childrenOf = {}, parentsOf = {};
    nodes.forEach(n => { childrenOf[n.id] = []; parentsOf[n.id] = []; });
    edges.forEach(e => {
        if (childrenOf[e.from] !== undefined) childrenOf[e.from].push(e.to);
        if (parentsOf[e.to]   !== undefined) parentsOf[e.to].push(e.from);
    });

    // ── Agrupamento por nível ───────────────────────────────────────────────
    const byLevel = {};
    nodes.forEach(n => {
        if (!byLevel[n.level]) byLevel[n.level] = [];
        byLevel[n.level].push(n.id);
    });
    const sortedLevels = Object.keys(byLevel).map(Number).sort((a, b) => a - b);

    // Posição relativa inicial: usa ordem do JSON (controlável pelo usuário)
    const relPos = {};
    sortedLevels.forEach(lvl => {
        byLevel[lvl].forEach((id, i) => relPos[id] = i);
    });

    // ── Heurística baricentro (15 iterações, alternando top-down/bottom-up) ──
    const barycenter = (id, neighbors) => {
        const nbrs = neighbors(id);
        return nbrs.length
            ? nbrs.reduce((s, x) => s + (relPos[x] ?? 0), 0) / nbrs.length
            : relPos[id] ?? 0;
    };

    for (let iter = 0; iter < 15; iter++) {
        // Top-down: ordena cada nível usando baricentro dos pais
        sortedLevels.forEach(lvl => {
            byLevel[lvl].sort((a, b) =>
                barycenter(a, id => parentsOf[id]) -
                barycenter(b, id => parentsOf[id])
            );
            byLevel[lvl].forEach((id, i) => relPos[id] = i);
        });
        // Bottom-up: reordena usando baricentro dos filhos
        [...sortedLevels].reverse().forEach(lvl => {
            byLevel[lvl].sort((a, b) =>
                barycenter(a, id => childrenOf[id]) -
                barycenter(b, id => childrenOf[id])
            );
            byLevel[lvl].forEach((id, i) => relPos[id] = i);
        });
    }

    // ── Identifica arestas longas e atribui faixas laterais ────────────────
    //    Faixas são atribuídas ordenando por (to_level desc, from_level asc)
    //    para que arestas que chegam mais fundo fiquem mais à direita.
    const longEdges = edges
        .map(e => ({
            ...e,
            fromLevel: nodeById[e.from]?.level ?? 0,
            toLevel:   nodeById[e.to]?.level ?? 0,
            diff:      (nodeById[e.to]?.level ?? 0) - (nodeById[e.from]?.level ?? 0),
        }))
        .filter(e => e.diff >= 2)
        .sort((a, b) => b.toLevel - a.toLevel || a.fromLevel - b.fromLevel);

    // ── Dimensões do SVG ────────────────────────────────────────────────────
    const maxCount  = Math.max(...sortedLevels.map(lvl => byLevel[lvl].length));
    const innerW    = maxCount * NODE_W + (maxCount - 1) * H_GAP;
    const laneAreaW = longEdges.length > 0
        ? LANE_START + longEdges.length * LANE_SEP + 10
        : 0;
    const svgWidth  = PAD_X + innerW + PAD_X + laneAreaW;
    const svgHeight = PAD_Y + sortedLevels.length * NODE_H +
                      (sortedLevels.length - 1) * V_GAP + PAD_Y;

    // ── Posições absolutas dos nós ──────────────────────────────────────────
    const positions = {};
    sortedLevels.forEach((lvl, lvlIdx) => {
        const ids      = byLevel[lvl];
        const count    = ids.length;
        const rowW     = count * NODE_W + (count - 1) * H_GAP;
        const startX   = PAD_X + (innerW - rowW) / 2;
        ids.forEach((id, i) => {
            const x = startX + i * (NODE_W + H_GAP);
            positions[id] = {
                x, y: PAD_Y + lvlIdx * (NODE_H + V_GAP),
                cx: x + NODE_W / 2,
                levelIdx: lvlIdx,
            };
        });
    });

    // ── Calcula x de cada faixa lateral ────────────────────────────────────
    //    Faixas ficam à direita do último nó mais largo
    const rightEdge = PAD_X + innerW + PAD_X;  // início da área de faixas
    longEdges.forEach((e, i) => {
        e.laneX = rightEdge + LANE_START + i * LANE_SEP;
    });

    return {
        positions, svgWidth, svgHeight,
        sortedLevels, byLevel,
        longEdges, childrenOf, parentsOf,
    };
}

// Cache do layout (recalculado apenas no reload)
let _layout = null;
const getLayout = () => _layout || (_layout = computeLayout());

// ═══════════════════════════════════════════════════════════════════════════════
// CÁLCULO DE PORTAS (port spreading)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calcula o x de saída de uma aresta no nó source, distribuído
 * horizontalmente se houver múltiplos filhos, na ordem das posições.
 */
function srcPort(fromId, toId, positions, childrenOf) {
    const children = [...(childrenOf[fromId] || [])];
    // Ordena filhos por posição x para mapear porta → posição visual
    children.sort((a, b) => (positions[a]?.cx ?? 0) - (positions[b]?.cx ?? 0));
    const idx = children.indexOf(toId);
    const n   = children.length;
    const offset = n > 1 ? (idx - (n - 1) / 2) * PORT_W : 0;
    return (positions[fromId]?.cx ?? 0) + offset;
}

/**
 * Calcula o x de chegada de uma aresta no nó target.
 */
function tgtPort(fromId, toId, positions, parentsOf) {
    const parents = [...(parentsOf[toId] || [])];
    parents.sort((a, b) => (positions[a]?.cx ?? 0) - (positions[b]?.cx ?? 0));
    const idx = parents.indexOf(fromId);
    const n   = parents.length;
    const offset = n > 1 ? (idx - (n - 1) / 2) * PORT_W : 0;
    return (positions[toId]?.cx ?? 0) + offset;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GERAÇÃO DE CAMINHO SVG
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Aresta curta (diff = 1): bezier vertical simples.
 */
function shortEdgePath(sx, sy, tx, ty) {
    const gap = (ty - sy) * 0.38;
    return `M${sx},${sy} C${sx},${sy+gap} ${tx},${ty-gap} ${tx},${ty}`;
}

/**
 * Aresta longa (diff ≥ 2): roteada pela faixa lateral laneX.
 * Formato: sai do source → curva para faixa → desce → curva para target
 */
function longEdgePath(sx, sy, tx, ty, laneX) {
    const curl = 38;  // raio da curva nas extremidades
    return [
        `M${sx},${sy}`,
        `C${sx},${sy+curl} ${laneX},${sy+curl*1.6} ${laneX},${sy+curl*2.2}`,
        `L${laneX},${ty-curl*2.2}`,
        `C${laneX},${ty-curl*1.6} ${tx},${ty-curl} ${tx},${ty}`,
    ].join(' ');
}

// ═══════════════════════════════════════════════════════════════════════════════
// RENDERIZAÇÃO SVG
// ═══════════════════════════════════════════════════════════════════════════════

const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl  = (tag, attrs = {}) => {
    const e = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    return e;
};

function splitName(name, max = 19) {
    if (name.length <= max) return [name, null];
    const idx = name.lastIndexOf(' ', max) || name.indexOf(' ', max);
    return idx > 0
        ? [name.slice(0, idx), name.slice(idx + 1)]
        : [name.slice(0, max) + '…', null];
}

function renderGraph() {
    const container = document.getElementById('graph-container');
    if (!container) return;

    const { positions, svgWidth, svgHeight, longEdges, childrenOf, parentsOf } = getLayout();

    // ── SVG root ───────────────────────────────────────────────────────────
    const svg = svgEl('svg', {
        id:      'graph-svg',
        width:   svgWidth,
        height:  svgHeight,
        viewBox: `0 0 ${svgWidth} ${svgHeight}`,
    });

    // ── Defs ───────────────────────────────────────────────────────────────
    const defs = svgEl('defs');
    defs.innerHTML = `
        <marker id="arr" markerWidth="8" markerHeight="6" refX="7.5" refY="3" orient="auto">
            <polygon points="0 0,8 3,0 6" fill="#8a6f30"/>
        </marker>
        <marker id="arr-long" markerWidth="8" markerHeight="6" refX="7.5" refY="3" orient="auto">
            <polygon points="0 0,8 3,0 6" fill="#6a5825"/>
        </marker>
        <marker id="arr-locked" markerWidth="8" markerHeight="6" refX="7.5" refY="3" orient="auto">
            <polygon points="0 0,8 3,0 6" fill="#252015"/>
        </marker>
        <filter id="f-glow">
            <feGaussianBlur in="SourceAlpha" stdDeviation="4" result="b"/>
            <feFlood flood-color="#c9a84c" flood-opacity="0.6" result="c"/>
            <feComposite in="c" in2="b" operator="in" result="g"/>
            <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="f-hub">
            <feGaussianBlur in="SourceAlpha" stdDeviation="6" result="b"/>
            <feFlood flood-color="#e8c96e" flood-opacity="0.45" result="c"/>
            <feComposite in="c" in2="b" operator="in" result="g"/>
            <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
    `;
    svg.appendChild(defs);

    // ── Camada: guias de faixa lateral (linhas verticais tracejadas) ────────
    if (longEdges.length > 0) {
        const guideLayer = svgEl('g', { id: 'lane-guides' });
        longEdges.forEach(e => {
            const fromPos = positions[e.from];
            const toPos   = positions[e.to];
            if (!fromPos || !toPos) return;
            const y1 = fromPos.y + NODE_H;
            const y2 = toPos.y;
            const line = svgEl('line', {
                x1: e.laneX, y1, x2: e.laneX, y2,
                class: 'lane-guide',
            });
            guideLayer.appendChild(line);
        });
        svg.appendChild(guideLayer);
    }

    // ── Camada: arestas ────────────────────────────────────────────────────
    const edgeLayer = svgEl('g', { id: 'edge-layer' });

    GRAPH_DATA.edges.forEach(edge => {
        const fp = positions[edge.from];
        const tp = positions[edge.to];
        if (!fp || !tp) return;

        const fromNode  = nodeById[edge.from];
        const toNode    = nodeById[edge.to];
        const diff      = (toNode?.level ?? 0) - (fromNode?.level ?? 0);
        const locked    = !isUnlocked(edge.to);
        const longEdge  = diff >= 2
            ? longEdges.find(le => le.from === edge.from && le.to === edge.to)
            : null;

        const sx = longEdge ? fp.cx : srcPort(edge.from, edge.to, positions, childrenOf);
        const tx = longEdge ? tp.cx : tgtPort(edge.from, edge.to, positions, parentsOf);
        const sy = fp.y + NODE_H;
        const ty = tp.y;

        const d = longEdge
            ? longEdgePath(sx, sy, tx, ty, longEdge.laneX)
            : shortEdgePath(sx, sy, tx, ty);

        const cls    = locked ? 'edge-locked' : longEdge ? 'edge-long' : 'edge-short';
        const marker = locked ? 'url(#arr-locked)' : longEdge ? 'url(#arr-long)' : 'url(#arr)';

        edgeLayer.appendChild(svgEl('path', {
            d, class: `graph-edge ${cls}`, 'marker-end': marker,
        }));
    });
    svg.appendChild(edgeLayer);

    // ── Camada: nós ────────────────────────────────────────────────────────
    const nodeLayer = svgEl('g', { id: 'node-layer' });

    GRAPH_DATA.nodes.forEach(node => {
        const pos  = positions[node.id];
        if (!pos) return;

        const unlocked = isUnlocked(node.id);
        const defeated = defeatedSet.has(node.id);
        const isHub    = node.is_hub;

        // Classes do grupo
        const cls = ['graph-node'];
        if (isHub)                    cls.push('node-hub');
        else if (!unlocked)           cls.push('node-locked');
        else if (defeated)            cls.push('node-defeated');
        if (node.type === 'optional') cls.push('node-optional');

        const g = svgEl('g', {
            class:     cls.join(' '),
            'data-id': node.id,
            transform: `translate(${pos.x},${pos.y})`,
            tabindex:  0,
        });

        // Fundo do nó
        const rect = svgEl('rect', {
            width: NODE_W, height: NODE_H, rx: 7, class: 'node-rect',
        });
        if (node.type === 'optional' && (unlocked || isHub)) {
            rect.setAttribute('stroke-dasharray', '6,3');
        }
        g.appendChild(rect);

        // Textos
        if (!unlocked && !isHub) {
            const t1 = svgEl('text', { x: NODE_W/2, y: NODE_H/2 - 8, class: 'node-txt node-locked-txt' });
            t1.textContent = '???';
            const t2 = svgEl('text', { x: NODE_W/2, y: NODE_H/2 + 9, class: 'node-sub node-locked-txt' });
            t2.textContent = 'Bloqueado';
            g.appendChild(t1); g.appendChild(t2);
        } else {
            const [l1, l2] = splitName(node.name);
            if (l2) {
                const t1 = svgEl('text', { x: NODE_W/2, y: NODE_H/2 - 9, class: 'node-txt' });
                t1.textContent = l1;
                const t2 = svgEl('text', { x: NODE_W/2, y: NODE_H/2 + 9, class: 'node-txt' });
                t2.textContent = l2;
                g.appendChild(t1); g.appendChild(t2);
            } else {
                const t = svgEl('text', { x: NODE_W/2, y: NODE_H/2 + 1, class: 'node-txt' });
                t.textContent = l1;
                g.appendChild(t);
            }
            if (defeated) {
                const ck = svgEl('text', { x: NODE_W - 11, y: 14, class: 'node-check' });
                ck.textContent = '✦';
                g.appendChild(ck);
            }
        }

        g.style.cursor = 'pointer';
        g.addEventListener('click', () => openDetailPanel(node.id));
        g.addEventListener('keydown', ev => {
            if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault(); openDetailPanel(node.id);
            }
        });
        nodeLayer.appendChild(g);
    });
    svg.appendChild(nodeLayer);

    container.innerHTML = '';
    container.appendChild(svg);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAINEL DE DETALHE
// ═══════════════════════════════════════════════════════════════════════════════

function openDetailPanel(nodeId) {
    const node     = nodeById[nodeId];
    if (!node) return;
    detailNodeId   = nodeId;
    const unlocked = isUnlocked(nodeId);
    const defeated = defeatedSet.has(nodeId);
    const isHub    = node.is_hub;
    const panel    = document.getElementById('detail-panel');
    if (!panel) return;

    document.getElementById('detail-name').textContent =
        (unlocked || isHub) ? node.name : '??? Desconhecido ???';

    const areaEl = document.getElementById('detail-area');
    areaEl.innerHTML = (unlocked || isHub)
        ? `<span class="icon">⚔</span> ${escHtml(node.area)}`
        : '';

    document.getElementById('detail-desc').textContent =
        (unlocked || isHub)
            ? node.description
            : 'Derrote o boss anterior para revelar este caminho.';

    const badge = document.getElementById('detail-badge');
    badge.textContent = isHub ? 'Área Inicial' : node.type === 'optional' ? 'Opcional' : 'Principal';
    badge.className   = 'badge ' + (isHub ? 'badge-hub' : node.type === 'optional' ? 'badge-optional' : 'badge-main');

    const footer = document.getElementById('detail-footer');
    if (isHub) {
        footer.style.display = 'none';
    } else {
        footer.style.display = '';
        const cb = document.getElementById('detail-checkbox');
        cb.dataset.id = nodeId;
        cb.disabled   = !unlocked;
        cb.checked    = defeated;
        document.getElementById('detail-cb-text').textContent =
            defeated ? '✦ Boss Derrotado' : 'Marcar como derrotado';
        const db = document.getElementById('detail-def-badge');
        if (db) db.hidden = !defeated;
    }

    panel.removeAttribute('hidden');
    requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.add('is-open')));
}

function closeDetailPanel() {
    const panel = document.getElementById('detail-panel');
    if (!panel) return;
    panel.classList.remove('is-open');
    setTimeout(() => panel.setAttribute('hidden', ''), 320);
    detailNodeId = null;
}

function escHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ═══════════════════════════════════════════════════════════════════════════════
// REFRESH (re-renderiza SVG; rápido para ~33 nós)
// ═══════════════════════════════════════════════════════════════════════════════

function refreshGraph() {
    renderGraph();
    if (detailNodeId !== null) openDetailPanel(detailNodeId);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ESTATÍSTICAS
// ═══════════════════════════════════════════════════════════════════════════════

function updateStats() {
    const gT = counters.main.total + counters.opt.total + counters.dlc.total;
    const gD = counters.main.defeated + counters.opt.defeated + counters.dlc.defeated;
    const pct = gT > 0 ? Math.round((gD / gT) * 100) : 0;

    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('stat-main',       `${counters.main.defeated}/${counters.main.total}`);
    set('stat-opt',        `${counters.opt.defeated}/${counters.opt.total}`);
    set('stat-dlc',        `${counters.dlc.defeated}/${counters.dlc.total}`);
    set('stat-pct',        `${pct}%`);
    set('progress-label',  `${gD} de ${gT} bosses derrotados`);
    const fill = document.getElementById('progress-fill');
    if (fill) fill.style.width = pct + '%';
}

// ═══════════════════════════════════════════════════════════════════════════════
// AJAX
// ═══════════════════════════════════════════════════════════════════════════════

async function toggleBoss(bossId, defeated) {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 8000);
    try {
        const res = await fetch('index.php', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
            body:    JSON.stringify({ action: 'toggle', boss_id: bossId, defeated }),
            signal:  ctrl.signal,
        });
        clearTimeout(tid);
        if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            throw new Error(e.error || `HTTP ${res.status}`);
        }
        const d = await res.json();
        if (!d.success) throw new Error('Falha ao salvar');
        return true;
    } catch (err) {
        clearTimeout(tid);
        showToast(err.name === 'AbortError' ? '⚠ Timeout' : '⚠ Erro ao salvar!', true);
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════════════════════════════

let toastTimer = null;
function showToast(msg, err = false) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent       = msg;
    t.style.borderColor = err ? 'var(--red-accent)' : 'var(--gold-dim)';
    t.style.color       = err ? 'var(--red-bright)'  : 'var(--gold-mid)';
    t.removeAttribute('hidden');
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        t.classList.remove('show');
        setTimeout(() => t.setAttribute('hidden', ''), 350);
    }, 2800);
}

// ═══════════════════════════════════════════════════════════════════════════════
// LISTENER CHECKBOXES (painel de detalhe + DLC)
// ═══════════════════════════════════════════════════════════════════════════════

document.addEventListener('change', async e => {
    const cb = e.target.closest('.boss-checkbox');
    if (!cb) return;
    const bossId  = parseInt(cb.dataset.id, 10);
    if (!bossId) return;
    cb.disabled   = true;

    const defeated = cb.checked;
    const bossType = getBossType(bossId);
    const bossName = nodeById[bossId]?.name || 'Boss';

    // Atualização optimistic
    if (defeated) {
        defeatedSet.add(bossId);
        if (bossType) counters[bossType].defeated++;
    } else {
        defeatedSet.delete(bossId);
        if (bossType) counters[bossType].defeated = Math.max(0, counters[bossType].defeated - 1);
    }

    // Sincroniza painel de detalhe
    const cbText = document.getElementById('detail-cb-text');
    const dbadge = document.getElementById('detail-def-badge');
    if (cbText) cbText.textContent = defeated ? '✦ Boss Derrotado' : 'Marcar como derrotado';
    if (dbadge) dbadge.hidden = !defeated;

    // Sincroniza card DLC
    const dlcCard = document.querySelector(`.dlc-card[data-boss-id="${bossId}"]`);
    if (dlcCard) {
        dlcCard.classList.toggle('boss-defeated', defeated);
        const dt = dlcCard.querySelector('.checkbox-text');
        if (dt) dt.textContent = defeated ? '✦ Boss Derrotado' : 'Marcar como derrotado';
        let db = dlcCard.querySelector('.defeated-badge');
        if (defeated && !db) {
            db = document.createElement('span');
            db.className = 'defeated-badge'; db.textContent = 'Derrotado ✦';
            dlcCard.querySelector('.boss-footer')?.appendChild(db);
        } else if (!defeated && db) db.remove();
    }

    refreshGraph();
    updateStats();

    const ok = await toggleBoss(bossId, defeated);
    if (ok) {
        showToast(defeated ? `✦ ${bossName} derrotado!` : `${bossName} revivido`);
    } else {
        // Reverte
        cb.checked = !defeated;
        if (defeated) {
            defeatedSet.delete(bossId);
            if (bossType) counters[bossType].defeated = Math.max(0, counters[bossType].defeated - 1);
        } else {
            defeatedSet.add(bossId);
            if (bossType) counters[bossType].defeated++;
        }
        if (cbText) cbText.textContent = !defeated ? '✦ Boss Derrotado' : 'Marcar como derrotado';
        if (dbadge) dbadge.hidden = defeated;
        refreshGraph();
        updateStats();
    }
    cb.disabled = false;
});

// ═══════════════════════════════════════════════════════════════════════════════
// RESET
// ═══════════════════════════════════════════════════════════════════════════════

const btnReset   = document.getElementById('btn-reset');
const modal      = document.getElementById('modal-reset');
const btnConfirm = document.getElementById('btn-confirm-reset');
const btnCancel  = document.getElementById('btn-cancel-reset');

btnReset?.addEventListener('click',  () => modal?.removeAttribute('hidden'));
btnCancel?.addEventListener('click', () => modal?.setAttribute('hidden', ''));
modal?.addEventListener('click', e => { if (e.target === modal) modal.setAttribute('hidden', ''); });

btnConfirm?.addEventListener('click', async () => {
    modal?.setAttribute('hidden', '');
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 8000);
    try {
        const res = await fetch('index.php', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
            body:    JSON.stringify({ action: 'reset' }),
            signal:  ctrl.signal,
        });
        clearTimeout(tid);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        if (d.success) { showToast('☠ Progresso resetado'); setTimeout(() => location.reload(), 800); }
    } catch (err) { clearTimeout(tid); showToast('⚠ Erro ao resetar!', true); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// FECHAR PAINEL / ESC
// ═══════════════════════════════════════════════════════════════════════════════

document.getElementById('detail-close')?.addEventListener('click', closeDetailPanel);

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        if (modal && !modal.hasAttribute('hidden')) modal.setAttribute('hidden', '');
        else closeDetailPanel();
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// INICIALIZAÇÃO
// ═══════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    renderGraph();
    updateStats();
});

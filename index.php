<?php
/**
 * index.php — Dark Souls II Boss Tracker
 */

require_once __DIR__ . '/includes/database.php';
require_once __DIR__ . '/includes/functions.php';

// ─── API AJAX ─────────────────────────────────────────────────────────────────
if (
    $_SERVER['REQUEST_METHOD'] === 'POST'
    && isset($_SERVER['HTTP_X_REQUESTED_WITH'])
    && strtolower($_SERVER['HTTP_X_REQUESTED_WITH']) === 'xmlhttprequest'
    && str_contains($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')
) {
    header('Content-Type: application/json; charset=utf-8');
    $input = json_decode(file_get_contents('php://input', false, null, 0, 4096), true);

    if (!is_array($input)) {
        http_response_code(400);
        echo json_encode(['error' => 'Payload inválido.']);
        exit;
    }

    try {
        switch ($input['action'] ?? '') {
            case 'toggle':
                $id = (int)($input['boss_id'] ?? 0);
                if ($id <= 0) { http_response_code(400); echo json_encode(['error' => 'ID inválido.']); exit; }
                setBossDefeated($id, (bool)($input['defeated'] ?? false));
                echo json_encode(['success' => true]);
                break;
            case 'reset':
                resetProgress();
                echo json_encode(['success' => true]);
                break;
            default:
                http_response_code(400);
                echo json_encode(['error' => 'Ação desconhecida.']);
        }
    } catch (InvalidArgumentException $e) {
        http_response_code(422); echo json_encode(['error' => $e->getMessage()]);
    } catch (RuntimeException $e) {
        http_response_code(500); echo json_encode(['error' => 'Erro interno.']); error_log($e->getMessage());
    }
    exit;
}

// ─── DADOS ────────────────────────────────────────────────────────────────────
try {
    $allBosses = loadBosses();
    $defeated  = getDefeatedBosses();
} catch (RuntimeException $e) {
    error_log($e->getMessage());
    die('<h1 style="font-family:sans-serif;padding:2rem">Erro ao carregar dados. Verifique os logs.</h1>');
}

$graphData = buildGraphData($allBosses['main'], $defeated);
$stats     = getStats($allBosses, $defeated);

$dlcBosses = array_map(function ($boss) use ($defeated) {
    $boss['defeated'] = in_array($boss['id'], $defeated, true);
    return $boss;
}, $allBosses['dlc']);

$pct = $stats['grand_total'] > 0
    ? round(($stats['grand_defeated'] / $stats['grand_total']) * 100)
    : 0;

// Dados para o JS
$graphJson   = json_encode($graphData,  JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
$parentsJson = json_encode(
    array_combine(
        array_column($allBosses['main'], 'id'),
        array_map(fn($b) => array_map('intval', $b['parents'] ?? []), $allBosses['main'])
    ),
    JSON_THROW_ON_ERROR
);
$statsJson = json_encode([
    'main_total' => $stats['main_total'], 'main_defeated' => $stats['main_defeated'],
    'opt_total'  => $stats['opt_total'],  'opt_defeated'  => $stats['opt_defeated'],
    'dlc_total'  => $stats['dlc_total'],  'dlc_defeated'  => $stats['dlc_defeated'],
], JSON_THROW_ON_ERROR);
?>
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dark Souls II – Boss Tracker</title>
    <link rel="stylesheet" href="style.css">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">
</head>
<body>

<!-- HEADER -->
<header class="site-header">
    <div class="header-inner">
        <div class="header-title-group">
            <span class="header-eyebrow">Scholar of the First Sin</span>
            <h1 class="header-title">Dark Souls II</h1>
            <span class="header-subtitle">Boss Progression Tracker</span>
        </div>
        <div class="header-ornament">⚜</div>
    </div>
</header>

<!-- STATS -->
<section class="stats-panel">
    <div class="stats-inner">
        <div class="stat-block">
            <span class="stat-value" id="stat-main"><?= $stats['main_defeated'] ?>/<?= $stats['main_total'] ?></span>
            <span class="stat-label">Principais</span>
        </div>
        <div class="stat-divider">✦</div>
        <div class="stat-block">
            <span class="stat-value" id="stat-opt"><?= $stats['opt_defeated'] ?>/<?= $stats['opt_total'] ?></span>
            <span class="stat-label">Opcionais</span>
        </div>
        <div class="stat-divider">✦</div>
        <div class="stat-block">
            <span class="stat-value" id="stat-dlc"><?= $stats['dlc_defeated'] ?>/<?= $stats['dlc_total'] ?></span>
            <span class="stat-label">DLC</span>
        </div>
        <div class="stat-divider">✦</div>
        <div class="stat-block stat-total">
            <span class="stat-value" id="stat-pct"><?= $pct ?>%</span>
            <span class="stat-label">Completo</span>
        </div>
    </div>
    <div class="progress-bar-wrap">
        <div class="progress-bar-track">
            <div class="progress-bar-fill" id="progress-fill" style="width:<?= $pct ?>%"></div>
        </div>
        <span class="progress-label" id="progress-label">
            <?= $stats['grand_defeated'] ?> de <?= $stats['grand_total'] ?> bosses derrotados
        </span>
    </div>
    <div class="header-actions">
        <button id="btn-reset" class="btn-reset"><span>☠</span> Resetar Progresso</button>
    </div>
</section>

<!-- LEGENDA -->
<div class="legend">
    <span class="legend-item"><span class="node-legend node-legend-main"></span> Boss principal</span>
    <span class="legend-item"><span class="node-legend node-legend-opt"></span> Boss opcional</span>
    <span class="legend-item"><span class="node-legend node-legend-locked"></span> Bloqueado</span>
    <span class="legend-item"><span class="node-legend node-legend-defeated"></span> Derrotado ✦</span>
    <span class="legend-item"><span class="node-legend node-legend-hub"></span> Majula (hub)</span>
    <span class="legend-item" style="font-size:0.75rem;color:var(--text-muted)">Clique no nó para detalhes</span>
</div>

<!-- GRAFO -->
<main class="main-content">
    <section class="graph-section">
        <h2 class="section-title">
            <span class="section-ornament">⚔</span>
            Grafo de Progressão
            <span class="section-ornament">⚔</span>
        </h2>
        <p class="section-desc">
            Cada boss aparece uma única vez. Arestas mostram todos os caminhos possíveis.
            Clique em qualquer nó para ver detalhes e marcar como derrotado.
        </p>

        <div id="graph-container">
            <div id="graph-loading">Carregando grafo…</div>
        </div>
    </section>

    <!-- PAINEL DE DETALHE (slide-up ao clicar num nó) -->
    <div id="detail-panel" hidden>
        <div class="detail-header-bar">
            <span class="detail-panel-title">Boss Selecionado</span>
            <button id="detail-close" class="detail-close-btn">✕ Fechar</button>
        </div>
        <div class="detail-content">
            <div class="boss-header">
                <span class="boss-name" id="detail-name"></span>
                <span class="badge" id="detail-badge"></span>
            </div>
            <div class="boss-area" id="detail-area"></div>
            <p class="boss-desc" id="detail-desc"></p>
            <div class="boss-footer" id="detail-footer">
                <label class="checkbox-label" for="detail-checkbox">
                    <input type="checkbox" id="detail-checkbox" class="boss-checkbox">
                    <span class="checkbox-custom"></span>
                    <span class="checkbox-text" id="detail-cb-text">Marcar como derrotado</span>
                </label>
                <span class="defeated-badge" id="detail-def-badge" hidden>Derrotado ✦</span>
            </div>
        </div>
    </div>

    <!-- DLC -->
    <section class="dlc-section">
        <h2 class="section-title dlc-title">
            <span class="section-ornament">👑</span>
            DLC Bosses
            <span class="section-ornament">👑</span>
        </h2>
        <p class="section-desc">As Coroas dos Três Reis — acessíveis a qualquer momento.</p>

        <?php
        $dlcGroups = [];
        foreach ($dlcBosses as $boss) $dlcGroups[$boss['dlc']][] = $boss;
        ?>

        <?php foreach ($dlcGroups as $dlcName => $bosses): ?>
        <div class="dlc-group">
            <h3 class="dlc-group-title">
                <span class="dlc-crown">♛</span>
                <?= htmlspecialchars($dlcName, ENT_QUOTES, 'UTF-8') ?>
            </h3>
            <div class="dlc-grid">
                <?php foreach ($bosses as $boss): $bid = (int)$boss['id']; ?>
                <div class="boss-card dlc-card <?= $boss['defeated'] ? 'boss-defeated' : '' ?>"
                     data-boss-id="<?= $bid ?>">
                    <div class="card-real-content">
                        <div class="boss-header">
                            <span class="boss-name"><?= htmlspecialchars($boss['name'], ENT_QUOTES, 'UTF-8') ?></span>
                            <span class="badge <?= $boss['type'] === 'optional' ? 'badge-optional' : 'badge-main' ?>">
                                <?= $boss['type'] === 'optional' ? 'Opcional' : 'Principal' ?>
                            </span>
                        </div>
                        <div class="boss-body">
                            <div class="boss-area"><span class="icon">⚔</span>
                                <?= htmlspecialchars($boss['area'], ENT_QUOTES, 'UTF-8') ?>
                            </div>
                            <p class="boss-desc"><?= htmlspecialchars($boss['description'], ENT_QUOTES, 'UTF-8') ?></p>
                        </div>
                        <div class="boss-footer">
                            <label class="checkbox-label" for="boss-<?= $bid ?>">
                                <input type="checkbox" id="boss-<?= $bid ?>"
                                       class="boss-checkbox" data-id="<?= $bid ?>" data-type="dlc"
                                       <?= $boss['defeated'] ? 'checked' : '' ?>>
                                <span class="checkbox-custom"></span>
                                <span class="checkbox-text">
                                    <?= $boss['defeated'] ? '✦ Boss Derrotado' : 'Marcar como derrotado' ?>
                                </span>
                            </label>
                            <?php if ($boss['defeated']): ?>
                                <span class="defeated-badge">Derrotado ✦</span>
                            <?php endif; ?>
                        </div>
                    </div>
                </div>
                <?php endforeach; ?>
            </div>
        </div>
        <?php endforeach; ?>
    </section>
</main>

<footer class="site-footer">
    <p>Dark Souls II: Scholar of the First Sin — Boss Tracker</p>
    <p class="footer-quote">"Seek souls, and be judged."</p>
</footer>

<!-- MODAL DE RESET -->
<div id="modal-reset" class="modal-overlay" hidden>
    <div class="modal-box">
        <h3 class="modal-title">☠ Resetar Progresso?</h3>
        <p>Todo seu progresso será apagado. Esta ação não pode ser desfeita.</p>
        <div class="modal-actions">
            <button id="btn-confirm-reset" class="btn-danger">Confirmar Reset</button>
            <button id="btn-cancel-reset" class="btn-secondary">Cancelar</button>
        </div>
    </div>
</div>

<div id="toast" class="toast" hidden></div>

<script>
    window.GRAPH_DATA    = <?= $graphJson ?>;
    window.BOSS_PARENTS  = <?= $parentsJson ?>;
    window.INITIAL_STATS = <?= $statsJson ?>;
</script>
<script src="script.js"></script>
</body>
</html>

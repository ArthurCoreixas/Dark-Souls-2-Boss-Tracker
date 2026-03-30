<?php
/**
 * functions.php
 * Lógica de progressão e construção do grafo DAG.
 */

// ─── CARREGAMENTO ─────────────────────────────────────────────────────────────

function loadBosses(): array {
    $path = __DIR__ . '/../bosses.json';
    $raw  = file_get_contents($path);
    if ($raw === false) throw new RuntimeException('Não foi possível ler bosses.json.');
    $data = json_decode($raw, true);
    if (!is_array($data)) throw new RuntimeException('bosses.json contém JSON inválido.');
    return $data;
}

// ─── DESBLOQUEIO ──────────────────────────────────────────────────────────────

function isBossUnlocked(array $boss, array $defeated): bool {
    if ($boss['unlocked_by_default'] ?? false) return true;
    $parents = $boss['parents'] ?? [];
    if (empty($parents)) return false;
    foreach ($parents as $pid) {
        if (in_array($pid, $defeated, true)) return true;
    }
    return false;
}

// ─── GRAFO DAG ────────────────────────────────────────────────────────────────
/**
 * Constrói os dados do grafo para renderização SVG no cliente.
 *
 * Algoritmo de nível: longest-path (caminho mais longo).
 * Garante que arestas sempre apontam para baixo (pai → filho).
 * Um boss com múltiplos pais recebe nível = max(pais) + 1.
 * Cada boss aparece UMA ÚNICA VEZ, independente de quantos pais tem.
 *
 * Majula é tratada como nó hub (level -1), não conta na progressão.
 */
function buildGraphData(array $bosses, array $defeated): array {
    $defeatedInts = array_map('intval', $defeated);

    // ── Longest-path level assignment ──────────────────────────────────────
    $levels = [];
    foreach ($bosses as $boss) {
        $levels[$boss['id']] = empty($boss['parents']) ? 0 : -1;
    }

    $changed = true;
    $guard   = 0;
    while ($changed && $guard++ < 200) {
        $changed = false;
        foreach ($bosses as $boss) {
            if (empty($boss['parents'])) continue;
            $maxP = -1;
            foreach ($boss['parents'] as $pid) {
                if (isset($levels[$pid]) && $levels[$pid] > $maxP) {
                    $maxP = $levels[$pid];
                }
            }
            if ($maxP >= 0 && $levels[$boss['id']] < $maxP + 1) {
                $levels[$boss['id']] = $maxP + 1;
                $changed = true;
            }
        }
    }

    // ── Nós ────────────────────────────────────────────────────────────────
    // Majula: nó hub no nível -1 (acima de tudo)
    $nodes = [[
        'id'          => 0,
        'name'        => 'Majula',
        'area'        => 'Área Inicial — Drangleic',
        'type'        => 'hub',
        'description' => 'O lar entre as mortes. Ponto central de Drangleic, de onde partem todos os caminhos do reino perdido.',
        'parents'     => [],
        'level'       => -1,
        'unlocked'    => true,
        'defeated'    => false,
        'is_hub'      => true,
    ]];

    foreach ($bosses as $boss) {
        $nodes[] = [
            'id'          => (int) $boss['id'],
            'name'        => $boss['name'],
            'area'        => $boss['area'],
            'type'        => $boss['type'],
            'description' => $boss['description'],
            'parents'     => array_map('intval', $boss['parents'] ?? []),
            'level'       => $levels[$boss['id']] ?? 0,
            'unlocked'    => isBossUnlocked($boss, $defeatedInts),
            'defeated'    => in_array((int)$boss['id'], $defeatedInts, true),
            'is_hub'      => false,
        ];
    }

    // ── Arestas ────────────────────────────────────────────────────────────
    $edges = [];

    // Majula → todos os bosses do nível 0
    foreach ($bosses as $boss) {
        if (($levels[$boss['id']] ?? -1) === 0) {
            $edges[] = ['from' => 0, 'to' => (int)$boss['id']];
        }
    }

    // Arestas pai → filho para CADA pai de cada boss
    // (isso é o que faz o grafo ser diferente da árvore:
    //  um boss com pais [6, 13] terá DUAS arestas chegando nele)
    foreach ($bosses as $boss) {
        foreach (($boss['parents'] ?? []) as $pid) {
            $edges[] = ['from' => (int)$pid, 'to' => (int)$boss['id']];
        }
    }

    return ['nodes' => $nodes, 'edges' => $edges];
}

// ─── ESTATÍSTICAS ─────────────────────────────────────────────────────────────

function getStats(array $allBosses, array $defeated): array {
    $mainBosses     = array_filter($allBosses['main'], fn($b) => $b['type'] === 'main');
    $optionalBosses = array_filter($allBosses['main'], fn($b) => $b['type'] === 'optional');
    $dlcBosses      = $allBosses['dlc'];

    $mainIds     = array_values(array_column($mainBosses,     'id'));
    $optionalIds = array_values(array_column($optionalBosses, 'id'));
    $dlcIds      = array_values(array_column($dlcBosses,      'id'));

    $defeatedInts = array_map('intval', $defeated);
    $countIn = fn(array $ids) => count(array_filter(
        $ids, fn($id) => in_array($id, $defeatedInts, true)
    ));

    return [
        'main_total'     => count($mainIds),
        'main_defeated'  => $countIn($mainIds),
        'opt_total'      => count($optionalIds),
        'opt_defeated'   => $countIn($optionalIds),
        'dlc_total'      => count($dlcIds),
        'dlc_defeated'   => $countIn($dlcIds),
        'grand_total'    => count($mainIds) + count($optionalIds) + count($dlcIds),
        'grand_defeated' => $countIn(array_merge($mainIds, $optionalIds, $dlcIds)),
    ];
}

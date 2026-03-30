<?php
/**
 * database.php
 * Gerencia a conexão e operações com o banco de dados SQLite.
 */

define('DB_PATH', __DIR__ . '/../progress.db');

/**
 * IDs válidos de bosses (principais + DLC).
 *
 * FIX [SEC-1]: whitelist usada para rejeitar IDs arbitrários na API,
 * impedindo que um atacante grave linhas espúrias no banco.
 */
function getValidBossIds(): array {
    static $ids = null;
    if ($ids === null) {
        $path = __DIR__ . '/../bosses.json';
        $raw  = file_get_contents($path);
        if ($raw === false) {
            throw new RuntimeException('Não foi possível ler bosses.json.');
        }
        $data = json_decode($raw, true);
        $ids  = array_merge(
            array_column($data['main'], 'id'),
            array_column($data['dlc'],  'id')
        );
    }
    return $ids;
}

/**
 * Retorna a conexão com o banco de dados SQLite (singleton).
 *
 * FIX [BUG-1]: die() vazava stack/path internos ao cliente em texto plano.
 * Agora lança RuntimeException — index.php decide como responder (JSON 500).
 */
function getDB(): PDO {
    static $pdo = null;

    if ($pdo === null) {
        try {
            $pdo = new PDO('sqlite:' . DB_PATH);
            $pdo->setAttribute(PDO::ATTR_ERRMODE,            PDO::ERRMODE_EXCEPTION);
            $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
            initDB($pdo);
        } catch (PDOException $e) {
            error_log('DB connection error: ' . $e->getMessage());
            throw new RuntimeException('Erro interno ao acessar o banco de dados.');
        }
    }

    return $pdo;
}

/**
 * Cria as tabelas necessárias se não existirem.
 */
function initDB(PDO $pdo): void {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS progress (
            boss_id     INTEGER PRIMARY KEY,
            defeated    INTEGER NOT NULL DEFAULT 0,
            defeated_at TEXT
        )
    ");
}

/**
 * Retorna todos os boss_ids marcados como derrotados.
 */
function getDefeatedBosses(): array {
    $stmt = getDB()->query("SELECT boss_id FROM progress WHERE defeated = 1");
    return array_column($stmt->fetchAll(), 'boss_id');
}

/**
 * Marca um boss como derrotado (ou desfaz a marcação).
 *
 * FIX [BUG-2]: substituído SELECT → INSERT/UPDATE por INSERT OR REPLACE (UPSERT
 * nativo do SQLite), eliminando a race condition entre as duas queries.
 *
 * FIX [SEC-1]: valida o ID contra a whitelist antes de qualquer operação.
 *
 * @throws InvalidArgumentException se boss_id não for reconhecido.
 */
function setBossDefeated(int $bossId, bool $defeated): void {
    if (!in_array($bossId, getValidBossIds(), true)) {
        throw new InvalidArgumentException("boss_id inválido: {$bossId}");
    }

    $stmt = getDB()->prepare("
        INSERT OR REPLACE INTO progress (boss_id, defeated, defeated_at)
        VALUES (?, ?, ?)
    ");
    $stmt->execute([
        $bossId,
        $defeated ? 1 : 0,
        $defeated ? date('Y-m-d H:i:s') : null,
    ]);
}

/**
 * Reseta todo o progresso do jogador.
 */
function resetProgress(): void {
    getDB()->exec("DELETE FROM progress");
}

/**
 * Retorna o total de bosses derrotados.
 */
function countDefeated(): int {
    $stmt = getDB()->query("SELECT COUNT(*) as total FROM progress WHERE defeated = 1");
    return (int) $stmt->fetch()['total'];
}

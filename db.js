const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, 'data', 'fut.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
    CREATE TABLE IF NOT EXISTS jogadores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        whatsapp_id TEXT UNIQUE,
        telefone TEXT,
        nivel INTEGER NOT NULL DEFAULT 3,
        papel TEXT NOT NULL DEFAULT 'avulso' CHECK(papel IN ('mensalista', 'avulso')),
        criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS enquetes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT UNIQUE NOT NULL,
        group_id TEXT NOT NULL,
        titulo TEXT NOT NULL,
        criada_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS votos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        enquete_id INTEGER NOT NULL REFERENCES enquetes(id) ON DELETE CASCADE,
        jogador_id INTEGER NOT NULL REFERENCES jogadores(id) ON DELETE CASCADE,
        opcao TEXT NOT NULL,
        votado_em TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(enquete_id, jogador_id)
    );

    CREATE TABLE IF NOT EXISTS pagamentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jogador_id INTEGER NOT NULL REFERENCES jogadores(id) ON DELETE CASCADE,
        mes_referencia TEXT NOT NULL,
        pago INTEGER NOT NULL DEFAULT 0,
        atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(jogador_id, mes_referencia)
    );

    CREATE TABLE IF NOT EXISTS admin_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario TEXT UNIQUE NOT NULL,
        senha_hash TEXT NOT NULL
    );
`);

function upsertJogador(whatsappId, nome, papelSugerido) {
    const existente = db
        .prepare('SELECT id FROM jogadores WHERE whatsapp_id = ?')
        .get(whatsappId);

    if (existente) {
        db.prepare('UPDATE jogadores SET nome = ? WHERE id = ?').run(
            nome,
            existente.id,
        );
        return existente.id;
    }

    const info = db
        .prepare(
            'INSERT INTO jogadores (nome, whatsapp_id, papel) VALUES (?, ?, ?)',
        )
        .run(nome, whatsappId, papelSugerido || 'avulso');
    return info.lastInsertRowid;
}

module.exports = { db, upsertJogador };

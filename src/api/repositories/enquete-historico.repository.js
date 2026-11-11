const db = require('../../loaders/database');
module.exports = {
    ultimo: (enquete, jogador) => db.prepare('SELECT * FROM enquete_respostas_historico WHERE enquete_id = ? AND jogador_id = ? ORDER BY ocorrido_em DESC, id DESC LIMIT 1').get(enquete, jogador),
    voto: (enquete, jogador) => db.prepare('SELECT opcao, papel FROM votos WHERE enquete_id = ? AND jogador_id = ?').get(enquete, jogador),
    inserir: dados => db.prepare(`INSERT OR IGNORE INTO enquete_respostas_historico
        (enquete_id, jogador_id, anterior, resposta, papel_anterior, papel, origem, ocorrido_em)
        VALUES (@enquete, @jogador, @anterior, @resposta, @papelAnterior, @papel, @origem, @ocorrido)`).run(dados),
    listar: enquete => db.prepare(`SELECT h.*, j.nome, e.data_jogo,
        EXISTS(SELECT 1 FROM enquete_respostas_historico m WHERE m.enquete_id = h.enquete_id AND m.jogador_id = h.jogador_id AND m.multa_enfileirada_em IS NOT NULL) AS cobrada
        FROM enquete_respostas_historico h JOIN jogadores j ON j.id = h.jogador_id
        JOIN enquetes e ON e.id = h.enquete_id WHERE h.enquete_id = ? ORDER BY h.ocorrido_em DESC, h.id DESC`).all(enquete),
    marcar: id => db.prepare("UPDATE enquete_respostas_historico SET multa_enfileirada_em = datetime('now') WHERE id = ?").run(id),
    contato: id => db.prepare('SELECT whatsapp_id FROM jogadores WHERE id = ?').get(id),
};

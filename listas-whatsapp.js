const crypto = require('crypto');
class ErroLista extends Error {}
const { db, getConfig, podeUsarComandos, getConfirmadosDaEnquete, getListaDeEsperaDaEnquete,
    marcarVotoManual, registrarMudancaPapel, registrarLog, getAusentesDaEnquete, setAusentesDaEnquete } = require('./db');

function normalizar(texto) {
    return String(texto).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[–—]/g, '-')
        .replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');
}
function limparLinha(linha) {
    return linha.replace(/\*/g, '').replace(/\u00a0/g, ' ').trim().replace(/^[^\p{L}\p{N}]+/u, '');
}
function pareceLista(texto) {
    return /^Lista (atual|fechada)\s*[—–-]\s*\S/i.test(String(texto).split(/\r?\n/).map(limparLinha).find(Boolean) || '');
}
function interpretarLista(texto) {
    if (typeof texto !== 'string' || texto.length > 20000) throw new ErroLista('A lista está grande demais.');
    const linhas = texto.split(/\r?\n/).map(limparLinha).filter(Boolean);
    const cabecalho = linhas.shift()?.match(/^Lista (?:atual|fechada)\s*[—–-]\s*(.+)$/i);
    if (!cabecalho) throw new ErroLista('Use o cabeçalho completo da lista do bot, com o título do jogo.');
    const secoes = [];
    const avisos = [];
    let secao = null;
    let total = null;
    let aposTotal = false;
    for (const linha of linhas) {
        const titulo = linha.match(/^(Mensalistas|Avulsas|Avulsos|Lista de espera)\s*\((\d+)\)\s*:\s*$/i);
        if (titulo) {
            const tipo = normalizar(titulo[1]);
            const papel = tipo === 'mensalistas' ? 'mensalista' : tipo === 'lista de espera' ? 'espera' : 'avulso';
            if (secoes.some(s => s.papel === papel) || (aposTotal && papel !== 'espera')) throw new ErroLista('Há uma seção repetida ou fora de ordem.');
            secao = { papel, quantidade: Number(titulo[2]), nomes: [], ultimoNumero: 0 };
            secoes.push(secao);
            continue;
        }
        const fim = linha.match(/^Total:\s*(\d+)(?:\s+confirmad[ao]s?)?\.?$/i);
        if (fim) {
            if (total !== null) throw new ErroLista('Há mais de um total na lista.');
            total = Number(fim[1]);
            aposTotal = true;
            secao = null;
            continue;
        }
        const pessoa = linha.match(/^(\d+)[.)-]\s*(.+)$/);
        if (pessoa) {
            if (!secao || Number(pessoa[1]) <= secao.ultimoNumero) throw new ErroLista('Confira a numeração de cada seção.');
            if (Number(pessoa[1]) !== secao.nomes.length + 1) avisos.push('A numeração será reorganizada.');
            secao.ultimoNumero = Number(pessoa[1]);
            const nome = pessoa[2].trim();
            if (!nome || nome.length > 100 || !/\p{L}/u.test(nome)) throw new ErroLista('Há um nome inválido na lista.');
            secao.nomes.push(nome);
            continue;
        }
        if (/^(Essa lista ainda pode mudar|So entra(?:m)? se|Lista fechada\s*[—–-]\s*votos)/i.test(normalizar(linha))) continue;
        throw new ErroLista('Há uma linha fora do formato. Reenvie a lista completa com nomes numerados e total.');
    }
    if (total === null || total < 1 || total > 200) throw new ErroLista('Informe um total entre 1 e 200 confirmadas.');
    if (secoes.some(s => s.quantidade !== s.nomes.length)) avisos.push('As contagens dos cabeçalhos foram recalculadas pelos nomes.');
    const confirmadas = secoes.filter(s => s.papel !== 'espera').flatMap(s => s.nomes.map(nome => ({ nome, papel: s.papel })));
    const espera = secoes.find(s => s.papel === 'espera')?.nomes || [];
    if (confirmadas.length !== total || confirmadas.length + espera.length > 200) throw new ErroLista('O total não bate com a lista de confirmadas.');
    const nomes = [...confirmadas.map(j => normalizar(j.nome)), ...espera.map(normalizar)];
    if (new Set(nomes).size !== nomes.length) throw new ErroLista('Há nomes repetidos na lista.');
    return { titulo: cabecalho[1], confirmadas, espera, avisos: [...new Set(avisos)] };
}
function contexto(grupo, autor) {
    if (grupo !== getConfig('enquete_grupo_id') || !podeUsarComandos(autor)) throw new ErroLista('Somente uma pessoa autorizada pode corrigir a lista no grupo configurado.');
    const enquete = db.prepare('SELECT * FROM enquetes ORDER BY id DESC LIMIT 1').get();
    if (!enquete || enquete.group_id !== grupo) throw new ErroLista('Não há uma enquete atual desse grupo para corrigir.');
    return enquete;
}
function assinatura(enquete) {
    const votos = db.prepare('SELECT * FROM votos WHERE enquete_id = ? ORDER BY jogador_id').all(enquete.id);
    const jogadoras = db.prepare('SELECT id, nome, papel, ativo FROM jogadores ORDER BY id').all();
    return crypto.createHash('sha256').update(JSON.stringify({
        enquete: { id: enquete.id, message_id: enquete.message_id, group_id: enquete.group_id, titulo: enquete.titulo, vagas_maximo: enquete.vagas_maximo, fechada_em: enquete.fechada_em },
        votos, jogadoras, ausentes: getAusentesDaEnquete(enquete.id),
    })).digest('hex');
}
function resolverNomes(lista, enquete) {
    const jogadoras = db.prepare('SELECT id, nome, papel FROM jogadores').all();
    const votos = db.prepare('SELECT jogador_id, papel FROM votos WHERE enquete_id = ?').all(enquete.id);
    function resolver(nome, secao) {
        const candidatas = jogadoras.filter(j => normalizar(j.nome) === normalizar(nome));
        if (candidatas.length > 1) throw new ErroLista('Há jogadoras com o mesmo nome. Diferencie os nomes no cadastro antes de importar.');
        const jogadora = candidatas[0];
        if (!jogadora && jogadoras.some(j => normalizar(j.nome).startsWith(normalizar(nome) + ' '))) {
            throw new ErroLista('Há um nome abreviado que pode ser de uma jogadora cadastrada. Use o nome completo para evitar duplicidade.');
        }
        const papel = jogadora ? votos.find(v => v.jogador_id === jogadora.id)?.papel || jogadora.papel : 'avulso';
        if (secao !== 'espera' && papel !== secao) lista.avisos.push('As seções serão ajustadas aos vínculos registrados; convidadas novas entram como avulsas.');
        return { nome: jogadora?.nome || nome, id: jogadora?.id || null, papel, espera: secao === 'espera' };
    }
    const entradas = [...lista.confirmadas.map(j => resolver(j.nome, j.papel)), ...lista.espera.map(nome => resolver(nome, 'espera'))];
    const ids = entradas.filter(j => j.id).map(j => j.id);
    if (new Set(ids).size !== ids.length) throw new ErroLista('Uma jogadora aparece mais de uma vez.');
    if (enquete.vagas_maximo && lista.confirmadas.length > enquete.vagas_maximo) throw new ErroLista('A lista ultrapassa o limite de vagas deste jogo.');
    const alocadas = [...entradas.filter(j => j.papel === 'mensalista'), ...entradas.filter(j => j.papel === 'avulso')]
        .slice(0, enquete.vagas_maximo || entradas.length);
    if (alocadas.some(j => j.espera) || entradas.some(j => !j.espera && !alocadas.includes(j))) {
        throw new ErroLista('A divisão entre confirmadas e espera contraria as vagas ou a prioridade das mensalistas. Confira as seções.');
    }
    return entradas;
}
function montarPreviaLista({ texto, messageId, grupo, autor, agora = Date.now() }) {
    return db.transaction(() => {
        const enquete = contexto(grupo, autor);
        if (typeof messageId !== 'string' || !messageId) throw new ErroLista('Mensagem sem identificação. Reenvie a lista.');
        if (db.prepare('SELECT 1 FROM listas_importacoes WHERE message_id = ?').get(messageId)) return null;
        const lista = interpretarLista(texto);
        if (normalizar(lista.titulo) !== normalizar(enquete.titulo)) throw new ErroLista('Essa lista é de outro jogo. Use o título completo da enquete atual.');
        const entradas = resolverNomes(lista, enquete);
        const atuais = getConfirmadosDaEnquete(enquete.id);
        const esperaAtual = getListaDeEsperaDaEnquete(enquete.id);
        const selecionadas = entradas.filter(j => !j.espera);
        const entrando = selecionadas.filter(j => !atuais.some(a => a.id === j.id));
        const saindo = atuais.filter(j => !selecionadas.some(a => a.id === j.id));
        const removidasEspera = esperaAtual.filter(j => !entradas.some(a => a.id === j.id));
        const entrandoEspera = entradas.filter(j => j.espera && !esperaAtual.some(a => a.id === j.id));
        if (!entrando.length && !saindo.length && !removidasEspera.length && !entrandoEspera.length) {
            db.prepare("UPDATE listas_importacoes SET estado = 'cancelada' WHERE grupo_id = ? AND autor_id = ? AND estado = 'pendente'").run(grupo, autor);
            return null;
        }
        const proposta = { entradas, assinatura: assinatura(enquete) };
        const prazo = Math.max(1, Math.min(60, Number(getConfig('lista_importacao_prazo_minutos')) || 10));
        db.prepare("UPDATE listas_importacoes SET estado = 'substituida' WHERE grupo_id = ? AND autor_id = ? AND estado = 'pendente'").run(grupo, autor);
        db.prepare('INSERT INTO listas_importacoes (message_id, grupo_id, autor_id, enquete_id, dados, criado_em, expira_em) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(messageId, grupo, autor, enquete.id, JSON.stringify(proposta), agora, agora + prazo * 60000);
        const linha = (titulo, pessoas) => pessoas.length ? `${titulo}: ${pessoas.map(j => j.nome).join(', ')}.` : '';
        return [
            '*Correção da lista — prévia*',
            ...new Set(lista.avisos),
            linha('Entram nas vagas', entrando), linha('Saem das vagas', saindo),
            linha('Entram na espera', entrandoEspera), linha('Retiradas da espera', removidasEspera),
            linha('Novas convidadas avulsas', entradas.filter(j => !j.id)),
            `Após a correção: ${selecionadas.length} com vaga e ${entradas.filter(j => j.espera).length} na espera.`,
            'Vínculos mensais, pagamentos e faltas de quem continua na lista serão preservados. Novas convidadas serão cadastradas como avulsas, sem telefone; até serem avaliadas, usam o nível padrão do cadastro no sorteio.',
            `Envie !confirmarlista em até ${prazo} minutos para aplicar ou !cancelarlista para descartar. Só quem enviou esta lista pode confirmar.`
        ].filter(Boolean).join('\n\n');
    }).immediate();
}
function prepararLista(args) {
    const resultado = db.transaction(() => {
        try { return montarPreviaLista(args); }
        catch (erro) {
            // Uma nova lista inválida não pode deixar a prévia anterior confirmável.
            if (args.grupo === getConfig('enquete_grupo_id') && podeUsarComandos(args.autor)) {
                db.prepare("UPDATE listas_importacoes SET estado = 'cancelada' WHERE grupo_id = ? AND autor_id = ? AND estado = 'pendente'").run(args.grupo, args.autor);
            }
            return { erro };
        }
    }).immediate();
    if (resultado?.erro) throw resultado.erro;
    return resultado;
}
function confirmarLista({ grupo, autor, agora = Date.now() }) {
    return db.transaction(() => {
        const enquete = contexto(grupo, autor);
        const pendente = db.prepare("SELECT * FROM listas_importacoes WHERE grupo_id = ? AND autor_id = ? AND estado = 'pendente' ORDER BY criado_em DESC, rowid DESC LIMIT 1").get(grupo, autor);
        if (!pendente) throw new ErroLista('Você não tem uma correção pendente. Reenvie a lista editada.');
        if (agora > pendente.expira_em) throw new ErroLista('A prévia expirou. Reenvie a lista editada.');
        const proposta = JSON.parse(pendente.dados);
        if (pendente.enquete_id !== enquete.id || proposta.assinatura !== assinatura(enquete)) throw new ErroLista('O jogo ou os dados mudaram desde a prévia. Reenvie a lista para conferir as diferenças.');
        const entradas = proposta.entradas.map(j => ({ ...j }));
        for (const j of entradas.filter(j => !j.id)) {
            j.id = Number(db.prepare("INSERT INTO jogadores (nome, papel) VALUES (?, 'avulso')").run(j.nome).lastInsertRowid);
            registrarMudancaPapel(j.id, null, 'avulso');
        }
        const ids = new Set(entradas.map(j => j.id));
        const anteriores = db.prepare('SELECT jogador_id FROM votos WHERE enquete_id = ? AND papel IS NOT NULL').all(enquete.id);
        for (const j of anteriores.filter(j => !ids.has(j.jogador_id))) {
            db.prepare('DELETE FROM votos WHERE enquete_id = ? AND jogador_id = ?').run(enquete.id, j.jogador_id);
            marcarVotoManual(enquete.id, j.jogador_id, agora);
        }
        entradas.forEach((j, i) => {
            db.prepare(`INSERT INTO votos (enquete_id, jogador_id, opcao, papel, ordem_manual)
                VALUES (?, ?, 'Confirmada por lista no WhatsApp', ?, ?)
                ON CONFLICT(enquete_id, jogador_id) DO UPDATE SET opcao = excluded.opcao, votado_em = CASE WHEN votos.papel IS NULL THEN datetime('now') ELSE votos.votado_em END, papel = excluded.papel, ordem_manual = excluded.ordem_manual`)
                .run(enquete.id, j.id, j.papel, i);
            marcarVotoManual(enquete.id, j.id, agora);
        });
        const comVaga = new Set(getConfirmadosDaEnquete(enquete.id).map(j => j.id));
        if (entradas.some(j => j.espera === comVaga.has(j.id))) throw new ErroLista('As vagas mudaram. Reenvie a lista para conferir novamente.');
        setAusentesDaEnquete(enquete.id, getAusentesDaEnquete(enquete.id).filter(id => comVaga.has(id)));
        db.prepare("UPDATE listas_importacoes SET estado = 'aplicada' WHERE message_id = ?").run(pendente.message_id);
        db.prepare("UPDATE listas_importacoes SET estado = 'substituida' WHERE enquete_id = ? AND estado = 'pendente'").run(enquete.id);
        registrarLog('lista', 'sucesso', `Lista corrigida pelo WhatsApp: ${comVaga.size} com vaga, ${entradas.length - comVaga.size} na espera.`);
        return 'Lista corrigida. Use !lista para conferir e !times para montar e enviar os times com as alterações.';
    }).immediate();
}
function cancelarLista({ grupo, autor }) {
    contexto(grupo, autor);
    db.prepare("UPDATE listas_importacoes SET estado = 'cancelada' WHERE grupo_id = ? AND autor_id = ? AND estado = 'pendente'").run(grupo, autor);
    return 'Correção descartada. A lista do jogo não foi alterada.';
}
module.exports = { ErroLista, pareceLista, interpretarLista, prepararLista, confirmarLista, cancelarLista };

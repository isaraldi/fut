const db = require('../../loaders/database');
const consultas = require('../repositories/fut.repository');
const { DEFAULT_CONFIG, PUBLICOS_JOGADORAS } = require('../../config/defaults');

function marcarVotoManual(enqueteId, jogadorId, agora = Date.now()) {
    const enquete = consultas.marcarVotoManualConsulta1().get(enqueteId);
    if (!enquete) return;
    consultas.marcarVotoManualConsulta2().run(enquete.message_id, jogadorId, agora);
}

function getAusentesDaEnquete(enqueteId) {
    try {
        const dado = JSON.parse(getConfig('times_ausentes') || 'null');
        return dado && dado.enquete_id === enqueteId && Array.isArray(dado.ids) ? dado.ids : [];
    } catch (err) {
        return [];
    }
}

function setAusentesDaEnquete(enqueteId, ids) {
    setConfig('times_ausentes', JSON.stringify({ enquete_id: enqueteId, ids }));
}

function getConfig(chave) {
    const row = consultas.getConfigConsulta3()
        .get(chave);
    if (row) return row.valor;
    return DEFAULT_CONFIG[chave] ?? null;
}

function setConfig(chave, valor) {
    consultas.setConfigConsulta4().run(chave, valor);
}

function registrarLog(tipo, nivel, mensagem, grupoId = null) {
    consultas.registrarLogConsulta5().run(tipo, nivel, mensagem, grupoId);
    consultas.registrarLogConsulta6().run();
}

function getLogs(tipo, limite = 200, offset = 0) {
    const query = tipo
        ? consultas.getLogsConsulta7()
        : consultas.getLogsConsulta8();
    return tipo ? query.all(tipo, limite, offset) : query.all(limite, offset);
}

function contarLogs(tipo) {
    const query = tipo
        ? consultas.contarLogsConsulta9()
        : consultas.contarLogsConsulta10();
    return (tipo ? query.get(tipo) : query.get()).c;
}

function criarEnvioImediato(grupoId, texto, tipo) {
    consultas.criarEnvioImediatoConsulta11().run(grupoId, texto, tipo);
}

function getDestinatariasPorPublico(publico) {
    if (publico === 'renovaram') {
        const ultimo = getCicloMensalAtual();
        if (!ultimo) return [];
        return consultas.getDestinatariasPorPublicoConsulta12()
            .all(ultimo.message_id);
    }
    if (publico === 'mensalistas') {
        return consultas.getDestinatariasPorPublicoConsulta13()
            .all();
    }
    if (publico === 'avulsas_confirmadas') {
        const enquete = consultas.getDestinatariasPorPublicoConsulta14().get();
        if (!enquete) return [];
        const ids = getConfirmadosDaEnquete(enquete.id).filter((j) => j.papel === 'avulso').map((j) => j.id);
        if (ids.length === 0) return [];
        return consultas.getDestinatariasPorPublicoConsulta15(ids.map(() => '?').join(','))
            .all(...ids);
    }
    return [];
}

function enfileirarMensagemJogadora(jogadorId, texto) {
    consultas.enfileirarMensagemJogadoraConsulta16().run(jogadorId, texto);
}

function getMensagensJogadorasPendentes() {
    return consultas.getMensagensJogadorasPendentesConsulta17()
        .all();
}

function removerMensagemJogadora(id) {
    consultas.removerMensagemJogadoraConsulta18().run(id);
}

function getEnviosImediatosPendentes() {
    return consultas.getEnviosImediatosPendentesConsulta19().all();
}

function removerEnvioImediato(id) {
    consultas.removerEnvioImediatoConsulta20().run(id);
}

function fecharEnquete(enqueteId) {
    consultas.fecharEnqueteConsulta21().run(enqueteId);
}

function getEnquetesFechadasNaoDesafixadas() {
    return consultas.getEnquetesFechadasNaoDesafixadasConsulta22()
        .all();
}

function marcarEnqueteDesafixada(enqueteId) {
    consultas.marcarEnqueteDesafixadaConsulta23().run(enqueteId);
}

function registrarTentativaDesafixar(enqueteId) {
    consultas.registrarTentativaDesafixarConsulta24().run(enqueteId);
}

function upsertGrupo(whatsappId, nome) {
    consultas.upsertGrupoConsulta25().run(whatsappId, nome);
}

function getGrupos() {
    return consultas.getGruposConsulta26().all();
}

function getEnqueteOpcoes() {
    return consultas.getEnqueteOpcoesConsulta27()
        .all();
}

function criarMensagemUnica(grupoId, texto, enviarEm) {
    consultas.criarMensagemUnicaConsulta28().run(grupoId, texto, enviarEm);
}

function criarMensagemSemanal(grupoId, texto, diaSemana, hora) {
    consultas.criarMensagemSemanalConsulta29().run(grupoId, texto, diaSemana, hora);
}

function getMensagemAgendada(id) {
    return consultas.getMensagemAgendadaConsulta30().get(id);
}

function atualizarMensagemUnica(id, grupoId, texto, enviarEm) {
    consultas.atualizarMensagemUnicaConsulta31().run(grupoId, texto, enviarEm, id);
}

function atualizarMensagemSemanal(id, grupoId, texto, diaSemana, hora) {
    consultas.atualizarMensagemSemanalConsulta32().run(grupoId, texto, diaSemana, hora, id);
}

function getMensagensAgendadas() {
    return consultas.getMensagensAgendadasConsulta33()
        .all();
}

function getMensagensUnicasParaEnviar() {
    const agora = new Date();
    const agoraLocal = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')} ${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
    return consultas.getMensagensUnicasParaEnviarConsulta34()
        .all(agoraLocal);
}

function getMensagensSemanais() {
    return consultas.getMensagensSemanaisConsulta35().all();
}

function marcarMensagemEnviada(id) {
    consultas.marcarMensagemEnviadaConsulta36().run(id);
}

function marcarMensagemSemanalEnviada(id, dataLocal) {
    consultas.marcarMensagemSemanalEnviadaConsulta37().run(dataLocal, id);
}

function excluirMensagemAgendada(id) {
    consultas.excluirMensagemAgendadaConsulta38().run(id);
}

function marcarPagamentoMensalista(jogadorId, mesReferencia) {
    definirPagamentoCaixa('mensal', jogadorId, mesReferencia, true, 'comprovante');
}

function getMensalistasPagos(mesReferencia) {
    return consultas.getMensalistasPagosConsulta39()
        .all(mesReferencia);
}

function criarConviteFechamentoMensal(jogadorId, messageId, mesAnteriorRef) {
    consultas.criarConviteFechamentoMensalConsulta40().run(jogadorId, messageId, mesAnteriorRef);
}

function getConviteFechamentoMensal(messageId, jogadorId) {
    return consultas.getConviteFechamentoMensalConsulta41()
        .get(messageId, jogadorId);
}

function registrarRespostaConviteFechamentoMensal(id, resposta) {
    consultas.registrarRespostaConviteFechamentoMensalConsulta42().run(resposta, id);
}

function criarCicloMensal(messageId, mesAnteriorRef, prazoHoras) {
    return db.transaction(() => {
        const agora = Date.now();
        consultas.criarCicloMensalConsulta43()
            .run(messageId, mesAnteriorRef, agora, agora + prazoHoras * 3600000);
        const mensalistas = consultas.criarCicloMensalConsulta44().all();
        for (const j of mensalistas) criarConviteFechamentoMensal(j.id, messageId, mesAnteriorRef);
    }).immediate();
}

function getCicloMensalAtual() {
    return consultas.getCicloMensalAtualConsulta45().get();
}

function expirarRenovacoesMensais(agora = Date.now()) {
    return db.transaction(() => {
        const ciclo = getCicloMensalAtual();
        if (!ciclo || agora < ciclo.prazo_em) return;
        const pendentes = consultas.expirarRenovacoesMensaisConsulta46().all(ciclo.message_id);
        for (const c of pendentes) {
            registrarRespostaConviteFechamentoMensal(c.id, 'nao');
            consultas.expirarRenovacoesMensaisConsulta47().run(c.id);
            definirPapelJogador(c.jogador_id, 'avulso');
            registrarLog('mensagem', 'sucesso', `Jogadora ${c.jogador_id}: prazo de renovação encerrado — virou avulsa.`);
        }
    }).immediate();
}

function responderChamadaMensal(messageId, jogadorId, resposta, agora = Date.now(), recuperada = false) {
    return db.transaction(() => {
        const ciclo = getCicloMensalAtual();
        if (!ciclo || ciclo.message_id !== messageId) return false;
        expirarRenovacoesMensais(agora);
        const jogadora = consultas.responderChamadaMensalConsulta48().get(jogadorId);
        if (!jogadora) return false;
        let convite = getConviteFechamentoMensal(messageId, jogadorId);
        if (!convite) {
            if (resposta !== 'sim') return false;
            consultas.responderChamadaMensalConsulta49().run(jogadorId, messageId, ciclo.mes_anterior);
            convite = getConviteFechamentoMensal(messageId, jogadorId);
        }
        if (convite.resposta === resposta) {
            // Uma desistência recebida depois da expiração não pode parecer só prazo vencido.
            if (convite.expirada && resposta === 'nao') {
                consultas.responderChamadaMensalConsulta50().run(convite.id);
            }
            return true; // repetição não muda posição/horário
        }
        const prioridade = convite.prioridade === 1 &&
            (convite.resposta === null || (recuperada && convite.expirada === 1)) && agora < ciclo.prazo_em;
        const ordem = resposta === 'sim' && !prioridade
            ? consultas.responderChamadaMensalConsulta51().get().n : convite.ordem;
        consultas.responderChamadaMensalConsulta52().run(resposta, prioridade ? 1 : 0, ordem,
                new Date(agora).toISOString().slice(0, -1), convite.id);
        if (resposta === 'sim' && !prioridade) {
            const fila = consultas.responderChamadaMensalConsulta53().all(messageId);
            const ordenar = consultas.responderChamadaMensalConsulta54();
            fila.forEach((item, i) => ordenar.run(i + 1, item.id));
        }
        if (resposta === 'nao') definirPapelJogador(jogadorId, 'avulso');
        else if (prioridade) definirPapelJogador(jogadorId, 'mensalista');
        registrarLog('mensagem', 'sucesso', `${jogadora.nome}: ${resposta === 'nao' ? 'desistiu do mensal' : prioridade ? 'renovou o mensal' : 'entrou na fila do mensal'}.`);
        return true;
    }).immediate();
}

function getResumoMensal(agora = Date.now()) {
    expirarRenovacoesMensais(agora);
    const ciclo = getCicloMensalAtual();
    if (!ciclo) return null;
    const participantes = consultas.getResumoMensalConsulta55().all(ciclo.message_id);
    const [ano, mes] = ciclo.mes_anterior.split('-').map(Number);
    const proximo = new Date(ano, mes, 1);
    return { ciclo, mesNovo: `${proximo.getFullYear()}-${String(proximo.getMonth() + 1).padStart(2, '0')}`,
        renovadas: participantes.filter(c => c.prioridade && c.resposta === 'sim'),
        pendentes: participantes.filter(c => c.prioridade && c.resposta === null),
        aprovadas: participantes.filter(c => c.aprovada && c.resposta === 'sim'),
        fila: participantes.filter(c => !c.prioridade && !c.aprovada && c.resposta === 'sim'),
        desistencias: participantes.filter(c => c.resposta === 'nao') };
}

function aprovarInteressadaMensal(conviteId) {
    return db.transaction(() => {
        const resumo = getResumoMensal();
        if (!resumo || resumo.pendentes.length || resumo.fila[0]?.id !== conviteId) return false;
        const convite = resumo.fila[0];
        definirPapelJogador(convite.jogador_id, 'mensalista');
        consultas.aprovarInteressadaMensalConsulta56().run(conviteId);
        registrarLog('mensagem', 'sucesso', `${convite.nome}: entrada no mensal aprovada pela organização.`);
        return true;
    }).immediate();
}

function definirPapelJogador(jogadorId, papelNovo) {
    const atual = consultas.definirPapelJogadorConsulta57().get(jogadorId);
    if (!atual || atual.papel === papelNovo) return false;
    consultas.definirPapelJogadorConsulta58().run(papelNovo, jogadorId);
    registrarMudancaPapel(jogadorId, atual.papel, papelNovo);
    return true;
}

function marcarPagamentoAvulso(jogadorId, enqueteId) {
    definirPagamentoCaixa('avulso', jogadorId, enqueteId, true, 'comprovante');
}

function getJogadorPorWhatsappId(whatsappId) {
    return consultas.getJogadorPorWhatsappIdConsulta59().get(whatsappId);
}

function podeUsarComandos(whatsappId) {
    const jogador = consultas.podeUsarComandosConsulta60()
        .get(whatsappId);
    return !!(jogador && jogador.pode_comandar);
}

function getJogadoresParaPermissao() {
    return consultas.getJogadoresParaPermissaoConsulta61()
        .all();
}

function definirPermissaoComando(jogadorId, pode) {
    consultas.definirPermissaoComandoConsulta62().run(pode ? 1 : 0, jogadorId);
}

function reativarJogador(jogadorId) {
    consultas.reativarJogadorConsulta63().run(jogadorId);
}

function registrarMudancaPapel(jogadorId, papelAnterior, papelNovo) {
    consultas.registrarMudancaPapelConsulta64().run(jogadorId, papelAnterior, papelNovo);
}

function getPapelHistorico(jogadorId) {
    return consultas.getPapelHistoricoConsulta65()
        .all(jogadorId);
}

function separarConfirmadosPorVagas(enqueteId) {
    const todos = consultas.separarConfirmadosPorVagasConsulta66()
        .all(enqueteId);

    const { vagas_maximo: vagasMaximo } =
        consultas.separarConfirmadosPorVagasConsulta67().get(enqueteId) || {};

    const porNome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR');
    const porOrdemDeChegada = (a, b) => {
        const manualA = Number.isInteger(a.ordem_manual);
        const manualB = Number.isInteger(b.ordem_manual);
        if (manualA && manualB) return a.ordem_manual - b.ordem_manual;
        if (manualA !== manualB) return manualA ? -1 : 1;
        return a.votado_em.localeCompare(b.votado_em);
    };

    // exibição: mensalistas sempre em ordem alfabética; avulsas sempre por ordem de
    // confirmação na enquete (e a lista de espera herda essa mesma ordem, automaticamente)
    const paraExibicao = (lista) => [
        ...lista.filter((j) => j.papel === 'mensalista').sort(porNome),
        ...lista.filter((j) => j.papel === 'avulso').sort(porOrdemDeChegada),
    ];

    if (!vagasMaximo) {
        return { dentro: paraExibicao(todos), fora: [] };
    }

    // alocação das vagas: sempre por ordem de chegada, mensalista primeiro
    const fila = [
        ...todos.filter((j) => j.papel === 'mensalista').sort(porOrdemDeChegada),
        ...todos.filter((j) => j.papel === 'avulso').sort(porOrdemDeChegada),
    ];

    return {
        dentro: paraExibicao(fila.slice(0, vagasMaximo)),
        fora: paraExibicao(fila.slice(vagasMaximo)),
    };
}

function getConfirmadosDaEnquete(enqueteId) {
    return separarConfirmadosPorVagas(enqueteId).dentro;
}

function getListaDeEsperaDaEnquete(enqueteId) {
    return separarConfirmadosPorVagas(enqueteId).fora;
}

function getAvaliacoesDaEnquete(enqueteId) {
    return consultas.getAvaliacoesDaEnqueteConsulta68()
        .all(enqueteId);
}

function recalcularNivel(jogadorId) {
    const { media } = consultas.recalcularNivelConsulta69()
        .get(jogadorId);
    if (media == null) return;

    const nivel = Math.min(5, Math.max(1, Math.round(media)));
    consultas.recalcularNivelConsulta70().run(nivel, jogadorId);
}

function registrarAvaliacao(enqueteId, jogadorId, avaliadorId, nota) {
    consultas.registrarAvaliacaoConsulta71().run(enqueteId, jogadorId, avaliadorId, nota);

    recalcularNivel(jogadorId);
}

function limparNome(nome) {
    const limpo = String(nome || '')
        .replace(/\p{Extended_Pictographic}/gu, '')
        .replace(/[\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
    return limpo || 'Jogador';
}

function upsertJogador(whatsappId, nome, papelSugerido, telefone) {
    const existente = consultas.upsertJogadorConsulta72()
        .get(whatsappId);

    if (existente) {
        // nome não é sincronizado depois da primeira importação — só a criação pega do
        // WhatsApp, edição manual no painel não pode ser sobrescrita depois.
        // telefone segue a mesma lógica: só preenche se ainda não tiver.
        if (telefone && !existente.telefone) {
            consultas.upsertJogadorConsulta73().run(
                telefone,
                existente.id,
            );
        }
        return existente.id;
    }

    const papelInicial = papelSugerido || 'avulso';
    const info = consultas.upsertJogadorConsulta74()
        .run(limparNome(nome), whatsappId, telefone || null, papelInicial);
    registrarMudancaPapel(info.lastInsertRowid, null, papelInicial);
    return info.lastInsertRowid;
}

function dinheiroCentavos(valor, permitirNegativo = false) {
    const texto = String(valor ?? '').trim().replace(',', '.');
    if (!(permitirNegativo ? /^-?\d{1,9}(\.\d{1,2})?$/ : /^\d{1,9}(\.\d{1,2})?$/).test(texto)) {
        throw new Error('Informe um valor válido com até duas casas decimais.');
    }
    const centavos = Math.round(Number(texto) * 100);
    if (!permitirNegativo && centavos <= 0) throw new Error('O valor deve ser maior que zero.');
    return centavos;
}

function dataCaixaAtual() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

function iniciarCaixa(saldo) {
    return db.transaction(() => {
        if (getConfig('caixa_ativo') === '1') throw new Error('O caixa já foi iniciado.');
        const centavos = dinheiroCentavos(saldo, true);
        // Ambos os valores precisam estar definidos para registrar os próximos pagamentos.
        for (const [chave, nome] of [['valor_mensal', 'mensalidade'], ['valor_avulso', 'avulsa']]) {
            try { dinheiroCentavos(getConfig(chave)); }
            catch { throw new Error(`Configure um valor válido de ${nome} em Regras do jogo antes de iniciar.`); }
        }
        consultas.iniciarCaixaConsulta75().run(dataCaixaAtual(), centavos);
        setConfig('caixa_ativo', '1');
    }).immediate();
}

function lancarCaixa({ tipo, valor, data, descricao, categoria }) {
    if (getConfig('caixa_ativo') !== '1') throw new Error('Inicie o caixa primeiro.');
    if (!['entrada', 'gasto'].includes(tipo)) throw new Error('Escolha entrada ou gasto.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data || '') || !Number.isFinite(Date.parse(data + 'T12:00:00Z')) ||
        new Date(data + 'T12:00:00Z').toISOString().slice(0, 10) !== data) throw new Error('Informe uma data válida.');
    if (!descricao?.trim() || descricao.trim().length > 160) throw new Error('Informe uma descrição de até 160 caracteres.');
    const categorias = ['Outras entradas', 'Quadra', 'Materiais', 'Eventos', 'Outros gastos'];
    if (!categorias.includes(categoria)) throw new Error('Escolha uma categoria válida.');
    return consultas.lancarCaixaConsulta76().run(data, tipo, dinheiroCentavos(valor), descricao.trim(), categoria);
}

function cancelarLancamentoCaixa(id) {
    const resultado = consultas.cancelarLancamentoCaixaConsulta77().run(id);
    if (!resultado.changes) throw new Error('Lançamento indisponível. Para pagamentos, corrija a situação na página Pagamentos.');
}

function definirPagamentoCaixa(tipo, jogadorId, referencia, pago, origemRegistro = 'manual') {
    if (!['mensal', 'avulso'].includes(tipo)) throw new Error('Tipo de pagamento inválido.');
    if (!['manual', 'comprovante'].includes(origemRegistro)) throw new Error('Origem de pagamento inválida.');
    return db.transaction(() => {
        const tabela = tipo === 'mensal' ? 'pagamentos' : 'pagamentos_avulsos';
        const coluna = tipo === 'mensal' ? 'mes_referencia' : 'enquete_id';
        const atual = consultas.definirPagamentoCaixaConsulta78(tabela, coluna).get(jogadorId, referencia);
        const novoPago = pago === undefined ? !atual?.pago : !!pago;
        if (!!atual?.pago === novoPago) return;
        let id = atual?.id;
        if (atual) consultas.definirPagamentoCaixaConsulta79(tabela).run(Number(novoPago), id);
        else id = consultas.definirPagamentoCaixaConsulta80(tabela, coluna).run(jogadorId, referencia, Number(novoPago)).lastInsertRowid;
        const origem = tipo + ':' + id;
        if (!novoPago) {
            consultas.definirPagamentoCaixaConsulta81().run(origem);
        } else if (getConfig('caixa_ativo') === '1') {
            const existente = consultas.definirPagamentoCaixaConsulta82().get(origem);
            if (existente) consultas.definirPagamentoCaixaConsulta83().run(existente.id);
            else {
                let valor;
                try { valor = dinheiroCentavos(getConfig(tipo === 'mensal' ? 'valor_mensal' : 'valor_avulso')); }
                catch { throw new Error('Configure o valor do pagamento em Regras do jogo. Nenhuma alteração foi salva.'); }
                const jogadora = consultas.definirPagamentoCaixaConsulta84().get(jogadorId);
                const descricao = tipo === 'mensal' ? `Mensalidade ${referencia} — ${jogadora.nome}` : `Avulsa · jogo #${referencia} — ${jogadora.nome}`;
                consultas.definirPagamentoCaixaConsulta85().run(dataCaixaAtual(), valor, descricao, tipo === 'mensal' ? 'Mensalidades' : 'Avulsas', origem);
            }
        }
        const jogadora = consultas.definirPagamentoCaixaConsulta86().get(jogadorId);
        const jogo = tipo === 'avulso' ? consultas.definirPagamentoCaixaConsulta87().get(referencia)?.titulo : null;
        let valor = consultas.definirPagamentoCaixaConsulta88().get(origem)?.valor_centavos ?? null;
        if (valor === null && novoPago) {
            try { valor = dinheiroCentavos(getConfig(tipo === 'mensal' ? 'valor_mensal' : 'valor_avulso')); }
            catch { /* Sem preço configurado, registra o pagamento sem estimar o valor. */ }
        }
        consultas.definirPagamentoCaixaConsulta89().run(jogadorId, jogadora.nome, tipo, String(referencia), jogo, Number(novoPago), origemRegistro, valor);
    }).immediate();
}

require('../models/schema')(db, getConfig, setConfig);

module.exports = {
    dinheiroCentavos, dataCaixaAtual, iniciarCaixa, lancarCaixa, cancelarLancamentoCaixa, definirPagamentoCaixa,
    marcarVotoManual,
    criarCicloMensal, getCicloMensalAtual, expirarRenovacoesMensais, responderChamadaMensal, getResumoMensal, aprovarInteressadaMensal,
    db,
    upsertJogador,
    getConfig,
    setConfig,
    getAusentesDaEnquete,
    setAusentesDaEnquete,
    upsertGrupo,
    getGrupos,
    registrarLog,
    getLogs,
    contarLogs,
    criarEnvioImediato,
    PUBLICOS_JOGADORAS,
    getDestinatariasPorPublico,
    enfileirarMensagemJogadora,
    getMensagensJogadorasPendentes,
    removerMensagemJogadora,
    getEnviosImediatosPendentes,
    removerEnvioImediato,
    fecharEnquete,
    getEnquetesFechadasNaoDesafixadas,
    marcarEnqueteDesafixada,
    registrarTentativaDesafixar,
    getEnqueteOpcoes,
    criarMensagemUnica,
    criarMensagemSemanal,
    getMensagemAgendada,
    atualizarMensagemUnica,
    atualizarMensagemSemanal,
    getMensagensAgendadas,
    getMensagensUnicasParaEnviar,
    getMensagensSemanais,
    marcarMensagemEnviada,
    marcarMensagemSemanalEnviada,
    excluirMensagemAgendada,
    marcarPagamentoMensalista,
    marcarPagamentoAvulso,
    getMensalistasPagos,
    criarConviteFechamentoMensal,
    getConviteFechamentoMensal,
    registrarRespostaConviteFechamentoMensal,
    definirPapelJogador,
    getJogadorPorWhatsappId,
    podeUsarComandos,
    getJogadoresParaPermissao,
    definirPermissaoComando,
    reativarJogador,
    registrarMudancaPapel,
    getPapelHistorico,
    getConfirmadosDaEnquete,
    getListaDeEsperaDaEnquete,
    getAvaliacoesDaEnquete,
    registrarAvaliacao,
};

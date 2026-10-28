const path = require('path');
const fs = require('fs');
const { public: publicDir } = require('../../config/paths');

const { db, getConfig, setConfig, getGrupos, getEnqueteOpcoes } = require('./fut.service');

const consultas = require('../repositories/configuracoes.repository');
const { sucesso, salvarJogadora, salvarConfiguracao, configuracoesPorPagina } = require('./painel-support.service');

function postConfiguracoesSalvar(entrada) {
    const pagina = entrada.body.pagina;
    const permitidas = Object.hasOwn(configuracoesPorPagina, pagina) ? configuracoesPorPagina[pagina] : null;
    if (!permitidas) return ({ json: { erro: 'Página de configurações inválida.' }, status: 400 });
    let alteracoes;
    try {
        alteracoes = JSON.parse(entrada.body.alteracoes);
    } catch {
        return ({ json: { erro: 'Não foi possível ler as alterações.' }, status: 400 });
    }
    if (!Array.isArray(alteracoes) || !alteracoes.length || alteracoes.length > 100) {
        return ({ json: { erro: 'Selecione as configurações que deseja salvar.' }, status: 400 });
    }
    // Valida o lote inteiro antes de escrever. As mudanças são confirmadas juntas.
    const validas = alteracoes.every(item => item && typeof item.action === 'string' &&
        item.campos && typeof item.campos === 'object' && !Array.isArray(item.campos) &&
        Object.values(item.campos).every(valor => typeof valor === 'string') &&
        (permitidas.includes(item.action) || (pagina === '/elenco' && /^\/elenco\/\d+\/atualizar$/.test(item.action)) || (pagina === '/enquete/config' && /^\/enquete\/config\/opcoes\/\d+$/.test(item.action))));
    if (!validas) return ({ json: { erro: 'Há configurações inválidas. Recarregue a página.' }, status: 400 });
    try {
        db.transaction(() => {
            for (const { action, campos } of alteracoes) {
                if (salvarConfiguracao[action]) salvarConfiguracao[action](campos);
                else if (pagina === '/elenco') salvarJogadora(Number(action.split('/')[2]), campos);
                else {
                    if (!campos.texto?.trim()) throw new Error('Opção sem texto');
                    const id = Number(action.split('/').pop());
                    const resultado = consultas.postConfiguracoesSalvarConsulta1()
                        .run(campos.texto.trim(), campos.conta === '1' ? 1 : 0, id);
                    if (!resultado.changes) throw new Error('Opção removida');
                }
            }
        }).immediate();
    } catch {
        return ({ json: { erro: 'Nenhuma alteração foi salva. Confira os campos e tente novamente.' }, status: 400 });
    }
    return ({ json: { destino: pagina + '?ok=' + encodeURIComponent('Alterações salvas!') }, status: 200 });
}

function getElencoConfig(entrada) {
    return ({ view: 'elenco-config', dados: {
        usuario: entrada.usuario,
        autoIncluir: getConfig('elenco_auto_incluir_grupo') === '1',
        grupos: getGrupos(),
        ok: entrada.query.ok,
    }, status: 200 });
}

function postElencoConfigSincronizar(entrada) {
    const grupoId = entrada.body.grupoId;
    if (!grupoId) return ({ destino: '/elenco/config' });

    setConfig('sincronizar_grupo_pendente', grupoId);
    return sucesso('/elenco/config', 'Sincronização solicitada! Pode levar até 1 minuto — confira em Logs.');
}

function postElencoConfig(entrada) {
    salvarConfiguracao['/elenco/config'](entrada.body);
    return sucesso('/elenco/config', 'Configuração salva!');
}

function getJogoConfig(entrada) {
    return ({ view: 'jogo-config', dados: {
        usuario: entrada.usuario,
        diaSemana: Number(getConfig('enquete_dia_semana')),
        hora: getConfig('enquete_hora'),
        valorMensal: getConfig('valor_mensal'),
        valorAvulso: getConfig('valor_avulso'),
        vagasMaximo: getConfig('jogo_vagas_maximo'),
        porTime: getConfig('jogo_jogadoras_por_time'),
        timesModo: getConfig('jogo_times_modo'),
        rodizioMinutos: getConfig('jogo_rodizio_minutos'),
        duracaoMinutos: getConfig('jogo_duracao_minutos'),
        ok: entrada.query.ok,
    }, status: 200 });
}

function postJogoConfig(entrada) {
    salvarConfiguracao['/jogo/config'](entrada.body);
    return sucesso('/jogo/config', 'Configurações salvas!');
}

function postJogoConfigTimes(entrada) {
    salvarConfiguracao['/jogo/config/times'](entrada.body);
    return sucesso('/jogo/config', 'Configurações de times salvas!');
}

function getEnqueteConfig(entrada) {
    return ({ view: 'enquete-config', dados: {
        usuario: entrada.usuario,
        titulo: getConfig('enquete_titulo_template'),
        opcoes: getEnqueteOpcoes(),
        autoEnviar: getConfig('enquete_auto_enviar') === '1',
        envioDiaSemana: Number(getConfig('enquete_envio_dia_semana')),
        envioHora: getConfig('enquete_envio_hora'),
        grupos: getGrupos(),
        grupoSelecionado: getConfig('enquete_grupo_id'),
        ok: entrada.query.ok,
    }, status: 200 });
}

function postEnqueteConfigAuto(entrada) {
    salvarConfiguracao['/enquete/config/auto'](entrada.body);
    return sucesso('/enquete/config', 'Envio automático atualizado!');
}

function postEnqueteConfigEnviarAgora(entrada) {
    const grupoId = getConfig('enquete_grupo_id');
    if (!grupoId) {
        return sucesso('/enquete/config', 'Configure o grupo de destino antes de enviar.');
    }
    setConfig('enquete_solicitar_envio', '1');
    return sucesso('/enquete/config', 'Enquete será enviada em até 1 minuto.');
}

function postEnqueteConfigTitulo(entrada) {
    salvarConfiguracao['/enquete/config/titulo'](entrada.body);
    return sucesso('/enquete/config', 'Título salvo!');
}

function postEnqueteConfigOpcoes(entrada) {
    const { texto, conta } = entrada.body;
    if (!texto || !texto.trim()) return ({ destino: '/enquete/config' });

    const proximaOrdem = consultas.postEnqueteConfigOpcoesConsulta2()
        .get().n;

    consultas.postEnqueteConfigOpcoesConsulta3().run(texto.trim(), conta === '1' ? 1 : 0, proximaOrdem);

    return sucesso('/enquete/config', 'Opção adicionada!');
}

function postEnqueteConfigOpcoesId(entrada) {
    const { texto, conta } = entrada.body;
    const id = Number(entrada.params.id);
    if (!texto || !texto.trim()) return ({ destino: '/enquete/config' });

    consultas.postEnqueteConfigOpcoesIdConsulta4().run(texto.trim(), conta === '1' ? 1 : 0, id);

    return sucesso('/enquete/config', 'Opção salva!');
}

function postEnqueteConfigOpcoesIdExcluir(entrada) {
    consultas.postEnqueteConfigOpcoesIdExcluirConsulta5().run(
        Number(entrada.params.id),
    );
    return sucesso('/enquete/config', 'Opção removida.');
}

function getConfiguracoesAparencia(entrada) {
    return ({ view: 'aparencia', dados: {
        usuario: entrada.usuario,
        logoUrl: getConfig('logo_url'),
        ok: entrada.query.ok,
    }, status: 200 });
}

function postConfiguracoesAparenciaLogoRemover(entrada) {
    const atual = getConfig('logo_url');
    if (atual) {
        const caminho = path.join(publicDir, atual.split('?')[0].replace(/^\//, ''));
        if (fs.existsSync(caminho)) fs.unlinkSync(caminho);
    }
    setConfig('logo_url', '');
    return sucesso('/configuracoes/aparencia', 'Logo removida.');
}

module.exports = { postConfiguracoesSalvar, getElencoConfig, postElencoConfigSincronizar, postElencoConfig, getJogoConfig, postJogoConfig, postJogoConfigTimes, getEnqueteConfig, postEnqueteConfigAuto, postEnqueteConfigEnviarAgora, postEnqueteConfigTitulo, postEnqueteConfigOpcoes, postEnqueteConfigOpcoesId, postEnqueteConfigOpcoesIdExcluir, getConfiguracoesAparencia, postConfiguracoesAparenciaLogoRemover };

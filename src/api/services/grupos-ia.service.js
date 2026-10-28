const { getConfig, setConfig, getGrupos } = require('./fut.service');
const { configuracaoGruposIa } = require('./comandos-ia');

function obterGruposIa() {
    const configuracao = configuracaoGruposIa(getConfig);
    const grupos = new Map(getGrupos().map(grupo => [grupo.whatsapp_id, grupo]));
    // Permissões salvas pelo utilitário continuam visíveis mesmo sem nome sincronizado.
    for (const id of configuracao.ids) {
        if (!grupos.has(id)) grupos.set(id, { whatsapp_id: id, nome: id });
    }
    return {
        modo: configuracao.modo,
        ativa: getConfig('llm_mensagens_ativa') === '1',
        grupos: [...grupos.values()].map(grupo => ({
            ...grupo,
            permitido: configuracao.ids.includes(grupo.whatsapp_id),
        })),
    };
}

function salvarGruposIa({ modo, grupos }) {
    if (modo === 'padrao') {
        setConfig('llm_grupos_autorizados', '');
        return null;
    }
    if (modo !== 'selecionados') return 'Escolha como liberar os grupos da IA.';

    const ids = grupos === undefined ? [] : Array.isArray(grupos) ? grupos : [grupos];
    const disponiveis = new Set(obterGruposIa().grupos.map(grupo => grupo.whatsapp_id));
    if (ids.some(id => typeof id !== 'string' || !/^\d+(?:-\d+)?@g\.us$/.test(id) || !disponiveis.has(id))) {
        return 'Há um grupo inválido ou indisponível. Recarregue a página e confira a seleção.';
    }
    setConfig('llm_grupos_autorizados', JSON.stringify([...new Set(ids)]));
    return null;
}

module.exports = { obterGruposIa, salvarGruposIa };

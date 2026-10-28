function jsonParaScript(valor) {
    return JSON.stringify(valor)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026');
}

function formatarDataHora(valorUtc) {
    if (!valorUtc) return '';
    const data = new Date(`${valorUtc.replace(' ', 'T')}Z`);
    if (Number.isNaN(data.getTime())) return valorUtc;
    return data.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

module.exports = { jsonParaScript, formatarDataHora };

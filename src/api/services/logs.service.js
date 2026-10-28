const { getLogs: listarLogs, contarLogs } = require('./fut.service');

function getLogs(entrada) {
    const tipo = ['enquete', 'mensagem', 'comprovante', 'lista', 'times', 'elenco'].includes(entrada.query.tipo) ? entrada.query.tipo : null;
    const LOGS_POR_PAGINA = 50;
    const totalLogs = contarLogs(tipo);
    const totalPaginas = Math.max(1, Math.ceil(totalLogs / LOGS_POR_PAGINA));
    const pagina = Math.min(Math.max(1, Number(entrada.query.pagina) || 1), totalPaginas);

    return ({ view: 'logs', dados: {
        usuario: entrada.usuario,
        logs: listarLogs(tipo, LOGS_POR_PAGINA, (pagina - 1) * LOGS_POR_PAGINA),
        tipo,
        pagina,
        totalPaginas,
    }, status: 200 });
}

module.exports = { getLogs };

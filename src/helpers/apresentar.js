// Traduz o resultado do serviço para a resposta Express.
module.exports = function apresentar(res, resultado) {
    if (resultado.destino !== undefined) return res.redirect(resultado.destino);
    res.status(resultado.status || 200);
    if (resultado.view) return res.render(resultado.view, resultado.dados);
    if (Object.hasOwn(resultado, 'json')) return res.json(resultado.json);
    return res.send(resultado.mensagem);
};

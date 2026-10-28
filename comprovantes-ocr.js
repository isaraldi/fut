const PALAVRAS_COMPROVANTE = [
  'comprovante', 'pix', 'transferência', 'transferencia', 'recibo',
  'pagamento', 'ted', 'boleto', 'transação', 'transacao',
];

function extrairValoresBRL(texto) {
  return Array.from(texto.matchAll(/r\$\s*(\d+(?:\.\d{3})*(?:,\d{2})?)/gi), match =>
    Number(match[1].replace(/\./g, '').replace(',', '.'))).filter(Number.isFinite);
}

function avaliarOcrComprovante(texto, confianca) {
  const normalizado = texto.toLowerCase();
  const valores = extrairValoresBRL(texto);
  const temPalavraChave = PALAVRAS_COMPROVANTE.some(p => normalizado.includes(p));
  const temValor = valores.length > 0;
  const concluido = /(?:pagamento|pix|transfer[eê]ncia|transa[cç][aã]o)\s+(?:realizad[oa]|conclu[ií]d[oa]|efetuad[oa]|confirmad[oa])|realizad[oa]\s+com\s+sucesso/i.test(texto);
  const pendente = /agendad|cancelad|falhou|n[aã]o\s+(?:realizad|conclu|efetuad|confirmad)|pendente|em\s+processamento/i.test(texto);
  const valorUnico = new Set(valores.map(v => Math.round(v * 100))).size === 1;
  return {
    temPalavraChave, temValor, valores,
    seguro: Number.isFinite(confianca) && confianca >= 85 && temPalavraChave
      && temValor && valorUnico && concluido && !pendente,
  };
}

module.exports = { extrairValoresBRL, avaliarOcrComprovante };

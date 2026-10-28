// Executar no mesmo ambiente/volume do bot. Não inicia WhatsApp.
const [acao, endereco] = process.argv.slice(2);
if (!['ativar', 'desativar'].includes(acao)) {
  console.error('Uso: node configurar-llm.js ativar http://IP_WINDOWS:11434 | desativar');
  process.exit(1);
}
if (acao === 'ativar') {
  let url;
  try { url = new URL(endereco); } catch { /* validado abaixo */ }
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    console.error('Informe um endereço HTTP válido, sem credenciais.');
    process.exit(1);
  }
}
const { db, setConfig } = require('./db');
try {
  db.transaction(() => {
    if (acao === 'ativar') {
      setConfig('llm_url', new URL(endereco).origin);
      setConfig('llm_modelo', 'qwen3:4b-instruct');
      setConfig('llm_modelo_visao', 'qwen3-vl:2b-instruct');
    }
    setConfig('llm_mensagens_ativa', acao === 'ativar' ? '1' : '0');
    setConfig('llm_comprovantes_ativa', acao === 'ativar' ? '1' : '0');
  })();
  console.log(acao === 'ativar' ? 'LLM local configurada e ativada.' : 'LLM local desativada; processamento original restaurado.');
} finally {
  db.close();
}

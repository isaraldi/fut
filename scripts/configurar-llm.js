// Executar no mesmo ambiente/volume do bot. Não inicia WhatsApp.
const [acao, endereco, ...outrosGrupos] = process.argv.slice(2);
if (!['ativar', 'desativar', 'grupos'].includes(acao)) {
  console.error('Uso: node scripts/configurar-llm.js ativar http://IP_WINDOWS:11434 | desativar | grupos ID_GRUPO... | grupos nenhum');
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
const grupos = acao === 'grupos' ? (endereco === 'nenhum' && !outrosGrupos.length ? [] : [endereco, ...outrosGrupos]) : null;
if (grupos && grupos.some(id => typeof id !== 'string' || !/^\d+(?:-\d+)?@g\.us$/.test(id))) {
  console.error('Informe IDs de grupos válidos ou use grupos nenhum.');
  process.exit(1);
}
const { db, setConfig } = require('../src/api/services/fut.service');
try {
  db.transaction(() => {
    if (acao === 'grupos') {
      setConfig('llm_grupos_autorizados', JSON.stringify([...new Set(grupos)]));
      return;
    }
    if (acao === 'ativar') {
      setConfig('llm_url', new URL(endereco).origin);
      setConfig('llm_modelo', 'qwen3:4b-instruct');
      setConfig('llm_modelo_visao', 'qwen3-vl:2b-instruct');
    }
    setConfig('llm_mensagens_ativa', acao === 'ativar' ? '1' : '0');
    setConfig('llm_comprovantes_ativa', acao === 'ativar' ? '1' : '0');
  })();
  console.log(acao === 'grupos' ? 'Grupos autorizados da IA atualizados.' : acao === 'ativar' ? 'LLM local configurada e ativada.' : 'LLM local desativada; processamento original restaurado.');
} finally {
  db.close();
}

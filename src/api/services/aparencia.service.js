const path = require('path');
const fs = require('fs');
const { public: publicDir } = require('../../config/paths');
const { getConfig, setConfig } = require('./fut.service');
const { sucesso } = require('./painel-support.service');

function salvarLogo(arquivo) {
    const antiga = getConfig('logo_url');
    if (antiga) {
        const caminhoAntigo = path.join(publicDir, antiga.replace(/^\//, ''));
        if (caminhoAntigo !== arquivo.path && fs.existsSync(caminhoAntigo)) fs.unlinkSync(caminhoAntigo);
    }
    setConfig('logo_url', '/uploads/' + arquivo.filename + '?v=' + Date.now());
    return sucesso('/configuracoes/aparencia', 'Logo atualizada!');
}

module.exports = { salvarLogo };

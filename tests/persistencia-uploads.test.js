// Valida a preparação do storage em diretórios temporários, sem iniciar bot ou painel.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'fut-uploads-'));
try {
    const escrever = (arquivo, texto) => {
        const destino = path.join(temporario, arquivo);
        fs.mkdirSync(path.dirname(destino), { recursive: true });
        fs.writeFileSync(destino, texto);
    };
    const ler = arquivo => fs.readFileSync(path.join(temporario, arquivo), 'utf8');
    escrever('storage/data/banco.txt', 'banco preservado');
    escrever('storage/.wwebjs_auth/sessao.txt', 'autenticacao preservada');
    escrever('storage/uploads/logo.svg', 'logo persistida');
    escrever('panel/public/uploads/logo.svg', 'copia antiga');
    escrever('panel/public/uploads/legada.svg', 'upload legado');
    escrever('public/uploads/nova.svg', 'upload novo');
    const entrada = fs.readFileSync(path.join(__dirname, '../docker-entrypoint.sh'), 'utf8');
    const inicioProcessos = entrada.indexOf('\ngosu node node ');
    assert(inicioProcessos > 0, 'O teste deve executar somente a preparação anterior aos processos');
    const preparar = entrada.slice(0, inicioProcessos)
        .replaceAll('/app', temporario)
        // Permite executar o teste como usuário comum. As operações de disco são reais.
        .replace(/^  chown -R node:node .*$/m, '  :');
    for (let tentativa = 0; tentativa < 2; tentativa++) {
        const resultado = spawnSync('bash', ['-c', preparar], { encoding: 'utf8' });
        assert.equal(resultado.status, 0, resultado.stderr);
        assert.equal(ler('public/uploads/logo.svg'), 'logo persistida');
        assert.equal(ler('public/uploads/legada.svg'), 'upload legado');
        assert.equal(ler('public/uploads/nova.svg'), 'upload novo');
        assert.equal(ler('data/banco.txt'), 'banco preservado');
        assert.equal(ler('.wwebjs_auth/sessao.txt'), 'autenticacao preservada');
        assert.equal(fs.readlinkSync(path.join(temporario, 'public/uploads')), path.join(temporario, 'storage/uploads'));
    }
    console.log('OK: uploads antigos e novos, prioridade dos persistidos, reinício e preservação de banco/autenticação.');
} finally {
    fs.rmSync(temporario, { recursive: true, force: true });
}

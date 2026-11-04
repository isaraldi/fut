// Executa o download com WhatsApp e navegador simulados, sem conexão ou dados reais.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { test } = require('node:test');
const Message = require('whatsapp-web.js/src/structures/Message');

for (const mimetype of ['image/jpeg', 'image/png']) {
    test(`download de comprovante preserva ${mimetype}`, async () => {
        let downloads = 0;
        const modelo = {
            type: 'image', mimetype, mediaData: { mediaStage: 'RESOLVED' },
            directPath: '/imagem-simulada',
        };
        const window = {
            require: nome => {
                if (nome === 'WAWebCollections') return { Msg: { get: () => modelo } };
                if (nome === 'WAWebDownloadManager') return {
                    downloadManager: { downloadAndMaybeDecrypt: async opcoes => {
                        // Reproduz a validação que falha quando o MIME não é informado.
                        assert.equal(opcoes.mimetype, mimetype, 'MIME ausente no download');
                        assert.equal(opcoes.type, 'image');
                        downloads++;
                        return new Uint8Array([1, 2, 3]).buffer;
                    } },
                };
                throw new Error(`Módulo inesperado: ${nome}`);
            },
            WWebJS: { arrayBufferToBase64Async: async dados => Buffer.from(dados).toString('base64') },
        };
        const mensagem = new Message({ pupPage: {
            evaluate: (fn, id) => vm.runInNewContext(`(${fn.toString()})(id)`, { window, id, AbortController }),
        } });
        mensagem.hasMedia = true;
        mensagem.id = { _serialized: 'imagem-simulada' };
        const media = await mensagem.downloadMedia();
        assert.equal(downloads, 1);
        assert.equal(media.mimetype, mimetype);
        assert.equal(media.data, 'AQID');
    });
}

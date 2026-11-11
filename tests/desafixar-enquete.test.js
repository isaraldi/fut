// WhatsApp simulado: não conecta ao bot nem altera grupos reais.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const utils = fs.readFileSync(require.resolve('whatsapp-web.js/src/util/Injected/Utils'), 'utf8');
const inicio = utils.indexOf('    window.WWebJS.pinUnpinMsgAction =');
const fim = utils.indexOf('    window.WWebJS.getStatusModel', inicio);

for (const legado of [false, true]) {
    for (const action of [1, 2]) {
        test(`fixação: API ${legado ? 'antiga' : 'nova'}, ação ${action}`, async () => {
            const message = { id: 'teste' };
            const original = () => 123;
            const constants = { getPinExpiryDuration: original, getPinExpiryOption: duration => 'opcao-' + duration };
            let chamadas = 0;
            const verificar = (msg, tipo, duration) => {
                chamadas++;
                assert.equal(msg, message);
                assert.equal(tipo, action);
                assert.equal(duration, legado ? 604800 : action === 1 ? 'opcao-604800' : undefined);
                return { messageSendResult: 'OK' };
            };
            const sendPinInChatMsg = legado
                ? async function (msg, tipo, duration) { return verificar(msg, tipo, duration); }
                : async function (options) { return verificar(options.msg, options.pinType, options.pinExpiryDurationOption); };
            const window = { WWebJS: {}, require: nome => {
                if (nome === 'WAWebCollections') return { Msg: { get: () => null, getMessagesById: async () => ({ messages: [message] }) } };
                if (nome === 'WAWebPinMsgConstants') return constants;
                if (nome === 'WAWebSendPinMessageAction') return { sendPinInChatMsg };
                throw new Error(nome);
            } };
            vm.runInNewContext(utils.slice(inicio, fim), { window });
            assert.equal(await window.WWebJS.pinUnpinMsgAction('teste', action, 604800), true);
            assert.equal(chamadas, 1);
            assert.equal(constants.getPinExpiryDuration, original);
            window.require = nome => {
                if (nome === 'WAWebCollections') return { Msg: { get: () => message } };
                if (nome === 'WAWebPinMsgConstants') return constants;
                return { sendPinInChatMsg: async function (options) { throw new Error('Falha simulada'); } };
            };
            await assert.rejects(window.WWebJS.pinUnpinMsgAction('teste', action, 604800), /Falha simulada/);
            assert.equal(constants.getPinExpiryDuration, original, 'restaura a função mesmo após erro');
        });
    }
}

test('exceções ao desafixar respeitam cinco tentativas e mantêm a enquete pendente', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/api/services/whatsapp.service.js'), 'utf8');
    const start = source.indexOf('async function checarEnquetesParaDesafixar()');
    const end = source.indexOf('async function tratarListaEditada', start);
    const enquete = { id: 24, message_id: 'teste', group_id: 'teste@g.us', tentativas_desafixar: 0 };
    let chamadas = 0;
    const logs = [];
    const context = {
        MAX_TENTATIVAS_DESAFIXAR: 5,
        getEnquetesFechadasNaoDesafixadas: () => [{ ...enquete }],
        client: { getMessageById: async () => ({ unpin: async () => { chamadas++; throw new Error('Falha simulada'); } }) },
        registrarTentativaDesafixar: () => { enquete.tentativas_desafixar++; },
        registrarLog: (...args) => logs.push(args),
        marcarEnqueteDesafixada: () => assert.fail('Não deve registrar sucesso após exceção'),
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end), context);
    for (let i = 0; i < 8; i++) await context.checarEnquetesParaDesafixar();
    assert.equal(chamadas, 5);
    assert.equal(logs.length, 2);
    assert.match(logs[1][2], /Desafixe manualmente/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { montarRodizio, distribuirReservasPorTime, montarTextoTimes } = require('../src/utils/mensagens-prontas');

const jogadora = (nome, posicao = 'linha') => ({ nome, posicao });

test('rodízio mantém reservas e titulares no mesmo time e respeita a fila', () => {
    for (const quantidade of [1, 2, 3, 4]) {
        for (let tentativa = 0; tentativa < 20; tentativa++) {
            const times = [
                ['A1', 'A2', 'A3'].map((nome) => jogadora(nome)),
                ['B1', 'B2', 'B3'].map((nome) => jogadora(nome)),
            ];
            times[0].push(jogadora('Goleira A', 'goleira'));
            times[1].push(jogadora('Goleira B', 'goleira'));
            const reservas = Array.from({ length: quantidade }, (_, i) => jogadora(`R${i}`));
            const original = JSON.stringify({ times, reservas });
            const bancos = distribuirReservasPorTime(times, reservas);
            const texto = montarRodizio(times, reservas, 10, 240, bancos);
            assert.doesNotMatch(texto, /entra no lugar|Goleira/);
            const grupos = times.map((time) => time.filter((j) => j.posicao !== 'goleira').map((j) => j.nome));
            bancos.forEach((banco, t) => grupos[t].push(...banco.map((j) => j.nome)));
            assert.equal(grupos.flat().length, 6 + quantidade);
            const linhas = texto.split('\n\n')[1].trim().split('\n');
            assert.equal(linhas.length, bancos.filter((banco) => banco.length > 0).length);
            for (const linha of linhas) {
                const t = linha.startsWith('🔵') ? 0 : 1;
                const etapas = linha.slice(3).split(' → ');
                const nomes = etapas.flatMap((etapa) => etapa.split(', '));
                assert.deepEqual([...nomes].sort(), [...grupos[t]].sort());
                assert.deepEqual(nomes.slice(-bancos[t].length), bancos[t].map((j) => j.nome));
                assert.ok(etapas.every((etapa) => etapa.split(', ').length <= bancos[t].length));
            }
            assert.equal(JSON.stringify({ times, reservas }), original);
        }
    }
});

test('sem reservas de linha ou sem intervalo de troca não há rodízio individual', () => {
    const times = [[jogadora('A')], [jogadora('B')]];
    assert.equal(montarRodizio(times, []), '');
    assert.equal(montarRodizio(times, [jogadora('G', 'goleira')]), '');
    assert.equal(montarRodizio(times, [jogadora('R')], 10, 10), '');
    assert.equal(montarRodizio([[jogadora('G', 'goleira')], []], [jogadora('R')]), '');
});

test('mensagem de três times não inclui rodízio', () => {
    const texto = montarRodizio([[jogadora('A')], [jogadora('B')], [jogadora('C')]], [], 10, 60);
    assert.equal(texto, '');
    const mensagem = montarTextoTimes('Futebol', [['A'], ['B'], ['C']], [], texto);
    assert.match(mensagem, /Time C/);
    assert.doesNotMatch(mensagem, /Rodízio|Quem sai|espera/);
    assert.equal(montarRodizio([[jogadora('A')], [jogadora('B')], [jogadora('C')]], [jogadora('R')]), '');
});

test('mensagem marca reservas na lista e mostra a ordem por time com setas', () => {
    const times = [['Ana', 'Bia', 'Carla'], ['Dani', 'Eva', 'Fernanda']];
    const bancos = [[jogadora('Gabi')], [jogadora('Helena')]];
    const rodizio = montarRodizio(times.map((time) => time.map((nome) => jogadora(nome))), bancos.flat(), 10, 60, bancos);
    const texto = montarTextoTimes('Futebol', times, ['Gabi', 'Helena'], rodizio, undefined, [['Gabi'], ['Helena']]);
    assert.match(texto, /- Carla\n- Gabi 🪑/);
    assert.match(texto, /- Fernanda\n- Helena 🪑/);
    assert.doesNotMatch(texto, /Reservas:|──────────/);
    assert.match(rodizio, /🔵 [^\n]+ → Gabi\n🔴 [^\n]+ → Helena/);
    assert.doesNotMatch(rodizio, /min|Reserva do/);
});

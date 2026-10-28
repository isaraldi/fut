module.exports = function registrarEventosWhatsApp(client, eventos) {
    for (const [evento, handler] of Object.entries(eventos)) client.on(evento, handler);
};

module.exports = function registrarErrosDeProcesso() {
process.on('unhandledRejection', (motivo) => {
    console.error('🔥 unhandledRejection não tratada — encerrando processo:', motivo);
    process.exit(1);
});

process.on('uncaughtException', (err) => {
    console.error('🔥 uncaughtException não tratada — encerrando processo:', err);
    process.exit(1);
});


};

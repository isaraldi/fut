const path = require('path');
const Database = require('better-sqlite3');
const { data } = require('../config/paths');

const db = new Database(path.join(data, 'fut.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
module.exports = db;

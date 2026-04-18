import 'dotenv/config';
import { initSchema, db } from './index.js';

initSchema();
console.log('[migrate] tables:', db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all());
process.exit(0);

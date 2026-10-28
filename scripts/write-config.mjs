// Runs on Netlify at build time. Writes the two PUBLIC Supabase values into public/config.js
// so the browser knows where to log in. (The anon key is designed to be public; all data is
// protected by row-level security. Secret keys never go in this file.)
import { writeFileSync } from 'node:fs';

const url = process.env.SUPABASE_URL || '';
const anon = process.env.SUPABASE_ANON_KEY || '';
if (!url || !anon) console.warn('SUPABASE_URL / SUPABASE_ANON_KEY not set: the site will show a setup message.');

writeFileSync('public/config.js',
  `window.YMT_CONFIG = ${JSON.stringify({ supabaseUrl: url, supabaseAnonKey: anon }, null, 2)};\n`);
console.log('Wrote public/config.js');

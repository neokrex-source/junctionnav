// Turns a single-file Vite build into page content for a hosted preview: strips the
// document skeleton (the host adds its own) and keeps title, font links, styles and scripts.
// Usage: node scripts/artifact-page.mjs <in.html> <out.html> [--fit-sides]
import { readFileSync, writeFileSync } from 'node:fs';
const [input, output, flag] = process.argv.slice(2);
const src = readFileSync(input, 'utf8');
const head = src.match(/<head>([\s\S]*?)<\/head>/i)[1];
const body = src.match(/<body[^>]*>([\s\S]*?)<\/body>/i)[1];
const keep = [];
const title = head.match(/<title>[\s\S]*?<\/title>/i);
if (title) keep.push(title[0]);
if (flag === '--fit-sides') keep.push('<meta name="claude:viewport-fit-sides" content="cover">');
for (const m of head.matchAll(/<link[^>]+fonts\.(googleapis|gstatic)[^>]*>/gi)) keep.push(m[0]);
for (const m of head.matchAll(/<style[^>]*>[\s\S]*?<\/style>/gi)) keep.push(m[0]);
const scripts = [...head.matchAll(/<script[^>]*>[\s\S]*?<\/script>/gi)].map((m) => m[0]);
const bodyClean = body.replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/gi, '').replace(/<noscript>[\s\S]*?<\/noscript>/gi, '');
const out = [...keep, bodyClean.trim(), ...scripts].filter(Boolean).join('\n');
writeFileSync(output, out);
console.log(`wrote ${output} (${(out.length / 1024).toFixed(0)} KB)`);

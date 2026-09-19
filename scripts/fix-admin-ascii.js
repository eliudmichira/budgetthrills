const fs = require('fs');
let html = fs.readFileSync('admin.html', 'utf8');

// Replace ALL non-ASCII in script blocks with ASCII equivalents
// First, find the main inline script block
const scriptStart = html.indexOf('<script>\n  (function()');
const scriptEnd = html.indexOf('</script>', scriptStart);
const before = html.substring(0, scriptStart + 9);
let script = html.substring(scriptStart + 9, scriptEnd);
const after = html.substring(scriptEnd);

// Replace box-drawing chars in comments: ── with --
script = script.replace(/\u2500\u2500/g, '--');

// Replace en-dash in comments
script = script.replace(/\u2013/g, '-');

// Replace middle dot in template literals
script = script.replace(/\u00b7/g, '|');

// Replace arrow in strings (should already be escaped, but just in case)
script = script.replace(/\u2192/g, '->');

// Replace em-dash escape (it's \u2014 literal in a string, not actual char)
// Check for actual em-dash character
script = script.replace(/\u2014/g, '--');

html = before + script + after;
fs.writeFileSync('admin.html', html, 'utf8');

// Verify
const verify = fs.readFileSync('admin.html', 'utf8');
const sStart = verify.indexOf('<script>\n  (function()');
const sEnd = verify.indexOf('</script>', sStart);
const s = verify.substring(sStart + 9, sEnd);
let nonAscii = 0;
for (let i = 0; i < s.length; i++) {
  if (s.charCodeAt(i) > 127) nonAscii++;
}
console.log('Non-ASCII chars remaining in main script:', nonAscii);
console.log('Done');

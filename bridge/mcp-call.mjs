// usage: node mcp-call.mjs <tool> '<json-args>'
const [tool, argsJson = '{}'] = process.argv.slice(2);
const res = await fetch('http://127.0.0.1:25589/mcp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: JSON.parse(argsJson) } }),
});
const text = await res.text();
const line = text.split('\n').find((l) => l.startsWith('data: '));
if (!line) { console.log(text.slice(0, 600)); process.exit(0); }
const data = JSON.parse(line.slice(6));
const content = data.result?.content ?? data;
for (const c of Array.isArray(content) ? content : [content]) {
  if (c?.type === 'text') {
    try { console.log(JSON.stringify(JSON.parse(c.text), null, 0)); }
    catch { console.log(c.text); }
  } else console.log(JSON.stringify(c));
}

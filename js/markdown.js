// Minimal frontmatter + markdown parser tailored to this app's generated content.
// Not a general-purpose parser — just enough to read our own notes.

function parseYamlValue(raw) {
  raw = raw.trim();
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map(s => s.trim());
  }
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  return raw;
}

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: text };
  const yamlBlock = m[1];
  const body = m[2];
  const data = {};
  yamlBlock.split(/\r?\n/).forEach(line => {
    const idx = line.indexOf(':');
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) data[key] = parseYamlValue(val);
  });
  return { data, body };
}

// Extract markdown table rows: returns array of arrays of cell strings, skipping the separator row.
function parseMarkdownTable(body) {
  const lines = body.split(/\r?\n/).filter(l => l.trim().startsWith('|'));
  const rows = [];
  lines.forEach(line => {
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length === 0) return;
    if (cells.every(c => /^:?-+:?$/.test(c))) return; // separator row
    rows.push(cells);
  });
  return rows;
}

// Very small markdown-to-HTML renderer for display-only notes (grammar/readings/vocab index bodies).
function renderMarkdown(body) {
  const lines = body.split(/\r?\n/);
  let html = '';
  let inList = false;
  let tableBuffer = [];

  function flushTable() {
    if (tableBuffer.length === 0) return;
    const rows = tableBuffer.filter(l => !/^\|?\s*:?-+:?\s*\|/.test(l));
    html += '<table>';
    rows.forEach((row, i) => {
      const cells = row.split('|').slice(1, -1).map(c => c.trim());
      const tag = i === 0 ? 'th' : 'td';
      html += '<tr>' + cells.map(c => `<${tag}>${inlineMd(c)}</${tag}>`).join('') + '</tr>';
    });
    html += '</table>';
    tableBuffer = [];
  }

  function inlineMd(s) {
    return s
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '<span class="wikilink">$2</span>')
      .replace(/\[\[([^\]]+)\]\]/g, '<span class="wikilink">$1</span>')
      .replace(/#(\w[\w-]*)/g, '<span class="tag">#$1</span>');
  }

  for (const raw of lines) {
    const line = raw;
    if (line.trim().startsWith('|')) {
      tableBuffer.push(line);
      continue;
    } else {
      flushTable();
    }
    if (/^###\s+/.test(line)) { html += `<h3>${inlineMd(line.replace(/^###\s+/, ''))}</h3>`; continue; }
    if (/^##\s+/.test(line)) { html += `<h2>${inlineMd(line.replace(/^##\s+/, ''))}</h2>`; continue; }
    if (/^#\s+/.test(line)) { html += `<h1>${inlineMd(line.replace(/^#\s+/, ''))}</h1>`; continue; }
    if (/^-\s+/.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inlineMd(line.replace(/^-\s+/, ''))}</li>`;
      continue;
    } else if (inList) { html += '</ul>'; inList = false; }
    if (line.trim() === '') { html += ''; continue; }
    html += `<p>${inlineMd(line)}</p>`;
  }
  if (inList) html += '</ul>';
  flushTable();
  return html;
}

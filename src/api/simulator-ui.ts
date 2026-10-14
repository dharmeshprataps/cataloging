/**
 * The simulator's single-page UI.
 *
 * Kept as one self-contained document on purpose: no build step, no framework,
 * no bundler. It is a development surface, and a designer should be able to open
 * it and use it without any tooling.
 */
export const SIMULATOR_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Catalog Studio — local simulator</title>
<style>
  :root {
    --bg: #0f1115; --panel: #171a21; --panel-2: #1e222b; --line: #2a2f3a;
    --text: #e8eaf0; --muted: #9aa3b2; --accent: #22c55e; --accent-2: #3b82f6;
    --bot: #1e222b; --user: #1d4ed8;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    display: grid; grid-template-columns: 1fr 320px; height: 100vh;
  }
  header {
    padding: 14px 20px; border-bottom: 1px solid var(--line);
    display: flex; align-items: center; gap: 12px; background: var(--panel);
  }
  header h1 { font-size: 15px; margin: 0; font-weight: 600; }
  .badge {
    font-size: 11px; padding: 2px 8px; border-radius: 999px;
    background: rgba(34,197,94,.15); color: var(--accent); border: 1px solid rgba(34,197,94,.3);
  }
  .badge.warn { background: rgba(234,179,8,.15); color: #eab308; border-color: rgba(234,179,8,.3); }
  main { display: flex; flex-direction: column; min-width: 0; }
  #log { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 14px; }
  .row { display: flex; gap: 10px; max-width: 720px; }
  .row.user { align-self: flex-end; flex-direction: row-reverse; }
  .bubble {
    background: var(--bot); border: 1px solid var(--line); border-radius: 14px;
    padding: 11px 14px; white-space: pre-wrap; word-break: break-word; max-width: 560px;
  }
  .row.user .bubble { background: var(--user); border-color: transparent; }
  .bubble img { max-width: 260px; border-radius: 10px; display: block; margin-top: 8px; }
  .avatar {
    width: 30px; height: 30px; border-radius: 50%; flex: 0 0 30px;
    display: grid; place-items: center; font-size: 14px; background: var(--panel-2);
    border: 1px solid var(--line);
  }
  .row.user .avatar { background: var(--accent-2); border-color: transparent; }
  .meta { font-size: 11px; color: var(--muted); margin-top: 6px; }
  .typing { color: var(--muted); font-style: italic; padding: 0 20px 10px; display: none; }
  footer { border-top: 1px solid var(--line); padding: 12px 16px; background: var(--panel); }
  .chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
  button {
    font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 8px; cursor: pointer;
    background: var(--panel-2); color: var(--text); border: 1px solid var(--line);
  }
  button:hover { border-color: var(--accent); }
  button.primary { background: var(--accent); color: #05230f; border-color: transparent; font-weight: 600; }
  button:disabled { opacity: .45; cursor: not-allowed; }
  .composer { display: flex; gap: 8px; align-items: flex-end; }
  textarea {
    flex: 1; resize: none; min-height: 42px; max-height: 140px; padding: 10px 12px;
    border-radius: 10px; border: 1px solid var(--line); background: var(--panel-2);
    color: var(--text); font: inherit;
  }
  textarea:focus { outline: none; border-color: var(--accent-2); }
  aside { border-left: 1px solid var(--line); background: var(--panel); overflow-y: auto; padding: 16px; }
  aside h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 0 0 12px; }
  .card { background: var(--panel-2); border: 1px solid var(--line); border-radius: 10px; padding: 10px; margin-bottom: 10px; }
  .card img { width: 100%; border-radius: 8px; display: block; }
  .card .sku { font-size: 11px; color: var(--accent); font-family: ui-monospace, monospace; }
  .card .title { font-size: 13px; margin-top: 4px; }
  .empty { color: var(--muted); font-size: 13px; }
  #previews { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
  .preview { position: relative; }
  .preview img { width: 54px; height: 54px; object-fit: cover; border-radius: 8px; border: 1px solid var(--line); }
  .preview button { position: absolute; top: -6px; right: -6px; padding: 0; width: 18px; height: 18px; font-size: 11px; line-height: 1; border-radius: 50%; }
  .hint { font-size: 12px; color: var(--muted); margin-top: 6px; }
</style>
</head>
<body>
<main>
  <header>
    <span class="avatar" style="background:var(--accent);color:#05230f">🧵</span>
    <h1>Catalog Studio</h1>
    <span class="badge" id="status">connecting…</span>
  </header>
  <div id="log"></div>
  <div class="typing" id="typing">generating your shot… this can take up to a minute</div>
  <footer>
    <div class="chips">
      <button data-chip="1">1 Approve</button>
      <button data-chip="2">2 Change</button>
      <button data-chip="3">3 Variations</button>
      <button data-chip="4">4 Show brief</button>
      <button data-chip="5">5 Cancel</button>
      <button data-chip="help">help</button>
      <button data-chip="clean studio, white background">clean studio</button>
    </div>
    <div id="previews"></div>
    <div class="composer">
      <textarea id="input" rows="1" placeholder="Describe the shot, or attach garment photo(s)…"></textarea>
      <button id="attach" title="Attach garment photo">📎 Photo</button>
      <button id="send" class="primary">Send</button>
    </div>
    <div class="hint">Local simulator — this drives the exact same pipeline as the WhatsApp channel.</div>
  </footer>
</main>
<aside>
  <h2>Catalog</h2>
  <div id="catalog"><p class="empty">No approved items yet.</p></div>
</aside>
<input type="file" id="file" accept="image/png,image/jpeg,image/webp" multiple hidden />

<script>
(function () {
  const contactId = localStorage.getItem('studio.contactId') || ('c' + Math.random().toString(36).slice(2, 10));
  localStorage.setItem('studio.contactId', contactId);

  const log = document.getElementById('log');
  const input = document.getElementById('input');
  const file = document.getElementById('file');
  const previews = document.getElementById('previews');
  const status = document.getElementById('status');
  const typing = document.getElementById('typing');
  const catalog = document.getElementById('catalog');

  /** @type {{name:string, data:string}[]} */
  let pending = [];

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function addRow(kind, opts) {
    const row = document.createElement('div');
    row.className = 'row ' + kind;
    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.textContent = kind === 'user' ? '🧑' : '🧵';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (opts.text) {
      const text = document.createElement('div');
      text.textContent = opts.text;
      bubble.appendChild(text);
    }
    if (opts.url) {
      const img = document.createElement('img');
      img.src = opts.url + (opts.url.indexOf('?') === -1 ? '?t=' + Date.now() : '');
      img.alt = kind === 'user' ? 'uploaded garment' : 'generated model shot';
      img.loading = 'lazy';
      img.onerror = function () { img.alt = 'image unavailable'; };
      bubble.appendChild(img);
    }
    row.appendChild(avatar);
    row.appendChild(bubble);
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    return bubble;
  }

  function renderPreviews() {
    previews.innerHTML = '';
    pending.forEach(function (item, index) {
      const wrap = document.createElement('div');
      wrap.className = 'preview';
      const img = document.createElement('img');
      img.src = item.data;
      img.alt = item.name;
      const remove = document.createElement('button');
      remove.textContent = '×';
      remove.onclick = function () { pending.splice(index, 1); renderPreviews(); };
      wrap.appendChild(img);
      wrap.appendChild(remove);
      previews.appendChild(wrap);
    });
  }

  async function post(payload) {
    const res = await fetch('/sim/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ contactId: contactId }, payload)),
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).message || ''; } catch (e) { /* ignore */ }
      addRow('bot', { text: ('Could not send that. ' + detail).trim() });
    }
  }

  async function send() {
    const text = input.value.trim();
    const images = pending.slice();
    if (!text && images.length === 0) return;

    input.value = '';
    input.style.height = 'auto';
    pending = [];
    renderPreviews();

    // Send images first, then the caption, so the coordinator batches them into
    // one turn — the same ordering a phone would produce.
    for (const image of images) {
      await post({ imageBase64: image.data, filename: image.name });
    }
    if (text) await post({ text: text });
  }

  document.getElementById('send').onclick = send;
  document.getElementById('attach').onclick = function () { file.click(); };

  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });
  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  });

  document.querySelectorAll('[data-chip]').forEach(function (button) {
    button.onclick = function () { post({ text: button.dataset.chip }); };
  });

  file.addEventListener('change', function () {
    const files = Array.from(file.files || []);
    files.forEach(function (f) {
      const reader = new FileReader();
      reader.onload = function () {
        pending.push({ name: f.name, data: String(reader.result) });
        renderPreviews();
      };
      reader.readAsDataURL(f);
    });
    file.value = '';
  });

  // ---- server-sent events -------------------------------------------------
  const stream = new EventSource('/sim/events?session=' + encodeURIComponent('sim:' + contactId));
  stream.onopen = function () {
    status.textContent = 'live';
    status.className = 'badge';
  };
  stream.onerror = function () {
    status.textContent = 'reconnecting…';
    status.className = 'badge warn';
  };
  stream.onmessage = function (event) {
    let payload;
    try { payload = JSON.parse(event.data); } catch (e) { return; }
    if (!payload || payload.sessionKey !== 'sim:' + contactId) return;

    addRow(payload.direction === 'user' || payload.direction === 'inbound' ? 'user' : 'bot', {
      text: payload.text,
      url: payload.kind === 'image' ? payload.url : undefined,
    });

    if (payload.direction === 'outbound') {
      if (payload.kind === 'image') {
        typing.style.display = 'none';
        refreshCatalog();
      } else if (/generating|On it/.test(payload.text || '')) {
        typing.style.display = 'block';
      }
    }
  };

  // ---- catalog ------------------------------------------------------------
  async function refreshCatalog() {
    try {
      const res = await fetch('/api/catalog');
      if (!res.ok) return;
      const data = await res.json();
      if (!data.items || data.items.length === 0) {
        catalog.innerHTML = '<p class="empty">No approved items yet.</p>';
        return;
      }
      catalog.innerHTML = '';
      data.items.forEach(function (item) {
        const card = document.createElement('div');
        card.className = 'card';
        if (item.heroAssetId) {
          const img = document.createElement('img');
          img.src = '/media/' + item.heroAssetId;
          img.loading = 'lazy';
          card.appendChild(img);
        } else if (item.alternateAssetIds && item.alternateAssetIds[0]) {
          const img = document.createElement('img');
          img.src = '/media/' + item.alternateAssetIds[0];
          img.loading = 'lazy';
          card.appendChild(img);
        }
        card.insertAdjacentHTML(
          'beforeend',
          '<div class="sku">' + esc(item.sku || 'no sku') + '</div>' +
          '<div class="title">' + esc(item.title || 'Untitled item') + '</div>'
        );
        catalog.appendChild(card);
      });
    } catch (e) { /* non-fatal */ }
  }

  addRow('bot', {
    text: 'Hi! Send me a photo of a garment and I will show it on a model.\\n\\nTip: 2–3 angles gives the best result.',
  });
  refreshCatalog();
  setInterval(refreshCatalog, 20000);
})();
</script>
</body>
</html>`;

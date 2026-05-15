namespace Faceburg.LocalAgent.Web;

public static class AdminPage
{
    public const string Html = """
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Faceburg Local Agent</title>
  <style>
    body{margin:0;font-family:Segoe UI,Arial,sans-serif;background:#f7f8fb;color:#111827}
    main{max-width:980px;margin:0 auto;padding:28px}
    header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:22px}
    h1{font-size:24px;margin:0} h2{font-size:16px;margin:0 0 12px}
    .pill{font-size:12px;border:1px solid #bbf7d0;background:#ecfdf5;color:#166534;padding:6px 10px;border-radius:999px}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}
    section{background:white;border:1px solid #e5e7eb;border-radius:8px;padding:16px;box-shadow:0 1px 2px #00000008}
    label{display:block;font-size:12px;font-weight:700;color:#475569;margin:12px 0 4px}
    input,select,textarea{box-sizing:border-box;width:100%;border:1px solid #cbd5e1;border-radius:6px;padding:9px;font:inherit}
    .checkline{display:flex;align-items:center;gap:8px;margin:12px 0 4px;font-size:13px;font-weight:700;color:#475569}
    .checkline input{width:auto}
    textarea{min-height:120px}
    button{border:0;border-radius:6px;background:#e11d48;color:white;padding:10px 12px;font-weight:700;cursor:pointer}
    button.secondary{background:#0f172a}
    button.ghost{background:#e2e8f0;color:#0f172a}
    pre{background:#0f172a;color:#d1fae5;border-radius:8px;padding:12px;overflow:auto;min-height:90px}
    .actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Faceburg Local Agent</h1>
        <div>Impressao RAW ESC/POS e WhatsApp local em loopback.</div>
      </div>
      <span class="pill" id="health">carregando</span>
    </header>

    <div class="grid">
      <section>
        <h2>Configuracao</h2>
        <label>Servidor</label><input id="serverUrl">
        <label>Slug</label><input id="tenantSlug">
        <label>Tenant ID opcional</label><input id="tenantId">
        <label>Impressora</label><select id="printer"></select>
        <label>Papel da impressora</label><select id="columns"><option value="32">58 mm</option><option value="48">80 mm</option></select>
        <label>Tamanho da letra</label><select id="printTextSize"></select>
        <label>Codepage</label><select id="codePage"><option>CP860</option><option>CP850</option><option>CP858</option><option>CP437</option></select>
        <label class="checkline"><input type="checkbox" id="cutPaper"> Cortar papel ao final</label>
        <label class="checkline"><input type="checkbox" id="startWithWindows"> Iniciar junto com o Windows</label>
        <div class="actions">
          <button onclick="saveConfig()">Salvar</button>
          <button class="ghost" onclick="loadAll()">Atualizar</button>
        </div>
      </section>

      <section>
        <h2>Impressao</h2>
        <textarea id="printText">FACEBURG
Teste instantaneo ESC/POS
R$ 10,00</textarea>
        <div class="actions">
          <button onclick="printTest()">Teste ESC/POS</button>
          <button class="secondary" onclick="printText()">Imprimir texto</button>
        </div>
      </section>

      <section>
        <h2>WhatsApp</h2>
        <label>Status</label><input id="whatsStatus" readonly>
        <label class="checkline"><input type="checkbox" id="whatsAppHeadless"> Rodar WhatsApp oculto</label>
        <label>Telefone</label><input id="phone" placeholder="11999999999">
        <label>Mensagem</label><textarea id="message">Teste Faceburg Local Agent</textarea>
        <div class="actions">
          <button onclick="startWhats()">Abrir WhatsApp</button>
          <button class="secondary" onclick="sendWhats()">Enviar</button>
        </div>
      </section>
    </div>

    <h2 style="margin-top:18px">Log</h2>
    <pre id="log"></pre>
  </main>
  <script>
    let config = {};
    const PRINT_TEXT_SIZES = Array.from({length: 65}, (_, index) => {
      const size = 8 + (index * 0.25);
      return size.toFixed(2).replace(/\.?0+$/, '');
    });
    const log = (value) => document.getElementById('log').textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    async function json(url, options){ const r = await fetch(url, options); const data = await r.json().catch(()=>({})); if(!r.ok) throw data; return data; }
    function normalizePrintTextSize(value){
      const clean = String(value || '').trim().toLowerCase();
      if(clean === 'normal') return '10';
      if(clean === 'large') return '12';
      if(clean === 'extra_large') return '14';
      if(!/^\d+(?:\.\d+)?$/.test(clean)) return '12.5';
      const parsed = Number(clean);
      if(!Number.isFinite(parsed)) return '12.5';
      const rounded = Math.round(Math.min(24, Math.max(8, parsed)) * 4) / 4;
      return rounded.toFixed(2).replace(/\.?0+$/, '');
    }
    function normalizePaperColumns(value){
      const parsed = Number(value);
      if(parsed === 58) return '32';
      if(parsed === 80) return '48';
      if(parsed === 40) return '48';
      return parsed === 48 ? '48' : '32';
    }
    function fillPrintTextSizes(){
      printTextSize.innerHTML = PRINT_TEXT_SIZES.map(size => `<option value="${size}">${size}</option>`).join('');
    }
    async function loadAll(){
      fillPrintTextSizes();
      const [health, cfg, printers, whats] = await Promise.all([
        json('/api/health'), json('/api/config'), json('/api/printers'), json('/api/whatsapp/status').catch(()=>({status:'stopped'}))
      ]);
      config = cfg;
      document.getElementById('health').textContent = health.online ? 'online' : 'offline';
      serverUrl.value = cfg.serverUrl || ''; tenantSlug.value = cfg.tenantSlug || ''; tenantId.value = cfg.tenantId || '';
      columns.value = normalizePaperColumns(cfg.columns); printTextSize.value = normalizePrintTextSize(cfg.printTextSize); codePage.value = cfg.codePage || 'CP860'; whatsStatus.value = `${whats.status || ''} ${whats.phoneNumber || ''}`;
      cutPaper.checked = Boolean(cfg.cutPaper);
      startWithWindows.checked = cfg.startWithWindows !== false;
      whatsAppHeadless.checked = cfg.whatsAppHeadless !== false;
      printer.innerHTML = printers.map(p=>`<option ${p.name===cfg.defaultPrinter?'selected':''}>${p.name}</option>`).join('');
      log(health);
    }
    async function saveConfig(){
      config.serverUrl = serverUrl.value; config.tenantSlug = tenantSlug.value; config.tenantId = tenantId.value;
      config.defaultPrinter = printer.value; config.columns = Number(normalizePaperColumns(columns.value)); config.printTextSize = normalizePrintTextSize(printTextSize.value); config.codePage = codePage.value;
      config.cutPaper = cutPaper.checked;
      config.startWithWindows = startWithWindows.checked;
      config.whatsAppHeadless = whatsAppHeadless.checked;
      log(await json('/api/config',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(config)}));
    }
    async function printTest(){ log(await json('/api/print/test',{method:'POST'})); }
    async function printText(){ log(await json('/api/print',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({payloadText:document.getElementById('printText').value,cutPaper:cutPaper.checked})})); }
    async function startWhats(){ log(await json('/api/whatsapp/start',{method:'POST'})); setTimeout(loadAll, 1500); }
    async function sendWhats(){ log(await json('/api/whatsapp/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({targetPhone:phone.value,payloadText:message.value})})); }
    loadAll().catch(log);
    setInterval(()=>json('/api/whatsapp/status').then(s=>whatsStatus.value=`${s.status||''} ${s.phoneNumber||''}`).catch(()=>{}), 2500);
  </script>
</body>
</html>
""";
}

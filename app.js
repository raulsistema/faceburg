const fs = require('fs');
const stream = require('stream');
const fetch = require('node-fetch');
const storage = require('node-persist');

//configuracoes impressora
var Fonte = '', TamanhoFonte = '18px', NumeroColunas = '', chromePath = '', CaminhoNavegador = '', InitWhatsApp = false;
var Executando = true, StatusImpressao = true;

var countSuporte = 0;

var numerosPorExtenso = [];
const { Configuration, OpenAIApi } = require("openai");
const WebSocket = require('ws');
const path = require('path');
var skt;
var windows = [];
var Administrador = [];

const singleInstance = require('single-instance');
const { isNumberObject } = require('util/types');
const locker = new singleInstance('SW_Impressora');
locker.lock().then(() => {
  function sendMessage(message) {
    if (skt && skt.readyState === WebSocket.OPEN) {
      skt.send(message);
    } else {
      console.log('Nenhum cliente conectado.');
    }
  }
  
  
    // Caminho para o diretório "Program Files (x86)" no Windows
    const programFilesx86Path = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application';
  
    // Verifica se o diretório existe
    fs.access(programFilesx86Path, fs.constants.F_OK, (error) => {
      if (error) {
        //diretorio nao existe
        chromePath = 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe';
    
      } else {
        //diretorio existe
        chromePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
      }
    });

    async function LerConfiguracoes() {
      var i = 0;
    
      if (fs.existsSync(path.join(app.getPath('temp'), 'config.txt'))) {
        fs.readFile(path.join(app.getPath('temp'), 'config.txt'), 'utf-8', async function (err, data) {
          var linhas = data.split(/\r?\n/);
          linhas.forEach(function (linha) {
            if (linha != undefined) {
              var strLinha = linha.split('=');
    
              if (strLinha.length > 1) {
                switch (i) {
                  case 0:
                    InitWhatsApp = strLinha[1];
                    break;
                  case 1:
                      Fonte = strLinha[1];
                    break;
                    case 2 :
                      TamanhoFonte = strLinha[1]; 
                    break;
                    case 3:
                      NumeroColunas = strLinha[1];    
                    break;
                    case 4:
                      CaminhoNavegador = strLinha[1];    
                    break;
                }
              }
    
              i++;
            }
          })
        })
      }
      else {
        const filePath = path.join(app.getPath('temp'), 'config.txt');
        const fileContent = 'whatsapp=true\nfonte=sans-serif\nfonteSize=14px\nnumeroColunas=\ncaminhoNavegador=';
    
        fs.writeFile(filePath, fileContent, (error) => {
          if (error) {
            console.log(error);
          } else {
            console.log('O arquivo foi criado com sucesso.');
            sendMessage(JSON.stringify({acao: 3, msg: 'O arquivo foi criado com sucesso.'}));
    
          }
        });
    
        LerConfiguracoes();
      }
  }
  
  function ObtersNumerosExtensos() {
    const numeroPorExtenso = require('numero-por-extenso');
  
    for (let i = 1; i <= 1000; i++) {
      let numero = {
        Extenso: numeroPorExtenso.porExtenso(i).toUpperCase(),
        Valor: i
      };
  
      numerosPorExtenso.push(numero);
    }
  
    numero = {
      Extenso: 'DUAS',
      Valor: 2
    };
  
    numero = {
      Extenso: 'ZERO',
      Valor: 0
    };
  
    numerosPorExtenso.push(numero);
  }
  
  const { dockStart } = require('@nlpjs/basic');
  var dock, nlp;
  
  async function Train() {
    try {
      dock = await dockStart({ use: ['Basic'] });
      nlp = dock.get('nlp');
      await nlp.addCorpus(__dirname + '/traini.json');
      await nlp.train();
    }
    catch (e) {
      const filePath = './logs.txt';
  
      fs.writeFile(filePath, e, (error) => {
        if (error) {
          console.log(error);
        } else {
          console.log('O arquivo foi criado com sucesso.');
          sendMessage(JSON.stringify({acao: 3, msg: 'O arquivo foi criado com sucesso.'}));
  
        }
      });
    }
  }
  
  async function ObterResposta(Value) {
    try {
      const response = await nlp.process('pt', Value);
  
      return response;
    }
    catch (e) {
      const filePath = './logs.txt';
  
      fs.writeFile(filePath, e, (error) => {
        if (error) {
          console.log(error);
        } else {
          console.log('O arquivo foi criado com sucesso.');
          sendMessage(JSON.stringify({acao: 3, msg: 'O arquivo foi criado com sucesso.'}));
  
        }
      });
    }
  }
  ///electron create view///
  const { app, BrowserWindow, Tray, Menu, screen, Notification, ipcMain, shell  } = require('electron');
  const electronLocalshortcut = require('electron-localshortcut');
  const { autoUpdater } = require("electron-updater")
  const AutoLaunch = require('auto-launch');
  
  app.allowSingleInstance = true;
  
  
  let mainWindow;
  function CreateJanela() {
    const { resolve } = require('path');
    const iconPath = resolve(__dirname + '/img/icon.png');
  
    tray = new Tray(iconPath);
    tray.setToolTip('Sistemas na Web');
    tray.setIgnoreDoubleClickEvents(true)
  
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: 'Maximizar App', click: function () {
          mainWindow.show();
        }
      },
      {
        label: 'Sair', click: function () {
          isQuiting = true;
          app.quit();
        }
      }
    ]));
  
    tray.on('click', function(e){
      mainWindow.show()
    });
  
    const { width, height } = screen.getPrimaryDisplay().size;
    const urlMultiplaPermitida = 'https://sistemasnaweb.com.br/Venda/VendasPOS?Controle=1';
    const urlsUnicasPorCaminho = new Set([
      '/Venda/Pedidos',
      '/Venda/MesasComandas'
    ]);

    function ObterChaveJanela(url) {
      try {
        const parsedUrl = new URL(url);
        const hostname = parsedUrl.hostname.replace(/^www\./, '');
        const pathname = parsedUrl.pathname.replace(/\/+$/, '');

        if (hostname === 'sistemasnaweb.com.br' && urlsUnicasPorCaminho.has(pathname)) {
          return `${parsedUrl.protocol}//${hostname}${pathname}`;
        }

        return parsedUrl.href;
      } catch (error) {
        return url;
      }
    }

    function UrlExigeJanelaUnica(url) {
      try {
        const parsedUrl = new URL(url);
        const hostname = parsedUrl.hostname.replace(/^www\./, '');
        const pathname = parsedUrl.pathname.replace(/\/+$/, '');

        return hostname === 'sistemasnaweb.com.br' && urlsUnicasPorCaminho.has(pathname);
      } catch (error) {
        return false;
      }
    }

    function ObterJanelaExistente(url) {
      const chaveUrl = ObterChaveJanela(url);

      return windows.find((window) => {
        if (!window || window.isDestroyed()) {
          return false;
        }

        return ObterChaveJanela(window.webContents.getURL()) === chaveUrl;
      });
    }

    function FocarJanela(window) {
      if (!window || window.isDestroyed()) {
        return;
      }

      if (window.isMinimized()) {
        window.restore();
      }

      window.show();
      window.focus();
    }

    function RegistrarAberturaJanela(window) {
      window.webContents.setWindowOpenHandler((event) => {
        return ProcessarAberturaJanela(event.url);
      });

      window.webContents.on('will-navigate', (event, url) => {
        if (FecharJanelaDuplicada(window, url)) {
          event.preventDefault();
        }
      });

      window.webContents.on('did-navigate', (event, url) => {
        FecharJanelaDuplicada(window, url);
      });

      window.webContents.on('did-navigate-in-page', (event, url) => {
        FecharJanelaDuplicada(window, url);
      });
    }

    function FecharJanelaDuplicada(window, url) {
      if (!window || window.isDestroyed() || !UrlExigeJanelaUnica(url)) {
        return false;
      }

      const existingWindow = windows.find((currentWindow) => {
        if (!currentWindow || currentWindow === window || currentWindow.isDestroyed()) {
          return false;
        }

        return ObterChaveJanela(currentWindow.webContents.getURL()) === ObterChaveJanela(url);
      });

      if (!existingWindow) {
        return false;
      }

      FocarJanela(existingWindow);

      if (window !== mainWindow) {
        setTimeout(() => {
          if (window && !window.isDestroyed()) {
            window.close();
          }
        }, 50);
      }

      return true;
    }

    function CriarJanelaFilha(url) {
      let newWindow = new BrowserWindow(
        {
          width: width,
          height: height,
          show: true,
          resize: false,
          autoHideMenuBar: true,
          icon: __dirname + '/icone.ico',    
          webPreferences: {
            nativeWindowOpen: true,
            devTools: true, // false if you want to remove dev tools access for the user
            contextIsolation: true,
            webviewTag: true // https://www.electronjs.org/docs/api/webview-tag,
          }
        }
      );

      electronLocalshortcut.register(newWindow, 'F5', () => {
        newWindow.reload();
      });

      newWindow.loadURL(url);
      windows.push(newWindow);

      newWindow.webContents.on('did-finish-load', () => {
        newWindow.maximize();
        FecharJanelaDuplicada(newWindow, newWindow.webContents.getURL());
        console.log(windows)
      });
      
      newWindow.on('closed', function () {
        windows = windows.filter(win => win !== newWindow);
        newWindow = null;
      });

      RegistrarAberturaJanela(newWindow);
    }

    function ProcessarAberturaJanela(url) {
      const newURL = new URL(url);

      if (newURL.origin.endsWith('ifood.com.br')) {
        shell.openExternal(newURL.href);
        return { action: 'deny' };
      }

      let existingWindow = ObterJanelaExistente(newURL.href);
      if (existingWindow != null && newURL.href != urlMultiplaPermitida) {
        FocarJanela(existingWindow);
        return { action: 'deny' };
      }

      CriarJanelaFilha(newURL.href);
      return { action: 'deny' };
    }
  
    mainWindow = new BrowserWindow({
      width: width,
      height: height,
      show: true,
      resize: false,
      autoHideMenuBar: true,
      icon: __dirname + '/icone.ico',    
      webPreferences: {
        nativeWindowOpen: true,
        contextIsolation: false,
        devTools: true, // false if you want to remove dev tools access for the user
        webviewTag: true // https://www.electronjs.org/docs/api/webview-tag,
      }
    });
  
    //mainWindow.loadURL(`file://${__dirname}/Views/index.html`);  
    //mainWindow.loadURL(`https://sistemasnaweb.com.br/Login`);  
    //mainWindow.loadURL(`file://${__dirname}/Views/Pedidos.html`);  
    mainWindow.loadURL(`https://sistemasnaweb.com.br/Login/Index`);  
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.maximize();
      mainWindow.show();
    });
    windows.push(mainWindow);

    RegistrarAberturaJanela(mainWindow);
  }
  
  app.on('second-instance', (event, commandLine, workingDirectory) => {
      if (mainWindow != null)
      {
        mainWindow.maximize();  
      }
  });
  
  
  app.on('ready', async () => {    
    
    CreateJanela();
    LerConfiguracoes();
    ObtersNumerosExtensos();
    Train();

    //sendMessage(JSON.stringify({acao: 7, msg: `Atualizando Status`}));

    electronLocalshortcut.register(mainWindow, 'F5', () => {
      mainWindow.reload();
    });

    await sleep(2000);
    if(InitWhatsApp == 'true')
    {
      await storage.init();
      const usuarios = await storage.getItem('usuarios') || [];
      console.log(usuarios)
      for (const item of usuarios) {
        IniciarServer(item.id);
        await sleep(2000);
      }
    }

  });
  
  let autoLaunch = new AutoLaunch({
    name: 'SW_Responde',
    path: app.getPath('exe'),
  });

  autoLaunch.isEnabled().then((isEnabled) => {
    if (!isEnabled) autoLaunch.enable();
  });

  app.on('activate', () => {
    if (mainWindow === null) {
      CreateJanela();
    } else {
      mainWindow.show();
    }
  });
  
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
  
  app.on('before-quit', function () {
    isQuiting = true;
  });
  
  autoUpdater.on('update-available', ()=>{
    //mostra na tela ... 
    sendMessage(JSON.stringify({acao: 4, msg: 'Nova Atualização Disponivel'}));
    //MoveToTemp();
    //move as pastas base para fora ....
    new Notification({
      title: 'Sistemas na Web',
      body: 'Nova Atualização Disponivel',
      icon: './icone.ico', // Replace with the path to your icon
    }).show();
  });
  
  autoUpdater.on('checking-for-update', ()=>{
    sendMessage(JSON.stringify({acao: 3, msg: 'Checkando Atualização'}));
  });
  
  autoUpdater.on('download-progress', (progressTrack)=>{        
    sendMessage(JSON.stringify({acao: 5, msg: progressTrack}));
  
  });
  
  autoUpdater.on('update-downloaded', ()=>{
    /*sendMessage(JSON.stringify({acao: 6, msg: 'Atualizado'}));
    new Notification({
      title: 'Sistemas na Web',
      body: 'Sistema Atualizado, Reinicie o App, e espere ele iniciar novamente',
      icon: './icone.ico', // Replace with the path to your icon
    }).show();*/
  
    autoUpdater.quitAndInstall();  
  });
  
  async function verifyAtt(){
    autoUpdater.checkForUpdatesAndNotify();
  }
  

  //verifica a cada 1 hora
  setInterval(verifyAtt, 3600000);

  const serverWs = new WebSocket.Server({ port: 9000 });

  serverWs.on('connection', (socket) => {
    skt = socket;

    console.log('Nova conexão WebSocket');
    
    socket.on('close', () => {
      console.log('Conexão WebSocket fechada');
    });

  });

  ///bot whats app ///
  const { Client, LocalAuth, MessageMedia  } = require('whatsapp-web.js');
  

  async function adicionarUsuario(novoUsuario) {
    await storage.init();

    const chave = 'usuarios';

    // Carrega lista existente (ou cria nova)
    let usuarios = await storage.getItem(chave) || [];

    // Evita duplicados por id (opcional)
    const existe = usuarios.find(u => u.id === novoUsuario.id);
    if (existe) {
      console.log(`Usuário com id ${novoUsuario.id} já existe.`);
      return;
    }

    // Adiciona novo item
    usuarios.push(novoUsuario);

    // Salva lista atualizada
    await storage.setItem(chave, usuarios);

    console.log(`Usuário ${novoUsuario.nome} adicionado!`);
  }
  async function ReiniciarSessaoUnica(SessionId) {
    try {
      if (clientSessionRegistry && clientSessionRegistry[SessionId]) {
        await clientSessionRegistry[SessionId].destroy();
        delete clientSessionRegistry[SessionId];
      }

      await sleep(5000); // evita abrir duas abas
      await IniciarServer(SessionId);

    } catch (e) {
      console.log('Erro ao reiniciar sessão:', e);
    }
  }

// ==============================================================================
// 1. FUNÇÃO AUXILIAR DE LIMPEZA (ESSENCIAL PARA NÃO DUPLICAR GUIAS)
// ==============================================================================
async function LimparSessao(SessionId) {
    const id = String(SessionId); // Garante que é string

    if (clientSessionRegistry[id]) {
        console.log(`🧹 Limpando sessão anterior: ${id}`);
        const clienteOuStatus = clientSessionRegistry[id];

        // Se for um cliente real (e não apenas o objeto de reserva 'INICIALIZANDO')
        // E se tiver o método destroy (para fechar o navegador)
        if (clienteOuStatus && typeof clienteOuStatus.destroy === 'function') {
            try {
                await clienteOuStatus.destroy(); // <--- OBRIGATÓRIO: Fecha o Chrome
                console.log(`✅ Navegador da sessão ${id} fechado com sucesso.`);
            } catch (err) {
                console.log(`⚠️ Erro ao tentar fechar navegador da sessão ${id}:`, err);
            }
        }
    }
    
    // Remove do registro para liberar a vaga
    delete clientSessionRegistry[id];
}

// ==============================================================================
// 2. FUNÇÃO PRINCIPAL DE INICIALIZAÇÃO
// ==============================================================================
async function IniciarServer(SessionId, Indice) {
    // Normaliza o ID para string
    const sId = String(SessionId); 

    console.log('--------------------------------------------teste ------------------------------');
    
    // ✅ PASSO CRÍTICO 1: VERIFICAÇÃO SÍNCRONA
    if (clientSessionRegistry[sId]) {
        console.log(`❌ BLOQUEIO: Sessão ${sId} já está ativa ou iniciando.`);
        return;
    }

    // ✅ PASSO CRÍTICO 2: RESERVA IMEDIATA
    clientSessionRegistry[sId] = { status: 'INICIALIZANDO' };

    try {
                  await LimparSessao(sId); // Limpa e fecha navegador
              await sleep(1500);

        console.log(`Iniciando sessão para: ${sId}`);
        adicionarUsuario({ id: sId });

        const client = new Client({
            // O LocalAuth gerencia as pastas automaticamente baseando-se no clientId.
            // Ele criará algo como: .../temp/Sessoes/session-{sId}
            authStrategy: new LocalAuth({
                clientId: sId,
                dataPath: path.join(app.getPath('temp'), 'Sessoes'), 
            }),
            puppeteer: {
                executablePath: CaminhoNavegador.length > 5 ? CaminhoNavegador : chromePath,
                headless: false,
                // userDataDir: ... <--- REMOVIDO para evitar conflito com LocalAuth
                args: [                  
                    "--disable-accelerated-2d-canvas",
                    "--disable-background-timer-throttling",
                    "--disable-backgrounding-occluded-windows",
                    "--disable-breakpad",
                    "--disable-cache",
                    "--disable-component-extensions-with-background-pages",
                    "--disable-crash-reporter",
                    "--disable-dev-shm-usage",
                    "--disable-extensions",
                    "--disable-hang-monitor",
                    "--disable-ipc-flooding-protection",
                    "--disable-mojo-local-storage",
                    "--disable-notifications",
                    "--disable-popup-blocking",
                    "--disable-print-preview",
                    "--disable-prompt-on-repost",
                    "--disable-renderer-backgrounding",
                    "--disable-software-rasterizer",
                    "--ignore-certificate-errors",
                    "--log-level=3",
                    "--no-default-browser-check",
                    "--no-first-run",
                    "--no-sandbox",
                    "--no-zygote",
                    "--renderer-process-limit=2",
                    "--enable-gpu-rasterization",
                    "--enable-zero-copy",
                    "--app=https://web.whatsapp.com"
                ],
                timeout: 120000,        
            },
            qrMaxRetries: 10
        });

        // ✅ PASSO CRÍTICO 3: SUBSTITUI A RESERVA PELO CLIENTE REAL
        clientSessionRegistry[sId] = client;

        client.initialize();

        const qra = require('qr-image');

        client.on('qr', (qr) => {
            // Verifica se a sessão ainda é válida antes de enviar QR
            if (!clientSessionRegistry[sId]) return;
            var code = qra.imageSync(qr, { type: 'png' });
            sendMessage(JSON.stringify({ acao: 1, code: code.toString('base64') }));
        });

        client.on('auth_failure', async msg => {
            console.log(`Falha de autenticação na sessão ${sId}`);
            await LimparSessao(sId); // Limpa e fecha navegador
            await ReiniciarSessaoUnica(sId);
        });

        client.on('disconnected', async (reason) => {
            console.log(`Sessão ${sId} desconectada:`, reason);
            await LimparSessao(sId); // Limpa e fecha navegador
            await ReiniciarSessaoUnica(sId);
        });

        client.on('ready', async () => {
          console.log(`Client ${sId} is ready!`);
          
          // 1. Envia notificações ao seu sistema de controle (WebSocket/API)
          sendMessage(JSON.stringify({ acao: 2, indice: Indice }));
          sendMessage(JSON.stringify({ acao: 3, msg: 'cliente carregado' }));

          // 2. Lógica para desativar o "Visto por último" / "Blue Tick" (Do Snippet 2)
          // Verificamos se pupPage existe antes de tentar injetar o código
          if (client.pupPage) {
              try {
                  await client.pupPage.evaluate(() => {
                      // Sobrescreve a função interna do WhatsApp Web para não enviar confirmação de leitura
                      if (window.WWebJS) {
                          window.WWebJS.sendSeen = async () => { return false; }; 
                      }
                  });
                  console.log(`[${sId}] Confirmação de leitura desativada com sucesso.`);
              } catch (e) {
                  console.error(`[${sId}] Erro ao tentar desativar confirmação de leitura:`, e);
              }
          }

          // 3. Inicia o fluxo principal do bot
          await start(client, sId);

          // 4. Monitoramento de erro na página do Puppeteer (Crash do navegador)
          if (client.pupPage) {
              client.pupPage.on('error', async (err) => {
                  console.log(`Erro na página do Puppeteer (${sId}):`, err);
                  await LimparSessao(sId);
                  await ReiniciarSessaoUnica(sId);
              });
          }
      });

    } catch (e) {
        console.log(`Erro fatal na inicialização (${sId}):`, e);
        // Garante a limpeza em caso de erro no setup
        await LimparSessao(sId);
    }
}
  
  const axios = require('axios');
  const express = require('express')
  const server = express();
  const serverImpressao = express();

  server.use(express.json());
  serverImpressao.use(express.json());
  
  var cors = require('cors');

  server.use(cors({
    origin: '*',
    methods: '*'
  }));

  serverImpressao.use(cors({
    origin: '*',
    methods: '*'
  }));

  var https = require('https'); //the variable doesn't necessarily have to be named http
  const { Console } = require('console');

  var Administradores = [];
  var clientSessionRegistry = {};
  const SessoesName = [];
  const { default: PQueue } = require("p-queue");
  const queue = new PQueue({
    concurrency: 4,
    autoStart: false
  });

  const proc = async (message, client, Administrador) => {
// Função utilitária para log de erros com contexto
function logErroContexto(err, context = {}) {
  console.error("❌ ERRO:", err.message);
  console.error("📍 STACK:", err.stack);
  console.error("📄 CONTEXTO:", JSON.stringify(context, null, 2));
}

try {
  var now = new Date();
  var timeDiff = now.getTime() - (message?.timestamp * 1000);

  if (timeDiff > 300000) {
    console.log('timeout ');
    return;
  }

  
  if (!message?._data?.id?.hasOwnProperty('participant') && (message?.type == 'chat' || message?.type == 'location' || message?.type == 'document')) {
    if (Administrador != null) {
      if (message.body.toUpperCase() != 'SAIR' && message.body.toUpperCase() != 'VOLTAR') {
        var found = await Administrador.Clientes.find(element => element.Codigo == message.from);
        var Validar = await ValidarHorarioFuncionamento(Administrador);

        if (!Validar.Status) {
          if (found == null) {
            var Cliente = await AdicionarCliente();
            await ObterDadosCliente(Cliente, Administrador);
            Administrador.Clientes.push(Cliente);

            if (Administrador.Configuracao.mensagemHorarioFuncionamento == '') {
              await client.sendMessage(message.from, 'Opss.. Ainda não estamos atendendo! 😕');
              await sleep(1500);
            }
            await client.sendMessage(message.from, await ConsultarHorarioFuncionamento(Administrador));

            if (Administrador.Configuracao.enviarAjuda) {
              await sleep(2000);
              await client.sendMessage(message.from, AjudaPlataforma(Administrador));
            }
          }
        } else {
          if (found == null) {
            if (message.type == 'document') {
              await client.sendMessage(message.from, 'Que legal que o *pagamento* deu certo 😍\n Caso precise de algo é só me *dizer* aqui👇');
            } else {
              var Cliente = await AdicionarCliente();
              await ObterDadosCliente(Cliente, Administrador);
              Administrador.Clientes.push(Cliente);

              if (Administrador.Configuracao.saudacaoInicio) {
                await SaudacaoInicial(message, client, Cliente, Administrador);
              } else {
                var found = await Administrador.Clientes.find(element => element.Codigo == message.from);

                if (Administrador.Configuracao.tipoColeta == 'MANUAL') {
                  var Saudacao = 'Olá, @HOR ';
                  Saudacao = Saudacao.replace('@HOR', await greetingMessage());
                  await client.sendMessage(message.from, Saudacao + Cliente.Nome);
                  await sleep(2000);

                  if (Administrador.Configuracao.tipoMenu == 'PRODUTOS') {
                    found.Menu = "PEDIDOMANUAL";
                    found.Action = 'ADD_SELL_LANCHE';
                    ExibirProdutos(client, message, Administrador);
                  } else {
                    found.Menu = "PEDIDOMANUAL";
                    found.Action = 'ADD_LANCHE';
                    await client.sendMessage(message.from, SegundaCamada(1));
                  }
                } else {
                  var Resposta = await Teste(client, message, Administrador);

                  if (Administrador.Configuracao.tipoColeta == 'HUMANA') {
                    var Resp = Resposta.answer.replace('@LINK', 'https://sistemasnaweb.com.br/' + Administrador.configuracao.urlLoja + '  🔗');
                    Resp = Resp.replace('@NOME', found.Nome);
                    await client.sendMessage(message.from, Resp);
                  } else {
                    await client.sendMessage(message.from, 'Acesse o nosso *catálogo* para realizar os seus *pedidos* 👇\nhttps://sistemasnaweb.com.br/' + Administrador.configuracao.urlLoja + '  🔗');
                  }
                }
              }
            }
          } else {
            if (found.AutoAtendimento) {
              if (found.Expire > new Date()) {
                if (message.type != 'location') {
                  if (!["PEDIDO", "FINALIZAR", "ADDENTREGA", "ADDPAGAMENTO", "PEDIDOMANUAL"].includes(found.Menu)) {
                    await sleep(1000);
                    var Resposta = await Teste(client, message, Administrador);
                    await Teste2(Resposta, found, client, message, Administrador);
                  } else {
                    await sleep(1000);
                    await Teste3(found, client, message, Administrador);
                  }
                } else {
                  var Url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${message.location.latitude},${message.location.longitude}&key=AIzaSyDTeohdHJlLUGblpiEh1bjYZmqvsCCX_eo`;

                  const response = await fetch(Url);
                  const data = await response.json();

                  await client.sendMessage(message.from, 'Você está na ' + data.results[0].formatted_address);

                  if (!found.Venda) {
                    found.Venda = {
                      ItensVenda: [],
                      TaxaEntrega: 0,
                      Troco: 0,
                      FormaPagamento: 0,
                      Telefone: '',
                      Nome: '',
                      EnderecoEntrega: null
                    };
                  }

                  await ObterLocalizacao(found, Administrador.configuracao.enderecoExibicao, data.results[0].formatted_address, 0, 0, Administrador);
                  await sleep(2000);

                  const taxa = found.Venda.TaxaEntrega;
                  await client.sendMessage(message.from, taxa > 0 ? `Sua *Taxa* de Entrega fica em R$ ${taxa.toFixed(2).replace('.', ',')}` : (taxa < 0 ? 'Você está *fora* da nossa *area de entrega* 🥲' : 'Sua *Taxa* de Entrega está *Grátis* 🤩'));
                }
              } else {
                found.Expire = addMinutes(new Date(), 30);
                await SaudacaoInicial(message, client, found, Administrador);
              }
            }
          }
        }
      } else {
        if (message.body.toUpperCase() == 'SAIR') {
          await client.sendMessage(message.from, `📢 Olá!
✅ Confirmamos o recebimento da sua solicitação.
🚫 Você foi removido das nossas campanhas automáticas.
🔁 Se mudar de ideia no futuro, é só nos chamar! 😉`);
          AlterarPessoaCampanha(message.from, false);
        } else if (message.body.toUpperCase() == 'VOLTAR') {
          await client.sendMessage(message.from, `🎉 *Que bom ter você de volta!*
📩 Você foi *reativado* para receber nossas *campanhas automáticas* com promoções e novidades exclusivas!
💬 Qualquer dúvida, é só *nos chamar*! 😉`);
          AlterarPessoaCampanha(message.from, true);
        }
      }
    } else {
      if (countSuporte == 0) {
        await client.sendMessage(message.from, 'Erro ao vincular o whatsapp, por favor entre em contato com o suporte');
      }
      countSuporte++;
    }
  } else {
    return;
  }

  async function AdicionarCliente() {
    var Cliente = {};
    Cliente.Codigo = message.from;
    Cliente.Nome = await RemoveEmoji(message?._data?.notifyName || '');
    Cliente.From = message.from;
    Cliente.GrupoSell = 0;
    Cliente.Expire = addMinutes(new Date(), 30);
    Cliente.Login = addMinutes(new Date(), 10);
    Cliente.Action = "MENU";
    Cliente.Menu = "MENU";
    Cliente.AutoAtendimento = !Administrador.Configuracao.apenasMensagemInicial;
    Cliente.Venda = null;
    Cliente.Enderecos = null;
    Cliente.Pessoa = null;
    Cliente.CodigoPagamento = null;
    Cliente.Pix = '';
    Cliente.TentativasPedido = 0;
    Cliente.Ajuda = 0;
    Cliente.Notificacao = false;
    Cliente.Administrador = Administrador.codigo;

    var Adm = await Administradores.find(element => element.id == message.to);
    if (Adm != null)
      Adm.Clientes.push(Cliente);
    else {
      Adm = Administrador;
      Administradores.push(Adm);
    }
    return Cliente;
  }

} catch (err) {
  logErroContexto(err, {
    from: message?.from,
    type: message?.type,
    body: message?.body,
    timestamp: message?.timestamp,
    notifyName: message?._data?.notifyName,
    id: message?._data?.id
  });
}

  }
  async function AlterarPessoaCampanha(Celular, Status){
    try {
      Celular = ObterCelularFormatado(Celular);
      const response = await axios.get("https://sistemasnaweb.com.br/Pessoa/RemoverPessoaCampanha?Celular=" + Celular + "&Status="+ Status + "&Adm="  + Administrador.codigo,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          responseType: 'json',
          httpsAgent: new https.Agent({ rejectUnauthorized: false })
        }
      );

      var Dados = response.data;

      console.log(Dados);
    }
    catch (e) {
      console.log(e);
      return [];
    }
  }
  async function ValidarVendaFromCelular(Celulares, Administrador) {

    try {
      const response = await axios.get("https://sistemasnaweb.com.br/Administrador/ValidarVendaFromCelular?Celulares=" + Celulares + "&Adm="  + Administrador.codigo,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          responseType: 'json',
          httpsAgent: new https.Agent({ rejectUnauthorized: false })
        }
      );

      var Dados = response.data;

      console.log(Dados);
      return Dados;

    }
    catch (e) {
      console.log(e);
      return [];
    }

  }
  function ObterCelularFormatado2(numeroWhatsApp) {
    // 1. Remove qualquer caractere que não seja número (isso já elimina o '@c.us' ou '+')
    let apenasNumeros = numeroWhatsApp.replace(/\D/g, '');

    // 2. Se o número tiver 13 dígitos e começar com '55' (Padrão WhatsApp Brasil), removemos o '55'
    if (apenasNumeros.length === 13 && apenasNumeros.startsWith('55')) {
        apenasNumeros = apenasNumeros.substring(2); 
    }

    // 3. Formata o número de 11 dígitos (DDD + 9 + 8 dígitos)
    if (apenasNumeros.length === 11) {
        return apenasNumeros.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    }

    // Opcional: Trata também números mais antigos sem o nono dígito (10 dígitos)
    if (apenasNumeros.length === 10) {
        return apenasNumeros.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    }

    // Se por algum motivo o número não se encaixar nos padrões acima, retorna como chegou
    return numeroWhatsApp;
}
  const processMessage = (message, client, Administrador) => queue.add(() => proc(message, client, Administrador));
  
  async function ObterWhatsApp(client, lid) {
  
  let numeroPn = client.info.wid._serialized;

      // 2. Verifica se a busca do LID retornou algo válido
      if (lid && lid._serialized) {
        var resultado = await client.getContactLidAndPhone(lid._serialized);
        
        // 3. Verifica se o resultado existe, se é um array com itens, e se tem o 'pn'
        if (Array.isArray(resultado) && resultado.length > 0 && resultado[0].pn) {
            numeroPn = resultado[0].pn;
        }
      }

      return numeroPn
  }
  async function start(client, sessionId) {
    try {
      //const unreadMessages = await client.getAllUnreadMessages();
      clientSessionRegistry[sessionId] = client;
      
      var lid = await client.getNumberId(client.info.wid._serialized);
      
      var numeroPn = await ObterWhatsApp(client, lid);

      var Celular = ObterCelularFormatado(numeroPn);
      console.log('Celular da sessão:', Celular);
      var Adm = await ObterInformacoesVendaWhats(Celular);

      Administradores.push(Adm);
      Administrador = Adm;

      client.on('message', message => processMessage(message, client, Adm));

      client.on('message_create', message => {
        // Verifica se a mensagem foi enviada por você
        /*if (message.fromMe) {
          console.log(message)
          var AdmVal = Administradores[0].Clientes.find(element => element.Codigo == message.to);

          if(AdmVal != null){
            AdmVal.AutoAtendimento = false;
          }
        }*/
      });
      
      queue.start();
      ObterCampanha(Adm);

    }
    catch (err) {
      //Faça algo se der erro em alguma das funções acima
      console.log("[ERRO FATAL]", err.message);

      setTimeout(() => {
        return client.destroy()
      }, 10000)
    }
  }

  async function ExibirProdutos(client, message, Administrador) {
    await client.sendMessage(message.from, await Cardapio(1, Administrador));
    await sleep(1500);
    await client.sendMessage(message.from, await ExibirSubMenuProdutos(Administrador));
  }


  const greetingMessage = () => {
    //let h = new Date().toLocaleTimeString('pt-BR', { hour: 'numeric', hour12: false });
    let h = new Date().getHours();
    if (h <= 5) return 'Boa madrugada';
    if (h < 12) return 'Bom dia';
    if (h < 18) return 'Boa tarde';
    return 'Boa noite';
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function RemoveEmoji(Text) {
    //console.log(Text);

    if(Text != null && Text != '')
      return Text.replace(/([\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2694-\u2697]|\uD83E[\uDD10-\uDD5D])/g, '');
    else
      return '';
  }

  async function Teste(client, message, Administrador) {
    //console.log(message);

    message.body = removeSpecialCharactersAndAccents(message.body);
    //console.log(message.body);
    var found = Administrador.Clientes.find(element => element.Codigo == message.from);

    if (message._data.isNewMsg) {
      if (message.type != 'ptt') {
        if (message.body.includes('.pdf') || message.body.includes('.jpg')) {
          var Resposta = new Object();
          Resposta.intent = 'ARQUIVOS';

          return Resposta;
        }
        else {

          if (message.type == 'chat') {
            var Resposta = '';
            var Operacao = parseInt(message.body);

            //se digitou um numero ... vai pra tela definida
            if (!isNaN(Operacao)) {
              switch (Operacao) {
                case 1:
                  Resposta = await ObterResposta('REALIZAR PEDIDO');
                  break;
                case 2:
                  Resposta = await ObterResposta('TEMPO DE ENTREGA');
                  break;
                case 3:
                  Resposta = await ObterResposta('PROMOÇÕES');
                  break;
                case 4:
                  Resposta = await ObterResposta('CARDAPIO');
                  break;
                case 5:
                  Resposta = await ObterResposta('ONDE ESTA MEU PEDIDO');
                  break;
                case 6:
                  Resposta = await ObterResposta('HORARIO DE FUNCIONAMENTO');
                  break;
                case 7:
                  Resposta = await ObterResposta('falar com uma pessoa');
                  found.AutoAtendimento = false;
                  break;
              }
            }
            else
              Resposta = await ObterResposta(message.body);


            if ((Resposta.score < 0.98) || Resposta.intent == 'None') { //resposta esta acertiva

              //var Operacao = parseInt(message.body);
              if (isNaN(Operacao))
                Resposta.intent = await CarregarBaseChat(message.body, Resposta.intent);
            }

            return Resposta;
          }
          else {
            if (found != null)
              found.Ajuda++;

            await client.sendMessage(message.from, 'Ops... Não entendemos esse tipo de arquivo ainda 😕');
            if (Administrador.Configuracao.enviarAjuda) {
              await sleep(2000);
              await client.sendMessage(message.from, AjudaPlataforma(Administrador));
            }
          }
        }
      }
      else {
        if (found != null)
          found.Ajuda++;

        await client.sendMessage(message.from, 'Não reproduzimos áudios no momento. 😕');
        if (Administrador.Configuracao.enviarAjuda) {
          await sleep(2000);
          await client.sendMessage(message.from, AjudaPlataforma(Administrador));
        }
      }

    }

  }
  async function Teste2(Resposta, found, client, message, Administrador) {
    switch (Resposta.intent) {
      case 'RASTREAMENTO':
        await client.sendMessage(message.from, await ObterInformacoesEntrega(ObterCelularFormatado(found.Codigo), Administrador));
        if (Administrador.Configuracao.enviarAjuda) {
          await sleep(2000);
          await client.sendMessage(message.from, AjudaPlataforma(Administrador));
        }
        break;
      case 'CONS_FUNCIONAMENTO':
        await client.sendMessage(message.from, await ConsultarHorarioFuncionamento(Administrador));
        if (Administrador.Configuracao.enviarAjuda) {
          await sleep(2000);
          await client.sendMessage(message.from, AjudaPlataforma(Administrador));
        }
        break;
      case 'ELOGIO':
        await client.sendMessage(message.from, Resposta.answer);
        break;
      case 'CANCELAMENTO':
        await client.sendMessage(message.from, Resposta.answer);
        await NotificarSistema(ObterCelularFormatado(found.Codigo), Administrador);
        break;
      case 'SAUDACAO':
        var Resp = Resposta.answer.replace('@NOME', found.Nome);
        await client.sendMessage(message.from, Resp);
        break;
      case 'RECLAMACAO':
        await client.sendMessage(message.from, Resposta.answer);
        break;
      case 'INTENCAO_PEDIDO':
        if (Administrador.Configuracao.tipoColeta == 'MANUAL') {
          if (Administrador.Configuracao.tipoMenu == 'PRODUTOS') {
            found.Menu = "PEDIDOMANUAL";
            found.Action = 'ADD_SELL_LANCHE';
            ExibirProdutos(client, message, Administrador);
          }
          else {
            found.Menu = "PEDIDOMANUAL";
            found.Action = 'ADD_LANCHE';

            await client.sendMessage(message.from, SegundaCamada(1, Administrador));
          }
        }
        else {
          if (Administrador.Configuracao.tipoColeta == 'HUMANA') {
            var Resp = Resposta.answer.replace('@LINK', 'https://sistemasnaweb.com.br/' + Administrador.configuracao.urlLoja + '  🔗')
            await client.sendMessage(message.from, Resp);
          }
          else {
            await client.sendMessage(message.from, 'Acesse nosso *catalogo* para realizar os *pedidos* 👇\nhttps://sistemasnaweb.com.br/' + Administrador.configuracao.urlLoja + '  🔗');
          }
        }
        break;
      case 'PEDIDO':

        if (Administrador.Configuracao.tipoColeta == 'MANUAL') {

          if (Administrador.Configuracao.tipoMenu == 'PRODUTOS') {
            found.Menu = "PEDIDOMANUAL";
            found.Action = 'ADD_SELL_LANCHE';
            ExibirProdutos(client, message, Administrador);
          }
          else {
            found.Menu = "PEDIDOMANUAL";
            found.Action = 'ADD_LANCHE';

            await client.sendMessage(message.from, SegundaCamada(1, Administrador));
          }


        }
        else {
          if (Administrador.Configuracao.tipoColeta == 'HUMANA') {
            //devolve o json formatado do pedido
            await client.sendMessage(message.from, 'Aguarde estamos *coletando* as informações de seu *pedido*. 🤗');
            //found.Venda = null;
            found.TentativasPedido++;

            if (found.TentativasPedido < 4) {
              var Pedido = await ColetarPedido(message.body, Administrador);

              //adiciona os itens da venda ... caso n tenha endereço pergunta o endereço

              if (Pedido != null) {
                if (Pedido.produtos != null || Pedido.pedido != null)
                  await AdicionarItemVendaFromWhatsApp(found, Pedido, Administrador);
                else {
                  await client.sendMessage(message.from, `Caso queira pedir algo🤩\n💡 Escreva Ex. *quero um NOME PRODUTO, um NOME PRODUTO*.`);
                  found.Menu = "MENU";
                }

                if (found.Venda != null && found.Venda.ItensVenda != null) {
                  await client.sendMessage(message.from, "Confira um Resumo\n" + await ResumoVenda(found));
                  await client.sendMessage(message.from, 'Confira o seu Pedido🤝\nDeseja confirmar o pedido?\n\n*Sim* 🟢 ou *Não* 🔴');
                  found.Menu = "ADDENTREGA";
                  found.Action = "CONFIRMARPEDIDO";
                }
                else {
                  if (Pedido.produtos != null) {
                    await client.sendMessage(message.from, 'Parece que o produto que você *digitou* não esta *disponível* ou foi *digitado de maneira incorreta!* 🤔');
                    await client.sendMessage(message.from, `Confira Produtos parecidos 🤩\nCaso queira algum escreva\n💡 Ex. *quero um NOME PRODUTO, um NOME PRODUTO*.`);
                    await client.sendMessage(message.from, await ObterProdutosWhereWhatsAPP(Pedido, Administrador));

                    found.Menu = "MENU";
                  }
                }
              }
              else {
                await client.sendMessage(message.from, 'Não entendi o que você quis dizer. 🤔');
              }
            }
            else {
              await client.sendMessage(message.from, 'Parece que você está tendo *dificuldades* em realizar o seu *pedido* 🤔\nConfira o nosso *catálogo*, é muito mais fácil. 👇\nhttps://sistemasnaweb.com.br/' + Administrador.configuracao.urlLoja + ' 🔗');
              found.TentativasPedido = 0;

            }
          }
          else {
            await client.sendMessage(message.from, 'Acesse o nosso *catálogo* para realizar os seus *pedidos* 👇\nhttps://sistemasnaweb.com.br/' + Administrador.configuracao.urlLoja + ' 🔗');
          }
        }
        break;
      case 'AGRADECIMENTO':
        await client.sendMessage(message.from, Resposta.answer);
        break;
      case 'QUALIDADE':
        await client.sendMessage(message.from, Resposta.answer);
        break;
      case 'CARDAPIO':
        if (Administrador.Configuracao.tipoColeta == 'MANUAL' || Administrador.Configuracao.tipoColeta == 'HUMANA') {
          await client.sendMessage(message.from, await Cardapio(0, Administrador));
        }
        else
          await client.sendMessage(message.from, 'Acesse o nosso *catálogo* para realizar os seus *pedidos* 👇\nhttps://sistemasnaweb.com.br/' + Administrador.configuracao.urlLoja + '  🔗');
        if (Administrador.Configuracao.enviarAjuda) {
          await sleep(2000);
          await client.sendMessage(message.from, AjudaPlataforma(Administrador));
        }
        break;
      case 'REMOVER':
        await client.sendMessage(message.from, "Aguarde estamos *coletando* as informações 🤗");
        var Pedido = await RemoverPedido(message.body, Administrador);
        if (Pedido != null) {
          var Rem = await RemoverItensVendaFromWhatsApp(found, Pedido);

          if (Rem) {
            await client.sendMessage(message.from, "Produto Removido com Sucesso 😍");

            if (found.Venda != null && found.Venda.ItensVenda != null && found.Venda.ItensVenda.length > 0) {
              await client.sendMessage(message.from, "Confira seu novo Resumo\n" + await ResumoVenda(found));
              await client.sendMessage(message.from, 'Confira seu Pedido🤝\nDeseja confirmar o pedido?\n\n*Sim* 🟢 ou *Não* 🔴');
            }
            else {
              await client.sendMessage(message.from, "Caso precisar estou a disposição 😍");

            }
          }
          else {
            await client.sendMessage(message.from, "Não consegui entender 🤔");
          }
        }
        else {
          await client.sendMessage(message.from, "Não consegui entender 🤔");
        }
        //await client.sendMessage(message.from, Resposta.answer);
        break;
      case 'PROMOCAO':
        var Valida = [];

        //FALA DO CASHBACK

        if (Administrador.configuracao.programaFidelidade) {
          await client.sendMessage(message.from, 'Compre pelo *APP* e ganhe pontos, e depois *troque-os* por premios *incríveis*.🥰\nConfira o nosso catálogo 👇\nhttps://sistemasnaweb.com.br/' + Administrador.configuracao.urlLoja + ' 🔗');
          await sleep(2000);
          Valida.push(1);
        }

        var Cupons = Administrador.Cupons;
        if (Cupons != null) {
          var i = 0;
          var Txt = '', Cup = '';

          while (i < Cupons.length) {
            if (Cupons[i].status) {
              var DataCupom = new Date(Cupons[i].validade);

              if (Cupons[i].usados < Cupons[i].quantidade && new Date() <= DataCupom) {
                if (Cupons[i].porcentagem) {
                  Cup = 'Desconto de *' + Cupons[i].valor.toFixed(2) + ' %*'
                }
                else {
                  Cup = 'Desconto de *R$ ' + Cupons[i].valor.toFixed(2) + '*';
                }

                Txt += 'Cupom: *' + Cupons[i].chave + `*   ${Cup} \n`;
              }

            }

            i++;
          }

          if (Txt != '') {
            await client.sendMessage(message.from, 'Confira nossos *Cupons* disponíveis em nosso *Catálogo*🤩' + '\n\n' + Txt + '\n\nAcesse agora 👉 https://sistemasnaweb.com.br/' + Administrador.configuracao.urlLoja + ' 🔗');
            Valida.push(1);
          }

        }

        var foundProdutos = Administrador.ProdutosCatalogo.filter(element => element.Promocao == 1);

        if (foundProdutos != null && foundProdutos.length > 0) {
                  
          var txtProdutos = '';
          var i = 0;
          while (i < foundProdutos.length) {
            txtProdutos+= foundProdutos[i].Nome + " - *R$ " + foundProdutos[i].PrecoVenda.toFixed(2).replace('.', ',') + '*\n';
            i++;
          }
          await sleep(2000);
          await client.sendMessage(message.from, 'Confira os nossos *produtos em Destaque* ou em *Promoção* 🤩\n\n' + txtProdutos);

          Valida.push(1);
        }

        console.log(Valida);

        if (Valida.length == 0) {
          await client.sendMessage(message.from, 'Infelizmente hoje não temos nenhuma promoção. 😕\n\nAcesse o nosso catálogo para mais informações 👇\nhttps://sistemasnaweb.com.br/' + Administrador.configuracao.urlLoja + ' 🔗');
        }

        if (Administrador.Configuracao.enviarAjuda) {
          await sleep(2000);
          await client.sendMessage(message.from, AjudaPlataforma(Administrador));
        }

        break;
      case 'ATENDENTE':
        var Resp = Resposta.answer.replace('@LINK', 'https://sistemasnaweb.com.br/' + Administrador.configuracao.urlLoja)
        await client.sendMessage(message.from, Resp);
        await NotificarSistema(ObterCelularFormatado(found.Codigo), Administrador);
        found.AutoAtendimento = false;
        break;
      case 'ENTREGA':
        var Txt = 'O tempo de *Entrega* hoje está em ' + Administrador.configuracao.prazoEntrega + ' Minutos\n\n';

        if (Administrador.Fretes != null) {
          for (var i = 0; i < Administrador.Fretes.length; i++) {
            if (Administrador.Fretes[i].valor == 0)
              Txt += '*Distância:* ' + (Administrador.Fretes[i].distancia / 1000).toFixed(2).replace('.', ',') + ' KM - Gratis 🤩\n';
            else
              Txt += '*Distância:* ' + (Administrador.Fretes[i].distancia / 1000).toFixed(2).replace('.', ',') + ' KM - *Valor:* R$ ' + Administrador.Fretes[i].valor.toFixed(2).replace('.', ',') + '\n';

            if (Administrador.Fretes[i].chave != '') {
              Txt += '*Bairro:* ' + Administrador.Fretes[i].chave + ' - *Valor:* R$ ' + Administrador.Fretes[i].valor.toFixed(2).replace('.', ',') + '\n';
            }
          }
        }
        else
          Txt += "Hoje estamos com *entrega grátis* 🤩"

        var Resp = Resposta.answer.replace('@LINK', 'https://sistemasnaweb.com.br/' + Administrador.configuracao.urlLoja)
        await client.sendMessage(message.from, Resp + '\n\n' + Txt);
        if (Administrador.Configuracao.enviarAjuda) {
          await sleep(2000);
          await client.sendMessage(message.from, AjudaPlataforma(Administrador));
        }
        break;
      case 'ARQUIVOS':
        await client.sendMessage(message.from, 'Que legal que o *pagamento* deu certo 😍\nCaso precise de algo é só me *dizer* aqui👇');
        break;
      case 'FINALIZAR':
        if (found.Venda.ItensVenda != null) {
          if (found.Venda.EnderecoEntrega != null) {
            if (found.Venda.FormaPagamento != null && found.Venda.FormaPagamento > 0) {
              ComunicarVendaDelivery(found, Administrador);
            }
            else {
              found.Menu = "PEDIDOMANUAL";
              found.Action = 'ADD_PAGAMENTO';

              await client.sendMessage(message.from, 'Estamos quase terminando... 😍\nAgora nos *forneça a forma de Pagamento*');
              await sleep(2000);
              await client.sendMessage(message.from, FormaPagamento(1, Administrador));
              found.Venda.Troco = 0;
            }
          }
          else {
            found.Menu = "PEDIDOMANUAL";
            found.Action = 'ADD_ENDERECO';

            await client.sendMessage(message.from, await ExibirEnderecos(found, 0, Administrador.Configuracao.retirada));
          }
        }
        else {
          if (Administrador.Configuracao.tipoColeta == 'MANUAL') {
            if (Administrador.Configuracao.tipoMenu == 'PRODUTOS') {
              found.Menu = "PEDIDOMANUAL";
              found.Action = 'ADD_SELL_LANCHE';
              ExibirProdutos(client, message, Administrador);
            }
            else {
              found.Menu = "PEDIDOMANUAL";
              found.Action = 'ADD_LANCHE';

              await client.sendMessage(message.from, SegundaCamada(1, Administrador));
            }
          }
          else {
            if (Administrador.Configuracao.tipoColeta == 'HUMANA') {
              var Resp = Resposta.answer.replace('@LINK', 'https://sistemasnaweb.com.br/' + Administrador.configuracao.urlLoja + '  🔗')
              await client.sendMessage(message.from, Resp);
            }
            else {
              await client.sendMessage(message.from, 'Acesse o nosso *catálogo* para realizar seus *pedidos* 👇\nhttps://sistemasnaweb.com.br/' + Administrador.configuracao.urlLoja + '  🔗');
            }
          }
        }
        break;
      case 'CARRINHO':
        found.Menu = "PEDIDOMANUAL";
        found.Action = 'VIEW_CARRINHO';
        await client.sendMessage(message.from, await ExibirCarrinho(found));
        break;
      default:
        found.Ajuda++;

        if (found.Ajuda < Administrador.Configuracao.maximoRespostas)
          await client.sendMessage(message.from, AjudaPlataforma(Administrador));
        else {
          await client.sendMessage(message.from, 'Parece que não estou conseguindo te ajudar 🥹');
          await sleep(2000);
          await client.sendMessage(message.from, 'Vou chamar um atendente para você 🙌');
          await NotificarSistema(ObterCelularFormatado(found.Codigo), Administrador);
          found.AutoAtendimento = false;
        }
    }

  }
  async function Teste3(found, client, message, Administrador) {
    switch (found.Menu) {
      case 'FINALIZAR':
        var Res = removeSpecialCharactersAndAccents(message.body.toUpperCase());

        if (Res == 'S' || Res == 'SIM' || Res == 'YES' || Res == 'Y') {

          /*if(found.Venda.FormaPagamento.Nome.toUpperCase().includes("PIX")){
            await ObterDadosPixFromWhats(found);
            await client.sendMessage(message.from, "\n*Pix Copia e Cola:*");
            await client.sendMessage(message.from, found.Pix);
          }
  
          ComunicarVendaDelivery(found);
          await client.sendMessage(message.from, "Compra Realizada com Sucesso! 😍\nLogo iniciará a *preparação* do seu pedido! Aguarde a atualização do status! 🟢");
          found.Menu = 'MENU';*/

          RealizarComunicacaoVenda(found, found.Venda.FormaPagamento, client, message, Administrador);
        }
        else {
          found.Menu = 'MENU';
          await client.sendMessage(message.from, 'Me diga o que você *deseja*, eu posso te *ajudar*! 😉');
        }
        break;
      case 'ADDENTREGA':
        if (found.Action == 'CONFIRMARPEDIDO') {
          var Res = removeSpecialCharactersAndAccents(message.body.toUpperCase());
          if (Res == 'S' || Res == 'SIM' || Res == 'YES' || Res == 'Y') {
            //confirmou o pedido
            //resolveu tudo em uma linha só

            if (found.Venda != null && found.Venda.ItensVenda != null && found.Venda.EnderecoEntrega != null && found.Venda.FormaPagamento != null) {
              //
              RealizarComunicacaoVenda(found, found.Venda.FormaPagamento, client, message, Administrador);
            }
            else {
              //endereco de entrega n foi digitado
              if (found.Venda != null && found.Venda.ItensVenda != null && found.Venda.EnderecoEntrega == null) {
                await client.sendMessage(message.from, 'Digite o endereço de Entrega 🚚\nDescrever *Rua, Número, Bairro, Cidade e se necessário referência* 💡\n_Ex: Rua Lauro Thomaz, 33 Pioneiro 2 Martinópolis SP_\n\nCaso prefira Escolha as opções Abaixo: 👇');
                await sleep(1500);
                await client.sendMessage(message.from, await ExibirEnderecos(found, 0));
                found.Action = 'CONFIRMARENTREGA'
              }
              else { //endereco de entrega digitado ja mando pro pagamento
                await client.sendMessage(message.from, 'Estamos quase terminando... 😍\nAgora nos *informe a forma de Pagamento*');
                await sleep(2000);
                await client.sendMessage(message.from, FormaPagamento(0, Administrador));

                found.Menu = 'ADDPAGAMENTO'
              }
            }

          }
          else {
            if (Res == 'N' || Res == 'NAO' || Res == 'NO') {
              await client.sendMessage(message.from, `Certo, nos informe o que deseja, ou se prefirir acesse nosso cardápio.👇\nhttps://sistemasnaweb.com.br/${Administrador.configuracao.urlLoja}  🔗`);
              found.Menu = 'MENU';
            }
            else {
              var Resposta = await Teste(client, message, Administrador);
              await Teste2(Resposta, found, client, message, Administrador);
              found.Menu = 'MENU';
            }
          }
        }
        else {
          if (await ValidarEndereco(message.body) === 'true') {
            var Endereco = new Object();
            Endereco.Codigo = 0;
            Endereco.Logradouro = message.body
            found.Venda.EnderecoEntrega = Endereco;
            found.Venda.TaxaEntrega = 3;

            if (found.Venda.FormaPagamento == null) {
              await client.sendMessage(message.from, "Endereço *Selecionado* com Sucesso! 🤗" + (found.Venda.TaxaEntrega > 0 ? "\nTaxa de Entrega Ficou em *R$ " + found.Venda.TaxaEntrega.toFixed(2).replace('.', ',') + "*" : ""));
              await sleep(2000);
              await client.sendMessage(message.from, 'Estamos quase terminando... 😍\nAgora nos *informe a forma de Pagamento*');
              await sleep(2000);
              await client.sendMessage(message.from, FormaPagamento(0, Administrador));

              found.Menu = "ADDPAGAMENTO";
            }
            else {
              var foundPagamento = Administrador.FormasPagamento.find(element => removeSpecialCharactersAndAccents(element.Nome.toUpperCase()) == Pag);
              if (foundPagamento != null) {
                RealizarComunicacaoVenda(found, foundPagamento, client, message, Administrador)
              }
              else {
                var Resposta = await Teste(client, message, Administrador);
                await Teste2(Resposta, found, client, message, Administrador);
              }
            }
          }
          else {
            //ver a resposta ... e qual o topico .... 
            const Opcao = parseInt(message.body);

            if (Opcao >= 0) {
              if (Opcao > 0) {
                var Endereco = new Object();
                Endereco.Codigo = ObterCodigoEndereco(found, Opcao);
                Endereco.Logradouro = ObterLogradouroEndereco(found, Opcao);

                found.Venda.EnderecoEntrega = Endereco;

                if (found.Venda.FormaPagamento == null) {
                  await client.sendMessage(message.from, "Endereço *Selecionado* com Sucesso! 🤗" + (found.Venda.TaxaEntrega > 0 ? "\nTaxa de Entrega Ficou em *R$ " + found.Venda.TaxaEntrega.toFixed(2).replace('.', ',') + "*" : ""));
                  await sleep(2000);
                  await client.sendMessage(message.from, 'Estamos quase terminando... 😍\nAgora nos *informe a forma de Pagamento*');
                  await sleep(2000);
                  await client.sendMessage(message.from, FormaPagamento(0, Administrador));

                  found.Menu = "ADDPAGAMENTO";
                }
                else {
                  RealizarComunicacaoVenda(found, found.Venda.FormaPagamento, client, message, Administrador);
                }
                //comunica a venda????
              }
              else {
                var Endereco = new Object();
                Endereco.Codigo = 0;
                Endereco.Logradouro = '';

                found.Venda.EnderecoEntrega = Endereco;

                if (found.Venda.FormaPagamento == null) {
                  await client.sendMessage(message.from, 'Estamos quase terminando... 😍\nAgora nos *informe a forma de Pagamento*');
                  await sleep(2000);
                  await client.sendMessage(message.from, FormaPagamento(0, Administrador));

                  found.Menu = "ADDPAGAMENTO";
                }
                else {
                  RealizarComunicacaoVenda(found, found.Venda.FormaPagamento, client, message, Administrador);
                }
                //comunica a venda ???
              }
            }
            else {
              var Resposta = await Teste(client, message, Administrador);
              await Teste2(Resposta, found, client, message, Administrador);
              found.Menu = 'MENU';
            }
          }
        }
        break;
      case 'ADDPAGAMENTO':
        const Opcao = parseInt(message.body);
        if (Opcao >= 0) {
          var foundPagamento = Administrador.FormasPagamento.find(element => element.Indice == Opcao);
          if (foundPagamento != null) {
            RealizarComunicacaoVenda(found, foundPagamento, client, message, Administrador)
          }
          else {
            var Resposta = await Teste(client, message, Administrador);
            await Teste2(Resposta, found, client, message, Administrador);
            found.Menu = 'MENU';
          }
        }
        else {
          var Resposta = await Teste(client, message, Administrador);
          await Teste2(Resposta, found, client, message, Administrador);
          found.Menu = 'MENU';
        }
        break;
      case 'PEDIDOMANUAL':
        ColetarPedidoManual(found, client, message, Administrador);
        break
    }
  }
  function ObterValorNumerico(Valor) {
    var foundNum = numerosPorExtenso.find(element => removeSpecialCharactersAndAccents(element.Extenso.toUpperCase()) == removeSpecialCharactersAndAccents(Valor.toUpperCase()));

    if (foundNum != null)
      return foundNum.Valor;
    else
      return NaN;
  }
  async function ColetarPedidoManual(found, client, message, Administrador) {
    var Operacao = parseInt(message.body);

    if (isNaN(Operacao))
      Operacao = ObterValorNumerico(message.body)

    //unicos comandas digitaveis nessa tela ... 
    if ((Operacao >= 0 || Operacao <= 0) || found.Action == 'ADD_SELL_ENDERECO' || found.Action == 'ADD_OBS' || found.Action == 'TROC_PAGAMENTO' || message.body.toUpperCase() == 'FINALIZAR') {
      if (found.Action == "CONS_ANDENTREGA") {
        if (Operacao == 0) {
          found.Action = "MENU";
          found.Menu = "MENU";
          await client.sendMessage(message.from, `Qualquer coisa que precisar só nos informar que estamos a disposição 😉\nSe prefiririr acesse nossa plataforma e *realize pedidos* agora mesmo 👇\nhttps://sistemasnaweb.com.br/${Administrador.configuracao.urlLoja}  🔗`);
          return;
        }
      }

      if (found.Action === "CONS_FUNCIONAMENTO") {
        if (Operacao == 0) {
          found.Action = "MENU";
          found.Menu = "MENU";
          await client.sendMessage(message.from, `Qualquer coisa que precisar só nos informar que estamos a disposição 😉\nSe prefiririr acesse nossa plataforma e *realize pedidos* agora mesmo 👇\nhttps://sistemasnaweb.com.br/${Administrador.configuracao.urlLoja}  🔗`);
          return;
        }
      }

      if (found.Action == "ADD_LANCHE") {
        if (Operacao == 0) {
          found.Action = "MENU";
          found.Menu = "MENU";
          await client.sendMessage(message.from, `Qualquer coisa que precisar, é só nos informar. Estamos a disposição. 😉\nSe preferir acesse nossa plataforma e *realize pedidos* agora mesmo 👇\nhttps://sistemasnaweb.com.br/${Administrador.configuracao.urlLoja}  🔗`);
          await sleep(2000)
          await client.sendMessage(message.from, AjudaPlataforma(Administrador));

          return;
        }
        else {
          found.Action = "SEL_LANCHE";
          //await client.sendMessage(message.from, SegundaCamada(Operacao));     
          //return;
        }
      }

      if (found.Action == "VIEW_CARRINHO") {

        if (Operacao == 0) {

          if (Administrador.Configuracao.tipoMenu == 'PRODUTOS') {
            found.Action = 'ADD_SELL_LANCHE';
            ExibirProdutos(client, message, Administrador);
          }
          else {
            found.Action = "SEL_LANCHE";
            await client.sendMessage(message.from, SegundaCamada(1, Administrador));
          }

          return;
        }
        else {
          var Acao = ExcluirItemCarrinho(found, Operacao);

          if (Acao == 1) {
            await client.sendMessage(message.from, 'Produto *Excluído* com Sucesso!');
            await sleep(2000);
            await client.sendMessage(message.from, ExibirCarrinho(found));
            return;
          }
          else {
            if (Acao == -1) {
              await client.sendMessage(message.from, 'Produto não Econtrado!');
              await sleep(2000);
              await client.sendMessage(message.from, ExibirCarrinho(found));

              return;
            }
            else {
              if (Acao == -10) {
                await client.sendMessage(message.from, 'Nenhum produto no carrinho!');
                await client.sendMessage(message.from, ExibirCarrinho(found));

                return;
              }
              else {
                if (Acao == -15) {
                  await client.sendMessage(message.from, 'Ops... *Produto* não Econtrado!');
                  await client.sendMessage(message.from, ExibirCarrinho(found));

                  return;
                }
              }
            }
          }
        }

      }

      if (found.Action == "SEL_LANCHE") {
        if (Operacao == 0) {
          found.Action = "MENU";
          found.Menu = "MENU";
          await client.sendMessage(message.from, `Qualquer coisa que precisar, é só nos informar. Estamos a disposição. 😉\nSe preferir acesse nossa plataforma e *realize pedidos* agora mesmo. 👇\nhttps://sistemasnaweb.com.br/${Administrador.configuracao.urlLoja}`);
          await sleep(2000)
          await client.sendMessage(message.from, AjudaPlataforma(Administrador));

          return;
        }
        else {
          if (Operacao <= Administrador.Grupos.length + 2) {
            if (Operacao == Administrador.Grupos.length + 1) {
              found.Action = "ADD_ENDERECO";
              if (found.Venda != null && found.Venda.ItensVenda.length > 0) {
                await client.sendMessage(message.from, await ExibirEnderecos(found));
                return;
              }
              else {
                if (Administrador.Configuracao.tipoMenu == 'PRODUTOS') {
                  found.Action = 'ADD_SELL_LANCHE';
                }
                else {
                  found.Action = "SEL_LANCHE";
                }

                await client.sendMessage(message.from, 'Primeiro Adicione alguns *Produtos* ao seu *Carrinho* selecionando os produtos *acima* 😍☝️');
                return;
              }
            }
            else {
              if (Operacao == Administrador.Grupos.length + 2) {
                found.Action = "VIEW_CARRINHO";
                await client.sendMessage(message.from, ExibirCarrinho(found));
                return;
              }
              else {
                found.Action = "ADD_SELL_LANCHE";
                found.GrupoSell = Operacao;
                await client.sendMessage(message.from, TerceiraCamada(Operacao, Administrador));
                return;
              }

            }
          }
          else {
            if (message.body.toUpperCase() == 'FINALIZAR') {
              if (found.Venda != null && found.Venda.ItensVenda != null && found.Venda.ItensVenda.length > 0) {
                await client.sendMessage(message.from, ExibirEnderecos(found));
                //ColetarPedidoManual(found);

                found.Menu = "PEDIDOMANUAL";
                found.Action = "ADD_ENDERECO";
              }
              else {
                await client.sendMessage(message.from, "Primeiro Adicione alguns *Produtos* ao seu *Carrinho* selecionando os produtos *acima* 😍☝️");
              }
            }
            else {
              await client.sendMessage(message.from, "*Opção inválida!*\nVou te enviar novamente as minhas *opções!*");
              await sleep(2000);
              await client.sendMessage(message.from, SegundaCamada(1, Administrador));
              return;
            }
          }
        }
      }

      if (found.Action == "ADD_SELL_LANCHE") {
        if (Operacao == 0) {

          if (Administrador.Configuracao.tipoMenu == 'PRODUTOS') {
            found.Action = "MENU";
            found.Menu = "MENU";
            await client.sendMessage(message.from, `Qualquer coisa que precisar, é só nos informar. Estamos a disposição. 😉\nSe preferir acesse nossa plataforma e *realize pedidos* agora mesmo. 👇\nhttps://sistemasnaweb.com.br/${Administrador.configuracao.urlLoja}`);
            await sleep(2000)
            await client.sendMessage(message.from, AjudaPlataforma(Administrador));

            return;
          }
          else {
            found.Action = "SEL_LANCHE";
            await client.sendMessage(message.from, SegundaCamada(1, Administrador));
            return;
          }

        }
        else {
          if (Operacao <= Administrador.ProdutosCatalogo.length + 2) {
            if (Operacao == Administrador.ProdutosCatalogo.length + 1) {
              if (found.Venda != null && found.Venda.ItensVenda != null && found.Venda.ItensVenda.length > 0) {
                await client.sendMessage(message.from, ExibirEnderecos(found));
                //ColetarPedidoManual(found);

                found.Menu = "PEDIDOMANUAL";
                found.Action = "ADD_ENDERECO";
                return;
              }
              else {
                if (Administrador.Configuracao.tipoMenu == 'PRODUTOS') {
                  found.Action = 'ADD_SELL_LANCHE';
                }
                else {
                  found.Action = "SEL_LANCHE";
                }

                await client.sendMessage(message.from, "Primeiro Adicione alguns *Produtos* ao seu *Carrinho* selecionando os produtos *acima* 😍☝️");
                return;
              }
            }
            else {
              if (Operacao == Administrador.ProdutosCatalogo.length + 2) {
                found.Action = "VIEW_CARRINHO";
                await client.sendMessage(message.from, ExibirCarrinho(found));
                return;
              }
              else {
                var Retorno = await AdicionarItemVenda(Operacao, found, Administrador);

                if (Retorno) {
                  found.Action = "ADD_QTD";
                  found.ProdutoSell = Operacao;
                  await client.sendMessage(message.from, "Digite a *quantidade* desejada?\n\n *0* - Voltar aos Produtos");
                  return;
                }
                else {
                  await client.sendMessage(message.from, "*Opção inválida!*\nVou te enviar novamente as minhas *opções!*");
                  await sleep(2000);
                  if (Administrador.Configuracao.tipoMenu == 'PRODUTOS') {
                    found.Action = 'ADD_SELL_LANCHE';
                    ExibirProdutos(client, message, Administrador);
                  }
                  else {
                    found.Action = "ADD_SELL_LANCHE";
                    await client.sendMessage(message.from, TerceiraCamada(found.GrupoSell, Administrador));

                  }

                  return;
                }
              }
            }
          }
          else {
            await client.sendMessage(message.from, "*Opção inválida!*\nVou te enviar novamente as minhas *opções!*");
            await sleep(2000);
            if (Administrador.Configuracao.tipoMenu == 'PRODUTOS') {
              found.Action = 'ADD_SELL_LANCHE';
              ExibirProdutos(client, message, Administrador);
            }
            else {
              found.Action = "ADD_SELL_LANCHE";
              await client.sendMessage(message.from, TerceiraCamada(found.GrupoSell, Administrador));

            }

            return;
          }
        }
      }

      if (found.Action == "ADD_QTD") {
        if (Operacao > 0) {
          found.Action = "ADD_OBS";
          AdicionarQuantidade(Operacao, found);
          await client.sendMessage(message.from, "Deseja adicionar alguma *Observação* neste Produto?\n_Ex. quero que adicione algo, ou quero que remova algo_\n\n*0* - Para Continuar!");
          return;
        }
        else {
          if (Operacao == 0) {
            found.Menu = "PEDIDOMANUAL";
            RemoverQuantidade(found);

            if (Administrador.Configuracao.tipoMenu == 'PRODUTOS') {
              found.Action = 'ADD_SELL_LANCHE';
              ExibirProdutos(client, message, Administrador);
            }
            else {
              found.Action = "SEL_LANCHE";
              await client.sendMessage(message.from, SegundaCamada(1, Administrador));
            }

          }
          else {
            await client.sendMessage(message.from, 'Está quantidade é *inválida*! 😕');
            await sleep(1500);
            await client.sendMessage(message.from, "Digite a *quantidade* desejada?\n\n *0* - voltar aos Produtos");
            return;
          }
        }
      }

      if (found.Action == "ADD_OBS") {
        if (Operacao == 0) {
          await client.sendMessage(message.from, "Produto *adicionado* com Sucesso! 🥰\nCaso tenha interesse, *adicione* mais produtos. 😉");
          await sleep(4000)

          if (Administrador.Configuracao.tipoMenu == 'PRODUTOS') {
            found.Action = 'ADD_SELL_LANCHE';
            ExibirProdutos(client, message, Administrador);
          }
          else {
            found.Action = "SEL_LANCHE";
            await client.sendMessage(message.from, SegundaCamada(1, Administrador));
          }

          return;
        }
        else {
          if (Operacao != 0) {
            AdicionarObservacao(message.body, found);
          }
          await client.sendMessage(message.from, "Produto *adicionado* com Sucesso! 🥰\nCaso tenha interesse, *adicione* mais produtos. 😉");
          await sleep(4000)

          if (Administrador.Configuracao.tipoMenu == 'PRODUTOS') {
            ExibirProdutos(client, message, Administrador);
            found.Action = 'ADD_SELL_LANCHE';

          }
          else {
            await client.sendMessage(message.from, SegundaCamada(1, Administrador));
            found.Action = "SEL_LANCHE";
          }
          return;
        }
      }

      if (found.Action == "ADD_SELL_ENDERECO") {
        if (Operacao == 0) {
          found.Action = "ADD_ENDERECO";
          await client.sendMessage(message.from, await ExibirEnderecos(found));
          return;
        }


        var Endereco = new Object();
        Endereco.Codigo = 0;
        Endereco.Logradouro = message.body;

        found.Venda.EnderecoEntrega = Endereco;

        //console.log(Administrador.configuracao);
        await ObterLocalizacao(found, Administrador.configuracao.enderecoExibicao, message.body, 0, 0, Administrador);
        if (found.Venda.TaxaEntrega >= 0) {
          found.Action = "ADD_PAGAMENTO";
          await client.sendMessage(message.from, "Endereço *Selecionado* com Sucesso! 🤗" + (found.Venda.TaxaEntrega > 0 ? "\nTaxa de Entrega Ficou em *R$ " + found.Venda.TaxaEntrega.toFixed(2).replace('.', ',') + "*" : ""));
          await sleep(2000);
          await client.sendMessage(message.from, 'Estamos quase terminando 😍\nAgora nos *forneça a forma de Pagamento*');
          await sleep(2000);
          await client.sendMessage(message.from, FormaPagamento(0, Administrador));
          found.Venda.Troco = 0;
          return;
        }
        else {
          await client.sendMessage(message.from, "Endereço fora da Area de Entrega!");
          await client.sendMessage(message.from, await ExibirEnderecos(found));
          found.Action = "ADD_ENDERECO";
          return;
        }
      }

      if (found.Action == "ADD_ENDERECO") {
        //console.log('devia ta aqui, mas por algum motivo que nao sei não to')

        if (Operacao == 0) {

          found.TaxaEntrega = 0;

          if (Administrador.Configuracao.tipoMenu == 'PRODUTOS') {
            found.Menu = "PEDIDOMANUAL";
            found.Action = 'ADD_SELL_LANCHE';
            ExibirProdutos(client, message, Administrador);
            return;
          }
          else {
            found.Action = "SEL_LANCHE";
            await client.sendMessage(message.from, SegundaCamada(1, Administrador));
            return;
          }
        }
        else {
          var h = (found.Enderecos == null ? 0 : found.Enderecos.length);

          if (Operacao == h + 2) {
            found.Action = "ADD_SELL_ENDERECO";
            await client.sendMessage(message.from, 'Digite o endereço de Entrega 🚚\nDescrever *Rua, Número, Bairro, Cidade e se necessário Referência* 💡\n_Ex: Rua Lauro Thomaz, 33 Pioneiro 2 Martinópolis SP_\n*0* - Voltar para os *endereços*!');
            return;
          }
          else {
            if (Operacao == h + 1) {
              found.Action = "ADD_PAGAMENTO";

              var Endereco = new Object();
              Endereco.Codigo = 0;
              Endereco.Logradouro = '';

              found.Venda.EnderecoEntrega = Endereco;

              found.Venda.TaxaEntrega = 0;
              await client.sendMessage(message.from, "Endereço *Selecionado* com Sucesso! 🤗" + (found.Venda.TaxaEntrega > 0 ? "\nTaxa de Entrega Ficou em *R$ " + found.Venda.TaxaEntrega.toFixed(2).replace('.', ',') + "*" : ""));
              await sleep(2000);
              await client.sendMessage(message.from, 'Estamos quase terminando... 😍\nAgora nos *informe a forma de Pagamento*');
              await sleep(2000);
              await client.sendMessage(message.from, FormaPagamento(0, Administrador));
              found.Venda.Troco = 0;
              return;
            }
            else {
              if (Operacao <= h + 2) {
                var Endereco = new Object();
                Endereco.Codigo = ObterCodigoEndereco(found, Operacao);
                Endereco.Logradouro = ObterLogradouroEndereco(found, Operacao);

                found.Venda.EnderecoEntrega = Endereco;

                await ObterLocalizacao(found, Administrador.configuracao.enderecoExibicao, await ObterLogradouroEndereco(found, Operacao), 0, 0, Administrador);

                if (found.Venda.TaxaEntrega >= 0) {
                  found.Action = "ADD_PAGAMENTO";
                  await client.sendMessage(message.from, "Endereço *Selecionado* com Sucesso! 🤗" + (found.Venda.TaxaEntrega > 0 ? "\nTaxa de Entrega Ficou em *R$ " + found.Venda.TaxaEntrega.toFixed(2).replace('.', ',') + "*" : ""));
                  await sleep(1500);
                  await client.sendMessage(message.from, 'Estamos quase terminando... 😍\nAgora nos *informe a forma de Pagamento*');
                  await sleep(2000);
                  await client.sendMessage(message.from, FormaPagamento(0, Administrador));
                  found.Venda.Troco = 0;
                  return;
                }
                else {
                  await client.sendMessage(message.from, "Endereço fora da Área de Entrega!");
                  await client.sendMessage(message.from, await ExibirEnderecos(found));
                  found.Action = "ADD_ENDERECO";
                  return;

                }
              }
              else {
                await client.sendMessage(message.from, "*Opção inválida!*\nVou te enviar novamente as minhas *opções!*");
                await sleep(2000);
                await client.sendMessage(message.from, await ExibirEnderecos(found));
                return;
              }
            }
          }

        }
      }

      if (found.Action == "ADD_PAGAMENTO") {
        if (Operacao == 0) {
          found.Action = "ADD_ENDERECO";
          await client.sendMessage(message.from, await ExibirEnderecos(found));
          return;
        }
        else {
          var foundPagamento = Administrador.FormasPagamento.find(element => element.Indice == Operacao);

          if (foundPagamento != null) {
            found.Venda.FormaPagamento = foundPagamento;

            if (foundPagamento.Nome.toUpperCase().includes("DINHEIRO")) {
              await client.sendMessage(message.from, `Vai Precisar de Troco? Digite o valor que irá *PAGAR EM DINHEIRO* 💵\nValor da sua Venda *R$ ${ObterValorVenda(found).toFixed(2).replace('.', ',')}*`);
              found.Action = "TROC_PAGAMENTO";
              return;

            }
            else {

              if (foundPagamento.Nome.toUpperCase().includes("PIX")) {
                if (Administrador.Configuracao.tipoPix.toUpperCase() == 'OFFLINE')
                  await ObterDadosPixFromWhats(found, Administrador);
                else
                  await ObterDadosPixOnline(found, Administrador);
              }
              else
                found.Pix = '';

              await client.sendMessage(message.from, "Confira um Resumo\n" + await ResumoVenda(found));
              await sleep(2000);
              await client.sendMessage(message.from, "Dê uma olhada no seu *pedido*, e se estiver *tudo certo é só digitar a opção* correspondente. 🥰\n\n*1 - Finalizar Pedido*\n*0 - Voltar para os Produtos*");

              found.Action = "CONFIRM_PAGAMENTO";
              return;
            }

          }
          else {
            await client.sendMessage(message.from, "*Opção inválida!*\nVou te enviar novamente as minhas *opções!*");
            await sleep(2000);
            await client.sendMessage(message.from, FormaPagamento(0, Administrador));
            return;
          }

        }

      }

      if (found.Action == "TROC_PAGAMENTO") {
        if (ValidarInt(message.body)) {
          var Troco = parseFloat(message.body.replace(',', '.').replace(/[^0-9.,]/g, ""));
          console.log(message.body.replace('.', ',').replace(/[a-zA-Z]/g, ""));
          
          if (Troco > ObterValorVenda(found)) {
            found.Venda.Troco = Troco - ObterValorVenda(found);

            await client.sendMessage(message.from, "Confira um Resumo\n" + await ResumoVenda(found));
            await sleep(2000);
            await client.sendMessage(message.from, "Dê uma olhada no seu *pedido*, e se estiver tudo *certo*, é só digitar a opção correspondente🥰\n\n*1 - Finalizar Pedido*\n*0 - Voltar para os Produtos*");

            found.Action = "CONFIRM_PAGAMENTO";
            return;
          }
          else {
            await client.sendMessage(message.from, `Valor *Menor* que valor da *Venda*! 😗\nSua *venda* está em *R$ ${ObterValorVenda(found).toFixed(2).replace('.', ',')}* forneça um *valor* acima disso 😜 `);
            return;
          }

        }
        else {
          await client.sendMessage(message.from, "Valor inválido!");
          return;
        }
      }

      if (found.Action == "CONFIRM_PAGAMENTO") {
        if (Operacao == 0) {
          if (Administrador.Configuracao.tipoMenu == 'PRODUTOS') {
            found.Menu = "PEDIDOMANUAL";
            found.Action = 'ADD_SELL_LANCHE';
            ExibirProdutos(client, message, Administrador);
            return;
          }
          else {
            found.Action = "SEL_LANCHE";
            await client.sendMessage(message.from, SegundaCamada(1, Administrador));
            return;
          }
        }
        else {
          if (Operacao == 1) {
            ComunicarVendaDelivery(found, Administrador);
            await client.sendMessage(message.from, "Compra Realizada com Sucesso! 😍\nLogo iniciará a *preparação* do seu pedido. Aguarde a atualização do status! 🟢");

            if (found.Pix != null && found.Pix != "") {
              await sleep(2000)
              await client.sendMessage(message.from, "\n*Segue o Pix Copia e Cola:*\nAcesse o APP do banco e vá na opção *Pix Copia e Cola*, é bem fácil\nassim que efetuar o pagamento, nos envie o comprovante por aqui! 😉");
              await sleep(2000)
              await client.sendMessage(message.from, "\nChave com validade de 15 Minutos ⏰");
              await sleep(2000)
              await client.sendMessage(message.from, found.Pix);
            }

            found.Action = "INICIAL";
            found.Menu = "MENU";
            found.Venda = null;
            found.Pix = null;
            found.CodigoPagamento = null;
            //Clientes.splice(found, 1); 
            return;

          }
          else {
            await client.sendMessage(message.from, "*Opção inválida!*\nVou te enviar novamente as minhas *opções!*");
            await sleep(2000);
            await client.sendMessage(message.from, "Dê uma olhada no seu *pedido*, e se estiver *tudo certo é só digitar a opção* correspondente. 🥰\n\n*1 - Finalizar Pedido*\n*0 - Voltar para os Produtos*");

            found.Action = "CONFIRM_PAGAMENTO";
            return;
          }
        }
      }

      if (found.Action == "FALAR_ATENDENTE") {
        if (message.body.toUpperCase() == "MENU") {
          found.Action = "MENU";
          found.Menu = "MENU";
          await client.sendMessage(message.from, `Qualquer coisa que precisar só nos informar que estamos a disposição 😉\nSe prefiririr acesse nossa plataforma e *realize pedidos* agora mesmo 👇\nhttps://sistemasnaweb.com.br/${Administrador.configuracao.urlLoja}`);
          return
        }
      }
    }
    else {
      var Resposta = await Teste(client, message, Administrador);
      found.Menu = 'MENU';
      await Teste2(Resposta, found, client, message, Administrador);
      return;
    }
  }
  async function RealizarComunicacaoVenda(found, foundPagamento, client, message, Administrador) {
    var FormasPagamento = Administrador.FormasPagamento;

    if (foundPagamento == null) {
      var Pag = removeSpecialCharactersAndAccents(message.body).toUpperCase().replace('CARTAO', 'DEBITO');

      foundPagamento = FormasPagamento.find(element => removeSpecialCharactersAndAccents(element.Nome.toUpperCase()) == Pag);
    }

    if (foundPagamento != null) {
      found.Venda.FormaPagamento = foundPagamento;

      if (foundPagamento.Nome.toUpperCase().includes("PIX")) {
        if (Administrador.Configuracao.tipoPix.toUpperCase() == 'OFFLINE')
          await ObterDadosPixFromWhats(found, Administrador);
        else
          await ObterDadosPixOnline(found, Administrador);

        await sleep(2000);
        await client.sendMessage(message.from, "\n*Segue o Pix Copia e Cola:*\nAcesse o APP do banco e vá na opção *Pix Copia e Cola*, é bem fácil\nassim que efetuar o pagamento, nos envie o comprovante por aqui! 😉");
        await sleep(2000);
        await client.sendMessage(message.from, "\nChave com validade de 15 Minutos ⏰");
        await sleep(2000);
        await client.sendMessage(message.from, found.Pix);
      }

      ComunicarVendaDelivery(found, Administrador);
      await client.sendMessage(message.from, "Compra Realizada com Sucesso! 😍\nLogo iniciará a *preparação* do seu pedido. Aguarde a atualização do status! 🟢");

      found.Action = "INICIAL";
      found.Menu = "MENU";
      found.Venda = null;
      found.Pix = null;
      found.CodigoPagamento = null;
    }
  }

  async function SaudacaoInicial(message, client, Cliente, Administrador) {
    var Saudacao = 'Olá, @HOR ';
    Saudacao = Saudacao.replace('@HOR', await greetingMessage());

    //client.simulateTyping(message.from, true)

    if(Administrador.Configuracao.mensagemInicial == ''){
      await client.sendMessage(message.from, Saudacao + Cliente.Nome + '\nSeja bem-vindo(a) ao nosso autoatendimento! 🤖\n' + AjudaPlataforma(Administrador));
    }
    else{
      await client.sendMessage(message.from, Administrador.Configuracao.mensagemInicial.replaceAll('<br>', '\n'));
    }
  }
  async function ObterInformacoesVendaWhats(Celular) {

    try {
      const response = await axios.get("https://sistemasnaweb.com.br/Administrador/ObterInformacoesVendaWhats?Celular=" + Celular,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          responseType: 'json',
          httpsAgent: new https.Agent({ rejectUnauthorized: false })
        }
      );


      var Dados = response.data;
      var Retorno = ObterProdutos(Dados.produtos);

      Dados.adm.Grupos = Retorno.Grupos;
      Dados.adm.ProdutosCatalogo = Retorno.ProdutosCatalogo;
      Dados.adm.HorarioFuncionamento = Dados.horarioFuncionamento;
      Dados.adm.FormasPagamento = ObterTipoPagamento(Dados.tiposPagamento);
      Dados.adm.Clientes = [];
      Dados.adm.Fretes = Dados.fretes;
      Dados.adm.Cupons = Dados.cupons;
      Dados.adm.Configuracao = Dados.configuracao;

      //Administradores.push(Dados.adm);
      //Administrador = Dados.Adm;

      return Dados.adm;

    }
    catch (e) {
      
      console.log(e);
    
      // Formatação do Log
      const dataHora = new Date().toLocaleString('pt-BR');
      const logMensagem = `[${dataHora}] Erro no celular ${Celular}:\n${e.stack || e.message}\n----------------------------------------\n`;
      
      // Definição do caminho do arquivo
      const logPath = path.join(__dirname, 'erros_venda_whats.log'); 

        try {
          // Gravação do arquivo em modo append (adiciona ao final sem apagar o que já existe)
          await fs.appendFile(logPath, logMensagem, 'utf8');
        } catch (logErro) {
          console.error("Falha ao tentar gravar o log de erro em disco:", logErro);
        }

    }

  }

  function FormatarData(data) {
    if (data != '' && data != null) {
      let dia = data.getDate().toString().padStart(2, '0');
      let mes = (data.getMonth() + 1).toString().padStart(2, '0');
      let ano = data.getFullYear();
      let hora = data.getHours().toString().padStart(2, '0');
      let min = data.getMinutes().toString().padStart(2, '0');
      let dataEHoraBrasil = `${dia}/${mes}/${ano} as ${hora}:${min}`;

      return dataEHoraBrasil;
    }
    else
      return '';
  }
  async function ValidarHorarioFuncionamento(Administrador) {
    try {
      var Retorno = new Object();
      HorarioFuncionamento = Administrador.HorarioFuncionamento;
      if (HorarioFuncionamento != null) {

        var D = new Date();
        var Dia = D.getDay() + 1;
        var Hora = D.getHours();
        var Minutos = D.getMinutes();

        var data1 = '';
        var data2 = '';

        for (var i = 0; i < HorarioFuncionamento.length; i++) {
          if (Dia == HorarioFuncionamento[i].codigoDia) {
          
          var abertura = HorarioFuncionamento[i].abertura;
          var fechamento = HorarioFuncionamento[i].fechamento;
          var [h, m, s] = abertura.split(":").map(Number);
          var [hh, mm, ss] = fechamento.split(":").map(Number);

            var d = new Date();
            data1 = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
            data2 = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm);


            if (d >= data1 && d <= data2) {
              Retorno.Status = true;
              Retorno.Data = '';

              return Retorno;
            }
          }
        }



        if (data1 == '') {
          //n achou ... varre ate achar um dia
          var AchouData = false;

          var d = new Date();
          while (!AchouData && Dia <= 7) {
            for (var i = 0; i < HorarioFuncionamento.length; i++) {
              if (Dia == HorarioFuncionamento[i].codigoDia) {

                var abertura = HorarioFuncionamento[i].abertura;
                var fechamento = HorarioFuncionamento[i].fechamento;
                var [h, m, s] = abertura.split(":").map(Number);
                var [hh, mm, ss] = fechamento.split(":").map(Number);

                data1 = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
                data2 = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm);

                AchouData = true;
              }
            }

            if (Dia == 7 && !AchouData) {
              d.setDate(d.getDate() + 1);
              Dia = 1
            }
            else {
              d.setDate(d.getDate() + 1);
              Dia++;
            }
          }


          Retorno.Status = false;
          Retorno.Data = FormatarData(data1);

          return Retorno;
        }


        Retorno.Status = false;
        Retorno.Data = (data1 != null && data1.toLocaleTimeString().length > 5) ? data1.toLocaleTimeString().substring(0, 5) : '';

        return Retorno;
      }
      else {
        Retorno.Status = true;
        Retorno.Data = '';

        return Retorno;
      }
    }
    catch (e) {
      console.log(e);

      Retorno.Status = false;
      Retorno.Data = '';

      return Retorno;
    }
  }
  function ObterTipoPagamento(Dados) {
    try {
      var FormasPagamento = [];

      for (var i = 0; i < Dados.length; i++) {
        var TipoPmto = new Object();

        TipoPmto.Codigo = Dados[i].codigo;
        TipoPmto.Nome = Dados[i].nome;
        TipoPmto.Indice = i + 1;

        if (TipoPmto.Nome.toUpperCase() != 'ONLINE')
          FormasPagamento.push(TipoPmto);
      }

      return FormasPagamento;
    }
    catch (e) {
      console.log(e);
    }
  }
  function ObterProdutos(Dados) {

    try {
      var Retorno = new Object();

      var Grupos = [];
      var ProdutosCatalogo = [];
      var count = 1;
      var Promocao = 0;
      var CC = 1;
      for (var i = 0; i < Dados.length; i++) {

        //verifica se aquele grupo ja est ano array
        var found = Grupos.find(element => element.Codigo == Dados[i].subGrupo.codigo);
    
        if(Dados[i].precoPromocao > 0 || Dados[i].subGrupo.descricao == "Destaques")
          Promocao = 1;
        else
          Promocao = 0

        if (found == null) {
          //grupo n existe ... cria o grupo e adiciona o produto

          var Grupo = new Object();
          Grupo.Codigo = Dados[i].subGrupo.codigo;
          Grupo.Nome = Dados[i].subGrupo.descricao;
          Grupo.Indice = count;
          Grupo.Produtos = [];


          //pergunta se o produto tem variacao 
          if (Dados[i].variacoes != null) {
            for (var h = 0; h < Dados[i].variacoes.length; h++) {
              var foundVariacao = Grupo.Produtos.find(element => element.Codigo == Dados[i].variacoes[h].codigo);

              if (foundVariacao == null) {
                var Produto = new Object();
                Produto.CodigoPai = Dados[i].codigo;
                Produto.Codigo = Dados[i].variacoes[h].codigo;
                Produto.Nome = Dados[i].variacoes[h].nome;
                Produto.PrecoVenda = Dados[i].variacoes[h].precoVenda;
                Produto.Promocao = Promocao;
                Produto.Observacao = Dados[i].observacao;
                Produto.Associacao = Dados[i].associacao;
                Produto.Indice = Grupo.Produtos.length + 1;
                Produto.IndiceGeral = CC;
                Produto.Operacao = 1;
                Grupo.Produtos.push(Produto);

                ProdutosCatalogo.push(Produto);
              }

              CC++;
            }
          }
          else {
            var Produto = new Object();
            Produto.CodigoPai = Dados[i].codigo;
            Produto.Codigo = Dados[i].codigo;
            Produto.Nome = Dados[i].nome;
            Produto.PrecoVenda = Dados[i].precoPromocao > 0 ? Dados[i].precoPromocao : Dados[i].precoVenda;
            Produto.Promocao = Promocao;
            Produto.Indice = Grupo.Produtos.length + 1;
            Produto.IndiceGeral = CC;
            Produto.Observacao = Dados[i].observacao;
            Produto.Associacao = Dados[i].associacao;
            Produto.Operacao = 0;
            Grupo.Produtos.push(Produto);

            ProdutosCatalogo.push(Produto);

            CC++;

          }

          Grupos.push(Grupo);
          count++;

        } else {
          //grupo ja existe ... verifica se o produto esta no grupo caso n esteja adiciona

          var foundProduto = found.Produtos.find(element => element.Codigo == Dados[i].codigo);

          if (foundProduto == null) {

            if (Dados[i].variacoes != null) {
              for (var h = 0; h < Dados[i].variacoes.length; h++) {
                var foundVariacao = found.Produtos.find(element => element.Codigo == Dados[i].variacoes[h].codigo);

                if (foundVariacao == null) {
                  var Produto = new Object();

                  Produto.CodigoPai = Dados[i].codigo;
                  Produto.Codigo = Dados[i].variacoes[h].codigo;
                  Produto.Nome = Dados[i].variacoes[h].nome;
                  Produto.PrecoVenda = Dados[i].variacoes[h].precoVenda;
                  Produto.Promocao = Promocao;
                  Produto.Observacao = Dados[i].observacao;
                  Produto.Associacao = Dados[i].associacao;
                  Produto.Indice = found.Produtos.length + 1;
                  Produto.IndiceGeral = CC;
                  Produto.Operacao = 1;

                  found.Produtos.push(Produto);
                  ProdutosCatalogo.push(Produto);

                  CC++;

                }

              }
            }
            else {
              var Produto = new Object();
              Produto.CodigoPai = Dados[i].codigo;
              Produto.Codigo = Dados[i].codigo;
              Produto.Nome = Dados[i].nome;
              Produto.PrecoVenda = Dados[i].precoPromocao > 0 ? Dados[i].precoPromocao : Dados[i].precoVenda;
              Produto.Promocao = Promocao;
              Produto.Observacao = Dados[i].observacao;
              Produto.Associacao = Dados[i].associacao;
              Produto.Indice = found.Produtos.length + 1;
              Produto.IndiceGeral = CC;
              Produto.Operacao = 0;

              found.Produtos.push(Produto);
              ProdutosCatalogo.push(Produto);

              CC++;

            }

          }
        }
      }

      Retorno.Grupos = Grupos;
      Retorno.ProdutosCatalogo = ProdutosCatalogo;

      return Retorno;
    }
    catch (e) {
      console.log(e);
    }
  }
  function ObterValorVenda(Cli) {
    try {

      var ItensVenda = Cli.Venda.ItensVenda;
      var SubTotal = 0;

      for (var i = 0; i < ItensVenda.length; i++) {
        SubTotal += ItensVenda[i].PrecoVenda * ItensVenda[i].Quantidade;
      }

      SubTotal += Cli.Venda.TaxaEntrega;

      return SubTotal;
    }
    catch (e) {
      console.log(e);
      return 0;
    }
  }
  async function ResumoVenda(Cli) {
    try {
      var TxtItens = ``;
      var SubTotal = 0;
      if (Cli != null) {
        if (Cli.Venda != null) {
          var ItensVenda = Cli.Venda.ItensVenda;

          TxtItens += `\n*Cliente*: ${Cli.Nome.toUpperCase()}\n*Endereço*: ${(Cli.Venda.EnderecoEntrega != null && Cli.Venda.EnderecoEntrega.Logradouro != '') ? Cli.Venda.EnderecoEntrega.Logradouro.toUpperCase() : 'Retirar na Loja'}\n`;

          if (ItensVenda != null) {
            TxtItens += `_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _\n`;
            for (var i = 0; i < ItensVenda.length; i++) {

              TxtItens += ItensVenda[i].Nome + '\n';
              TxtItens += '   ' + ItensVenda[i].Quantidade + ' un.    R$ ' + (ItensVenda[i].PrecoVenda * ItensVenda[i].Quantidade).toFixed(2).replace('.', ',') + '\n';

              if (ItensVenda[i].Observacao != null && ItensVenda[i].Observacao != "")
                TxtItens += "*Obs.*: " + ItensVenda[i].Observacao + "\n";

              TxtItens += `_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _\n`;

              SubTotal += ItensVenda[i].PrecoVenda * ItensVenda[i].Quantidade;
            }
          }
          var Total = SubTotal + Cli.Venda.TaxaEntrega;

          TxtItens += "\n*Sub Total*: R$ " + SubTotal.toFixed(2).replace('.', ',') + '\n';

          if (Cli.Venda.TaxaEntrega > 0)
            TxtItens += "*Entrega*: R$ " + Cli.Venda.TaxaEntrega.toFixed(2).replace('.', ',') + '\n';

          if (Cli.Venda.Troco > 0)
            TxtItens += "*Troco*: R$ " + Cli.Venda.Troco.toFixed(2).replace('.', ',') + '\n';

          if (Total != SubTotal)
            TxtItens += "*Total*: R$ " + Total.toFixed(2).replace('.', ',') + '\n';


          console.log(Cli.Venda.FormaPagamento);
          TxtItens += '\n*Forma Pagamento*: ' + ((Cli.Venda.FormaPagamento != null || Cli.Venda.FormaPagamento > 0) ? Cli.Venda.FormaPagamento.Nome : '') + '\n';
        }
      }

      return TxtItens;
    }
    catch (e) {
      console.log(e);
      return '';
    }

  }
  function addMinutes(date, minutes) {
    try {
      return new Date(date.getTime() + minutes * 60000);
    }
    catch (e) {
      console.log(e);
      return new Date();
    }
  }

  function ExibirSubMenuProdutos(Administrador) {

    var ProdutosCatalogo = Administrador.ProdutosCatalogo;

    var Text = '';

    Text += `\n*${ProdutosCatalogo.length + 1} - Finalizar Pedido*\n`;
    Text += `*${ProdutosCatalogo.length + 2} - Ver Carrinho*\n`;
    Text += `*0 - Sair dos Pedidos*\n`;
    Text += `\nDigite o *código* correspondente para a *categoria* desejada ⚠️`;
    Text += `\nCaso queira finalizar o pedido escolha a opção *_Finalizar Pedido_* ⚠️`;

    return Text;
  }
  function SegundaCamada(Opcao, Administrador) {
    try {
      var Grupos = Administrador.Grupos;

      if (Opcao == 1) {
        var Text = '';

        Text += `Escolha uma *categoria* de Produtos 🥘🌵\n\n`;

        for (var i = 0; i < Grupos.length; i++) {
          Text += `*${i + 1}* - ${Grupos[i].Nome} \n`;
        }

        Text += `\n*${Grupos.length + 1} - Finalizar Pedido*\n`;
        Text += `*${Grupos.length + 2} - Ver Carrinho*\n`;
        Text += `*0 - Sair dos Pedidos*\n`;
        Text += `\nDigite o *código* correspondente para a *categoria* desejada ⚠️`;
        Text += `\nCaso queira finalizar o pedido escolha a opção *_Finalizar Pedido_* ⚠️`;

        return Text;
      }
      else {
        if (Opcao == 2) {
          return `Digite o CEP de seu endereço ou *0 - Voltar a Etapa Anterior*`;

        }
        else {
          if (Opcao == 3) {
            return `Digite o número do Pedido ou *0 - Voltar a Etapa Anterior*`;

          }
          else {
            if (Opcao == 4) {
              //return ConsultarHorarioFuncionamento(32);              
            }
          }
        }
      }
    }
    catch (e) {
      console.log(e);
    }
  }

  function TerceiraCamada(Opcao, Administrador, Acao) {
    try {
      var Grupos = Administrador.Grupos;

      var Text = Acao != 1 ? 'Escolha um ou mais *Produtos* 🍽️\n\n' : '';

      var foundComp = Grupos.find(element => element.Indice == Opcao);

      if (foundComp != null) {
        var Pro = foundComp.Produtos;

        if (Pro != null) {
          for (var i = 0; i < Pro.length; i++) {
            if (Acao != 1)
              Text += `*${i + 1}* - ${Pro[i].Nome.trim()} - *R$ ${Pro[i].PrecoVenda.toFixed(2).trim().replace('.', ',')}* \n\n`;
            else
              Text += `${Pro[i].Nome.trim()} - *R$ ${Pro[i].PrecoVenda.toFixed(2).trim().replace('.', ',')}* \n`;
          }
        }
      }

      
      if (Acao != 1) {
        Text += `\n*0 - Voltar Etapa Anterior*\n`;
        Text += `\nDigite o número correspondente ao produto desejado! ⚠️`;
      }

      return Text;
    }
    catch (e) {
      console.log(e);
      return '';
    }

  }
  async function ConsultarHorarioFuncionamento(Administrador) {

    try {

      if(Administrador.Configuracao.mensagemHorarioFuncionamento == ''){
        var HorarioFuncionamento = Administrador.HorarioFuncionamento;

        var Horario = '', Dias = '';
        var Func = false;
  
        if (HorarioFuncionamento != null) {
          var Dados = HorarioFuncionamento;
  
          for (var i = 1; i <= 7; i++) {
            var foundComp = Dados.filter(element => element.codigoDia == i);
  
            if (foundComp != null) {
              foundComp.forEach(function (Dado) {
                  var abertura = Dado.abertura;
                  var fechamento = Dado.fechamento;
                  var [h, m, s] = abertura.split(":").map(Number);
                  var [hh, mm, ss] = fechamento.split(":").map(Number);

                if (Horario == '')
                  Horario += ("00" + h).slice(-2) + ":" + ("00" + m).slice(-2) + ' as ' + ("00" + hh).slice(-2) + ":" + ("00" + mm).slice(-2);
                else
                  Horario += ' - ' + ("00" + h).slice(-2) + ":" + ("00" + m).slice(-2) + ' as ' + ("00" + hh).slice(-2) + ":" + ("00" + mm).slice(-2);
              });
  
              Dias += DiasExtenso(i);
  
              Dias += Horario != "" ? (" - " + Horario + " 🤩 \n") : " - Fechado 😕\n";
  
              Horario = '';
            }
          }
          Func = true;
        }
        else {
          Dias += "\nO Estabelecimento não configurou o seu horário de funcionamento! 😕";
          Func = false;
        }
        // Dias += "\n\n *0* - Voltar a Etapa Anterior";
  
        return Func ? ('Consulte nossos horários de *atendimento*! 🤩🤩\n\n' + Dias) : Dias;
      }
      else
        return Administrador.Configuracao.mensagemHorarioFuncionamento.replaceAll('<br>', '\n');
    }
    catch (e) {
      console.log(e);
      return '';
    }
  }
  function DiasExtenso(Dia) {
    try {
      if (Dia == 1)
        return '*Domingo*';
      else {
        if (Dia == 2)
          return '*Segunda*';
        else {
          if (Dia == 3)
            return '*Terça*';
          else {
            if (Dia == 4)
              return '*Quarta*';
            else {
              if (Dia == 5)
                return '*Quinta*';
              else {
                if (Dia == 6)
                  return '*Sexta*';
                else
                  return '*Sábado*';
              }
            }
          }
        }
      }
    }
    catch (e) {
      console.log(e);
      return '';
    }

  }
  function ValidarInt(Value) {
    try {
      console.log(Value.replace(/[^0-9]/g, ''))

      var Inteiro = Number.parseInt(Value.replace(/[^0-9]/g, ''));

      return Inteiro >= 0 ? true : false;
    }
    catch (e) {
      console.log(e);
      return false;
    }
  }
  function ExibirCarrinho(Cli) {
    try {
      var Txt = ``;
      if (Cli.Venda != null) {
        var ItensVenda = Cli.Venda.ItensVenda;
        console.log(ItensVenda);

        if (ItensVenda != null && ItensVenda.length > 0) {
          for (var i = 0; i < ItensVenda.length; i++) {

            Txt += `*${i + 1}*. ${ItensVenda[i].Nome}\n`;
            Txt += '     ' + ItensVenda[i].Quantidade + ' un.    R$ ' + (ItensVenda[i].PrecoVenda * ItensVenda[i].Quantidade).toFixed(2).replace('.', ',') + '\n';

            if (ItensVenda[i].Observacao != null && ItensVenda[i].Observacao != "")
              Txt += "*Obs.*: " + ItensVenda[i].Observacao + "\n";

            Txt += `_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _\n`;

          }
        }
        else
          Txt = `Nenhum item em seu Carrinho 🥹\n`;

      }
      else {
        Txt = `Nenhum item em seu Carrinho\n`;
      }

      Txt += `\n*0 - Voltar a Etapa Anterior*`;

      if (Cli.Venda != null && Cli.Venda.ItensVenda != null && Cli.Venda.ItensVenda.length > 0)
        Txt += `\n\nDigite o número correspondente ao *produto* que deseja *excluir* do carrinho! ⚠️`;


      return Txt;
    }
    catch (e) {
      console.log(e);

      return '';
    }

  }
  function AdicionarObservacao(Observação, Cli) {
    try {
      var found = Cli.Venda.ItensVenda.filter(element => element.IndiceGrupo == Cli.GrupoSell);

      if (found != null) {
        var foundProduto = found.find(element => element.Indice == Cli.ProdutoSell);

        if (foundProduto != null)
          foundProduto.Observacao = Observação;
      }
    }
    catch (e) {
      console.log(e);

    }

  }
  function RemoverQuantidade(Cli) {
    try {
      var found = Cli.Venda.ItensVenda.filter(element => element.IndiceGrupo == Cli.GrupoSell);
      console.log(found);

      if (found != null) {
        var foundProduto = found.find(element => element.Indice == Cli.ProdutoSell);

        console.log(foundProduto);

        if (foundProduto != null) {
          Cli.Venda.ItensVenda.splice(Cli.Venda.ItensVenda.indexOf(foundProduto), 1);
        }

      }
    }
    catch (e) {
      console.log(e);

    }

  }
  function AdicionarQuantidade(Quantidade, Cli) {
    try {
      var found = Cli.Venda.ItensVenda.filter(element => element.IndiceGrupo == Cli.GrupoSell);

      if (found != null) {
        var foundProduto = found.find(element => element.Indice == Cli.ProdutoSell);

        if (foundProduto != null)
          foundProduto.Quantidade = Quantidade;
      }
    }
    catch (e) {
      console.log(e);

    }

  }
  function ObterProdutosWhereWhatsAPP(Json, Administrador) {
    var ProdCat = '';
    var ProdutosCatalogo = Administrador.ProdutosCatalogo;
    for (var i = 0; i < Json.produtos.length; i++) {
      var foundProduto = ProdutosCatalogo.find(element => element.Codigo == Json.produtos[i].Id);

      if (foundProduto != null) {
        ProdCat += foundProduto.Nome + ' R$ ' + foundProduto.PrecoVenda.toFixed(2).replace('.', ',') + '\n';
      }
    }

    return ProdCat;
  }
  function RemoverItensVendaFromWhatsApp(Cli, Json) {
    try {
      var Removeu = false;
      Json.produtos = Json.produtos == null ? Json : Json.produtos;


      if (Cli.Venda != null && Cli.Venda.ItensVenda != null) {
        if (Json != null && Json.produtos != null) {
          for (var i = 0; i < Json.produtos.length; i++) {
            var foundProduto = Cli.Venda.ItensVenda.find(element => element.Produto == Json.produtos[i].Id);

            if (foundProduto != null) {
              var Pos = Cli.Venda.ItensVenda.indexOf(foundProduto);
              Cli.Venda.ItensVenda.splice(Pos, 1);
              Removeu = true;
            }
          }
        }
      }

      return Removeu;
    }
    catch (e) {
      console.log(e);
      return false;
    }
  }
  function AdicionarItemVendaFromWhatsApp(Cli, Json, Administrador) {
    try {

      var ProdutosCatalogo = Administrador.ProdutosCatalogo;

      Json.produtos = Json.pedido != null ? Json.pedido : Json.produtos;

      if (Json != null) {
        if (Json.produtos != null) {
          for (var i = 0; i < Json.produtos.length; i++) {
            if (Json.produtos[i].Score >= 0.9) {
              var foundProduto = ProdutosCatalogo.find(element => element.Codigo == Json.produtos[i].Id);

              if (foundProduto != null) {
                if (Cli.Venda == null) {
                  Cli.Venda = new Object();

                  Cli.Venda.ItensVenda = [];
                  Cli.Venda.TaxaEntrega = 0;
                  Cli.Venda.Troco = 0;
                  Cli.Venda.FormaPagamento = null;
                  Cli.Venda.Telefone = '';
                  Cli.Venda.Nome = '';
                  Cli.Venda.EnderecoEntrega = null;

                  var ItemVenda = new Object();

                  ItemVenda.Quantidade = Json.produtos[i].Quantidade;
                  ItemVenda.PrecoVenda = foundProduto.PrecoVenda;
                  ItemVenda.Produto = foundProduto.Codigo;
                  ItemVenda.Nome = foundProduto.Nome;
                  ItemVenda.Observacao = Json.produtos[i].Observacao == null ? '' : Json.produtos[i].Observacao;
                  ItemVenda.Indice = i;
                  ItemVenda.IndiceGrupo = 0;
                  ItemVenda.Operacao = foundProduto.Operacao;

                  Cli.Venda.ItensVenda.push(ItemVenda);
                }
                else {
                  var ItemVenda = new Object();

                  ItemVenda.Quantidade = Json.produtos[i].Quantidade;
                  ItemVenda.PrecoVenda = foundProduto.PrecoVenda;
                  ItemVenda.Produto = foundProduto.Codigo;
                  ItemVenda.Nome = foundProduto.Nome;
                  ItemVenda.Observacao = Json.produtos[i].Observacao == null ? '' : Json.produtos[i].Observacao;
                  ItemVenda.Indice = i;
                  ItemVenda.IndiceGrupo = 0;
                  ItemVenda.Operacao = foundProduto.Operacao;

                  Cli.Venda.ItensVenda.push(ItemVenda);
                }
              }
            }
          }
        }


        if (Cli.Venda != null && Json.enderecoEntrega != null) {

          var Endereco = new Object();
          Endereco.Codigo = 0;

          if (Json.enderecoEntrega.hasOwnProperty('rua')) {
            if (Json.enderecoEntrega.hasOwnProperty('numero')) {
              if (Json.enderecoEntrega.hasOwnProperty('bairro')) {
                Endereco.Logradouro = Json.enderecoEntrega.rua + ', ' + Json.enderecoEntrega.numero + ', ' + Json.enderecoEntrega.bairro;
              }
              else
                Endereco.Logradouro = Json.enderecoEntrega.rua + ', ' + Json.enderecoEntrega.numero;

            }
            else
              Endereco.Logradouro = Json.enderecoEntrega.rua;
          }
          else
            Endereco.Logradouro = Json.enderecoEntrega;

          Cli.Venda.EnderecoEntrega = Endereco
        }

        if (Cli.Venda != null && Json.formaPagamento != null) {
          var foundPagamento = Administrador.FormasPagamento.find(element => removeSpecialCharactersAndAccents(element.Nome.toUpperCase()) == removeSpecialCharactersAndAccents(Json.formaPagamento.toUpperCase()));

          if (foundPagamento != null)
            Cli.Venda.FormaPagamento = foundPagamento;

        }

      }

    }
    catch (e) {
      console.log(e);
      return false;
    }

  }
  function AdicionarItemVenda(Operacao, Cli, Administrador) {
    try {
      var ProdutosCatalogo = Administrador.ProdutosCatalogo;
      var Grupos = Administrador.Grupos;

      if (Administrador.Configuracao.tipoMenu == 'PRODUTOS') {
        var foundProduto = ProdutosCatalogo.find(element => element.IndiceGeral == Operacao);

        if (foundProduto != null) {
          if (Cli.Venda == null) {
            Cli.Venda = new Object();

            Cli.Venda.ItensVenda = [];
            Cli.Venda.TaxaEntrega = 0;
            Cli.Venda.Troco = 0;
            Cli.Venda.FormaPagamento = 0;
            Cli.Venda.Telefone = '';
            Cli.Venda.Nome = '';
            Cli.Venda.EnderecoEntrega = null;

            var ItemVenda = new Object();

            ItemVenda.Quantidade = 1;
            ItemVenda.PrecoVenda = foundProduto.PrecoVenda;
            ItemVenda.Produto = foundProduto.Codigo;
            ItemVenda.Nome = foundProduto.Nome;
            ItemVenda.Observacao = '';
            ItemVenda.Indice = Operacao;
            ItemVenda.IndiceGrupo = Cli.GrupoSell;
            ItemVenda.Operacao = foundProduto.Operacao;

            Cli.Venda.ItensVenda.push(ItemVenda);
          }
          else {
            var ItemVenda = new Object();

            ItemVenda.Quantidade = 1;
            ItemVenda.PrecoVenda = foundProduto.PrecoVenda;
            ItemVenda.Produto = foundProduto.Codigo;
            ItemVenda.Nome = foundProduto.Nome;
            ItemVenda.Observacao = '';
            ItemVenda.Indice = Operacao;
            ItemVenda.IndiceGrupo = Cli.GrupoSell;
            ItemVenda.Operacao = foundProduto.Operacao;

            Cli.Venda.ItensVenda.push(ItemVenda);
          }
        }
        else
          return false;
      }
      else {
        var found = Grupos.find(element => element.Indice == Cli.GrupoSell);

        if (found != null) {
          var foundProduto = found.Produtos.find(element => element.Indice == Operacao);

          if (foundProduto != null) {
            if (Cli.Venda == null) {
              Cli.Venda = new Object();

              Cli.Venda.ItensVenda = [];
              Cli.Venda.TaxaEntrega = 0;
              Cli.Venda.Troco = 0;
              Cli.Venda.FormaPagamento = 0;
              Cli.Venda.Telefone = '';
              Cli.Venda.Nome = '';
              Cli.Venda.EnderecoEntrega = null;

              var ItemVenda = new Object();

              ItemVenda.Quantidade = 1;
              ItemVenda.PrecoVenda = foundProduto.PrecoVenda;
              ItemVenda.Produto = foundProduto.Codigo;
              ItemVenda.Nome = foundProduto.Nome;
              ItemVenda.Observacao = '';
              ItemVenda.Indice = Operacao;
              ItemVenda.IndiceGrupo = Cli.GrupoSell;
              ItemVenda.Operacao = foundProduto.Operacao;

              Cli.Venda.ItensVenda.push(ItemVenda);
            }
            else {
              var ItemVenda = new Object();

              ItemVenda.Quantidade = 1;
              ItemVenda.PrecoVenda = foundProduto.PrecoVenda;
              ItemVenda.Produto = foundProduto.Codigo;
              ItemVenda.Nome = foundProduto.Nome;
              ItemVenda.Observacao = '';
              ItemVenda.Indice = Operacao;
              ItemVenda.IndiceGrupo = Cli.GrupoSell;
              ItemVenda.Operacao = foundProduto.Operacao;

              Cli.Venda.ItensVenda.push(ItemVenda);
            }
          }
          else
            return false;
        }
        else
          return false;

      }

      return true;
    }
    catch (e) {
      console.log(e);
      return false;
    }

  }

  function Cardapio(Op = 0, Administrador) {
    var Txt = 'Dê uma olhada em nossas deliciosas opções: 🤗\n\n';
    var Emoji = ['🥘', '🫕', '🍔', '🥞', '🍕', '🍜', '🍝', '🌯', '🌮', '🥓', '🍟'];
    var H = 1;

    var Grupos = Administrador.Grupos;

    for (var i = 0; i < Grupos.length; i++) {
      var h = Math.floor(Math.random() * (i + 1));
      Txt += Emoji[h] + ' *' + Grupos[i].Nome.trim() + '*\n\n';

      for (var j = 0; j < Grupos[i].Produtos.length; j++) {
        Txt += (Op == 1 ? `*${H}*` : '') + ' *- ' + Grupos[i].Produtos[j].Nome.trim() + ' R$ ' + Grupos[i].Produtos[j].PrecoVenda.toFixed(2).trim().replace('.', ',') + '*\n';

        if (Grupos[i].Produtos[j].Associacao == 2)
          Txt += '(' + Grupos[i].Produtos[j].Observacao.trim() + ')\n';

        if (Op == 1)
          Txt += '\n'

        H++;
      }

      Txt += '\n\n';
    }

    return Txt;
  }
  async function ComunicarVendaDelivery(Cli, Administrador) {
    //EnderecoFull
    //FormaPagamento
    //Frete
    //Troco
    //Mesa
    //CodigoExterno 
    //Meio
    //Itens
    //Celular
    //Adm

    try {
      Cli.TentativasPedido = 0;

      var ItensVenda = '';
      var FormaPagamento = 0;
      FormaPagamento = Cli.Venda.FormaPagamento.Codigo;

      var Celular = '';
      Celular = ObterCelularFormatado(Cli.Codigo);

      var Itv = Cli.Venda.ItensVenda;

      for (var i = 0; i < Itv.length; i++) {
        ItensVenda += '' + Itv[i].Indice + '//;' + Itv[i].Produto + '//;' + Itv[i].Nome + '//;' + Itv[i].PrecoVenda.toFixed(2).replace('.', ',') + '//;' +
          Itv[i].Quantidade + '//;' + Itv[i].Observacao + '//;' + '//;' + 0 + '//;' + '//;' + 0 + '//;' + 0 + '//;' + Itv[i].Operacao + '/*';
      }


      var Url = `https://sistemasnaweb.com.br/Todo/FinalizarPedidoFromWhats?EnderecoFull=${Cli.Venda.EnderecoEntrega.Logradouro}&CodigoEndereco=${Cli.Venda.EnderecoEntrega.Codigo}&Frete=${Cli.Venda.TaxaEntrega}&Troco=${Cli.Venda.Troco}&Mesa=0&CodigoExterno=${Cli.CodigoPagamento}&Meio=6&Itens=${ItensVenda}&FormaPagamento=${FormaPagamento}&Adm=${Administrador.codigo}&Celular=${Celular}&Nome=${Cli.Nome}&CodigoPessoa=${Cli.Pessoa != null ? Cli.Pessoa.codigo : 0}`;

      const response = await axios.get(Url,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          responseType: 'json',
          httpsAgent: new https.Agent({ rejectUnauthorized: false })
        }
      );
    }
    catch (e) {
      console.log(e);

    }

  }
  function ObterCelularFormatado(Celular) {
    try {
      if(Celular != null){
        if (Celular.length == 17) {
          return '(' + Celular.substring(2, 4) + ') ' + Celular.substring(4, 8) + '-' + Celular.substring(8, 12);
        }
        else {
          return '(' + Celular.substring(2, 4) + ') ' + Celular.substring(4, 9) + '-' + Celular.substring(9, 13);
        }
      }

      return '';
    }
    catch (e) {
      console.log(e);

      return '';
    }
  }
  async function ObterDadosCliente(Cli, Administrador) {
    try {
      var Url = `https://www.sistemasnaweb.com.br/Administrador/ObterEnderecoFromCelular?Celular=${ObterCelularFormatado(Cli.Codigo)}&Adm=${Administrador.codigo}`;

      const response = await axios.get(Url,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          responseType: 'json',
          httpsAgent: new https.Agent({ rejectUnauthorized: false })
        }

      );

      Cli.Pessoa = response.data.cliente;
      Cli.Enderecos = response.data.enderecos;
    }
    catch (e) {
      console.log(e);

      Cli.Pessoa = null;
      Cli.Enderecos = null;
    }

  }


  

  function substituirLinks(mensagem, substituicao = "[link removido]") {
    // Expressão regular para identificar links
    const regexLink = /(https?:\/\/[^\s]+)/g;
    
    // Verifica se a mensagem contém um link
    if (regexLink.test(mensagem)) {
      // Substitui o link pelo valor fornecido em 'substituicao'
      return mensagem.replace(regexLink, substituicao);
    }
  
    // Retorna a mensagem original se nenhum link for encontrado
    return mensagem;
  }
  function removerLinksForaDeSistemasNaWeb(msg) {
    return msg.replace(/https?:\/\/[^\s"')<>,]+/gi, (link) => {
      try {
        const url = new URL(link);
        const hostname = url.hostname.replace(/^www\./, '').toLowerCase();
        return hostname === 'sistemasnaweb.com.br' ? link : '';
      } catch {
        return ''; // se não for uma URL válida, remove também
      }
    });
  }

const CONFIG = {
    DELAY_MIN: 10,       // Mínimo de segundos entre mensagens (Sugestão: 5s)
    DELAY_MAX: 25,       // Máximo de segundos entre mensagens (Sugestão: 20s)
    LOTE_TAMANHO: 30,    // A cada quantas mensagens faz uma pausa longa? (Sugestão: 30)
    LOTE_PAUSA: 180000,  // Tempo da pausa longa em ms (Sugestão: 3 min = 180000ms)
};

async function ObterCampanha(Administrador) {
    try {
        console.log(`🔍 Buscando campanhas para ADM: ${Administrador.codigo}`);

        const Url = `https://sistemasnaweb.com.br/Campanha/ObterCampanhasAbertas`;
        
        // Passando parâmetros via 'params' (mais limpo e seguro)
        const response = await axios.get(Url, {
            params: { Adm: Administrador.codigo },
            headers: { 'Content-Type': 'application/json' },
            responseType: 'json',
            httpsAgent: new https.Agent({ rejectUnauthorized: false })
        });

        const Campanhas = response.data.dados;

        if (Campanhas && Campanhas.length > 0) {
            console.log(`✅ Encontradas ${Campanhas.length} campanhas.`);
            await ProcessarCampanhas(Campanhas, Administrador);
        } else {
            // console.log('ℹ️ Nenhuma campanha pendente.');
        }

    } catch (e) {
        console.error('❌ Erro ao buscar campanhas na API:', e.message);
    }
}

async function ProcessarCampanhas(listaCampanhas, Administrador) {
    // Verifica se a sessão existe e está pronta
    const cliWh = clientSessionRegistry[Administrador.codigo];

    if (!cliWh) {
        console.log(`⚠️ Sessão do Cliente ${Administrador.codigo} não encontrada.`);
        return;
    }

    for (const campanha of listaCampanhas) {
        // Se o botão de "Parar" foi apertado no sistema, interrompe tudo
        if (!Executando) break; 

        if (!campanha.numeros) continue;

        // 1. Notifica API que iniciou (se necessário)
        if (!campanha.iniciado) {
            try {
                await IniciarCampanha(campanha.codigo, Administrador);
            } catch (err) {
                console.log('Erro ao marcar inicio campanha:', err.message);
            }
        }

        // 2. Gerenciamento de Posição (Retomada de onde parou)
        let Arq = lerPosicao();
        let posicao = Arq.posicao || 0;

        // Se o arquivo salvo é de outra campanha antiga, reseta
        if (Arq.campanha != campanha.codigo) {
            apagarArquivo();
            posicao = 0;
            Arq = { campanha: campanha.codigo, posicao: 0 };
        }

        const ListaNumeros = campanha.numeros.split(',');

        // Validação se já acabou
        if (posicao >= ListaNumeros.length) {
            await FinalizarRotina(campanha, Administrador);
            continue; 
        }

        console.log(`🚀 Processando Campanha ${campanha.codigo} | Total: ${ListaNumeros.length} | Iniciando em: ${posicao}`);

        // ====================================================================
        // 🔄 LOOP DE DISPARO
        // ====================================================================
        for (let j = posicao; j < ListaNumeros.length && Executando; j++) {
            
            // --- VERIFICAÇÃO DE LIMITE DA CAMPANHA ---
            if (campanha.limiteEnvios > 0 && j >= campanha.limiteEnvios) {
                console.log('🛑 Limite de envios configurado na campanha atingido.');
                break; 
            }

            // --- PAUSA DE SEGURANÇA (LOTE) ---
            if (j > 0 && j % CONFIG.LOTE_TAMANHO === 0) {
                console.log(`☕ Pausa para "café" do robô: ${CONFIG.LOTE_PAUSA / 1000} segundos...`);
                await sleep(CONFIG.LOTE_PAUSA);
            }

            // Pega os dados da linha atual (Ex: "Joao;551199999999")
            const itemLinha = ListaNumeros[j];
            
            // Processamento individual blindado com try/catch para não parar o loop
            try {
                if (itemLinha) {
                    let [nomeCliente, telefoneBruto] = itemLinha.split(';');

                    if (telefoneBruto) {
                        // Remove caracteres não numéricos
                        let telefoneLimpo = telefoneBruto.replace(/\D/g, ''); 

                        // FUNÇÃO QUE FAZ O ENVIO REAL
                        const enviou = await EnviarMensagemSegura(cliWh, campanha, nomeCliente, telefoneLimpo, Administrador);

                        if (enviou) {
                            // Notifica Front-end
                            sendMessage(JSON.stringify({
                                acao: 9, 
                                posicao: j + 1, // +1 para visual humano
                                totalEnvio: ListaNumeros.length, 
                                codigo: campanha.codigo 
                            }));

                            // Delay aleatório "Humano"
                            const tempoEspera = obterDelayAleatorio();
                            console.log(`✅ Enviado. Aguardando ${tempoEspera}s...`);
                            await sleep(tempoEspera * 1000);
                        } else {
                            console.log(`⏩ Pulando inválido/erro: ${telefoneLimpo}`);
                            // Pequeno delay mesmo em erro para não processar lista de erro instantaneamente
                            await sleep(2000); 
                        }
                    }
                }
            } catch (erroInterno) {
                console.error(`Erro no índice ${j}:`, erroInterno.message);
            }

            // Salva posição SEMPRE (sucesso ou erro), para não travar no mesmo número
            salvarPosicao(j + 1, campanha.codigo);
        }

        // Verifica se terminou a lista toda
        if (lerPosicao().posicao >= ListaNumeros.length) {
            await FinalizarRotina(campanha, Administrador);
        }
    }
}
// ============================================================================
// 📩 FUNÇÃO DE ENVIO UNIFICADA
// ============================================================================
async function EnviarMensagemSegura(client, campanha, nome, telefone, Administrador) {
    try {
        // 1. VALIDAÇÃO DE WHATSAPP (CRUCIAL PARA NÃO TOMAR BAN)
        // Adiciona @c.us se não tiver
        const userFormatado = telefone.includes('@') ? telefone : `${telefone}@c.us`;
        
        // Pergunta ao servidor do whats se o número existe
        const contatoId = await client.getNumberId(userFormatado);


        if (!contatoId) {
            console.log(`❌ Número não registrado no WhatsApp: ${telefone}`);
            return false; 
        }

        var numeroPn = await ObterWhatsApp(client, contatoId);

        // 2. PREPARAR TEXTO (COM SPINTAX/VARIAÇÃO)
        let textoFinal = MontarTexto(campanha, nome, Administrador);

        const chatId = numeroPn;

        // 3. ENVIO (IMAGEM OU TEXTO)
        if (campanha.foto && campanha.foto.length > 50) {
            // Tratamento de base64
            let base64Image = campanha.foto;
            if (base64Image.includes(',')) {
                base64Image = base64Image.split(',')[1];
            }

            const media = new MessageMedia('image/jpeg', base64Image);
            await client.sendMessage(chatId, media, { caption: textoFinal });
        } else {
            await client.sendMessage(chatId, textoFinal);
        }

        return true; // Sucesso

    } catch (error) {
        console.error(`Falha ao enviar para ${telefone}:`, error.message);
        return false;
    }
}

// ============================================================================
// 📝 GERADOR DE TEXTO E VARIAÇÕES
// ============================================================================
function MontarTexto(campanha, nome, Administrador) {
    let msg = campanha.mensagem || "";
    
    // Limpeza de links antigos (Sua função original)
    if (typeof removerLinksForaDeSistemasNaWeb === 'function') {
        msg = removerLinksForaDeSistemasNaWeb(msg);
    }

    // SPINTAX SIMPLES (Variação de saudação para evitar hash de spam)
    const saudacoes = ["Olá", "Oi", "Opa", "Tudo bem", "Como vai"];
    const saudacaoEscolhida = saudacoes[Math.floor(Math.random() * saudacoes.length)];
    
    // Nome ou genérico
    const nomeTratado = nome && nome.length > 1 ? nome : "cliente";

    const linkBase = `https://sistemasnaweb.com.br/${Administrador.configuracao.urlLoja}?Campanha=${campanha.codigo}`;
    
    let corpoMsg = "";

    // Lógica de Link (preservada do seu código)
    if (typeof ValidaLink === 'function' && ValidaLink(msg, Administrador.configuracao.urlLoja)) {
        if (typeof substituirLinks === 'function') {
            corpoMsg = substituirLinks(msg, linkBase);
        } else {
            corpoMsg = msg + `\n${linkBase}`;
        }
    } else {
        corpoMsg = `${msg}\n\n👇 *Acesse nosso cardápio:*\n${linkBase}`;
    }

    // Montagem Final com Rodapé de segurança (SAIR)
    return `${saudacaoEscolhida}, *${nomeTratado}*!\n\n${corpoMsg}\n\n⚠️ _Digite *SAIR* para cancelar o recebimento._`;
}

// ============================================================================
// 🛠️ FUNÇÕES AUXILIARES
// ============================================================================

async function FinalizarRotina(campanha, Administrador) {
    console.log(`🏁 Campanha ${campanha.codigo} finalizada.`);
    try {
        sendMessage(JSON.stringify({ acao: 8, msg: campanha.codigo }));
        await FinalizarCampanha(campanha.codigo, Administrador);
        apagarArquivo();
    } catch (e) {
        console.log('Erro ao finalizar API:', e);
    }
}

function obterDelayAleatorio() {
    return Math.floor(Math.random() * (CONFIG.DELAY_MAX - CONFIG.DELAY_MIN + 1)) + CONFIG.DELAY_MIN;
}
  /*
  function gerarRegexLoja(nomeLoja) {
    // escapa caracteres especiais, caso tenha
    const lojaEscapada = nomeLoja.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    const pattern = `https?:\\/\\/(?:www\\.)?sistemasnaweb\\.com\\.br\\/${lojaEscapada}(?:\\/)?(?:\\?[^\s]*)?`;
    
    return new RegExp(pattern, 'g');
  }
  function ValidaLink(mensagem, nomeLoja) {
    // Expressão regular para identificar links
    const regexLink = gerarRegexLoja(nomeLoja);
    // Verifica se a mensagem contém um link
    if (regexLink.test(mensagem)) {
      // Substitui o link pelo valor fornecido em 'substituicao'
      return true;
    }
  
    // Retorna a mensagem original se nenhum link for encontrado
    return false;
  }*/


  async function FinalizarCampanha(Codigo, Administrador){
    try {
      var Data = new Date().toISOString();

      var Url = `https://sistemasnaweb.com.br/Campanha/FinalizarCampanha?Codigo=${Codigo}&Data=${Data}&Adm=${Administrador.codigo}`;

      const response = await axios.get(Url,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          responseType: 'json',
          httpsAgent: new https.Agent({ rejectUnauthorized: false })
        }

      );
      var Status = response.data.status;

      return Status;

    }
    catch (e) {
      console.log(e);
      return false;
    }
  };

  async function IniciarCampanha(Codigo, Administrador){
    try {
      var Url = `https://sistemasnaweb.com.br/Campanha/IniciarCampanha?Codigo=${Codigo}&&Adm=${Administrador.codigo}`;

      const response = await axios.get(Url,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          responseType: 'json',
          httpsAgent: new https.Agent({ rejectUnauthorized: false })
        }

      );
      var Status = response.data.status;

      return Status;

    }
    catch (e) {
      console.log(e);
      return false;
    }
  };

  function lerPosicao() {

    if (fs.existsSync(path.join(app.getPath('temp'), 'arquivo.json'))) {
      const posicaoSalva = JSON.parse(fs.readFileSync(path.join(app.getPath('temp'), 'arquivo.json'), 'utf-8'));
      return posicaoSalva;
    }
    
    return -1; // Se não houver posição salva, começa do início
  }

  // Função para salvar a posição atual
  function salvarPosicao(posicao, campanha) {
    const dados = { posicao, campanha };
    fs.writeFileSync(path.join(app.getPath('temp'), 'arquivo.json'), JSON.stringify(dados), 'utf-8');
  }

  async function apagarArquivo() {
    try{
      if (fs.existsSync(path.join(app.getPath('temp'), 'arquivo.json'))) {
        fs.unlink(path.join(app.getPath('temp'), 'arquivo.json'), (err) => {
          if (err) {
            console.error('Erro ao apagar o arquivo:', err);
          } else {
            console.log('Arquivo apagado com sucesso!');
          }
        });
      }
    }
    catch (e) {
      console.log('deu erro');
      return '';
    }
  }
  function FormaPagamento(Op = 1, Administrador) {
    try {
      var FormasPagamento = Administrador.FormasPagamento;

      var Txt = '';

      for (var i = 0; i < FormasPagamento.length; i++) {
        Txt += `*${i + 1}*. ${FormasPagamento[i].Nome}\n`
      }

      if (Op == 1) {
        Txt += '\n*0 - Voltar a Etapa Anterior*\n';
        Txt += `\nDigite o número correspondente da forma de pagamento desejada! ⚠️`;
      }

      return Txt;
    }
    catch (e) {
      console.log(e);
      return '';
    }


  }
  function ExibirEnderecos(Cli, Op = 1, Retirada) {
    try {
      var Txt = '';
      var i = 0;

      if (Op == 1)
        Txt = 'Escolha/Adicione um *endereço*';

      if (Retirada)
        Txt += ' ou *retire* em nossa Loja 🚚\n\n'
      else
        Txt += '  🚚\n\n'


      if (Cli.Enderecos != null) {
        var Enderecos = Cli.Enderecos;

        for (i = 0; i < Enderecos.length; i++) {
          Txt += `*${i + 1}* - ${Enderecos[i].logradouro} ${Enderecos[i].numero > 0 ? ', ' + Enderecos[i].numero : ''} ${Enderecos[i].bairro != '' ? '- ' + Enderecos[i].bairro : ''}\n`;
        }
      }


      if (Op == 1) {
        if (Retirada)
          Txt += `\n*${i + 1} - Retirar na Loja*\n`;
        else
          Txt += `\n`;

        Txt += `*${i + 2} - Adicionar um novo Endereço*\n`;
        Txt += `*0 - Voltar a Etapa Anterior*`;
      }
      else {
        Txt += `\n*0* - Retirar na Loja\n`;

      }


      return Txt;
    }
    catch (e) {
      console.log(e);

      return '';
    }

  }
  function ObterLogradouroEndereco(Cli, Operacao) {
    try {
      var Txt = `${Cli.Enderecos[Operacao - 1].logradouro}, ${Cli.Enderecos[Operacao - 1].numero} - ${Cli.Enderecos[Operacao - 1].bairro}\n`;
      return Txt;
    }
    catch (e) {
      console.log(e);

      return '';
    }
  }
  function ObterDistanciaEndereco(Cli, Operacao) {
    try {
      var Distancia = Cli.Enderecos[Operacao - 1].distancia;
      return Distancia;
    }
    catch (e) {
      console.log(e);

      return 0;
    }
  }
  function ObterCodigoEndereco(Cli, Operacao) {
    try {
      return Cli.Enderecos[Operacao - 1].codigo;
    }
    catch (e) {
      console.log(e);

      return '';
    }
  }
  function ExcluirItemCarrinho(Cli, Operacao) {
    try {
      if (Cli.Venda != null) {
        if (Cli.Venda.ItensVenda != null) {
          var found = Cli.Venda.ItensVenda[Operacao - 1];
          if (found != null) {
            Cli.Venda.ItensVenda.splice(Cli.Venda.ItensVenda.indexOf(found), 1);
            return 1;
          }
          else
            return -1;
        }
        else
          return -10;
      }
      else
        return -15;
    }
    catch (e) {
      console.log(e);

    }

  }
  function ValidarNome(Value) {
    try {
      if (Value.toUpperCase().includes('A') || Value.toUpperCase().includes('E') || Value.toUpperCase().includes('I') ||
        Value.toUpperCase().includes('O') || Value.toUpperCase().includes('U') || Value.toUpperCase().includes('Y'))
        return true;
      else
        return false;
    }
    catch (e) {
      console.log(e);

    }

  }
  async function ObterInformacoesEntrega(Celular, Administrador) {

    try {
      var Url = `https://www.sistemasnaweb.com.br/Administrador/ObterVendasFromTelefone?Celular=${Celular}&Adm=${Administrador.codigo}`;

      const response = await axios.get(Url,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          responseType: 'json',
          httpsAgent: new https.Agent({ rejectUnauthorized: false })
        }
      );

      var Dados = response.data;
      var Txt = 'Veja o status de suas *últimas* compras: 😉\n\n';

      if (Dados != null) {
        for (var i = 0; i < Dados.length; i++) {
          Txt += `*Data*: ${Dados[i].data}   *Status*: ${ObterStatusPedido(Dados[i].andamento)}\n`;
        }

        Txt += `\nCaso precise de algo mais, é só me dizer aqui, ou acesse o link da nossa *plataforma* por aqui👇\nhttps://sistemasnaweb.com.br/${Administrador.configuracao.urlLoja}  🔗`;
      }
      else {
        Txt += `Nenhuma venda encontrada 🥹\n\nCaso queira realizar um *pedido*, é só acessar o link da nossa plataforma por aqui👇\nhttps://sistemasnaweb.com.br/${Administrador.configuracao.urlLoja}  🔗`;

      }

      //Txt+= `\n*0* - Voltar a Etapa Anterior`;

      return Txt;
    }
    catch (e) {
      console.log(e);

      return '';
    }
  }

  function ObterStatusPedidoEscrito(Status, Administrador, Entrega = false, LinkEntrega = '') {

    console.log(Administrador.Configuracao)
    try {
      if (Status == 1) {
        return  Administrador.Configuracao.mensagemPedido == '' ?'Pedido Realizado com sucesso, aguarde atualizações do restaurante 😋' : Administrador.Configuracao.mensagemPedido.replaceAll('<br>', '\n');
      }
      else {
        if (Status == 2) {
          return Administrador.Configuracao.mensagemCozinha == ''  ? 'Olá, So para te atualizar 🤝, seu pedido já está sendo *preparado* e em breve *será enviado* para você 🤩' : Administrador.Configuracao.mensagemCozinha .replaceAll('<br>', '\n');
        }
        else {
          if (Status == 3) {
            var Mensagem = '';

            if(Entrega){
              
              if(Administrador.Configuracao.mensagemEntrega == ''){
                  Mensagem = 'Ótima Notícia 🤩, seu *pedido* já foi *entregue ao entregador* logo estará com você 🚚';

                  if(LinkEntrega != ''){
                    Mensagem += '\nAcompanhe em tempo real por meio do link abaixo:\n 🔗' + LinkEntrega;
                  }
              }
              else{
                Mensagem = Administrador.Configuracao.mensagemEntrega.replaceAll('<br>', '\n');
                
                if(LinkEntrega != '')
                {
                  if(Mensagem.includes('[Rastreio]'))
                    Mensagem = Mensagem.replace('[Rastreio]', LinkEntrega);
                  else
                    Mensagem += '\nAcompanhe em tempo real por meio do link abaixo:\n 🔗' + LinkEntrega;
                }
                else
                  Mensagem = Mensagem.replace('[Rastreio]', 'Link Não Encontrado!');
                
              }

              return Mensagem

            }
            else
              return 'Ótima Notícia 🤩, seu *pedido* já está disponivel para ser retirado em nossa loja 🏪';
          }
          else {
            if (Status == 4) {
              return Administrador.Configuracao.mensagemEntregue == '' ? 'Pedido *entregue* com Sucesso, esperamos que você aproveite o máximo possivel, *Agradecemos* a preferência 😍' : Administrador.Configuracao.mensagemEntregue.replaceAll('<br>', '\n');
            }
            else {
              return Administrador.Configuracao.mensagemCancelamento == '' ?'Infelizmente o *restaurante* precisou *cancelar* seu *pedido* 😞' : Administrador.Configuracao.mensagemCancelamento.replaceAll('<br>', '\n');
            }
          }
        }
      }
    }
    catch (e) {
      console.log(e);

    }
  }
  function ObterStatusPedido(Status) {

    try {
      if (Status == 1) {
        return 'Pedido Realizado ✅';
      }
      else {
        if (Status == 2) {
          return 'Pedido em Preparo 👨‍🍳';
        }
        else {
          if (Status == 3) {
            return 'Pedido saiu para entrega 🚚';

          }
          else {
            if (Status == 4) {
              return 'Pedido Entregue 😋';
            }
            else {
              return 'Pedido Cancelado ✖️';
            }
          }
        }
      }
    }
    catch (e) {
      console.log(e);

    }
  }
  async function NotificarSistema(Celular, Administrador) {
    try {
      //console.log(Administrador)

      var Url = `https://www.sistemasnaweb.com.br/Todo/NotificarMensagemWhatsApp?Celular=${Celular}&Adm=${Administrador.codigo}`;

      const response = await axios.get(Url,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          responseType: 'json',
          httpsAgent: new https.Agent({ rejectUnauthorized: false })
        }
      );
    }
    catch (e) {
      console.log(e);

    }
  }

  async function ObterDadosPixOnline(Cli, Administrador) {
    try {

      var Url = `https://sistemasnaweb.com.br/MetodoPagamento/GerarPixWhatsApp?Adm=${Administrador.codigo}&Nome=${Cli.Nome}&Valor=${ObterValorVenda(Cli)}`;

      const response = await axios.get(Url,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          responseType: 'json',
          httpsAgent: new https.Agent({ rejectUnauthorized: false })
        }
      );

      var result = response.data;
      Cli.Pix = result.pixCopia;
      Cli.CodigoPagamento = result.codigoExterno;
    }
    catch (e) {
      console.log(e);
    }
  }
  async function ObterDadosPixFromWhats(Cli, Administrador) {
    try {
      var Url = `https://www.sistemasnaweb.com.br/Administrador/ObterDadosPixFromWhats?Pix=${Administrador.configuracao.chavePix}&TipoPix=${Administrador.configuracao.tipoPix}&CidadePix=${Administrador.configuracao.cidadePix}&TitularPix=${Administrador.configuracao.titularPix}&ValorDec=${ObterValorVenda(Cli)}&CodigoPessoa=${(Cli.Pessoa != null ? Cli.Pessoa.codigo : 0)}&Celular=${ObterCelularFormatado(Cli.Codigo)}&Adm=${Administrador.codigo}`;

      const response = await axios.get(Url,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          responseType: 'json',
          httpsAgent: new https.Agent({ rejectUnauthorized: false })
        }
      );

      var result = response.data;
      if (result.status) {
        var UrlQr = "00020126@tipo0014BR.GOV.BCB.PIX01@chave52040000530398654@valor5802BR59@beneficiario60@cidade62@limitador05@referencia6304";

        UrlQr = UrlQr.replace("@chave", result.chave);
        UrlQr = UrlQr.replace("@beneficiario", result.beneficiario);
        UrlQr = UrlQr.replace("@cidade", result.cidade);
        UrlQr = UrlQr.replace("@valor", result.valor);
        UrlQr = UrlQr.replace("@referencia", result.referencia);
        UrlQr = UrlQr.replace("@tipo", result.tipoPix);
        UrlQr = UrlQr.replace("@tipo", result.tipoPix);
        UrlQr = UrlQr.replace("@limitador", result.limitador);

        var crc = computeCRC(UrlQr);

        Cli.Pix = UrlQr + crc;
      }

    }
    catch (e) {
      console.log(e);
    }
  }

  async function ObterLocalizacao(Cli, Origem, Destino, Op, Operacao, Administrador) {
    try {
      var Distancia = 0;
      var TempoEntrega = 0;
      var h = 0, i = 0, Anterior = 0;
      var Achou = false, Ok = false;

      var Fretes = Administrador.Fretes;

      if (Fretes != null && Fretes.length > 0) {
        if (Op == 0) {
          var Url = 'https://maps.googleapis.com/maps/api/distancematrix/json?origins=@ORIGEM&destinations=@DESTINO&units=imperial&key=AIzaSyDTeohdHJlLUGblpiEh1bjYZmqvsCCX_eo';

          Url = Url.replace('@ORIGEM', Origem);
          Url = Url.replace('@DESTINO', Destino);

          const response = await fetch(Url);
          const data = await response.json();
          
          console.log(data);


          if (data.rows != null && data.rows.length > 0) {
            for (i = 0; i < data.rows.length; i++) {
              var Data = data.rows[i].elements[0];

              if (Data.distance != null)
                Distancia = Data.distance.value;
              else
                Distancia = 0;

              if (Data.duration != null)
                TempoEntrega = Data.duration.value / 60;
              else
                TempoEntrega = 0;
            };
          }
          else
            Distancia = 0;

          h = 0;

          while (h < Fretes.length && !Achou) {
            if (Destino.toUpperCase().includes(Fretes[h].chave.toUpperCase()) && Fretes[h].distancia == 0) {
              Achou = true;
            }
            else
              h++;
          }

          console.log(Achou);
          console.log(Fretes[h].valor);

          if (!Achou) {
            i = 0
            while (i < Fretes.length && !Ok) {
              if (Distancia < Fretes[i].distancia && Distancia >= Anterior)
                Ok = true;
              else {
                Anterior = Fretes[i].distancia;
                i++;
              }
            }


            if (Ok) {
              Cli.Venda.TaxaEntrega = Fretes[i].valor;
            }
            else
              Cli.Venda.TaxaEntrega = -1;
          }
          else {
            Cli.Venda.TaxaEntrega = Fretes[h].valor;
          }
        }
        else {
          //endereço ja existe consulta nos endereços

          h = 0;
          while (h < Fretes.length && !Achou) {
            if (Destino.toUpperCase().includes(Fretes[h].chave.toUpperCase()) && Fretes[h].distancia == 0) {
              Achou = true;
            }
            else
              h++;
          }

          console.log('Achou .... ' + Achou);

          if (Achou) {
            i = 0
            while (i < Fretes.length && !Ok) {
              if (Distancia < Fretes[i].distancia && Distancia >= Anterior)
                Ok = true;
              else {
                Anterior = Fretes[i].distancia;
                i++;
              }
            }

            if (Ok) {
              Cli.Venda.TaxaEntrega = Fretes[i].valor;
            }
            else
              Cli.Venda.TaxaEntrega = -1;
          }
          else {
            var DistanciaEnd = ObterDistanciaEndereco(Cli, Operacao);
            console.log('DistanciaEnd .... ' + DistanciaEnd);

            i = 0
            Ok = false;
            while (i < Fretes.length && !Ok) {
              if (DistanciaEnd < Fretes[i].distancia && DistanciaEnd >= Anterior)
                Ok = true;
              else {
                Anterior = Fretes[i].distancia;
                i++;
              }
            }

            if (Ok) {
              Cli.Venda.TaxaEntrega = Fretes[i].valor;
            }
            else
              Cli.Venda.TaxaEntrega = -1;
          }

        }
      }
      else {
        console.log('cai aqui')
        Cli.Venda.TaxaEntrega = 0;

      }
    }
    catch (err) {
      Cli.Venda.TaxaEntrega = 0;
    }

    console.log(Cli.Venda.TaxaEntrega);
    return;
  }

  function computeCRC(str, invert = false) {
    const bytes = new TextEncoder().encode(str);

    const crcTable = [0x0000, 0x1021, 0x2042, 0x3063, 0x4084, 0x50a5, 0x60c6, 0x70e7, 0x8108, 0x9129, 0xa14a, 0xb16b, 0xc18c, 0xd1ad, 0xe1ce, 0xf1ef, 0x1231, 0x0210, 0x3273, 0x2252, 0x52b5, 0x4294, 0x72f7, 0x62d6, 0x9339, 0x8318, 0xb37b, 0xa35a, 0xd3bd, 0xc39c, 0xf3ff, 0xe3de, 0x2462, 0x3443, 0x0420, 0x1401, 0x64e6, 0x74c7, 0x44a4, 0x5485, 0xa56a, 0xb54b, 0x8528, 0x9509, 0xe5ee, 0xf5cf, 0xc5ac, 0xd58d, 0x3653, 0x2672, 0x1611, 0x0630, 0x76d7, 0x66f6, 0x5695, 0x46b4, 0xb75b, 0xa77a, 0x9719, 0x8738, 0xf7df, 0xe7fe, 0xd79d, 0xc7bc, 0x48c4, 0x58e5, 0x6886, 0x78a7, 0x0840, 0x1861, 0x2802, 0x3823, 0xc9cc, 0xd9ed, 0xe98e, 0xf9af, 0x8948, 0x9969, 0xa90a, 0xb92b, 0x5af5, 0x4ad4, 0x7ab7, 0x6a96, 0x1a71, 0x0a50, 0x3a33, 0x2a12, 0xdbfd, 0xcbdc, 0xfbbf, 0xeb9e, 0x9b79, 0x8b58, 0xbb3b, 0xab1a, 0x6ca6, 0x7c87, 0x4ce4, 0x5cc5, 0x2c22, 0x3c03, 0x0c60, 0x1c41, 0xedae, 0xfd8f, 0xcdec, 0xddcd, 0xad2a, 0xbd0b, 0x8d68, 0x9d49, 0x7e97, 0x6eb6, 0x5ed5, 0x4ef4, 0x3e13, 0x2e32, 0x1e51, 0x0e70, 0xff9f, 0xefbe, 0xdfdd, 0xcffc, 0xbf1b, 0xaf3a, 0x9f59, 0x8f78, 0x9188, 0x81a9, 0xb1ca, 0xa1eb, 0xd10c, 0xc12d, 0xf14e, 0xe16f, 0x1080, 0x00a1, 0x30c2, 0x20e3, 0x5004, 0x4025, 0x7046, 0x6067, 0x83b9, 0x9398, 0xa3fb, 0xb3da, 0xc33d, 0xd31c, 0xe37f, 0xf35e, 0x02b1, 0x1290, 0x22f3, 0x32d2, 0x4235, 0x5214, 0x6277, 0x7256, 0xb5ea, 0xa5cb, 0x95a8, 0x8589, 0xf56e, 0xe54f, 0xd52c, 0xc50d, 0x34e2, 0x24c3, 0x14a0, 0x0481, 0x7466, 0x6447, 0x5424, 0x4405, 0xa7db, 0xb7fa, 0x8799, 0x97b8, 0xe75f, 0xf77e, 0xc71d, 0xd73c, 0x26d3, 0x36f2, 0x0691, 0x16b0, 0x6657, 0x7676, 0x4615, 0x5634, 0xd94c, 0xc96d, 0xf90e, 0xe92f, 0x99c8, 0x89e9, 0xb98a, 0xa9ab, 0x5844, 0x4865, 0x7806, 0x6827, 0x18c0, 0x08e1, 0x3882, 0x28a3, 0xcb7d, 0xdb5c, 0xeb3f, 0xfb1e, 0x8bf9, 0x9bd8, 0xabbb, 0xbb9a, 0x4a75, 0x5a54, 0x6a37, 0x7a16, 0x0af1, 0x1ad0, 0x2ab3, 0x3a92, 0xfd2e, 0xed0f, 0xdd6c, 0xcd4d, 0xbdaa, 0xad8b, 0x9de8, 0x8dc9, 0x7c26, 0x6c07, 0x5c64, 0x4c45, 0x3ca2, 0x2c83, 0x1ce0, 0x0cc1, 0xef1f, 0xff3e, 0xcf5d, 0xdf7c, 0xaf9b, 0xbfba, 0x8fd9, 0x9ff8, 0x6e17, 0x7e36, 0x4e55, 0x5e74, 0x2e93, 0x3eb2, 0x0ed1, 0x1ef0];

    let crc = 0xFFFF;

    for (let i = 0; i < bytes.length; i++) {
      const c = bytes[i];
      const j = (c ^ (crc >> 8)) & 0xFF;

      crc = crcTable[j] ^ (crc << 8);
    }

    let answer = ((crc ^ 0) & 0xFFFF);

    let hex = numToHex(answer, 4);

    if (invert)
      return hex.slice(2) + hex.slice(0, 2);

    return hex;
  };
  function numToHex(n, digits) {
    let hex = n.toString(16).toUpperCase();

    if (digits) {
      return ("0".repeat(digits) + hex).slice(-digits);
    }

    return (hex.length % 2 == 0) ? hex : "0" + hex;
  }
  function removeSpecialCharactersAndAccents(str) {
    let normalized = str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return '' + normalized;
  }
  function GetJsonString(textoComJson) {
    const indiceInicioJson = textoComJson.indexOf('{')

    // Use o método JSON.parse para analisar o JSON em um objeto JavaScript
    const objetoJson = JSON.parse(textoComJson.slice(indiceInicioJson))
    return objetoJson;
  }
  function GetVetorProdutosNome(Administrador) {
    var Nomes = [];

    var ProdutosCatalogo = Administrador.ProdutosCatalogo;

    for (var i = 0; i < ProdutosCatalogo.length; i++) {
      var Prod = new Object();
      Prod.Id = ProdutosCatalogo[i].Codigo;
      Prod.Nome = removeSpecialCharactersAndAccents(ProdutosCatalogo[i].Nome.toUpperCase());

      Nomes.push(Prod);
    }

    return Nomes;
  }
  function GetVetorPagamentoNome(Administrador) {
    var Nomes = [];

    for (var i = 0; i < Administrador.FormasPagamento.length; i++) {
      Nomes.push(Administrador.FormasPagamento[i].Nome);
    }

    return Nomes;
  }
  async function ValidarEndereco(Msg) {
    Msg = removeSpecialCharactersAndAccents(Msg.toUpperCase());

    var Mensagem = `RETORNAR true OU false SE E UM ENDEREÇO VALIDO "@MSG"`;

    Mensagem = Mensagem.replace('@MSG', Msg);

    const configuration = new Configuration({
      apiKey: process.env.OPENAI_API_KEY || '',
    });
    const openai = new OpenAIApi(configuration);

    var response = await openai.createCompletion({
      model: "text-davinci-003",
      prompt: Mensagem,
      temperature: 0,
      max_tokens: 1000,
      top_p: 0,
      frequency_penalty: 0,
      presence_penalty: 0
    });
    var data = response.data;

    var data = data.choices[0].text;

    return data.trim().toLowerCase();
  }
  async function ValidarFormaPagamento(Msg) {
    Msg = removeSpecialCharactersAndAccents(Msg.toUpperCase());

    var Mensagem = `RETORNAR true OU false SE E UMA FORMA DE PAGAMENTO VALIDO "@MSG"`;

    Mensagem = Mensagem.replace('@MSG', Msg);

    const configuration = new Configuration({
      apiKey: process.env.OPENAI_API_KEY || '',
    });
    const openai = new OpenAIApi(configuration);

    var response = await openai.createCompletion({
      model: "text-davinci-003",
      prompt: Mensagem,
      temperature: 0,
      max_tokens: 1000,
      top_p: 0,
      frequency_penalty: 0,
      presence_penalty: 0
    });
    var data = response.data;
    var data = data.choices[0].text;

    return data.trim().toLowerCase();
  }
  function AjudaPlataforma(Administrador) {
    return Administrador.Configuracao.mensagemAjuda == '' ? 'Posso te ajudar nestas *situações*:\n\n*1 - Realizar Pedidos*\n*2 - Tempo de Entrega e Taxa de Entrega*\n*3 - Promoções*\n*4 - Ver o Cardápio*\n*5 - Rastreio da Entrega*\n*6 - Horário de Funcionamento*\n*7 - Falar com Atendente*\n\nEscolha o *código* da opção desejada ou digite com suas palavras uma das *opções acima*!\n\nOu acesse nossa plataforma: https://sistemasnaweb.com.br/' + Administrador.configuracao.urlLoja + '  🔗' : Administrador.Configuracao.mensagemAjuda.replaceAll('<br>', '\n');
  }
  async function ColetarPedido(Msg, Administrador) {
    try {

      Msg = removeSpecialCharactersAndAccents(Msg.toUpperCase());
      Msg = Msg.replace('CARTAO', 'DEBITO');

      var ProdutosNome = JSON.stringify(GetVetorProdutosNome(Administrador));
      var PagamentosNome = GetVetorPagamentoNome(Administrador);

      var Mensagem = `Frase feita por um cliente do restaurante "@MSG"
Classifique a frase se for um pedido Retorne sem explicação ou comentarios um json com os produtos (Id, Nome, Quantidade e Observação, Score), enderecoEntrega, formaPagamento
Se não tiver produtos retorne null
Se nao tiver quantidade retorne 1
Leve em consideração meus produtos @PRODUTOS Score da confiabilidade da classificacao para cada produto e um valor de 0 a 1
produtos, enderecoEntrega e formaPagamento se não tiverem trazer null`;

      Mensagem = Mensagem.replace('@MSG', Msg);
      Mensagem = Mensagem.replace('@PRODUTOS', ProdutosNome);

      const configuration = new Configuration({
        apiKey: process.env.OPENAI_API_KEY || '',
      });
      const openai = new OpenAIApi(configuration);

      var response = await openai.createCompletion({
        model: "text-davinci-003",
        prompt: Mensagem,
        temperature: 0,
        max_tokens: 600,
        top_p: 0,
        frequency_penalty: 0,
        presence_penalty: 0
      });

      var data = response.data;
      console.log(data.choices[0].text);

      var Json = JSON.parse(data.choices[0].text);

      return Json;
    }
    catch (e) {
      console.log(e);
      return null;

    }
  }
  async function RemoverPedido(Msg, Administrador) {
    try {

      Msg = removeSpecialCharactersAndAccents(Msg.toUpperCase());

      var ProdutosNome = JSON.stringify(GetVetorProdutosNome(Administrador));

      var Mensagem = `Frase "@MSG"
Classifique a frase se for um pedido Retorne sem explicação ou comentarios um json com um vetor de produtos (Id, Nome, Quantidade e Observação, Score)
Se não tiver produtos retorne null
Leve em consideração meus produtos @PRODUTOS
Exemplo produtos []`;

      Mensagem = Mensagem.replace('@MSG', Msg);
      Mensagem = Mensagem.replace('@PRODUTOS', ProdutosNome);

      const configuration = new Configuration({
        apiKey: process.env.OPENAI_API_KEY || '',
      });
      const openai = new OpenAIApi(configuration);

      var response = await openai.createCompletion({
        model: "text-davinci-003",
        prompt: Mensagem,
        temperature: 0,
        max_tokens: 600,
        top_p: 0,
        frequency_penalty: 0,
        presence_penalty: 0
      });

      var data = response.data;
      var Json = JSON.parse(data.choices[0].text);

      console.log(Json);

      return Json;
    }
    catch (e) {
      console.log(e);
      return null;

    }
  }
  async function CarregarBaseChat(Mensagem, Intent) {
    try {

      var Base = require(__dirname + '/traini.json');

      const configuration = new Configuration({
        apiKey: process.env.OPENAI_API_KEY || '',
      });
      const openai = new OpenAIApi(configuration);


      var Msg = `atendimento de uma lanchonete no delivery dentre essa lista ["ENTREGA", "AGRADECIMENTO", "RECLAMACAO", "ELOGIO", "RASTREAMENTO", "PEDIDO", "INTENCAO_PEDIDO", "SAUDACAO", "CANCELAMENTO", "QUALIDADE", "PROMOCAO", "CARDAPIO", "ATENDENTE", "PROMOCAO", "REMOVER", "FINALIZAR", "CARRINHO", "NENHUMA"] acuaria acima de 90 corrija a ortografia se necessário e classifique a frase "@MENSAGEM" retorne apenas a palavra sem a explicação e sem afirmação`;

      Msg = Msg.replace('@MENSAGEM', Mensagem);

      var response = await openai.createCompletion({
        model: "text-davinci-003",
        prompt: Msg,
        temperature: 0.1,
        max_tokens: 10,
        top_p: 1,
        frequency_penalty: 0.5,
        presence_penalty: 0,
      });

      var data = response.data;

      var Intencao = data.choices[0].text.replaceAll('\n', '').replaceAll('.', '').replace('?', '').toUpperCase();
      Intencao = removeSpecialCharactersAndAccents(Intencao);

      var Dados = Base.data;
      var found = Dados.find(obj => obj.intent.trim() == Intencao.trim())

      if (found != null && Intencao != Intent) {
        //encontratou a intenção na base
        //verifica a pergunta agora

        var foundAns = found.utterances.find(element => element == Mensagem);

        if (foundAns == null) {
          //nao tem ... add no vetor e grava a interação .... 
          found.utterances.push(Mensagem);

          const filePath = __dirname + '/traini.json';
          const fileContent = JSON.stringify(Base);

          await fs.writeFile(filePath, fileContent, async (error) => {
            if (error) {
              console.log(error);
            } else {

              Train();

              fs.readFile('./logs.txt', 'utf-8', async function (err, data) {

                var Content = data + '\n' + Intencao;
                await fs.writeFile('./logs.txt', Content, async (error) => { });

              })

            }
          });
        }

      }

      return Intencao;
    }
    catch (e) {
      console.log(e);
      return 'NENHUMA';

    }
  }
  function parseBool(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
        return ["true", "1", "yes", "on"].includes(value.toLowerCase());
    }
    return Boolean(value);
  }
setInterval(verificarPedidosClientes, 300000);

  function verificarPedidosClientes(){

    for(var i = 0; i < Administradores.length; i++){
      if(Administradores[i] != null){
      var Administrador = Administradores[i];

      if(Administrador != null){
var cliWh = clientSessionRegistry[Administrador.codigo];;      

      if(cliWh != null){
        if(Administrador != null && Administrador.Clientes != null){
          Administrador.Clientes.forEach(async function (Cli) {          
            //fez o login a mais de 10 minutos e nao pediu
            if(Cli.Login < new Date()){
              if(Cli.Venda == null && !Cli.Notificacao){
                if(Administrador.Configuracao.mensagemInativo != ''){
                  Cli.Notificacao = true;
                  await cliWh.sendMessage(Cli.Codigo, Administrador.Configuracao.mensagemInativo);
                }              
              }
            }

          });
        }

      } 
      }
      
      }
          
    }
  }
server.listen(2000, () => {
    try{
      console.log('API Rodando')
    }
    catch (err) {
      console.log('Opss Erro')
    }
  })
  server.get('/RemoverServerFromSessao', async (req, res) => {
    var Sessao = req.query.IdSessao;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Credentials', true);

     //apaga a pasta
     var caminhoDaPasta = path.join(app.getPath('temp'), 'Sessoes')
     caminhoDaPasta += '/session-' + Sessao;
     if (fs.existsSync(caminhoDaPasta)) {
      var cliWh = clientSessionRegistry[req.query.IdSessao];

      if(cliWh != null){
              res.json({ status: false, operacao : 2 });
      }
      else{
        fs.rmdir(caminhoDaPasta, { recursive: true }, (erro) => {
          if (erro) {
            console.log(erro);
            res.json({ status: false, operacao : 1 });
          }

          res.json({ status: true, operacao: 1 });
        });
      }

    } else {
                  
      res.json({ status: false, operacao : 0 });

      }

  })  
  
  server.post('/IniciarCampanha', async (req, res) => {
    try{

      var Adm = Administradores.find(element => element.codigo == req.query.Loja);

      if(Adm != null){
        ObterCampanha(Adm);

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Allow-Credentials', true);

        res.json({ status: true });
      }
      else
        res.json({ status: false });
    }
    catch (err) {
      res.json({ status: false });
    }
  })

  server.post('/PausarCampanha', async (req, res) => {
    try{

      var Adm = Administradores.find(element => element.codigo == req.query.Loja);

      if(Adm != null){
        Executando = !Executando;

        if(Executando){
          ObterCampanha(Adm.codigo);
        }
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Allow-Credentials', true);

        res.json({ status: true, executando : Executando });
      }
      else{
        res.json({ status: false, executando : Executando });
      }
    }
    catch (err) {
      res.json({ status: false });
    }
  })

  server.post('/SendComanda', async (req, res) => {
    try{        
              
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Allow-Credentials', true);
        
        var cliWh = clientSessionRegistry[req.query.Loja];;      

        if(cliWh != null){
          var Texto = req.body.Texto;
          var Celular = req.body.Celular;
        
          Celular = Celular.replace('(', '').replace(')', '').replace('-', '').replace(' ', '');

          if (Celular != "" && Celular != null && cliWh ) {      
            Celular = '55' + Celular.replace('(', '').replace(')', '').replace('-', '').replace(' ', '') + '@c.us';
        
            var ValidarCelular = await cliWh.getNumberId(Celular);

            var numeroPn = await ObterWhatsApp(cliWh, ValidarCelular);
            Celular = numeroPn;

            if(Celular.length > 14){    

              if(Administrador != null && Administrador.Clientes != null)
              {
                var Cliente = Administrador.Clientes.find(element => element.Codigo == Celular);

                if(Cliente != null)
                {
                  Cliente.AutoAtendimento = false;
                  const agora = new Date();
                  agora.setMinutes(agora.getMinutes() + 1);
                
                  Cliente.Expire = agora;

                }
              }
      
              await cliWh.sendMessage(Celular, Texto);
              res.json({ status: true });
          }
        }
      }


    }
    catch (err) {
      res.json({ status: false });
    }
  })

  server.get('/ValidarInicilizacaoWhats', async (req, res) => {

    try{
      var Status = false;

      var cliWh = clientSessionRegistry[req.query.Loja];

      if(cliWh != null){
        Status = true;
      }

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Credentials', true);

      res.json({ status: Status });
    }
    catch (err) {
      res.json({ status: false });
    }
  })

  server.get('/Whats', async (req, res) => {

    try{

      var Adm = Administradores.find(element => element.codigo == req.query.Loja);

      if(Adm != null){
        var cliWh = clientSessionRegistry[req.query.Loja];
        var Venda = req.query.Venda;
        var Pagamento = req.query.Pagamento;
        var Status = req.query.Status;
        var Celular = req.query.Celular;
        var Motivo = req.query.Motivo;
        var Entrega = parseBool(req.query.Entrega);
        var LinkEntrega = req.query.LinkEntrega;

        Celular = Celular.replace('(', '').replace(')', '').replace('-', '').replace(' ', '');

        sendMessage(JSON.stringify({acao: 3, msg: req.query.Sessao}));

        if (Celular != "" && Celular != null && cliWh ) {

          Celular = '55' + Celular + '@c.us';
          var ValidarCelular = await cliWh.getNumberId(Celular);

            var numeroPn = await ObterWhatsApp(cliWh, ValidarCelular);
            Celular = numeroPn;
          if(Celular.length > 14){
        
          var found = await Adm.Clientes.find(element => element.Codigo == Celular);

          if(found != null){
            //instancia na venda ... para depois consultar se esse cliente realizou o pedido ... 
            var VenObj = new Object();
            VenObj.Codigo = Venda;

            found.Venda = VenObj;
          }

          await sleep(2000);
          await cliWh.sendMessage(Celular,  ObterStatusPedidoEscrito(Status, Adm, Entrega, LinkEntrega) + ((Motivo != null && Motivo != "") ? "\n*Motivo:* " + Motivo : ''));
            console.log('cai aqui')

          if(Pagamento != null && Pagamento.toUpperCase() == 'PIX' && Status == 2){
            await sleep(5000);
            await cliWh.sendMessage(Celular, (Adm.Configuracao.mensagemPix == '' ? '💸 Por Favor, Assim que realizar o *pagamento* nós envie o *comprovante* por aqui 😉' : Adm.Configuracao.mensagemPix.replaceAll('<br>', '\n')));
          }
        }
        }        
      }

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Credentials', true);

      res.json({ status: true });
    }
    catch (err) {
      res.json({ status: false });
    }
  })
  
  server.get('/NewSessao', async (req, res) => {
    try{
      console.log('aaaa '+req.query.Loja);

      //var NroSessao = await ConsultarNomeSessao(req.query.Loja) + 1;
      //console.log((NroSessao - 1));
      
      var Ret = await IniciarServer(req.query.Loja, 0)
      //var Ret = await IniciarServer('001', 1)
      //await sleep(10000);

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Credentials', true);

      //res.json({ status: Ret, Sessao: (req.query.Loja + '00' + NroSessao) });
      res.json({ status: Ret, Sessao: (req.query.Loja) });

    }
    catch (err) {
      res.json({ status: false, Sessao: '' });
    }
  })
  server.get('/ReiniciarServidor', async (req, res) => {
      try{
        const client = clientSessionRegistry[req.query.Loja];

        if(client != null){
          delete clientSessionRegistry[req.query.Loja];
          client.destroy();
          await sleep(2000);
        }
        var Ret = await IniciarServer(req.query.Loja, 0)

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Allow-Credentials', true);

        //res.json({ status: Ret, Sessao: (req.query.Loja + '00' + NroSessao) });
        res.json({ status: Ret, Sessao: (req.query.Loja) });

      }
      catch (err) {
        res.json({ status: false, Sessao: '' });
      }
    })
  server.get('/getQrCode', (req, res) => {
    try{
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Credentials', true);

      var sessionId = req.query.Sessao;
      console.log(`./qr_code${sessionId ? '_' + sessionId : ''}.png`);

      if (fs.existsSync(`./qr_code${sessionId ? '_' + sessionId : ''}.png`)) {
        console.log('to aqui 123');
        const filePath = `./qr_code${sessionId ? '_' + sessionId : ''}.png`;
        const stat = fs.statSync(filePath);
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': stat.size
        });
        const readStream = fs.createReadStream(filePath);
        readStream.pipe(res);
      }
      else {
        res.writeHead(451, {
        });
      }
    }
    catch (err) {
      res.json({ status: false, Sessao: '' });
    }
  });

server.post('/KillServer', async (req, res) => {
    try {
        const idLoja = req.query.Loja;
        const client = clientSessionRegistry[idLoja];

        if (client) {
            // 1. Tenta destruir a sessão de forma segura
            try {
                // É OBRIGATÓRIO usar await aqui
                delete clientSessionRegistry[idLoja];

            // 3. CORREÇÃO DE LÓGICA: .find retorna o objeto, .findIndex retorna a posição
            // O splice precisa do INDEX (número), não do objeto.
            const index = Administradores.findIndex(element => element.codigo == idLoja);
            
            if (index !== -1) { // -1 significa que não achou
                Administradores.splice(index, 1);
            }
            LimparSessao(idLoja);
                          await sleep(1500);

                await client.destroy(); 
            } catch (err) {
                // Se der erro ao destruir (ex: navegador já fechado), apenas ignoramos
                // para não travar o servidor. O objetivo é fechar mesmo.
                console.log(`Aviso: Erro ao destruir cliente ${idLoja} (provavelmente já fechado).`);
            }

            // 2. Remove do registro de sessões
            
        }

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Allow-Credentials', true);

        res.json({ status: true });

    } catch (e) {
        console.error('Erro no KillServer:', e);
        res.status(500).json({ status: false, error: e.message });
    }
});

  server.post('/ClientesWhatsApp', async (req, res) => {
    try{
      
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Credentials', true);

      var Adm = await Administradores.find(element => element.codigo == req.query.Loja);
      
      console.log(Administradores);
            console.log(req.query.Loja);

      if (Adm != null && Adm.Clientes != null)
        res.json({ Clientes: Adm.Clientes });
      else
        res.json({ Clientes: null });
    }
    catch (e) {
      console.log(e);
      res.json({ Clientes: null });

    }
  })

  server.post('/DesativarAtendimentoAutomatico', async (req, res) => {
    try{        
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Credentials', true);

      var Administrador = await Administradores.find(element => element.codigo == req.body.Adm);

      if(Administrador != null){
        var Pessoa = await Administrador.Clientes.find(element => element.Codigo == req.body.Codigo);

        if (Pessoa != null) {
          Pessoa.AutoAtendimento = req.body.Status;
          res.json({ Status: true });
        }
        else
          res.json({ Status: false });

      }
      else
        res.json({ Status: true });

    }
    catch (e) {
      console.log(e);
      res.json({ Status: false });

    }
  })

  server.listen(3000, () => {
    try{
      console.log('Server em funcionamento')
    }
    catch (e) {
      console.log(e);
    }
  })

  const { exec } = require('child_process');
  /// servidor de impressao ///
  //verifica funcionamento do servidor ... 
  serverImpressao.listen(8000, () => {
    try{
      console.log('Server em funcionamento');
      sendMessage(JSON.stringify({acao: 3, msg: 'Server em funcionamento'}));
    }
    catch (e) {
      console.log('erro' + e);
    }
  })

  const { PosPrinter } = require("electron-pos-printer");

  serverImpressao.post('/imprimir', async (req, res) => {
    try {
      if (StatusImpressao) {
        var Dados = req.body;
        var data = [];
        var Ok = false;
        var NumCol = '';

        if (Dados != null && Dados != "") {

          var options = {
            preview: false,
            margin: 'auto',
            printerName: Dados.impresora,
            timeOutPerLine: 2000,
            silent: true,
            //pagesPerSheet: 10,
            pageSize: { height: 301000, width: 301000 }  // page size
          }


          if(NumeroColunas != '')
              NumCol = NumeroColunas;
          else
              NumCol = 'auto';

          for (var i = 0; i < Dados.operaciones.length; i++) {
            if (Dados.operaciones[i].accion == 'text') {
              data.push(
                {
                  type: 'text',
                  value: Dados.operaciones[i].datos,
                  style: {
                    "text-align": 'match-parent',
                    "font-family": Fonte,
                    "font-size": TamanhoFonte,
                    "margin-left": '10px',
                    "margin-right": '15px',
                    "word-wrap": "break-word",
                    'width': NumCol
                  }
                }
              );
            }
            
            if (Dados.operaciones[i].accion == 'imagen') {
              data.push(
                {
                  type: 'image',
                  url: Dados.operaciones[i].datos,
                  position: 'left',
                  width: '90px',                                           // width of image in px; default: auto
                  height: '90px',
                  style: {
                    "margin-left": '20px',
                    "margin-right": '20px'
                  }
                }
              );

            }

            if (Dados.operaciones[i].accion == 'qrimagen') {
              data.push(
                {
                  type: 'qrCode',
                  value: Dados.operaciones[i].datos,
                  height: 55,
                  width: 55,
                  position: 'center',
                  style: { margin: '10 20px 20 20px' }
                }
              );
            }
          }

          data.push(
            {
              type: 'text',
              value: "</corte_total>",
              style: {
                "text-align": 'match-parent',
                "font-family": Fonte,
                "font-size": TamanhoFonte,
                "margin-left": '25px',
                "margin-right": '25px'

              }
            }
          );
          const temNFCE = JSON.stringify(data).toLocaleLowerCase().includes("nfc-e");

          if(temNFCE){
            console.log('cai aqui');

            data.push(
              {
                type: 'qrCode',
                value: 'Sistemas na Web Cupom Fiscal',
                height: 230,
                width: 230,
                position: 'center',
                style: { margin: '10 20px 20 20px' }
              }
            );

          }

          PosPrinter.print(data, options)
            .then(Ok = true)
            .catch((error) => {
              Ok = false;
              console.log(error)
            });

        }

      }
      res.json(Ok);
    }
    catch (e) {
      console.log('erro' + e);
      sendMessage(JSON.stringify({acao: 3, msg: 'erro' + e}));
      res.json(false);
    }
  });

  serverImpressao.post('/impresoras', async (req, res) => {
    try{
      var Impressoras = [];

    const { exec } = require('child_process');
    exec('wmic printer list brief', (err, stdout, stderr) => {
      if (err) {
        // node couldn't execute the command
      }
      // list of printers with brief details
      // the *entire* stdout and stderr (buffered)
      stdout = stdout.split("  ");
      var printers = [];
      j = 0;
      stdout = stdout.filter(item => item);
      for (i = 0; i < stdout.length; i++) {
        if (stdout[i] == " \r\r\n" || stdout[i] == "\r\r\n") {
          printers[j] = stdout[i + 1];
          j++;
        }
      }

      Impressoras = printers;

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Api-Key, X-Requested-With, Content-Type, Accept, Authorization');
      res.setHeader('Access-Control-Allow-Credentials', true);

      res.json(Impressoras);
    });
    }
    catch (e) {
      console.log('erro' + e);
      res.json('');

    }
  });

  serverImpressao.get('/ObterConfig', async (req, res) => {
    try{
      res.json({ WhatsApp: InitWhatsApp, Fonte: Fonte, TamanhoFonte: TamanhoFonte, 
      CaminhoNavegador: CaminhoNavegador, NumeroColunas: NumeroColunas});
    }
    catch (e) {
      console.log('erro' + e);
      res.json('');
    }
  });

  serverImpressao.post('/GravarConfiguracao', async (req, res) => {
    try{
      var Value = req.body.Value;
      var Pos = req.body.Pos;

      console.log(Value);

      if (Value != null || Value != '') {
        GravarConfiguracao(Value, Pos);
      }

      res.json({ status: true });
    }
    catch (e) {
      console.log('erro' + e);
      res.json({ status: false });
    }
  });

  async function GravarConfiguracao(Value, Pos) {
    var Txt = '';
    var i = 0;

    fs.readFile(path.join(app.getPath('temp'), 'config.txt'), 'utf-8', async function (err, data) {
      var linhas = data.split(/\r?\n/);

      linhas.forEach(function (linha) {
        if (linha != undefined) {
          var strLinha = linha.split('=');

          if (strLinha != null && strLinha.length > 0) {
            if (strLinha[0] != '') {
              if (i == Pos)
                Txt += strLinha[0] + '=' + (strLinha.length > 1 ? Value : '') + ((i + 1 == linhas.length) ? '' : '\n');
              else
                Txt += strLinha[0] + '=' + (strLinha.length > 1 ? strLinha[1] : '') + ((i + 1 == linhas.length) ? '' : '\n');
            }
          }
        }

        i++;
      })

      fs.writeFile(path.join(app.getPath('temp'), 'config.txt'), Txt, function (erro) {

        if (erro) {
          throw erro;
        }

      });
    })
    
    await sleep(1000);
    LerConfiguracoes();
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}).catch(err => {
  app.quit();
});

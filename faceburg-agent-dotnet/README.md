# Faceburg Local Agent .NET

Versao separada do agente local para comparar com o hub Electron atual.

## Ideia

- Servidor local leve em `http://127.0.0.1:9787`.
- Impressao nativa RAW ESC/POS via Winspool, sem PowerShell.
- WhatsApp isolado em sidecar controlado pelo agente .NET por IPC.
- O servidor principal continua sem polling pesado: a tela de pedidos pode preparar os payloads no sistema e entregar localmente.
- Se o local falhar, o sistema pode manter a fila antiga como fallback.
- A tela `/pedidos` ja tenta este agente em `127.0.0.1:9787` quando nao estiver usando a ponte Electron.

## Endpoints

- `GET /api/health`
- `GET /api/printers`
- `GET /api/config`
- `PUT /api/config`
- `POST /api/print/test`
- `POST /api/print`
- `GET /api/whatsapp/status`
- `POST /api/whatsapp/start`
- `POST /api/whatsapp/stop`
- `POST /api/whatsapp/send`
- `POST /api/dispatch`

## Rodar em desenvolvimento

```powershell
& "C:\Program Files\dotnet\dotnet.exe" run --project .\src\Faceburg.LocalAgent\Faceburg.LocalAgent.csproj
```

Depois abra:

```text
http://127.0.0.1:9787
```

## Publicar EXE

```powershell
.\scripts\publish-win-x64.ps1
```

Saida esperada:

```text
dist\Faceburg.LocalAgent.exe
```

O script tambem instala as dependencias do `whatsapp-sidecar` dentro da pasta publicada.

Para abrir depois de publicar, use:

```text
start-agent.bat
```

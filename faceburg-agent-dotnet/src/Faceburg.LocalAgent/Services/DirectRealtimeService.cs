using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Faceburg.LocalAgent.Config;
using Faceburg.LocalAgent.Models;

namespace Faceburg.LocalAgent.Services;

public sealed class DirectRealtimeService(
    ConfigStore configStore,
    PrintService print,
    WhatsAppSidecarService whatsapp,
    ILogger<DirectRealtimeService> logger
) : BackgroundService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly TimeSpan ReconnectDelay = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan StateInterval = TimeSpan.FromSeconds(15);

    private string _lastPrintError = "";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.WhenAll(
            RunKindLoopAsync("print", stoppingToken),
            RunKindLoopAsync("whatsapp", stoppingToken)
        );
    }

    private async Task RunKindLoopAsync(string kind, CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var config = await configStore.LoadAsync(stoppingToken);
                var agentKey = GetAgentKey(config, kind);
                if (string.IsNullOrWhiteSpace(agentKey) || (kind == "whatsapp" && !config.WhatsAppEnabled))
                {
                    await Task.Delay(ReconnectDelay, stoppingToken);
                    continue;
                }

                using var ws = new ClientWebSocket();
                ws.Options.SetRequestHeader("x-agent-key", agentKey);
                ws.Options.SetRequestHeader("x-agent-protocol", "direct-v1");
                var uri = BuildRealtimeUri(config, kind);
                await ws.ConnectAsync(uri, stoppingToken);
                logger.LogInformation("Realtime direto conectado ({Kind}) em {Uri}.", kind, uri);
                await SendStateAsync(ws, kind, config, stoppingToken);
                await ReceiveLoopAsync(ws, kind, config, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Realtime direto desconectado ({Kind}).", kind);
            }

            await Task.Delay(ReconnectDelay, stoppingToken);
        }
    }

    private async Task ReceiveLoopAsync(ClientWebSocket ws, string kind, AgentConfig initialConfig, CancellationToken stoppingToken)
    {
        var connectedWith = ConnectionFingerprint(initialConfig, kind);
        using var heartbeatCts = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        var heartbeatTask = HeartbeatLoopAsync(ws, kind, connectedWith, heartbeatCts.Token);
        try
        {
            while (!stoppingToken.IsCancellationRequested && ws.State == WebSocketState.Open)
            {
                var message = await ReceiveMessageAsync(ws, stoppingToken);
                if (message is null) break;
                await HandleMessageAsync(ws, kind, message, stoppingToken);
            }
        }
        finally
        {
            heartbeatCts.Cancel();
            await heartbeatTask.ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
        }
    }

    private async Task HeartbeatLoopAsync(ClientWebSocket ws, string kind, string connectedWith, CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested && ws.State == WebSocketState.Open)
        {
            try
            {
                await Task.Delay(StateInterval, cancellationToken);
                var config = await configStore.LoadAsync(cancellationToken);
                if (!string.Equals(connectedWith, ConnectionFingerprint(config, kind), StringComparison.Ordinal))
                {
                    await CloseSilentlyAsync(ws, cancellationToken);
                    return;
                }
                await SendStateAsync(ws, kind, config, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
        }
    }

    private async Task HandleMessageAsync(ClientWebSocket ws, string kind, string message, CancellationToken cancellationToken)
    {
        using var document = JsonDocument.Parse(message);
        var root = document.RootElement;
        var type = GetString(root, "type");

        if (type == "ping")
        {
            await SendJsonAsync(ws, new { type = "pong", ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() }, cancellationToken);
            return;
        }

        if (type != "job") return;
        var job = root.TryGetProperty("job", out var jobElement) ? jobElement : default;
        if (job.ValueKind != JsonValueKind.Object) return;

        if (kind == "print")
        {
            await HandlePrintJobAsync(ws, job, cancellationToken);
            return;
        }

        await HandleWhatsAppJobAsync(ws, job, cancellationToken);
    }

    private async Task HandlePrintJobAsync(ClientWebSocket ws, JsonElement job, CancellationToken cancellationToken)
    {
        var jobId = GetString(job, "id");
        try
        {
            var config = await configStore.LoadAsync(cancellationToken);
            var result = print.Print(new PrintJobRequest
            {
                JobId = jobId,
                TenantId = config.TenantId,
                TenantSlug = config.TenantSlug,
                TerminalId = config.TerminalId,
                PrinterName = FirstNonEmpty(GetString(job, "printerName"), config.DefaultPrinter),
                PayloadText = GetString(job, "payloadText"),
                Columns = GetInt(job, "columns") ?? GetInt(job, "receiptWidth") ?? config.Columns,
                PrintTextSize = FirstNonEmpty(GetString(job, "printTextSize"), config.PrintTextSize),
                CodePage = config.CodePage,
                CutPaper = config.CutPaper,
                PulseDrawer = config.PulseDrawer,
                Copies = GetInt(job, "copies") ?? 1,
            }, config);

            _lastPrintError = result.Ok ? "" : result.Error ?? "Falha de impressao";
            await SendAckAsync(ws, jobId, result.Ok, _lastPrintError, cancellationToken);
            if (result.Ok)
            {
                logger.LogInformation("Job direto de impressao {JobId} enviado para {PrinterName}.", jobId, result.PrinterName);
            }
        }
        catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
        {
            _lastPrintError = ex.Message;
            await SendAckAsync(ws, jobId, false, _lastPrintError, cancellationToken);
            logger.LogWarning(ex, "Job direto de impressao {JobId} falhou.", jobId);
        }
    }

    private async Task HandleWhatsAppJobAsync(ClientWebSocket ws, JsonElement job, CancellationToken cancellationToken)
    {
        var jobId = GetString(job, "id");
        try
        {
            var result = await whatsapp.SendAsync(new WhatsAppSendRequest
            {
                JobId = jobId,
                TargetPhone = GetString(job, "targetPhone"),
                PayloadText = GetString(job, "payloadText"),
            }, cancellationToken);

            await SendAckAsync(ws, jobId, result.Ok, result.Error ?? "", cancellationToken);
            if (result.Ok)
            {
                logger.LogInformation("Job direto WhatsApp {JobId} enviado para {TargetPhone}.", jobId, result.TargetPhone);
            }
        }
        catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
        {
            await SendAckAsync(ws, jobId, false, ex.Message, cancellationToken);
            logger.LogWarning(ex, "Job direto WhatsApp {JobId} falhou.", jobId);
        }
    }

    private async Task SendStateAsync(ClientWebSocket ws, string kind, AgentConfig config, CancellationToken cancellationToken)
    {
        if (kind == "print")
        {
            await SendJsonAsync(ws, new
            {
                type = "agent_state",
                state = new
                {
                    connectionStatus = string.IsNullOrWhiteSpace(_lastPrintError) ? "ready" : "error",
                    printerName = config.DefaultPrinter,
                    columns = config.Columns,
                    printTextSize = config.PrintTextSize,
                    deviceName = Environment.MachineName,
                    appVersion = AppVersion(),
                    lastError = _lastPrintError,
                },
            }, cancellationToken);
            return;
        }

        var status = whatsapp.CurrentStatus;
        await SendJsonAsync(ws, new
        {
            type = "agent_state",
            state = new
            {
                sessionStatus = MapWhatsAppStatus(status.Status),
                qrCode = status.QrCode,
                phoneNumber = status.PhoneNumber,
                deviceName = Environment.MachineName,
                appVersion = AppVersion(),
                lastError = status.LastError,
            },
        }, cancellationToken);
    }

    private static Task SendAckAsync(ClientWebSocket ws, string jobId, bool success, string error, CancellationToken cancellationToken)
    {
        return SendJsonAsync(ws, new
        {
            type = "job_ack",
            jobId,
            success,
            error,
            ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        }, cancellationToken);
    }

    private static async Task SendJsonAsync(ClientWebSocket ws, object payload, CancellationToken cancellationToken)
    {
        if (ws.State != WebSocketState.Open) return;
        var bytes = JsonSerializer.SerializeToUtf8Bytes(payload, JsonOptions);
        await ws.SendAsync(bytes, WebSocketMessageType.Text, true, cancellationToken);
    }

    private static async Task<string?> ReceiveMessageAsync(ClientWebSocket ws, CancellationToken cancellationToken)
    {
        var buffer = new byte[16 * 1024];
        await using var stream = new MemoryStream();

        while (true)
        {
            var result = await ws.ReceiveAsync(buffer, cancellationToken);
            if (result.MessageType == WebSocketMessageType.Close) return null;
            stream.Write(buffer, 0, result.Count);
            if (result.EndOfMessage) break;
        }

        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private static async Task CloseSilentlyAsync(ClientWebSocket ws, CancellationToken cancellationToken)
    {
        try
        {
            if (ws.State == WebSocketState.Open)
            {
                await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "config_changed", cancellationToken);
            }
        }
        catch
        {
            // Ignora fechamento ja concluido.
        }
    }

    private static string GetAgentKey(AgentConfig config, string kind)
    {
        return kind == "whatsapp" ? config.WhatsAppAgentKey : config.PrintAgentKey;
    }

    private static Uri BuildRealtimeUri(AgentConfig config, string kind)
    {
        var serverUrl = string.IsNullOrWhiteSpace(config.ServerUrl) ? "https://faceburg.vercel.app/" : config.ServerUrl.Trim();
        if (!Uri.TryCreate(serverUrl, UriKind.Absolute, out var serverUri))
        {
            serverUri = new Uri("https://faceburg.vercel.app/");
        }

        var scheme = serverUri.Scheme.Equals("https", StringComparison.OrdinalIgnoreCase) ? "wss" : "ws";
        var builder = new UriBuilder(serverUri)
        {
            Scheme = scheme,
            Port = config.RealtimeGatewayPort,
            Path = string.IsNullOrWhiteSpace(config.RealtimeGatewayPath) ? "/ws/agents" : config.RealtimeGatewayPath,
            Query = $"kind={Uri.EscapeDataString(kind)}&protocol=direct-v1",
        };
        return builder.Uri;
    }

    private static string ConnectionFingerprint(AgentConfig config, string kind)
    {
        return string.Join('|',
            config.ServerUrl,
            config.RealtimeGatewayPort,
            config.RealtimeGatewayPath,
            kind,
            GetAgentKey(config, kind),
            kind == "whatsapp" ? config.WhatsAppEnabled.ToString() : "print");
    }

    private static string GetString(JsonElement element, string property)
    {
        if (!element.TryGetProperty(property, out var value))
        {
            return "";
        }

        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString() ?? "",
            JsonValueKind.Number => value.GetRawText(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => "",
        };
    }

    private static int? GetInt(JsonElement element, string property)
    {
        if (!element.TryGetProperty(property, out var value))
        {
            return null;
        }

        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var numeric))
        {
            return numeric;
        }

        if (value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), out var textNumeric))
        {
            return textNumeric;
        }

        return null;
    }

    private static string FirstNonEmpty(params string[] values)
    {
        return values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value)) ?? "";
    }

    private static string MapWhatsAppStatus(string status)
    {
        return status.Trim().ToLowerInvariant() switch
        {
            "ready" => "ready",
            "qr" => "qr",
            "starting" => "connecting",
            "connecting" => "connecting",
            "auth_failure" => "auth_failure",
            _ => "disconnected",
        };
    }

    private static string AppVersion()
    {
        return typeof(DirectRealtimeService).Assembly.GetName().Version?.ToString() ?? "dev";
    }
}

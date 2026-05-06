using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;
using Faceburg.LocalAgent.Config;
using Faceburg.LocalAgent.Models;

namespace Faceburg.LocalAgent.Services;

public sealed class WhatsAppSidecarService(
    ConfigStore configStore,
    ILogger<WhatsAppSidecarService> logger
) : BackgroundService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement>> _pending = new();
    private readonly object _sync = new();
    private Process? _process;
    private StreamWriter? _stdin;
    private WhatsAppStatusDto _status = new("stopped", "", "", "", DateTimeOffset.UtcNow);

    public WhatsAppStatusDto CurrentStatus => _status;

    public async Task<WhatsAppResult> SendAsync(WhatsAppSendRequest request, CancellationToken cancellationToken)
    {
        var jobId = string.IsNullOrWhiteSpace(request.JobId)
            ? Guid.NewGuid().ToString("N")
            : request.JobId.Trim();
        var targetPhone = NormalizeTargetPhone(request.TargetPhone);
        var payloadText = (request.PayloadText ?? "").Trim();

        if (string.IsNullOrWhiteSpace(targetPhone))
        {
            return new WhatsAppResult(false, jobId, "", "Numero invalido.");
        }
        if (string.IsNullOrWhiteSpace(payloadText))
        {
            return new WhatsAppResult(false, jobId, targetPhone, "Mensagem vazia.");
        }

        await EnsureStartedAsync(cancellationToken);
        var response = await SendCommandAsync(new
        {
            type = "send",
            targetPhone,
            payloadText,
            jobId,
        }, TimeSpan.FromSeconds(35), cancellationToken);

        var ok = response.TryGetProperty("ok", out var okElement) && okElement.GetBoolean();
        if (ok)
        {
            return new WhatsAppResult(true, jobId, targetPhone);
        }

        var error = response.TryGetProperty("error", out var errorElement)
            ? errorElement.GetString()
            : "Falha ao enviar WhatsApp.";
        return new WhatsAppResult(false, jobId, targetPhone, error);
    }

    public async Task RestartAsync(CancellationToken cancellationToken)
    {
        await StopSidecarAsync();
        await EnsureStartedAsync(cancellationToken);
    }

    public async Task StopSidecarAsync()
    {
        Process? process;
        lock (_sync)
        {
            process = _process;
            _process = null;
            _stdin = null;
        }

        foreach (var pending in _pending)
        {
            pending.Value.TrySetException(new InvalidOperationException("WhatsApp sidecar foi encerrado."));
        }
        _pending.Clear();

        if (process is null)
        {
            SetStatus("stopped", "", "", "");
            return;
        }

        try
        {
            if (!process.HasExited)
            {
                await SendCommandNoReplyAsync(new { type = "shutdown" });
                if (!process.WaitForExit(3000))
                {
                    process.Kill(entireProcessTree: true);
                }
            }
        }
        catch
        {
            try { process.Kill(entireProcessTree: true); } catch {}
        }
        finally
        {
            process.Dispose();
            SetStatus("stopped", "", "", "");
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var config = await configStore.LoadAsync(stoppingToken);
                if (config.WhatsAppEnabled)
                {
                    await EnsureStartedAsync(stoppingToken);
                }
                else
                {
                    await StopSidecarAsync();
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Falha no monitor do WhatsApp sidecar.");
                SetStatus("error", CurrentStatus.PhoneNumber, CurrentStatus.QrCode, ex.Message);
            }

            await Task.Delay(TimeSpan.FromSeconds(3), stoppingToken);
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        await StopSidecarAsync();
        await base.StopAsync(cancellationToken);
    }

    private async Task EnsureStartedAsync(CancellationToken cancellationToken)
    {
        lock (_sync)
        {
            if (_process is { HasExited: false }) return;
        }

        var config = await configStore.LoadAsync(cancellationToken);
        if (!config.WhatsAppEnabled)
        {
            throw new InvalidOperationException("WhatsApp desativado no agente local.");
        }

        var scriptPath = ResolveSidecarScriptPath();
        var workingDirectory = Path.GetDirectoryName(scriptPath)!;
        var authPath = GetWhatsAppAuthPath();

        var startInfo = new ProcessStartInfo
        {
            FileName = ResolveNodeExecutable(),
            Arguments = $"\"{scriptPath}\"",
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        startInfo.Environment["FACEBURG_WHATS_DATA"] = authPath;
        startInfo.Environment["FACEBURG_WHATS_HEADLESS"] = config.WhatsAppHeadless ? "1" : "0";
        startInfo.Environment["FACEBURG_WHATS_CHROME_PATH"] = config.WhatsAppChromePath ?? "";
        startInfo.Environment["FACEBURG_WHATS_CLIENT_ID"] = string.IsNullOrWhiteSpace(config.TenantSlug)
            ? "faceburg"
            : config.TenantSlug.Trim().ToLowerInvariant();

        var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        process.Exited += (_, _) =>
        {
            lock (_sync)
            {
                if (ReferenceEquals(_process, process))
                {
                    _process = null;
                    _stdin = null;
                }
            }
            SetStatus("stopped", "", "", "WhatsApp sidecar encerrou.");
        };

        if (!process.Start())
        {
            throw new InvalidOperationException("Nao foi possivel iniciar o WhatsApp sidecar.");
        }

        lock (_sync)
        {
            _process = process;
            _stdin = process.StandardInput;
        }

        SetStatus("starting", "", "", "");
        _ = Task.Run(() => ReadStdoutAsync(process), cancellationToken);
        _ = Task.Run(() => ReadStderrAsync(process), cancellationToken);
    }

    private async Task<JsonElement> SendCommandAsync(object command, TimeSpan timeout, CancellationToken cancellationToken)
    {
        var id = Guid.NewGuid().ToString("N");
        var envelope = JsonSerializer.Serialize(ToEnvelope(command, id), JsonOptions);
        var tcs = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending[id] = tcs;

        StreamWriter? writer;
        lock (_sync)
        {
            writer = _stdin;
        }
        if (writer is null)
        {
            _pending.TryRemove(id, out var _);
            throw new InvalidOperationException("WhatsApp sidecar nao esta pronto.");
        }

        await writer.WriteLineAsync(envelope.AsMemory(), cancellationToken);
        await writer.FlushAsync(cancellationToken);

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(timeout);
        using var registration = timeoutCts.Token.Register(() =>
        {
            if (_pending.TryRemove(id, out var pending))
            {
                pending.TrySetException(new TimeoutException("Tempo esgotado aguardando WhatsApp sidecar."));
            }
        });

        return await tcs.Task;
    }

    private async Task SendCommandNoReplyAsync(object command)
    {
        StreamWriter? writer;
        lock (_sync)
        {
            writer = _stdin;
        }
        if (writer is null) return;

        await writer.WriteLineAsync(JsonSerializer.Serialize(command, JsonOptions));
        await writer.FlushAsync();
    }

    private async Task ReadStdoutAsync(Process process)
    {
        while (!process.HasExited)
        {
            var line = await process.StandardOutput.ReadLineAsync();
            if (line is null) break;
            if (string.IsNullOrWhiteSpace(line)) continue;
            HandleSidecarMessage(line);
        }
    }

    private async Task ReadStderrAsync(Process process)
    {
        while (!process.HasExited)
        {
            var line = await process.StandardError.ReadLineAsync();
            if (line is null) break;
            if (!string.IsNullOrWhiteSpace(line))
            {
                logger.LogInformation("WhatsApp sidecar: {Line}", line);
            }
        }
    }

    private void HandleSidecarMessage(string line)
    {
        try
        {
            using var document = JsonDocument.Parse(line);
            var root = document.RootElement;
            var type = root.TryGetProperty("type", out var typeElement) ? typeElement.GetString() : "";

            if (type == "response")
            {
                var id = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : "";
                if (!string.IsNullOrWhiteSpace(id) && _pending.TryRemove(id, out var pending))
                {
                    pending.TrySetResult(root.Clone());
                }
                return;
            }

            if (type == "state")
            {
                SetStatus(
                    GetString(root, "status", CurrentStatus.Status),
                    GetString(root, "phoneNumber", CurrentStatus.PhoneNumber),
                    GetString(root, "qrCode", CurrentStatus.QrCode),
                    GetString(root, "lastError", CurrentStatus.LastError)
                );
            }
        }
        catch (Exception ex)
        {
            logger.LogDebug(ex, "Mensagem invalida do WhatsApp sidecar: {Line}", line);
        }
    }

    private void SetStatus(string status, string phoneNumber, string qrCode, string lastError)
    {
        _status = new WhatsAppStatusDto(status, phoneNumber, qrCode, lastError, DateTimeOffset.UtcNow);
    }

    private static Dictionary<string, object?> ToEnvelope(object command, string id)
    {
        var json = JsonSerializer.Serialize(command, JsonOptions);
        var map = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonOptions) ?? [];
        map["id"] = id;
        return map;
    }

    private static string GetString(JsonElement element, string property, string fallback)
    {
        return element.TryGetProperty(property, out var value)
            ? value.GetString() ?? fallback
            : fallback;
    }

    private static string NormalizeTargetPhone(string? target)
    {
        var digits = new string((target ?? "").Where(char.IsDigit).ToArray());
        if (string.IsNullOrWhiteSpace(digits)) return "";
        return digits.StartsWith("55", StringComparison.Ordinal) ? digits : $"55{digits}";
    }

    private static string ResolveNodeExecutable()
    {
        return "node";
    }

    private static string ResolveSidecarScriptPath()
    {
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "whatsapp-sidecar", "index.js"),
            Path.Combine(Directory.GetCurrentDirectory(), "whatsapp-sidecar", "index.js"),
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "whatsapp-sidecar", "index.js")),
            Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "faceburg-agent-dotnet", "whatsapp-sidecar", "index.js")),
        };

        var script = candidates.FirstOrDefault(File.Exists);
        if (script is not null) return script;

        throw new FileNotFoundException("whatsapp-sidecar/index.js nao encontrado.", candidates[0]);
    }

    private static string GetWhatsAppAuthPath()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var basePath = string.IsNullOrWhiteSpace(localAppData)
            ? Path.Combine(Path.GetTempPath(), "Faceburg", "LocalAgent", "whatsapp-auth")
            : Path.Combine(localAppData, "Faceburg", "LocalAgent", "whatsapp-auth");
        Directory.CreateDirectory(basePath);
        return basePath;
    }
}

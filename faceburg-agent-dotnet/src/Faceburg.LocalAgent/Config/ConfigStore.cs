using System.Text.Json;
using System.Globalization;

namespace Faceburg.LocalAgent.Config;

public sealed class ConfigStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
    };

    private readonly string _filePath;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private AgentConfig? _cache;

    public ConfigStore()
    {
        var programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        var baseDir = string.IsNullOrWhiteSpace(programData)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Faceburg", "LocalAgent")
            : Path.Combine(programData, "Faceburg", "LocalAgent");
        Directory.CreateDirectory(baseDir);
        _filePath = Path.Combine(baseDir, "agent-config.json");
    }

    public string FilePath => _filePath;

    public async Task<AgentConfig> LoadAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (_cache is not null) return Clone(_cache);

            if (!File.Exists(_filePath))
            {
                _cache = new AgentConfig();
                await SaveInternalAsync(_cache, cancellationToken);
                return Clone(_cache);
            }

            await using var stream = File.OpenRead(_filePath);
            _cache = await JsonSerializer.DeserializeAsync<AgentConfig>(stream, JsonOptions, cancellationToken)
                ?? new AgentConfig();
            NormalizeConfig(_cache);
            if (string.IsNullOrWhiteSpace(_cache.LocalToken))
            {
                _cache.LocalToken = Guid.NewGuid().ToString("N");
                await SaveInternalAsync(_cache, cancellationToken);
            }
            return Clone(_cache);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<AgentConfig> SaveAsync(AgentConfig config, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            NormalizeConfig(config);
            config.UpdatedAt = DateTimeOffset.UtcNow;
            if (string.IsNullOrWhiteSpace(config.LocalToken))
            {
                config.LocalToken = Guid.NewGuid().ToString("N");
            }
            _cache = Clone(config);
            await SaveInternalAsync(_cache, cancellationToken);
            return Clone(_cache);
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task SaveInternalAsync(AgentConfig config, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_filePath)!);
        await using var stream = File.Create(_filePath);
        await JsonSerializer.SerializeAsync(stream, config, JsonOptions, cancellationToken);
    }

    private static AgentConfig Clone(AgentConfig config)
    {
        var json = JsonSerializer.Serialize(config, JsonOptions);
        return JsonSerializer.Deserialize<AgentConfig>(json, JsonOptions) ?? new AgentConfig();
    }

    private static bool NormalizeConfig(AgentConfig config)
    {
        var changed = false;
        var normalizedPrintTextSize = NormalizePrintTextSize(config.PrintTextSize);
        if (!string.Equals(config.PrintTextSize, normalizedPrintTextSize, StringComparison.Ordinal))
        {
            config.PrintTextSize = normalizedPrintTextSize;
            changed = true;
        }

        var normalizedColumns = NormalizeColumns(config.Columns);
        if (config.Columns != normalizedColumns)
        {
            config.Columns = normalizedColumns;
            changed = true;
        }

        var normalizedPrintAgentKey = (config.PrintAgentKey ?? "").Trim();
        if (!string.Equals(config.PrintAgentKey, normalizedPrintAgentKey, StringComparison.Ordinal))
        {
            config.PrintAgentKey = normalizedPrintAgentKey;
            changed = true;
        }

        var normalizedWhatsAppAgentKey = (config.WhatsAppAgentKey ?? "").Trim();
        if (!string.Equals(config.WhatsAppAgentKey, normalizedWhatsAppAgentKey, StringComparison.Ordinal))
        {
            config.WhatsAppAgentKey = normalizedWhatsAppAgentKey;
            changed = true;
        }

        var normalizedGatewayPort = Math.Clamp(config.RealtimeGatewayPort, 1, 65535);
        if (config.RealtimeGatewayPort != normalizedGatewayPort)
        {
            config.RealtimeGatewayPort = normalizedGatewayPort;
            changed = true;
        }

        var normalizedGatewayPath = NormalizeGatewayPath(config.RealtimeGatewayPath);
        if (!string.Equals(config.RealtimeGatewayPath, normalizedGatewayPath, StringComparison.Ordinal))
        {
            config.RealtimeGatewayPath = normalizedGatewayPath;
            changed = true;
        }

        var normalizedPrintEngine = NormalizePrintEngine(config.PrintEngine);
        if (!string.Equals(config.PrintEngine, normalizedPrintEngine, StringComparison.Ordinal))
        {
            config.PrintEngine = normalizedPrintEngine;
            changed = true;
        }

        return changed;
    }

    private static int NormalizeColumns(int value)
    {
        return value switch
        {
            48 => 48,
            80 => 48,
            40 => 48,
            58 => 32,
            _ => 32,
        };
    }

    private static string NormalizePrintTextSize(string? value)
    {
        var clean = (value ?? "").Trim().ToLowerInvariant().Replace(',', '.');
        var legacySize = clean switch
        {
            "normal" => 10,
            "large" => 12,
            "extra_large" => 14,
            _ => 0,
        };
        if (legacySize > 0) return legacySize.ToString(CultureInfo.InvariantCulture);

        if (decimal.TryParse(clean, NumberStyles.Number, CultureInfo.InvariantCulture, out var size))
        {
            var clamped = Math.Clamp(size, 8m, 24m);
            var rounded = Math.Round(clamped * 4m, MidpointRounding.AwayFromZero) / 4m;
            return rounded.ToString("0.##", CultureInfo.InvariantCulture);
        }

        return "12.5";
    }

    private static string NormalizeGatewayPath(string? value)
    {
        var clean = (value ?? "").Trim();
        if (string.IsNullOrWhiteSpace(clean)) return "/ws/agents";
        return clean.StartsWith('/') ? clean : $"/{clean}";
    }

    private static string NormalizePrintEngine(string? value)
    {
        return (value ?? "").Trim().ToLowerInvariant() switch
        {
            "acbr" => "acbr-posprinter",
            "acbr-posprinter" => "acbr-posprinter",
            "raw" => "raw-escpos",
            "raw-escpos" => "raw-escpos",
            "windows" => "windows-driver-visual",
            "windows-driver" => "windows-driver-visual",
            "windows-driver-font" => "windows-driver-visual",
            "windows-driver-visual" => "windows-driver-visual",
            _ => "windows-driver-visual",
        };
    }
}

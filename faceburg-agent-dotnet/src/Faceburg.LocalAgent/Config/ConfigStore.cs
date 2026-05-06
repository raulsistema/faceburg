using System.Text.Json;

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
}

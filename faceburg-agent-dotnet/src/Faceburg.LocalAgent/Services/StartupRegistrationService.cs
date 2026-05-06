using Faceburg.LocalAgent.Config;
using Microsoft.Win32;

namespace Faceburg.LocalAgent.Services;

public sealed class StartupRegistrationService(ILogger<StartupRegistrationService> logger)
{
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "Faceburg Local Agent";

    public bool IsRegistered()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: false);
            return !string.IsNullOrWhiteSpace(key?.GetValue(ValueName)?.ToString());
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Nao foi possivel consultar inicializacao com Windows.");
            return false;
        }
    }

    public Task ApplyAsync(AgentConfig config, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (config.StartWithWindows)
        {
            Register();
        }
        else
        {
            Unregister();
        }

        return Task.CompletedTask;
    }

    private void Register()
    {
        var executable = ResolveExecutablePath();
        if (string.IsNullOrWhiteSpace(executable) || !File.Exists(executable))
        {
            logger.LogWarning("Nao foi possivel registrar inicializacao: executavel nao encontrado.");
            return;
        }

        try
        {
            using var key = Registry.CurrentUser.CreateSubKey(RunKeyPath, writable: true);
            key?.SetValue(ValueName, $"\"{executable}\"", RegistryValueKind.String);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Nao foi possivel registrar inicializacao com Windows.");
        }
    }

    private void Unregister()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: true);
            key?.DeleteValue(ValueName, throwOnMissingValue: false);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Nao foi possivel remover inicializacao com Windows.");
        }
    }

    private static string ResolveExecutablePath()
    {
        var processPath = Environment.ProcessPath;
        if (!string.IsNullOrWhiteSpace(processPath) && Path.GetFileName(processPath).Equals("Faceburg.LocalAgent.exe", StringComparison.OrdinalIgnoreCase))
        {
            return processPath;
        }

        var exePath = Path.Combine(AppContext.BaseDirectory, "Faceburg.LocalAgent.exe");
        return File.Exists(exePath) ? exePath : "";
    }
}

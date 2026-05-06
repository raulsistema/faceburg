using System.Diagnostics;
using System.IO.Compression;
using System.Net.Http;
using System.Reflection;
using System.Security.Principal;
using Microsoft.Win32;

namespace RbsAgent.Installer;

internal static class Program
{
    private const string InstallDir = @"C:\rbsAgent";

    [STAThread]
    private static int Main(string[] args)
    {
        if (!IsAdministrator())
        {
            return RelaunchElevated(args);
        }

        if (args.Any(arg => arg.Equals("--silent", StringComparison.OrdinalIgnoreCase)))
        {
            return InstallerCore.Install(InstallDir, (_, _) => { });
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        using var form = new InstallerForm();
        Application.Run(form);
        return form.ExitCode;
    }

    private static bool IsAdministrator()
    {
        using var identity = WindowsIdentity.GetCurrent();
        return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
    }

    private static int RelaunchElevated(string[] args)
    {
        try
        {
            var process = Process.Start(new ProcessStartInfo
            {
                FileName = Environment.ProcessPath ?? Application.ExecutablePath,
                Arguments = string.Join(" ", args.Select(QuoteArgument)),
                UseShellExecute = true,
                Verb = "runas",
            });
            process?.WaitForExit();
            return process?.ExitCode ?? 0;
        }
        catch
        {
            MessageBox.Show("Nao foi possivel abrir o instalador como administrador.", "rbsAgent", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 740;
        }
    }

    private static string QuoteArgument(string value)
    {
        return value.Contains(' ') ? $"\"{value.Replace("\"", "\\\"")}\"" : value;
    }
}

internal sealed class InstallerForm : Form
{
    private readonly Label _title = new();
    private readonly Label _status = new();
    private readonly ProgressBar _progress = new();
    private readonly Button _close = new();
    private readonly Button _openConfig = new();

    public int ExitCode { get; private set; } = 1;

    public InstallerForm()
    {
        Text = "Instalador rbsAgent";
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ClientSize = new Size(560, 250);
        BackColor = Color.White;
        Icon = LoadWindowIcon();

        _title.Text = "Instalando rbsAgent";
        _title.Font = new Font("Segoe UI", 17, FontStyle.Bold);
        _title.ForeColor = Color.FromArgb(15, 23, 42);
        _title.SetBounds(28, 26, 500, 36);

        var subtitle = new Label
        {
            Text = "Agente local de impressao e WhatsApp para o Faceburg.",
            Font = new Font("Segoe UI", 9),
            ForeColor = Color.FromArgb(71, 85, 105),
        };
        subtitle.SetBounds(30, 64, 500, 24);

        _status.Text = "Preparando instalacao...";
        _status.Font = new Font("Segoe UI", 9, FontStyle.Bold);
        _status.ForeColor = Color.FromArgb(51, 65, 85);
        _status.SetBounds(30, 104, 500, 24);

        _progress.SetBounds(30, 134, 500, 20);
        _progress.Minimum = 0;
        _progress.Maximum = 100;
        _progress.Value = 2;

        _openConfig.Text = "Abrir configuracoes";
        _openConfig.Enabled = false;
        _openConfig.SetBounds(276, 188, 145, 34);
        _openConfig.Click += (_, _) => Process.Start(new ProcessStartInfo("http://127.0.0.1:9787/") { UseShellExecute = true });

        _close.Text = "Fechar";
        _close.Enabled = false;
        _close.SetBounds(430, 188, 100, 34);
        _close.Click += (_, _) => Close();

        Controls.AddRange([_title, subtitle, _status, _progress, _openConfig, _close]);
        Shown += async (_, _) => await RunInstallAsync();
    }

    private async Task RunInstallAsync()
    {
        try
        {
            ExitCode = await Task.Run(() => InstallerCore.Install(@"C:\rbsAgent", Report));
            Report(100, "Instalacao concluida. O rbsAgent ja esta em segundo plano.");
            _openConfig.Enabled = true;
        }
        catch (Exception ex)
        {
            ExitCode = 1;
            Report(100, $"Falha: {ex.Message}");
            MessageBox.Show(ex.Message, "Erro ao instalar rbsAgent", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            _close.Enabled = true;
        }
    }

    private void Report(int percent, string message)
    {
        if (InvokeRequired)
        {
            BeginInvoke(() => Report(percent, message));
            return;
        }

        _progress.Value = Math.Max(_progress.Minimum, Math.Min(_progress.Maximum, percent));
        _status.Text = message;
    }

    private static Icon? LoadWindowIcon()
    {
        var iconPath = Path.Combine(AppContext.BaseDirectory, "logorbs.ico");
        if (File.Exists(iconPath)) return new Icon(iconPath);

        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("RbsAgent.Installer.Assets.logorbs.ico");
        return stream is null ? null : new Icon(stream);
    }
}

internal static class InstallerCore
{
    private const string AppName = "rbsAgent";
    private const string AgentExe = "Faceburg.LocalAgent.exe";
    private const string ConfigUrl = "http://127.0.0.1:9787/";

    public static int Install(string installDir, Action<int, string> progress)
    {
        progress(5, "Fechando agente antigo...");
        StopOldProcesses(installDir);

        progress(15, "Preparando pasta C:\\rbsAgent...");
        PrepareInstallDirectory(installDir);

        progress(30, "Extraindo arquivos do agente...");
        ExtractPayload(installDir);

        progress(66, "Criando atalhos...");
        CreateConfigShortcut(installDir);

        progress(76, "Registrando inicio com Windows...");
        RegisterStartup(installDir);

        progress(84, "Registrando informacoes do instalador...");
        RegisterInstallInfo(installDir);

        progress(90, "Iniciando rbsAgent...");
        StartAgent(installDir);

        progress(94, "Aguardando agente responder...");
        WaitForHealth();
        return 0;
    }

    private static void StopOldProcesses(string installDir)
    {
        foreach (var process in Process.GetProcessesByName("Faceburg.LocalAgent"))
        {
            TryKill(process);
        }

        var escapedInstall = installDir.Replace("'", "''");
        var command = $$"""
$install = '{{escapedInstall}}'
Get-CimInstance Win32_Process -Filter "name='node.exe' OR name='chrome.exe' OR name='msedge.exe'" |
  Where-Object {
    $_.CommandLine -and (
      $_.CommandLine.Contains($install) -or
      $_.CommandLine.Contains('Faceburg\LocalAgent\whatsapp-auth') -or
      $_.CommandLine.Contains('faceburg-agent-dotnet\dist\whatsapp-sidecar')
    )
  } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
""";
        RunPowerShell(command);
        Thread.Sleep(800);
    }

    private static void PrepareInstallDirectory(string installDir)
    {
        Directory.CreateDirectory(installDir);
        foreach (var entry in Directory.EnumerateFileSystemEntries(installDir))
        {
            var name = Path.GetFileName(entry);
            if (name.Equals("agent-config.json", StringComparison.OrdinalIgnoreCase)) continue;
            if (Directory.Exists(entry)) Directory.Delete(entry, recursive: true);
            else File.Delete(entry);
        }
    }

    private static void ExtractPayload(string installDir)
    {
        using var payload = OpenPayload();
        using var archive = new ZipArchive(payload, ZipArchiveMode.Read);
        foreach (var entry in archive.Entries)
        {
            var targetPath = Path.GetFullPath(Path.Combine(installDir, entry.FullName));
            if (!targetPath.StartsWith(Path.GetFullPath(installDir), StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("Pacote contem caminho invalido.");
            }

            if (string.IsNullOrEmpty(entry.Name))
            {
                Directory.CreateDirectory(targetPath);
                continue;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(targetPath)!);
            entry.ExtractToFile(targetPath, overwrite: true);
        }
    }

    private static Stream OpenPayload()
    {
        var assembly = Assembly.GetExecutingAssembly();
        var resourceName = assembly.GetManifestResourceNames()
            .FirstOrDefault(name => name.EndsWith("rbsAgent-payload.zip", StringComparison.OrdinalIgnoreCase));
        if (resourceName is null)
        {
            throw new FileNotFoundException("Payload do rbsAgent nao foi encontrado dentro do instalador.");
        }

        return assembly.GetManifestResourceStream(resourceName)
            ?? throw new FileNotFoundException("Nao foi possivel abrir o payload do instalador.");
    }

    private static void CreateConfigShortcut(string installDir)
    {
        var iconPath = Path.Combine(installDir, "logorbs.ico");
        var content = string.Join("\r\n", [
            "[InternetShortcut]",
            $"URL={ConfigUrl}",
            $"IconFile={iconPath}",
            "IconIndex=0",
            "",
        ]);

        var desktop = Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory);
        if (string.IsNullOrWhiteSpace(desktop))
        {
            desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        }
        if (!string.IsNullOrWhiteSpace(desktop))
        {
            File.WriteAllText(Path.Combine(desktop, "Configurar rbsAgent.url"), content);
        }

        var programs = Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms);
        if (!string.IsNullOrWhiteSpace(programs))
        {
            var folder = Path.Combine(programs, "rbsAgent");
            Directory.CreateDirectory(folder);
            File.WriteAllText(Path.Combine(folder, "Configurar rbsAgent.url"), content);
        }
    }

    private static void RegisterStartup(string installDir)
    {
        var command = $"\"{Path.Combine(installDir, AgentExe)}\"";
        SetRunValue(Registry.LocalMachine, command);
        SetRunValue(Registry.CurrentUser, command);
    }

    private static void SetRunValue(RegistryKey root, string command)
    {
        try
        {
            using var key = root.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", writable: true);
            key?.SetValue(AppName, command, RegistryValueKind.String);
        }
        catch
        {
            // HKCU still covers normal installs if HKLM is blocked.
        }
    }

    private static void RegisterInstallInfo(string installDir)
    {
        try
        {
            using var key = Registry.LocalMachine.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\rbsAgent", writable: true);
            key?.SetValue("DisplayName", "rbsAgent");
            key?.SetValue("DisplayVersion", "1.0.0");
            key?.SetValue("Publisher", "RBS System");
            key?.SetValue("InstallLocation", installDir);
            key?.SetValue("DisplayIcon", Path.Combine(installDir, "logorbs.ico"));
            key?.SetValue("NoModify", 1, RegistryValueKind.DWord);
            key?.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        }
        catch
        {
            // This is informational only.
        }
    }

    private static void StartAgent(string installDir)
    {
        var exe = Path.Combine(installDir, AgentExe);
        if (!File.Exists(exe)) throw new FileNotFoundException("Faceburg.LocalAgent.exe nao encontrado apos a instalacao.", exe);

        Process.Start(new ProcessStartInfo
        {
            FileName = exe,
            WorkingDirectory = installDir,
            UseShellExecute = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        });
    }

    private static void WaitForHealth()
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        var deadline = DateTimeOffset.UtcNow.AddSeconds(25);
        while (DateTimeOffset.UtcNow < deadline)
        {
            try
            {
                using var response = client.GetAsync("http://127.0.0.1:9787/api/health").GetAwaiter().GetResult();
                if (response.IsSuccessStatusCode) return;
            }
            catch
            {
                Thread.Sleep(700);
            }
        }
    }

    private static void TryKill(Process process)
    {
        try
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
        }
        catch
        {
            // Best effort.
        }
        finally
        {
            process.Dispose();
        }
    }

    private static void RunPowerShell(string command)
    {
        try
        {
            using var process = Process.Start(new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = $"-NoProfile -ExecutionPolicy Bypass -Command {Quote(command)}",
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            });
            process?.WaitForExit(7000);
        }
        catch
        {
            // Best effort.
        }
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }
}

using System.Text;
using Faceburg.LocalAgent.Config;
using Faceburg.LocalAgent.Models;

namespace Faceburg.LocalAgent.Printing;

public sealed class EscPosTextBuilder
{
    private static readonly Dictionary<string, byte> CodePageCommands = new(StringComparer.OrdinalIgnoreCase)
    {
        ["CP437"] = 0,
        ["CP850"] = 2,
        ["CP860"] = 3,
        ["CP858"] = 19,
    };

    public byte[] Build(PrintJobRequest request, AgentConfig config)
    {
        if (!string.IsNullOrWhiteSpace(request.RawEscPosBase64))
        {
            return Convert.FromBase64String(request.RawEscPosBase64);
        }

        var text = NormalizeText(request.PayloadText);
        if (string.IsNullOrWhiteSpace(text))
        {
            throw new InvalidOperationException("Conteudo de impressao vazio.");
        }

        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        var codePage = FirstNonEmpty(request.CodePage, config.CodePage, "CP860");
        var encoding = ResolveEncoding(codePage);
        var bytes = new List<byte>(text.Length + 16);

        Initialize(bytes);
        SelectCodePage(bytes, codePage);
        bytes.AddRange(encoding.GetBytes(text));
        bytes.Add(0x0A);
        Feed(bytes, 3);

        if (request.PulseDrawer ?? config.PulseDrawer)
        {
            PulseDrawer(bytes);
        }

        if (request.CutPaper ?? config.CutPaper)
        {
            Cut(bytes);
        }

        return bytes.ToArray();
    }

    public byte[] BuildTest(AgentConfig config)
    {
        var lines = new[]
        {
            "FACEBURG LOCAL AGENT",
            "Teste RAW ESC/POS",
            new string('-', Math.Clamp(config.Columns, 32, 48)),
            $"Computador: {Environment.MachineName}",
            $"Data: {DateTime.Now:dd/MM/yyyy HH:mm:ss}",
            "",
            "Se este cupom saiu rapido,",
            "a impressao local esta pronta.",
            "",
            "Faceburg"
        };

        return Build(new PrintJobRequest
        {
            JobId = Guid.NewGuid().ToString("N"),
            PayloadText = string.Join('\n', lines),
            CutPaper = config.CutPaper,
            PulseDrawer = false,
            CodePage = config.CodePage,
            Columns = config.Columns,
        }, config);
    }

    private static string NormalizeText(string? value)
    {
        return string
            .Join('\n', (value ?? "")
                .Replace("\r\n", "\n")
                .Replace('\r', '\n')
                .Replace('\u00a0', ' ')
                .Split('\n')
                .Select(line => line.TrimEnd()))
            .TrimEnd();
    }

    private static string FirstNonEmpty(params string?[] values)
    {
        foreach (var value in values)
        {
            if (!string.IsNullOrWhiteSpace(value)) return value.Trim();
        }
        return "";
    }

    private static Encoding ResolveEncoding(string codePage)
    {
        return codePage.ToUpperInvariant() switch
        {
            "CP437" => Encoding.GetEncoding(437),
            "CP850" => Encoding.GetEncoding(850),
            "CP858" => Encoding.GetEncoding(858),
            "CP860" => Encoding.GetEncoding(860),
            _ => Encoding.GetEncoding(860),
        };
    }

    private static void Initialize(List<byte> bytes) => bytes.AddRange([0x1B, 0x40]);

    private static void SelectCodePage(List<byte> bytes, string codePage)
    {
        if (CodePageCommands.TryGetValue(codePage, out var command))
        {
            bytes.AddRange([0x1B, 0x74, command]);
        }
    }

    private static void Feed(List<byte> bytes, byte lines) => bytes.AddRange([0x1B, 0x64, lines]);

    private static void Cut(List<byte> bytes) => bytes.AddRange([0x1D, 0x56, 0x42, 0x00]);

    private static void PulseDrawer(List<byte> bytes) => bytes.AddRange([0x1B, 0x70, 0x00, 0x19, 0xFA]);
}

using System.Text;
using System.Globalization;
using Faceburg.LocalAgent.Config;
using Faceburg.LocalAgent.Models;

namespace Faceburg.LocalAgent.Printing;

public sealed class EscPosTextBuilder
{
    private const int MinPrintTextSize = 8;
    private const int MaxPrintTextSize = 24;
    private const decimal DefaultPrintTextSize = 12.5m;

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

        var requestedPrintTextSize = FirstNonEmpty(request.PrintTextSize, config.PrintTextSize, "12.5");
        var text = BuildPlainText(request, config);
        if (string.IsNullOrWhiteSpace(text))
        {
            throw new InvalidOperationException("Conteudo de impressao vazio.");
        }

        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        var codePage = FirstNonEmpty(request.CodePage, config.CodePage, "CP860");
        var textSize = GetPrintTextSizeProfile(requestedPrintTextSize);
        var encoding = ResolveEncoding(codePage);
        var bytes = new List<byte>(text.Length + 16);

        Initialize(bytes);
        SelectCodePage(bytes, codePage);
        WriteStyledText(bytes, encoding, text, textSize);
        SelectPrintMode(bytes, 0, false);
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

    public string BuildPlainText(PrintJobRequest request, AgentConfig config)
    {
        var columns = RawColumns(request.Columns ?? config.Columns);
        return NormalizeText(request.PayloadText, columns);
    }

    private static string NormalizeText(string? value, int columns)
    {
        return string
            .Join('\n', (value ?? "")
                .Replace("\r\n", "\n")
                .Replace('\r', '\n')
                .Replace('\u00a0', ' ')
                .Split('\n')
                .Select(line => line.TrimEnd())
                .SelectMany(line => WrapPreparedLine(line, columns)))
            .TrimEnd();
    }

    private static IEnumerable<string> WrapPreparedLine(string line, int columns)
    {
        if (columns <= 0 || line.Length <= columns || string.IsNullOrWhiteSpace(line))
        {
            yield return line;
            yield break;
        }

        var words = line.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var current = "";

        foreach (var word in words)
        {
            var next = string.IsNullOrEmpty(current) ? word : $"{current} {word}";
            if (next.Length <= columns)
            {
                current = next;
                continue;
            }

            if (!string.IsNullOrEmpty(current))
            {
                yield return current;
                current = "";
            }

            if (word.Length <= columns)
            {
                current = word;
                continue;
            }

            var remaining = word;
            while (remaining.Length > columns)
            {
                yield return remaining[..columns];
                remaining = remaining[columns..];
            }
            current = remaining;
        }

        if (!string.IsNullOrEmpty(current))
        {
            yield return current;
        }
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

    public string BuildAcbrTaggedText(PrintJobRequest request, AgentConfig config)
    {
        var requestedPrintTextSize = FirstNonEmpty(request.PrintTextSize, config.PrintTextSize, "12.5");
        var columns = RawColumns(request.Columns ?? config.Columns);
        var text = NormalizeText(request.PayloadText, columns);
        if (string.IsNullOrWhiteSpace(text))
        {
            throw new InvalidOperationException("Conteudo de impressao vazio.");
        }

        var baseProfile = GetPrintTextSizeProfile(requestedPrintTextSize);
        var lines = text.Split('\n');
        var builder = new StringBuilder(text.Length + 128);
        builder.Append("<e><a><n>");

        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                builder.Append("</lf>");
                continue;
            }

            var style = GetLineStyle(line, baseProfile);
            var expandedHeight = style.Profile.HeightMultiplier > 1;
            var expandedWidth = style.Profile.WidthMultiplier > 1;
            if (expandedHeight) builder.Append("<a>");
            if (expandedWidth) builder.Append("<e>");
            builder.Append(EscapeAcbrText(line.TrimEnd()));
            if (expandedWidth) builder.Append("</e>");
            if (expandedHeight) builder.Append("</a>");
            builder.Append("</lf>");
        }

        builder.Append("</n></e></a>");
        if (request.CutPaper ?? config.CutPaper)
        {
            builder.Append("</corte_total>");
        }

        return builder.ToString();
    }

    private sealed record PrintTextSizeProfile(decimal Size, int Font, int WidthMultiplier, int HeightMultiplier, bool Bold);

    private static decimal NormalizePrintTextSizeNumber(string? value)
    {
        var clean = (value ?? "").Trim().ToLowerInvariant().Replace(',', '.');
        var legacySize = clean switch
        {
            "normal" => DefaultPrintTextSize,
            "large" => 12,
            "extra_large" => 14,
            _ => 0,
        };
        if (legacySize > 0) return legacySize;

        if (decimal.TryParse(clean, NumberStyles.Number, CultureInfo.InvariantCulture, out var size))
        {
            return Math.Clamp(size, MinPrintTextSize, MaxPrintTextSize);
        }

        return DefaultPrintTextSize;
    }

    private static PrintTextSizeProfile GetPrintTextSizeProfile(string? value)
    {
        var size = NormalizePrintTextSizeNumber(value);
        if (size < 18) return new PrintTextSizeProfile(size, 0, 1, 1, false);
        return new PrintTextSizeProfile(size, 0, 2, 2, true);
    }

    private static int EffectiveColumns(int columns, string printTextSize)
    {
        var size = NormalizePrintTextSizeNumber(printTextSize);
        var safeColumns = columns switch
        {
            48 => 42,
            80 => 42,
            40 => 42,
            58 => 30,
            32 => 30,
            _ => 30,
        };
        var widthMultiplier = size >= 18 ? 2 : 1;
        return Math.Max(16, safeColumns / widthMultiplier);
    }

    private static int RawColumns(int columns)
    {
        return columns switch
        {
            48 => 48,
            80 => 48,
            40 => 48,
            58 => 32,
            32 => 32,
            _ => 32,
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

    private static void WriteStyledText(List<byte> bytes, Encoding encoding, string text, PrintTextSizeProfile baseProfile)
    {
        foreach (var line in text.Split('\n'))
        {
            var style = GetLineStyle(line, baseProfile);
            SelectJustification(bytes, 0);
            SelectCharacterSize(bytes, style.Profile.WidthMultiplier, style.Profile.HeightMultiplier);
            SelectPrintMode(bytes, style.Profile.Font, style.Bold);
            bytes.AddRange(encoding.GetBytes(line));
            bytes.Add(0x0A);
        }
        SelectCharacterSize(bytes, 1, 1);
    }

    private static (PrintTextSizeProfile Profile, bool Bold) GetLineStyle(string line, PrintTextSizeProfile baseProfile)
    {
        var clean = line.Trim();
        var upper = clean.ToUpperInvariant();
        var isHeader =
            upper is "DELIVERY" or "RETIRADA" or "BALCAO" or "MESA" or "COZINHA" or "PEDIDO" ||
            upper.StartsWith("PEDIDO #", StringComparison.OrdinalIgnoreCase);
        var isTag =
            upper is "PEDIDO NOVO" or "VIA COZINHA" or "RECIBO" or "RECIBO DO CLIENTE" or "SAIU P/ ENTREGA" or "PEDIDO CONCLUIDO" or "PEDIDO CANCELADO" or "DOCUMENTO DE VENDA";
        var isTotal = upper.StartsWith("TOTAL:", StringComparison.OrdinalIgnoreCase) || upper.StartsWith("TOTAL ", StringComparison.OrdinalIgnoreCase);

        if (isHeader)
        {
            return (HeaderProfile(baseProfile), true);
        }
        if (isTotal)
        {
            return (baseProfile with { Bold = true }, true);
        }
        if (isTag)
        {
            return (baseProfile with { Bold = true }, true);
        }
        return (baseProfile, baseProfile.Bold);
    }

    private static PrintTextSizeProfile HeaderProfile(PrintTextSizeProfile baseProfile)
    {
        return baseProfile with
        {
            Font = 0,
            Bold = true,
        };
    }

    private static string EscapeAcbrText(string value)
    {
        return value
            .Replace('<', '(')
            .Replace('>', ')');
    }

    private static void SelectJustification(List<byte> bytes, byte mode)
    {
        bytes.AddRange([0x1B, 0x61, (byte)Math.Clamp((int)mode, 0, 2)]);
    }

    private static void SelectPrintMode(List<byte> bytes, int font, bool bold)
    {
        var mode = 0;
        if (Math.Clamp(font, 0, 1) == 1) mode |= 0x01;
        if (bold) mode |= 0x08;
        bytes.AddRange([0x1B, 0x21, (byte)mode]);
    }

    private static void SelectCharacterSize(List<byte> bytes, int widthMultiplier, int heightMultiplier)
    {
        var width = Math.Clamp(widthMultiplier, 1, 8) - 1;
        var height = Math.Clamp(heightMultiplier, 1, 8) - 1;
        bytes.AddRange([0x1D, 0x21, (byte)((width << 4) | height)]);
    }

    private static void Cut(List<byte> bytes) => bytes.AddRange([0x1D, 0x56, 0x42, 0x00]);

    private static void PulseDrawer(List<byte> bytes) => bytes.AddRange([0x1B, 0x70, 0x00, 0x19, 0xFA]);
}

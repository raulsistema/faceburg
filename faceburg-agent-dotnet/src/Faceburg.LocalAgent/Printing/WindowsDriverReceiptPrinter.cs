using System.Drawing;
using System.Drawing.Printing;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Faceburg.LocalAgent.Config;
using Faceburg.LocalAgent.Models;
using QRCoder;

namespace Faceburg.LocalAgent.Printing;

public sealed class WindowsDriverReceiptPrinter
{
    private const int DefaultColumns = 32;
    private const decimal DefaultFontSize = 12.5m;
    private static readonly Regex QrRegex = new(@"^\s*(?:<qrcode>|<qr>|\[qrcode\]|\[qr\]|QR:)\s*(.*?)\s*(?:</qrcode>|</qr>|\[/qrcode\]|\[/qr\])?\s*$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public PrintResult PrintText(string printerName, PrintJobRequest request, AgentConfig config, int copies, string jobId)
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("Impressao pelo driver do Windows esta disponivel apenas no Windows.");
        }

        var payload = NormalizePayload(request.PayloadText);
        if (string.IsNullOrWhiteSpace(payload))
        {
            throw new InvalidOperationException("Conteudo de impressao vazio.");
        }

        var columns = NormalizeColumns(request.Columns ?? config.Columns);
        var paperWidth = PaperWidthHundredths(columns);
        var margins = MarginsFor(columns);
        var fontSize = NormalizeFontSize(FirstNonEmpty(request.PrintTextSize, config.PrintTextSize));
        var blocks = ReceiptBlockParser.Parse(payload, columns);

        for (var copy = 0; copy < copies; copy++)
        {
            using var document = new PrintDocument
            {
                DocumentName = $"Faceburg {jobId}",
                PrinterSettings =
                {
                    PrinterName = printerName,
                    Copies = 1,
                },
                DefaultPageSettings =
                {
                    PaperSize = new PaperSize("Faceburg Receipt", paperWidth, 3200),
                    Margins = margins,
                },
            };

            document.PrintController = new StandardPrintController();
            document.PrintPage += (_, e) =>
            {
                if (e.Graphics is null) return;

                DrawReceipt(e.Graphics, e.MarginBounds, blocks, fontSize);
                e.HasMorePages = false;
            };
            document.Print();
        }

        return new PrintResult(
            true,
            jobId,
            printerName,
            Encoding.UTF8.GetByteCount(payload),
            copies,
            "windows-driver-visual"
        );
    }

    private static void DrawReceipt(Graphics graphics, Rectangle marginBounds, IReadOnlyList<ReceiptBlock> blocks, decimal fontSize)
    {
        graphics.PageUnit = GraphicsUnit.Display;
        graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

        using var regularFont = CreateFont(fontSize, FontStyle.Regular);
        using var boldFont = CreateFont(fontSize, FontStyle.Bold);
        using var headerFont = CreateFont(Math.Min(fontSize + 1.6m, fontSize * 1.18m), FontStyle.Bold);
        using var heroFont = CreateFont(Math.Min(fontSize + 4m, fontSize * 1.34m), FontStyle.Bold);
        using var brush = new SolidBrush(Color.Black);
        using var pen = new Pen(Color.Black, 1);

        var x = (float)marginBounds.Left;
        var y = (float)marginBounds.Top;
        var width = (float)marginBounds.Width;
        var lineGap = Math.Max(2f, (float)fontSize * 0.18f);

        foreach (var block in blocks)
        {
            switch (block)
            {
                case SpacerBlock spacer:
                    y += Math.Max(regularFont.GetHeight(graphics) * spacer.Lines * 0.72f, 3f);
                    break;

                case DividerBlock:
                    y += 2f;
                    graphics.DrawLine(pen, x, y, x + width, y);
                    y += 5f;
                    break;

                case QrCodeBlock qr:
                    y = DrawQrCode(graphics, qr.Value, x, y, width);
                    break;

                case TextBlock text:
                {
                    var isHero = text.Emphasis == TextEmphasis.Hero;
                    var font = text.Emphasis switch
                    {
                        TextEmphasis.Hero => heroFont,
                        TextEmphasis.Header => headerFont,
                        _ => text.Bold ? boldFont : regularFont,
                    };
                    using var format = FormatFor(text.Alignment);
                    if (isHero) y += 4f;
                    var measured = graphics.MeasureString(text.Value, font, (int)Math.Ceiling(width), format);
                    var height = Math.Max(measured.Height + lineGap, font.GetHeight(graphics) + lineGap);
                    graphics.DrawString(text.Value, font, brush, new RectangleF(x, y, width, height), format);
                    y += height;
                    if (isHero) y += 5f;
                    break;
                }
            }
        }
    }

    private static float DrawQrCode(Graphics graphics, string value, float x, float y, float width)
    {
        if (string.IsNullOrWhiteSpace(value)) return y;

        using var generator = new QRCodeGenerator();
        using var data = generator.CreateQrCode(value.Trim(), QRCodeGenerator.ECCLevel.Q);
        var png = new PngByteQRCode(data);
        var bytes = png.GetGraphic(8);
        using var stream = new MemoryStream(bytes);
        using var image = Image.FromStream(stream);
        var size = Math.Min(width * 0.64f, 190f);
        var left = x + ((width - size) / 2f);
        y += 4f;
        graphics.DrawImage(image, left, y, size, size);
        return y + size + 8f;
    }

    private static Font CreateFont(decimal size, FontStyle style)
    {
        var candidates = new[] { "Consolas", "Courier New", "Lucida Console" };
        foreach (var candidate in candidates)
        {
            try
            {
                return new Font(candidate, (float)size, style, GraphicsUnit.Point);
            }
            catch
            {
                // Tenta a proxima fonte monoespacada instalada.
            }
        }

        return new Font(FontFamily.GenericMonospace, (float)size, style, GraphicsUnit.Point);
    }

    private static StringFormat FormatFor(TextAlignment alignment)
    {
        return new StringFormat(StringFormatFlags.LineLimit)
        {
            Alignment = alignment switch
            {
                TextAlignment.Center => StringAlignment.Center,
                TextAlignment.Right => StringAlignment.Far,
                _ => StringAlignment.Near,
            },
            LineAlignment = StringAlignment.Near,
            Trimming = StringTrimming.Word,
        };
    }

    private static string NormalizePayload(string? value)
    {
        return (value ?? "")
            .Replace("\r\n", "\n")
            .Replace('\r', '\n')
            .Replace('\u00a0', ' ')
            .TrimEnd();
    }

    private static int NormalizeColumns(int columns)
    {
        return columns switch
        {
            48 => 48,
            80 => 48,
            40 => 48,
            58 => 32,
            32 => 32,
            _ => DefaultColumns,
        };
    }

    private static int PaperWidthHundredths(int columns)
    {
        return columns >= 48 ? 315 : 228;
    }

    private static Margins MarginsFor(int columns)
    {
        return columns >= 48 ? new Margins(10, 10, 4, 4) : new Margins(4, 4, 4, 4);
    }

    private static decimal NormalizeFontSize(string? value)
    {
        var clean = (value ?? "").Trim().ToLowerInvariant().Replace(',', '.');
        var legacy = clean switch
        {
            "normal" => 10m,
            "large" => 12m,
            "extra_large" => 14m,
            _ => 0m,
        };
        if (legacy > 0) return legacy;

        if (decimal.TryParse(clean, NumberStyles.Number, CultureInfo.InvariantCulture, out var size))
        {
            return Math.Clamp(size, 8m, 24m);
        }

        return DefaultFontSize;
    }

    private static string FirstNonEmpty(params string?[] values)
    {
        foreach (var value in values)
        {
            if (!string.IsNullOrWhiteSpace(value)) return value.Trim();
        }
        return "";
    }

    private enum TextAlignment
    {
        Left,
        Center,
        Right,
    }

    private enum TextEmphasis
    {
        Normal,
        Header,
        Hero,
    }

    private abstract record ReceiptBlock;
    private sealed record TextBlock(string Value, TextAlignment Alignment, bool Bold, TextEmphasis Emphasis) : ReceiptBlock;
    private sealed record DividerBlock : ReceiptBlock;
    private sealed record SpacerBlock(int Lines) : ReceiptBlock;
    private sealed record QrCodeBlock(string Value) : ReceiptBlock;

    private static class ReceiptBlockParser
    {
        public static IReadOnlyList<ReceiptBlock> Parse(string payload, int columns)
        {
            var blocks = new List<ReceiptBlock>();
            foreach (var rawLine in payload.Split('\n'))
            {
                var line = rawLine.TrimEnd();
                var clean = line.Trim();

                if (string.IsNullOrWhiteSpace(clean))
                {
                    blocks.Add(new SpacerBlock(1));
                    continue;
                }

                var qrMatch = QrRegex.Match(line);
                if (qrMatch.Success && !string.IsNullOrWhiteSpace(qrMatch.Groups[1].Value))
                {
                    blocks.Add(new QrCodeBlock(qrMatch.Groups[1].Value));
                    continue;
                }

                if (IsDivider(clean))
                {
                    blocks.Add(new DividerBlock());
                    continue;
                }

                blocks.Add(ParseTextLine(line, clean, columns));
            }

            return blocks;
        }

        private static TextBlock ParseTextLine(string line, string clean, int columns)
        {
            var value = clean;
            var alignment = LooksCentered(line, clean, columns) ? TextAlignment.Center : TextAlignment.Left;
            var bold = false;
            var hero = IsHeroHeader(clean);
            var header = hero || IsHeader(clean);

            value = StripTag(value, "center", () => alignment = TextAlignment.Center);
            value = StripTag(value, "right", () => alignment = TextAlignment.Right);
            value = StripTag(value, "b", () => bold = true);
            value = StripTag(value, "strong", () => bold = true);
            value = StripTag(value, "big", () =>
            {
                bold = true;
                header = true;
            });

            hero = hero || IsHeroHeader(value);

            if (IsTotal(value) || IsStageTag(value))
            {
                bold = true;
            }

            if (header)
            {
                bold = true;
                alignment = TextAlignment.Center;
            }

            return new TextBlock(
                value,
                alignment,
                bold,
                hero ? TextEmphasis.Hero : header ? TextEmphasis.Header : TextEmphasis.Normal
            );
        }

        private static string StripTag(string value, string tag, Action onMatch)
        {
            var pattern = $@"^\s*<{tag}>\s*(.*?)\s*</{tag}>\s*$";
            var match = Regex.Match(value, pattern, RegexOptions.IgnoreCase | RegexOptions.Singleline);
            if (!match.Success) return value;
            onMatch();
            return match.Groups[1].Value.Trim();
        }

        private static bool LooksCentered(string line, string clean, int columns)
        {
            var leadingSpaces = line.Length - line.TrimStart().Length;
            return leadingSpaces >= 2 && clean.Length <= Math.Max(8, columns - (leadingSpaces * 2));
        }

        private static bool IsDivider(string value)
        {
            if (value.Length < 6) return false;
            return value.All(ch => ch is '-' or '_' or '=' or '*');
        }

        private static bool IsHeader(string value)
        {
            var upper = value.ToUpperInvariant();
            return upper is "DELIVERY" or "RETIRADA" or "RETIRADA NA LOJA" or "BALCAO" or "MESA" or "COZINHA" or "PEDIDO" ||
                   upper.StartsWith("PEDIDO #", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsHeroHeader(string value)
        {
            return string.Equals(value.Trim(), "DELIVERY", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsStageTag(string value)
        {
            var upper = value.ToUpperInvariant();
            return upper is "PEDIDO NOVO" or "VIA COZINHA" or "RECIBO" or "RECIBO DO CLIENTE" or "SAIU P/ ENTREGA" or "PEDIDO CONCLUIDO" or "PEDIDO CANCELADO" or "DOCUMENTO DE VENDA";
        }

        private static bool IsTotal(string value)
        {
            return value.TrimStart().StartsWith("TOTAL:", StringComparison.OrdinalIgnoreCase) ||
                   value.TrimStart().StartsWith("Total:", StringComparison.OrdinalIgnoreCase);
        }
    }
}

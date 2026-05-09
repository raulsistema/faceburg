using Faceburg.LocalAgent.Config;
using Faceburg.LocalAgent.Models;
using Faceburg.LocalAgent.Printing;

namespace Faceburg.LocalAgent.Services;

public sealed class PrintService(
    NativePrinterApi printers,
    EscPosTextBuilder escpos,
    AcbrPosPrinterApi acbrPrinter,
    WindowsDriverReceiptPrinter windowsPrinter
)
{
    public PrintResult Print(PrintJobRequest request, AgentConfig config)
    {
        var jobId = string.IsNullOrWhiteSpace(request.JobId)
            ? Guid.NewGuid().ToString("N")
            : request.JobId.Trim();
        var printerName = printers.ResolvePrinter(request.PrinterName, config.DefaultPrinter);
        var copies = Math.Clamp(request.Copies ?? 1, 1, 5);

        if (!string.IsNullOrWhiteSpace(request.RawEscPosBase64) || config.PrintEngine == "raw-escpos")
        {
            var bytes = escpos.Build(request, config);
            for (var copy = 0; copy < copies; copy++)
            {
                printers.WriteRaw(printerName, bytes, $"Faceburg {jobId}");
            }

            return new PrintResult(true, jobId, printerName, bytes.Length, copies, "raw-escpos");
        }

        if (config.PrintEngine == "acbr-posprinter")
        {
            var taggedText = escpos.BuildAcbrTaggedText(request, config);
            return acbrPrinter.PrintText(printerName, request, config, taggedText, copies, jobId);
        }

        return windowsPrinter.PrintText(printerName, request, config, copies, jobId);
    }

    public PrintResult PrintTest(AgentConfig config)
    {
        var jobId = Guid.NewGuid().ToString("N");
        var printerName = printers.ResolvePrinter(config.DefaultPrinter);
        var request = new PrintJobRequest
        {
            JobId = jobId,
            PayloadText = string.Join('\n', new[]
            {
                "<center><big>FACEBURG LOCAL AGENT</big></center>",
                "<center>Teste visual pelo driver Windows</center>",
                "------------------------------------------------",
                $"Computador: {Environment.MachineName}",
                $"Data: {DateTime.Now:dd/MM/yyyy HH:mm:ss}",
                "",
                "Se este cupom saiu rapido,",
                "a impressao visual esta pronta.",
                "",
                "<b>TOTAL: R$ 0,00</b>",
                "Faceburg",
            }),
            CutPaper = config.CutPaper,
            PulseDrawer = false,
            CodePage = config.CodePage,
            Columns = config.Columns,
            PrintTextSize = config.PrintTextSize,
        };
        return Print(request, config);
    }
}

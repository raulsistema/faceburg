using Faceburg.LocalAgent.Config;
using Faceburg.LocalAgent.Models;
using Faceburg.LocalAgent.Printing;

namespace Faceburg.LocalAgent.Services;

public sealed class PrintService(NativePrinterApi printers, EscPosTextBuilder escpos)
{
    public PrintResult Print(PrintJobRequest request, AgentConfig config)
    {
        var jobId = string.IsNullOrWhiteSpace(request.JobId)
            ? Guid.NewGuid().ToString("N")
            : request.JobId.Trim();
        var printerName = printers.ResolvePrinter(request.PrinterName, config.DefaultPrinter);
        var bytes = escpos.Build(request, config);
        var copies = Math.Clamp(request.Copies ?? 1, 1, 5);

        for (var copy = 0; copy < copies; copy++)
        {
            printers.WriteRaw(printerName, bytes, $"Faceburg {jobId}");
        }

        return new PrintResult(true, jobId, printerName, bytes.Length, copies, "raw-escpos");
    }

    public PrintResult PrintTest(AgentConfig config)
    {
        var jobId = Guid.NewGuid().ToString("N");
        var printerName = printers.ResolvePrinter(config.DefaultPrinter);
        var bytes = escpos.BuildTest(config);
        printers.WriteRaw(printerName, bytes, $"Faceburg teste {jobId}");
        return new PrintResult(true, jobId, printerName, bytes.Length, 1, "raw-escpos");
    }
}

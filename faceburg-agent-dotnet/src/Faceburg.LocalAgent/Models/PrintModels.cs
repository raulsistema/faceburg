namespace Faceburg.LocalAgent.Models;

public sealed class PrintJobRequest
{
    public string? JobId { get; set; }
    public string? TenantId { get; set; }
    public string? TenantSlug { get; set; }
    public string? TerminalId { get; set; }
    public string? PrinterName { get; set; }
    public string? PayloadText { get; set; }
    public string? RawEscPosBase64 { get; set; }
    public int? Columns { get; set; }
    public string? CodePage { get; set; }
    public bool? CutPaper { get; set; }
    public bool? PulseDrawer { get; set; }
    public int? Copies { get; set; }
}

public sealed record PrintResult(
    bool Ok,
    string JobId,
    string PrinterName,
    int Bytes,
    int Copies,
    string Strategy,
    string? Error = null
);

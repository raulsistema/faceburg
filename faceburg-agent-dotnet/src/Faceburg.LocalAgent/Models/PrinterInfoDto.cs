namespace Faceburg.LocalAgent.Models;

public sealed record PrinterInfoDto(
    string Name,
    bool IsDefault,
    string? ServerName,
    string Attributes
);

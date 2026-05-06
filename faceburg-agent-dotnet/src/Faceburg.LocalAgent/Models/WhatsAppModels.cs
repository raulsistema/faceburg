namespace Faceburg.LocalAgent.Models;

public sealed class WhatsAppSendRequest
{
    public string? JobId { get; set; }
    public string? TargetPhone { get; set; }
    public string? PayloadText { get; set; }
}

public sealed record WhatsAppStatusDto(
    string Status,
    string PhoneNumber,
    string QrCode,
    string LastError,
    DateTimeOffset UpdatedAt
);

public sealed record WhatsAppResult(
    bool Ok,
    string JobId,
    string TargetPhone,
    string? Error = null
);

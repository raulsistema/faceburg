namespace Faceburg.LocalAgent.Config;

public sealed class AgentConfig
{
    public string Product { get; set; } = "Faceburg Local Agent";
    public int Port { get; set; } = 9787;
    public string ServerUrl { get; set; } = "https://faceburg.vercel.app";
    public string TenantId { get; set; } = "";
    public string TenantSlug { get; set; } = "";
    public string TerminalId { get; set; } = Environment.MachineName;
    public string PrintAgentKey { get; set; } = "";
    public string WhatsAppAgentKey { get; set; } = "";
    public bool DirectRealtimeEnabled { get; set; } = false;
    public int RealtimeGatewayPort { get; set; } = 3001;
    public string RealtimeGatewayPath { get; set; } = "/ws/agents";
    public string DefaultPrinter { get; set; } = "";
    public string PrintEngine { get; set; } = "windows-driver-visual";
    public int Columns { get; set; } = 32;
    public string PrintTextSize { get; set; } = "12.5";
    public string CodePage { get; set; } = "CP860";
    public bool CutPaper { get; set; } = true;
    public bool PulseDrawer { get; set; } = false;
    public bool StartWithWindows { get; set; } = true;
    public bool RequireLocalToken { get; set; } = false;
    public string LocalToken { get; set; } = Guid.NewGuid().ToString("N");
    public bool WhatsAppEnabled { get; set; } = false;
    public bool WhatsAppHeadless { get; set; } = true;
    public string WhatsAppChromePath { get; set; } = "";
    public string[] AllowedOrigins { get; set; } =
    [
        "https://faceburg.vercel.app",
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:3002"
    ];
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Faceburg.LocalAgent.Config;
using Faceburg.LocalAgent.Models;
using Faceburg.LocalAgent.Printing;
using Faceburg.LocalAgent.Services;
using Faceburg.LocalAgent.Web;

var configStore = new ConfigStore();
var startupConfig = await configStore.LoadAsync();

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(options =>
{
    options.Listen(IPAddress.Loopback, startupConfig.Port);
});

builder.Services.AddSingleton(configStore);
builder.Services.AddSingleton<NativePrinterApi>();
builder.Services.AddSingleton<EscPosTextBuilder>();
builder.Services.AddSingleton<AcbrPosPrinterApi>();
builder.Services.AddSingleton<WindowsDriverReceiptPrinter>();
builder.Services.AddSingleton<PrintService>();
builder.Services.AddSingleton<WhatsAppSidecarService>();
builder.Services.AddSingleton<StartupRegistrationService>();
builder.Services.AddSingleton<DirectRealtimeService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<WhatsAppSidecarService>());
builder.Services.AddHostedService(sp => sp.GetRequiredService<DirectRealtimeService>());
builder.Services.AddCors(options =>
{
    options.AddPolicy("FaceburgLocal", policy =>
    {
        policy
            .WithOrigins(startupConfig.AllowedOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

var app = builder.Build();

app.Use(async (context, next) =>
{
    var origin = context.Request.Headers.Origin.ToString();
    if (!string.IsNullOrWhiteSpace(origin))
    {
        var config = await configStore.LoadAsync(context.RequestAborted);
        if (config.AllowedOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase))
        {
            context.Response.Headers.AccessControlAllowOrigin = origin;
            context.Response.Headers.AccessControlAllowHeaders = "content-type,x-faceburg-local-token";
            context.Response.Headers.AccessControlAllowMethods = "GET,POST,PUT,OPTIONS";
            context.Response.Headers["Access-Control-Allow-Private-Network"] = "true";
            context.Response.Headers.Vary = "Origin";
        }
    }

    if (HttpMethods.IsOptions(context.Request.Method))
    {
        context.Response.StatusCode = StatusCodes.Status204NoContent;
        return;
    }

    await next();
});
app.UseCors("FaceburgLocal");

app.MapGet("/", () => Results.Content(AdminPage.Html, "text/html; charset=utf-8"));

app.MapGet("/api/health", async (
    ConfigStore store,
    StartupRegistrationService startup,
    WhatsAppSidecarService whatsapp,
    CancellationToken cancellationToken) =>
{
    var config = await store.LoadAsync(cancellationToken);
    return Results.Ok(new
    {
        online = true,
        product = config.Product,
        version = typeof(Program).Assembly.GetName().Version?.ToString() ?? "dev",
        port = config.Port,
        tenantId = config.TenantId,
        tenantSlug = config.TenantSlug,
        terminalId = config.TerminalId,
        printerName = config.DefaultPrinter,
        printEngine = config.PrintEngine,
        columns = config.Columns,
        printTextSize = config.PrintTextSize,
        realtimeGatewayPort = config.RealtimeGatewayPort,
        realtimeGatewayPath = config.RealtimeGatewayPath,
        hasPrintAgentKey = !string.IsNullOrWhiteSpace(config.PrintAgentKey),
        hasWhatsAppAgentKey = !string.IsNullOrWhiteSpace(config.WhatsAppAgentKey),
        codePage = config.CodePage,
        cutPaper = config.CutPaper,
        pulseDrawer = config.PulseDrawer,
        startWithWindows = config.StartWithWindows,
        startupRegistered = startup.IsRegistered(),
        configUpdatedAt = config.UpdatedAt,
        whatsapp = whatsapp.CurrentStatus,
    });
});

app.MapGet("/api/printers", (NativePrinterApi printers) =>
{
    try
    {
        return Results.Ok(printers.ListPrinters());
    }
    catch (Exception ex)
    {
        return Results.Problem(ex.Message, statusCode: StatusCodes.Status500InternalServerError);
    }
});

app.MapGet("/impresoras/", (NativePrinterApi printers) =>
{
    try
    {
        return Results.Ok(new
        {
            Portas = printers.ListPrinters().Select(printer => printer.Name).ToArray(),
            Operacao = 1,
        });
    }
    catch
    {
        return Results.Json(false);
    }
});

app.MapGet("/api/config", async (HttpContext http, ConfigStore store, CancellationToken cancellationToken) =>
{
    var config = await store.LoadAsync(cancellationToken);
    var authError = Authorize(http, config);
    return authError ?? Results.Ok(config);
});

app.MapPut("/api/config", async (
    HttpContext http,
    AgentConfig incoming,
    ConfigStore store,
    StartupRegistrationService startup,
    CancellationToken cancellationToken) =>
{
    var current = await store.LoadAsync(cancellationToken);
    var authError = Authorize(http, current);
    if (authError is not null) return authError;

    incoming.LocalToken = string.IsNullOrWhiteSpace(incoming.LocalToken)
        ? current.LocalToken
        : incoming.LocalToken;
    var saved = await store.SaveAsync(incoming, cancellationToken);
    await startup.ApplyAsync(saved, cancellationToken);
    return Results.Ok(saved);
});

app.MapPost("/api/print/test", async (
    HttpContext http,
    ConfigStore store,
    PrintService print,
    CancellationToken cancellationToken) =>
{
    var config = await store.LoadAsync(cancellationToken);
    var authError = Authorize(http, config);
    if (authError is not null) return authError;

    try
    {
        return Results.Ok(print.PrintTest(config));
    }
    catch (Exception ex)
    {
        return Results.Json(
            new PrintResult(false, Guid.NewGuid().ToString("N"), config.DefaultPrinter, 0, 0, config.PrintEngine, ex.Message),
            statusCode: StatusCodes.Status500InternalServerError
        );
    }
});

app.MapPost("/api/print", async (
    HttpContext http,
    PrintJobRequest request,
    ConfigStore store,
    PrintService print,
    CancellationToken cancellationToken) =>
{
    var config = await store.LoadAsync(cancellationToken);
    var authError = Authorize(http, config);
    if (authError is not null) return authError;

    var tenantError = ValidateTenant(config, request.TenantId, request.TenantSlug, request.TerminalId);
    if (tenantError is not null) return tenantError;

    try
    {
        return Results.Ok(print.Print(request, config));
    }
    catch (Exception ex)
    {
        return Results.Json(
            new PrintResult(false, request.JobId ?? Guid.NewGuid().ToString("N"), request.PrinterName ?? config.DefaultPrinter, 0, 0, config.PrintEngine, ex.Message),
            statusCode: StatusCodes.Status500InternalServerError
        );
    }
});

app.MapPost("/imprimir/", async (
    SwAnyPrintRequest request,
    ConfigStore store,
    PrintService print,
    CancellationToken cancellationToken) =>
{
    var config = await store.LoadAsync(cancellationToken);
    try
    {
        var jobId = Guid.NewGuid().ToString("N");
        var printRequest = new PrintJobRequest
        {
            JobId = jobId,
            PrinterName = request.Impresora,
            PayloadText = BuildSwAnyPayloadText(request),
            Columns = config.Columns,
            PrintTextSize = config.PrintTextSize,
            CodePage = config.CodePage,
            CutPaper = config.CutPaper,
            PulseDrawer = config.PulseDrawer,
            Copies = 1,
        };
        print.Print(printRequest, config);
        return Results.Json(true);
    }
    catch
    {
        return Results.Json(false);
    }
});

app.MapGet("/api/whatsapp/status", (WhatsAppSidecarService whatsapp) =>
{
    return Results.Ok(whatsapp.CurrentStatus);
});

app.MapPost("/api/whatsapp/start", async (
    HttpContext http,
    ConfigStore store,
    WhatsAppSidecarService whatsapp,
    CancellationToken cancellationToken) =>
{
    var config = await store.LoadAsync(cancellationToken);
    var authError = Authorize(http, config);
    if (authError is not null) return authError;

    if (!config.WhatsAppEnabled)
    {
        config.WhatsAppEnabled = true;
        await store.SaveAsync(config, cancellationToken);
    }
    await whatsapp.RestartAsync(cancellationToken);
    return Results.Ok(new { ok = true, status = whatsapp.CurrentStatus });
});

app.MapPost("/api/whatsapp/stop", async (
    HttpContext http,
    ConfigStore store,
    WhatsAppSidecarService whatsapp,
    CancellationToken cancellationToken) =>
{
    var config = await store.LoadAsync(cancellationToken);
    var authError = Authorize(http, config);
    if (authError is not null) return authError;

    if (config.WhatsAppEnabled)
    {
        config.WhatsAppEnabled = false;
        await store.SaveAsync(config, cancellationToken);
    }
    await whatsapp.StopSidecarAsync();
    return Results.Ok(new { ok = true, status = whatsapp.CurrentStatus });
});

app.MapPost("/api/whatsapp/send", async (
    HttpContext http,
    WhatsAppSendRequest request,
    ConfigStore store,
    WhatsAppSidecarService whatsapp,
    CancellationToken cancellationToken) =>
{
    var config = await store.LoadAsync(cancellationToken);
    var authError = Authorize(http, config);
    if (authError is not null) return authError;

    var result = await whatsapp.SendAsync(request, cancellationToken);
    return result.Ok
        ? Results.Ok(result)
        : Results.Json(result, statusCode: StatusCodes.Status409Conflict);
});

app.MapPost("/api/dispatch", async (
    HttpContext http,
    LocalDispatchRequest request,
    ConfigStore store,
    PrintService print,
    WhatsAppSidecarService whatsapp,
    CancellationToken cancellationToken) =>
{
    var config = await store.LoadAsync(cancellationToken);
    var authError = Authorize(http, config);
    if (authError is not null) return authError;

    var printResults = new List<PrintResult>();
    var whatsResults = new List<WhatsAppResult>();

    foreach (var printJob in request.PrintJobs ?? [])
    {
        printResults.Add(print.Print(printJob, config));
    }

    foreach (var whatsJob in request.WhatsAppJobs ?? [])
    {
        whatsResults.Add(await whatsapp.SendAsync(whatsJob, cancellationToken));
    }

    return Results.Ok(new
    {
        ok = printResults.All(result => result.Ok) && whatsResults.All(result => result.Ok),
        printResults,
        whatsResults,
    });
});

await app.Services.GetRequiredService<StartupRegistrationService>().ApplyAsync(startupConfig);
app.Run();

static IResult? Authorize(HttpContext http, AgentConfig config)
{
    if (!config.RequireLocalToken)
    {
        return null;
    }

    var token = http.Request.Headers["X-Faceburg-Local-Token"].ToString();
    return CryptographicEquals(token, config.LocalToken) ? null : Results.Unauthorized();
}

static IResult? ValidateTenant(AgentConfig config, string? tenantId, string? tenantSlug, string? terminalId)
{
    if (!string.IsNullOrWhiteSpace(tenantId) && !Matches(config.TenantId, tenantId))
    {
        return Results.Json(new { error = "Tenant diferente do configurado neste agente." }, statusCode: StatusCodes.Status403Forbidden);
    }

    if (!string.IsNullOrWhiteSpace(tenantSlug) && !Matches(config.TenantSlug, tenantSlug))
    {
        return Results.Json(new { error = "Cardapio/empresa diferente do configurado neste agente." }, statusCode: StatusCodes.Status403Forbidden);
    }

    if (!string.IsNullOrWhiteSpace(terminalId) && !Matches(config.TerminalId, terminalId))
    {
        return Results.Json(new { error = "Terminal diferente do configurado neste agente." }, statusCode: StatusCodes.Status403Forbidden);
    }

    return null;
}

static bool Matches(string configured, string? incoming)
{
    return string.IsNullOrWhiteSpace(configured) ||
           string.Equals(configured.Trim(), incoming?.Trim(), StringComparison.OrdinalIgnoreCase);
}

static bool CryptographicEquals(string left, string right)
{
    if (string.IsNullOrWhiteSpace(left) || string.IsNullOrWhiteSpace(right))
    {
        return false;
    }

    var leftBytes = Encoding.UTF8.GetBytes(left);
    var rightBytes = Encoding.UTF8.GetBytes(right);
    return leftBytes.Length == rightBytes.Length &&
           CryptographicOperations.FixedTimeEquals(leftBytes, rightBytes);
}

static string BuildSwAnyPayloadText(SwAnyPrintRequest request)
{
    var builder = new StringBuilder();
    var centered = false;
    var expanded = false;

    foreach (var operation in request.Operaciones ?? [])
    {
        var action = (operation.Accion ?? "").Trim().ToLowerInvariant();
        var data = JsonValueToString(operation.Datos);

        switch (action)
        {
            case "text":
                builder.Append(DecorateSwAnyText(data, centered, expanded));
                break;

            case "settextsize":
                if (string.Equals(data, "2,2", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(data, "2x2", StringComparison.OrdinalIgnoreCase))
                {
                    expanded = true;
                }
                else
                {
                    expanded = false;
                }
                break;

            case "feed":
                if (int.TryParse(data, out var feedLines))
                {
                    for (var i = 0; i < Math.Clamp(feedLines, 1, 20); i++)
                    {
                        builder.Append('\n');
                    }
                }
                else
                {
                    builder.Append('\n');
                }
                break;

            case "cut":
                builder.Append('\n');
                break;

            case "qrimagen":
                if (!string.IsNullOrWhiteSpace(data))
                {
                    builder.Append("\n<qrcode>")
                        .Append(data)
                        .Append("</qrcode>\n");
                }
                break;

            case "setjustification":
                if (string.Equals(data, "center", StringComparison.OrdinalIgnoreCase))
                {
                    centered = true;
                }
                else if (string.Equals(data, "left", StringComparison.OrdinalIgnoreCase))
                {
                    centered = false;
                }
                break;
        }
    }

    return builder.ToString().TrimEnd();
}

static string DecorateSwAnyText(string value, bool centered, bool expanded)
{
    var lines = value
        .Replace("\r\n", "\n")
        .Replace('\r', '\n')
        .Split('\n');
    var builder = new StringBuilder(value.Length + 64);

    foreach (var line in lines)
    {
        var text = line.TrimEnd();
        if (string.IsNullOrWhiteSpace(text))
        {
            builder.Append('\n');
            continue;
        }

        if (expanded) text = $"<big>{text}</big>";
        if (centered) text = $"<center>{text}</center>";
        builder.Append(text).Append('\n');
    }

    return builder.ToString();
}

static string JsonValueToString(JsonElement value)
{
    return value.ValueKind switch
    {
        JsonValueKind.String => value.GetString() ?? "",
        JsonValueKind.Number => value.ToString(),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        _ => value.ToString(),
    };
}

public sealed class LocalDispatchRequest
{
    public PrintJobRequest[]? PrintJobs { get; set; }
    public WhatsAppSendRequest[]? WhatsAppJobs { get; set; }
}

public sealed class SwAnyPrintRequest
{
    public string? Impresora { get; set; }
    public SwAnyOperation[]? Operaciones { get; set; }
}

public sealed class SwAnyOperation
{
    public string? Accion { get; set; }
    public JsonElement Datos { get; set; }
}

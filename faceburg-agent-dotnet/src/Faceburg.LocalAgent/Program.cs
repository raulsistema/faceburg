using System.Net;
using System.Security.Cryptography;
using System.Text;
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
builder.Services.AddSingleton<PrintService>();
builder.Services.AddSingleton<WhatsAppSidecarService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<WhatsAppSidecarService>());
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

app.MapGet("/api/config", async (HttpContext http, ConfigStore store, CancellationToken cancellationToken) =>
{
    var config = await store.LoadAsync(cancellationToken);
    var authError = Authorize(http, config);
    return authError ?? Results.Ok(config);
});

app.MapPut("/api/config", async (HttpContext http, AgentConfig incoming, ConfigStore store, CancellationToken cancellationToken) =>
{
    var current = await store.LoadAsync(cancellationToken);
    var authError = Authorize(http, current);
    if (authError is not null) return authError;

    incoming.LocalToken = string.IsNullOrWhiteSpace(incoming.LocalToken)
        ? current.LocalToken
        : incoming.LocalToken;
    var saved = await store.SaveAsync(incoming, cancellationToken);
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
            new PrintResult(false, Guid.NewGuid().ToString("N"), config.DefaultPrinter, 0, 0, "raw-escpos", ex.Message),
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
            new PrintResult(false, request.JobId ?? Guid.NewGuid().ToString("N"), request.PrinterName ?? config.DefaultPrinter, 0, 0, "raw-escpos", ex.Message),
            statusCode: StatusCodes.Status500InternalServerError
        );
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

public sealed class LocalDispatchRequest
{
    public PrintJobRequest[]? PrintJobs { get; set; }
    public WhatsAppSendRequest[]? WhatsAppJobs { get; set; }
}

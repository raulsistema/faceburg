using System.Runtime.InteropServices;
using System.Text;
using Faceburg.LocalAgent.Config;
using Faceburg.LocalAgent.Models;

namespace Faceburg.LocalAgent.Printing;

public sealed class AcbrPosPrinterApi(NativePrinterApi rawPrinter)
{
    public PrintResult PrintText(string printerName, PrintJobRequest request, AgentConfig config, string taggedText, int copies, string jobId)
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("ACBr PosPrinter esta disponivel apenas no Windows.");
        }

        var handle = IntPtr.Zero;
        var initialized = false;
        try
        {
            Check(PosNative.POS_Inicializar(ref handle, "", ""), handle, "inicializar ACBr");
            initialized = true;
            Configure(handle, printerName, request, config);
            Check(PosNative.POS_ConfigGravar(handle, ""), handle, "gravar configuracao ACBr");
            Check(PosNative.POS_Ativar(handle), handle, "ativar ACBr");

            var printableText = PreparePrintableText(taggedText);
            for (var copy = 0; copy < copies; copy++)
            {
                Check(PosNative.POS_Imprimir(handle, printableText, false, true, true, 1), handle, "imprimir via ACBr");
                if (request.PulseDrawer ?? config.PulseDrawer)
                {
                    rawPrinter.WriteRaw(printerName, [0x1B, 0x70, 0x00, 0x19, 0xFA], $"Faceburg gaveta {jobId}");
                }
            }

            return new PrintResult(true, jobId, printerName, Encoding.UTF8.GetByteCount(printableText), copies, "acbr-posprinter");
        }
        finally
        {
            if (handle != IntPtr.Zero)
            {
                if (initialized)
                {
                    PosNative.POS_Desativar(handle);
                }
                PosNative.POS_Finalizar(handle);
            }
        }
    }

    private static void Configure(IntPtr handle, string printerName, PrintJobRequest request, AgentConfig config)
    {
        var columns = NormalizeColumns(request.Columns ?? config.Columns);
        var pageCode = NormalizeCodePage(request.CodePage ?? config.CodePage);

        Set(handle, "Principal", "LogNivel", "0");
        Set(handle, "PosPrinter", "Modelo", "7"); // ppCustomPos: mesmo perfil usado no sistema de referencia.
        Set(handle, "PosPrinter", "Porta", $"RAW:{printerName}");
        Set(handle, "PosPrinter", "TipoCorte", "1");
        Set(handle, "PosPrinter", "PaginaDeCodigo", pageCode);
        Set(handle, "PosPrinter", "CortaPapel", Bool(request.CutPaper ?? config.CutPaper));
        Set(handle, "PosPrinter", "IgnorarTags", "0");
        Set(handle, "PosPrinter", "LinhasEntreCupons", "5");
        Set(handle, "PosPrinter", "ColunasFonteNormal", columns.ToString());
        Set(handle, "PosPrinter_QRCode", "Tipo", "4");
        Set(handle, "PosPrinter_QRCode", "LarguraModulo", "6");
    }

    private static string PreparePrintableText(string text)
    {
        return text
            .Replace("\r\n", "\n")
            .Replace('\r', '\n')
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
            _ => 32,
        };
    }

    private static string NormalizeCodePage(string? codePage)
    {
        return (codePage ?? "").Trim().ToUpperInvariant() switch
        {
            "CP437" => "1",
            "CP850" => "2",
            "CP860" => "4",
            "CP858" => "2",
            _ => "4",
        };
    }

    private static string Bool(bool value) => value ? "1" : "0";

    private static void Set(IntPtr handle, string section, string key, string value)
    {
        Check(PosNative.POS_ConfigGravarValor(handle, section, key, value), handle, $"configurar ACBr {section}/{key}");
    }

    private static void Check(int result, IntPtr handle, string operation)
    {
        if (result == 0) return;
        var detail = GetLastReturn(handle);
        throw new InvalidOperationException($"Falha ao {operation}: {detail}".Trim());
    }

    private static string GetLastReturn(IntPtr handle)
    {
        if (handle == IntPtr.Zero) return "";
        var length = 4096;
        var buffer = new StringBuilder(length);
        PosNative.POS_UltimoRetorno(handle, buffer, ref length);
        return buffer.ToString();
    }

    private static class PosNative
    {
        private const string Dll = "ACBrLib\\x64\\ACBrPosPrinter64.dll";

        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
        public static extern int POS_Inicializar(ref IntPtr handle, [MarshalAs(UnmanagedType.LPUTF8Str)] string config, [MarshalAs(UnmanagedType.LPUTF8Str)] string chave);

        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
        public static extern int POS_Finalizar(IntPtr handle);

        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
        public static extern int POS_ConfigGravar(IntPtr handle, [MarshalAs(UnmanagedType.LPUTF8Str)] string config);

        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
        public static extern int POS_ConfigGravarValor(IntPtr handle, [MarshalAs(UnmanagedType.LPUTF8Str)] string section, [MarshalAs(UnmanagedType.LPUTF8Str)] string key, [MarshalAs(UnmanagedType.LPUTF8Str)] string value);

        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
        public static extern int POS_Ativar(IntPtr handle);

        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
        public static extern int POS_Desativar(IntPtr handle);

        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
        public static extern int POS_Imprimir(IntPtr handle, [MarshalAs(UnmanagedType.LPUTF8Str)] string text, bool lineFeed, bool decodeTags, bool encodePage, int copies);

        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
        public static extern int POS_UltimoRetorno(IntPtr handle, StringBuilder buffer, ref int bufferSize);
    }
}

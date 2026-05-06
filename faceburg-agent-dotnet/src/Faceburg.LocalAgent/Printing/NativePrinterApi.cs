using System.ComponentModel;
using System.Runtime.InteropServices;
using Faceburg.LocalAgent.Models;

namespace Faceburg.LocalAgent.Printing;

public sealed class NativePrinterApi
{
    private const uint PrinterEnumLocal = 0x00000002;
    private const uint PrinterEnumConnections = 0x00000004;

    public IReadOnlyList<PrinterInfoDto> ListPrinters()
    {
        var defaultPrinter = GetDefaultPrinterName();
        var flags = PrinterEnumLocal | PrinterEnumConnections;
        EnumPrinters(flags, null, 4, IntPtr.Zero, 0, out var needed, out _);

        if (needed == 0)
        {
            return [];
        }

        var buffer = Marshal.AllocHGlobal((int)needed);
        try
        {
            if (!EnumPrinters(flags, null, 4, buffer, needed, out _, out var returned))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }

            var printers = new List<PrinterInfoDto>((int)returned);
            var offset = buffer;
            var size = Marshal.SizeOf<PrinterInfo4>();

            for (var i = 0; i < returned; i++)
            {
                var info = Marshal.PtrToStructure<PrinterInfo4>(offset);
                var name = info.PrinterName ?? "";
                if (!string.IsNullOrWhiteSpace(name))
                {
                    printers.Add(new PrinterInfoDto(
                        name,
                        string.Equals(name, defaultPrinter, StringComparison.OrdinalIgnoreCase),
                        info.ServerName,
                        DescribeAttributes(info.Attributes)
                    ));
                }

                offset = IntPtr.Add(offset, size);
            }

            return printers
                .OrderByDescending(printer => printer.IsDefault)
                .ThenBy(printer => printer.Name)
                .ToArray();
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    public string ResolvePrinter(string? requestedPrinter, string? fallbackPrinter = null)
    {
        var requested = (requestedPrinter ?? "").Trim();
        if (!string.IsNullOrWhiteSpace(requested)) return requested;

        var fallback = (fallbackPrinter ?? "").Trim();
        if (!string.IsNullOrWhiteSpace(fallback)) return fallback;

        var defaultPrinter = ListPrinters().FirstOrDefault(printer => printer.IsDefault)?.Name;
        if (!string.IsNullOrWhiteSpace(defaultPrinter)) return defaultPrinter;

        throw new InvalidOperationException("Nenhuma impressora padrao encontrada. Configure uma impressora no agente.");
    }

    public void WriteRaw(string printerName, byte[] bytes, string documentName)
    {
        if (string.IsNullOrWhiteSpace(printerName))
        {
            throw new InvalidOperationException("Nenhuma impressora configurada.");
        }

        if (!OpenPrinter(printerName, out var printerHandle, IntPtr.Zero))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), $"Nao foi possivel abrir a impressora {printerName}.");
        }

        try
        {
            var documentInfo = new DocInfo1
            {
                DocName = documentName,
                OutputFile = null,
                DataType = "RAW",
            };

            if (!StartDocPrinter(printerHandle, 1, ref documentInfo))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Nao foi possivel iniciar o documento RAW.");
            }

            try
            {
                if (!StartPagePrinter(printerHandle))
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Nao foi possivel iniciar a pagina RAW.");
                }

                try
                {
                    if (!WritePrinter(printerHandle, bytes, bytes.Length, out var written) || written != bytes.Length)
                    {
                        throw new Win32Exception(Marshal.GetLastWin32Error(), "Falha ao enviar bytes para a impressora.");
                    }
                }
                finally
                {
                    EndPagePrinter(printerHandle);
                }
            }
            finally
            {
                EndDocPrinter(printerHandle);
            }
        }
        finally
        {
            ClosePrinter(printerHandle);
        }
    }

    private static string GetDefaultPrinterName()
    {
        var capacity = 0;
        GetDefaultPrinter(null, ref capacity);
        if (capacity <= 0)
        {
            return "";
        }

        var buffer = new char[capacity];
        return GetDefaultPrinter(buffer, ref capacity)
            ? new string(buffer, 0, Math.Max(0, capacity - 1))
            : "";
    }

    private static string DescribeAttributes(uint attributes)
    {
        var values = new List<string>();
        if ((attributes & 0x00000004) != 0) values.Add("default");
        if ((attributes & 0x00000010) != 0) values.Add("network");
        if ((attributes & 0x00000040) != 0) values.Add("local");
        if ((attributes & 0x00000400) != 0) values.Add("shared");
        return string.Join(",", values);
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct PrinterInfo4
    {
        [MarshalAs(UnmanagedType.LPWStr)]
        public string? PrinterName;

        [MarshalAs(UnmanagedType.LPWStr)]
        public string? ServerName;

        public uint Attributes;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DocInfo1
    {
        [MarshalAs(UnmanagedType.LPWStr)]
        public string DocName;

        [MarshalAs(UnmanagedType.LPWStr)]
        public string? OutputFile;

        [MarshalAs(UnmanagedType.LPWStr)]
        public string DataType;
    }

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool EnumPrinters(
        uint flags,
        string? name,
        uint level,
        IntPtr printerEnum,
        uint cbBuf,
        out uint pcbNeeded,
        out uint pcReturned
    );

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool OpenPrinter(string printerName, out IntPtr printerHandle, IntPtr printerDefaults);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool ClosePrinter(IntPtr printerHandle);

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool StartDocPrinter(IntPtr printerHandle, int level, ref DocInfo1 docInfo);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool EndDocPrinter(IntPtr printerHandle);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool StartPagePrinter(IntPtr printerHandle);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool EndPagePrinter(IntPtr printerHandle);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool WritePrinter(IntPtr printerHandle, byte[] bytes, int count, out int written);

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool GetDefaultPrinter(char[]? printerName, ref int bufferSize);
}

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const iconv = require('iconv-lite');

const PRINT_MODE = String(process.env.HUB_PRINT_MODE || process.env.PRINT_MODE || 'auto').trim().toLowerCase();
const RAW_ENCODING = String(process.env.HUB_PRINT_RAW_ENCODING || process.env.PRINT_RAW_ENCODING || 'cp860').trim().toLowerCase();
const RAW_APPEND_CUT = !['0', 'false', 'no', 'off'].includes(String(process.env.HUB_PRINT_RAW_CUT || process.env.PRINT_RAW_CUT || 'false').trim().toLowerCase());
const RAW_INIT_PRINTER = !['0', 'false', 'no', 'off'].includes(String(process.env.HUB_PRINT_RAW_INIT || process.env.PRINT_RAW_INIT || 'true').trim().toLowerCase());
const POWERSHELL_TIMEOUT_MS = Number(process.env.HUB_PRINT_TIMEOUT_MS || process.env.PRINT_TIMEOUT_MS || 45000);

const THERMAL_PRINTER_HINTS = [
  'epson',
  'elgin',
  'bematech',
  'daruma',
  'tanca',
  'control id',
  'thermal',
  'receipt',
  'pos',
  'i9',
  'mp-',
  'tm-',
  'non fiscal',
];

const ESC_POS_CODE_PAGES = {
  cp437: 0,
  cp850: 2,
  cp860: 3,
  cp858: 19,
};

function execPowerShell(args) {
  return new Promise((resolve, reject) => {
    execFile('powershell', args, { timeout: POWERSHELL_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error) {
        const details = String(stderr || stdout || error.message || 'Falha ao executar PowerShell').trim();
        reject(new Error(details));
        return;
      }
      resolve(String(stdout || '').trim());
    });
  });
}

function escapePowerShellString(value) {
  return String(value || '').replace(/'/g, "''");
}

function buildTempPath(extension) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return path.join(os.tmpdir(), `faceburg-print-${suffix}.${extension}`);
}

function isThermalPrinter(printerName) {
  const normalized = String(printerName || '').trim().toLowerCase();
  if (!normalized) return false;
  return THERMAL_PRINTER_HINTS.some((hint) => normalized.includes(hint));
}

async function getDefaultPrinterNameWindows() {
  const cmd = "(Get-CimInstance Win32_Printer | Where-Object { $_.Default -eq $true } | Select-Object -ExpandProperty Name -First 1)";
  const output = await execPowerShell(['-NoProfile', '-Command', cmd]).catch(() => '');
  return String(output || '').trim();
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trimEnd();
}

function buildRawPayload(text) {
  const normalized = normalizeText(text);
  const buffers = [];

  if (RAW_INIT_PRINTER) {
    buffers.push(Buffer.from([0x1b, 0x40]));
    const codePage = ESC_POS_CODE_PAGES[RAW_ENCODING];
    if (codePage !== undefined) {
      buffers.push(Buffer.from([0x1b, 0x74, codePage]));
    }
  }

  buffers.push(iconv.encode(`${normalized}\n\n\n`, RAW_ENCODING));

  if (RAW_APPEND_CUT) {
    buffers.push(Buffer.from([0x1d, 0x56, 0x42, 0x00]));
  }

  return Buffer.concat(buffers);
}

async function printRawWindows(text, printerName) {
  const effectivePrinterName = String(printerName || '').trim() || await getDefaultPrinterNameWindows();
  if (!effectivePrinterName) {
    throw new Error('Nenhuma impressora configurada para impressao RAW.');
  }

  const payload = buildRawPayload(text);
  const dataFile = buildTempPath('bin');
  const scriptFile = buildTempPath('ps1');

  const script = `
$printerName = '${escapePowerShellString(effectivePrinterName)}'
$dataFile = '${escapePowerShellString(dataFile)}'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPWStr)]
    public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)]
    public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)]
    public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

  [DllImport("winspool.Drv", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In] DOCINFOA di);

  [DllImport("winspool.Drv", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, Int32 dwCount, out Int32 dwWritten);

  public static void SendBytesToPrinter(string printerName, byte[] bytes, string documentName) {
    IntPtr printerHandle = IntPtr.Zero;
    Int32 written = 0;
    var docInfo = new DOCINFOA {
      pDocName = documentName,
      pDataType = "RAW"
    };

    if (!OpenPrinter(printerName, out printerHandle, IntPtr.Zero)) {
      throw new InvalidOperationException("Nao foi possivel abrir a impressora.");
    }

    try {
      if (!StartDocPrinter(printerHandle, 1, docInfo)) {
        throw new InvalidOperationException("Nao foi possivel iniciar o documento RAW.");
      }
      try {
        if (!StartPagePrinter(printerHandle)) {
          throw new InvalidOperationException("Nao foi possivel iniciar a pagina RAW.");
        }
        try {
          if (!WritePrinter(printerHandle, bytes, bytes.Length, out written) || written != bytes.Length) {
            throw new InvalidOperationException("Falha ao enviar os bytes para a impressora.");
          }
        } finally {
          EndPagePrinter(printerHandle);
        }
      } finally {
        EndDocPrinter(printerHandle);
      }
    } finally {
      ClosePrinter(printerHandle);
    }
  }
}
"@

$bytes = [System.IO.File]::ReadAllBytes($dataFile)
[RawPrinterHelper]::SendBytesToPrinter($printerName, $bytes, 'Faceburg Hub')
`;

  try {
    fs.writeFileSync(dataFile, payload);
    fs.writeFileSync(scriptFile, script, 'utf8');
    await execPowerShell(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile]);
    return { strategy: 'raw', printerName: effectivePrinterName };
  } finally {
    try { fs.unlinkSync(dataFile); } catch {}
    try { fs.unlinkSync(scriptFile); } catch {}
  }
}

async function printSpoolWindows(text, printerName) {
  const filePath = buildTempPath('txt');
  const effectivePrinterName = String(printerName || '').trim();
  const safeFile = escapePowerShellString(filePath);
  const safePrinter = escapePowerShellString(effectivePrinterName);
  const cmd = effectivePrinterName
    ? `Get-Content -Raw '${safeFile}' | Out-Printer -Name '${safePrinter}'`
    : `Get-Content -Raw '${safeFile}' | Out-Printer`;

  try {
    fs.writeFileSync(filePath, `${normalizeText(text)}\r\n`, 'utf8');
    await execPowerShell(['-NoProfile', '-Command', cmd]);
    return { strategy: 'spool', printerName: effectivePrinterName };
  } finally {
    try { fs.unlinkSync(filePath); } catch {}
  }
}

function getPrintStrategies(printerName) {
  if (PRINT_MODE === 'raw') return ['raw', 'spool'];
  if (PRINT_MODE === 'spool') return ['spool', 'raw'];
  if (!printerName) return ['spool', 'raw'];
  return isThermalPrinter(printerName) ? ['raw', 'spool'] : ['spool', 'raw'];
}

async function printTextWindows(text, printerName) {
  const effectivePrinterName = String(printerName || '').trim() || await getDefaultPrinterNameWindows();
  const strategies = getPrintStrategies(effectivePrinterName);
  const failures = [];

  for (const strategy of strategies) {
    try {
      if (strategy === 'raw') {
        const result = await printRawWindows(text, effectivePrinterName);
        return {
          ...result,
          fallbackUsed: failures.length > 0,
          previousFailures: [...failures],
        };
      }
      const result = await printSpoolWindows(text, effectivePrinterName);
      return {
        ...result,
        fallbackUsed: failures.length > 0,
        previousFailures: [...failures],
      };
    } catch (error) {
      failures.push(`${strategy}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(failures.join(' | ') || 'Nenhuma estrategia de impressao conseguiu concluir o job.');
}

module.exports = {
  printTextWindows,
};

type WebpConversionOptions = {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  maxOutputBytes?: number;
};

const DEFAULT_MAX_EDGE = 1600;
const DEFAULT_QUALITY = 0.82;
const MIN_QUALITY = 0.5;
const QUALITY_STEP = 0.08;

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Falha ao carregar imagem.'));
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Este navegador nao conseguiu converter a imagem para WebP.'));
          return;
        }
        resolve(blob);
      },
      'image/webp',
      quality,
    );
  });
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Falha ao ler imagem convertida.'));
    reader.readAsDataURL(blob);
  });
}

export async function imageFileToWebpDataUrl(file: File, options: WebpConversionOptions = {}) {
  if (!file.type.startsWith('image/')) {
    throw new Error('Selecione um arquivo de imagem valido.');
  }

  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(sourceUrl);
    const maxWidth = options.maxWidth || DEFAULT_MAX_EDGE;
    const maxHeight = options.maxHeight || DEFAULT_MAX_EDGE;
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;

    if (!width || !height) {
      throw new Error('Imagem invalida.');
    }

    const scale = Math.min(1, maxWidth / width, maxHeight / height);
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Nao foi possivel preparar a imagem.');
    }

    context.drawImage(image, 0, 0, targetWidth, targetHeight);

    let quality = options.quality || DEFAULT_QUALITY;
    let blob = await canvasToBlob(canvas, quality);

    while (options.maxOutputBytes && blob.size > options.maxOutputBytes && quality > MIN_QUALITY) {
      quality = Math.max(MIN_QUALITY, Number((quality - QUALITY_STEP).toFixed(2)));
      blob = await canvasToBlob(canvas, quality);
    }

    if (options.maxOutputBytes && blob.size > options.maxOutputBytes) {
      throw new Error('Imagem convertida ainda ficou acima do limite permitido.');
    }

    return blobToDataUrl(blob);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

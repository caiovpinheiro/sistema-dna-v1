import { existsSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { prepareOcrImages } from './ocr-image.js';
export interface OcrLine { text: string; confidence?: number; }

const OCR_TIMEOUT_MS = 25_000;
const INIT_TIMEOUT_MS = 45_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** Arquivos de idioma: TESSDATA_DIR, ou a pasta tessdata do backend (rodando da raiz ou de dentro de backend/). */
function tessdataPath(): string {
  const candidatos = [
    process.env.TESSDATA_DIR,
    path.join(process.cwd(), 'tessdata'),
    path.join(process.cwd(), 'backend', 'tessdata'),
  ].filter((item): item is string => Boolean(item));
  return candidatos.find((pasta) => existsSync(path.join(pasta, 'por.traineddata'))) ?? candidatos[0];
}

/** Worker do tesseract.js para Node, achado pelo próprio pacote (o node_modules fica na raiz do monorepo). */
function workerScriptPath(): string {
  const pacote = path.dirname(createRequire(import.meta.url).resolve('tesseract.js/package.json'));
  return path.join(pacote, 'src', 'worker-script', 'node', 'index.js');
}

type OcrWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;

let workerPromise: Promise<OcrWorker> | null = null;

async function createOcrWorker(): Promise<OcrWorker> {
  const langPath = tessdataPath();
  const workerPath = workerScriptPath();

  if (!existsSync(path.join(langPath, 'por.traineddata'))) {
    throw new Error(`Arquivos de idioma do OCR não encontrados em ${langPath}.`);
  }
  if (!existsSync(workerPath)) {
    throw new Error('Worker do Tesseract não encontrado na imagem.');
  }

  const { createWorker } = await import('tesseract.js');
  return withTimeout(
    createWorker('por+eng', 1, {
      workerPath,
      langPath,
      cachePath: langPath,
      cacheMethod: 'readOnly',
      gzip: false,
      errorHandler: (error) => {
        console.error('Tesseract worker:', error);
      },
    }),
    INIT_TIMEOUT_MS,
    'O OCR demorou demais para iniciar.'
  );
}

async function getOcrWorker(): Promise<OcrWorker> {
  if (!workerPromise) {
    workerPromise = createOcrWorker().catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

export interface OcrPass {
  text: string;
  lines: OcrLine[];
}

type TesseractPsm = (typeof import('tesseract.js'))['PSM'][keyof (typeof import('tesseract.js'))['PSM']];

export async function recognizeImageText(image: Buffer, psm?: TesseractPsm): Promise<string> {
  const worker = await getOcrWorker();
  const { PSM } = await import('tesseract.js');
  await worker.setParameters({
    tessedit_pageseg_mode: psm ?? PSM.AUTO,
    preserve_interword_spaces: '1',
  });
  const result = await withTimeout(
    worker.recognize(image, {}, { text: true }),
    OCR_TIMEOUT_MS,
    'O OCR demorou demais para ler a campanha.'
  );
  return result.data.text || '';
}

export async function recognizePhotoPasses(image: Buffer): Promise<OcrPass[]> {
  const variants = await prepareOcrImages(image);
  const worker = await getOcrWorker();
  const { PSM } = await import('tesseract.js');
  const passes: OcrPass[] = [];

  for (const variant of variants) {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });
    const result = await withTimeout(
      worker.recognize(variant, {}, { text: true, blocks: true }),
      OCR_TIMEOUT_MS,
      'O OCR demorou demais para ler a foto.'
    );
    const data = result.data as {
      text?: string;
      lines?: Array<{ text?: string; confidence?: number }>;
    };
    passes.push({
      text: data.text || '',
      lines: (data.lines || []).map((line) => ({
        text: line.text || '',
        confidence: line.confidence,
      })),
    });
  }

  return passes;
}

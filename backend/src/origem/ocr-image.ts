import sharp from 'sharp';

const TARGET_WIDTH = 2000;

async function cropToForeground(input: Buffer): Promise<Buffer> {
  const preview = sharp(input).rotate().resize({ width: 480, withoutEnlargement: true }).grayscale();
  const { data, info } = await preview.raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  if (width < 8 || height < 8) return input;

  const corner = [
    data[0],
    data[width - 1],
    data[(height - 1) * width],
    data[height * width - 1],
  ];
  const background = corner.reduce((sum, value) => sum + value, 0) / corner.length;
  const threshold = 28;

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let hits = 0;

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (Math.abs(data[row + x] - background) < threshold) continue;
      hits += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  const coverage = hits / (width * height);
  if (hits < 80 || coverage > 0.88 || maxX <= minX || maxY <= minY) {
    return input;
  }

  const padX = Math.max(4, Math.round((maxX - minX + 1) * 0.04));
  const padY = Math.max(4, Math.round((maxY - minY + 1) * 0.04));
  minX = Math.max(0, minX - padX);
  minY = Math.max(0, minY - padY);
  maxX = Math.min(width - 1, maxX + padX);
  maxY = Math.min(height - 1, maxY + padY);

  const rotated = sharp(input).rotate();
  const meta = await rotated.metadata();
  const sourceWidth = meta.width || width;
  const sourceHeight = meta.height || height;
  const left = Math.floor((minX / width) * sourceWidth);
  const top = Math.floor((minY / height) * sourceHeight);
  const cropWidth = Math.max(8, Math.ceil(((maxX - minX + 1) / width) * sourceWidth));
  const cropHeight = Math.max(8, Math.ceil(((maxY - minY + 1) / height) * sourceHeight));

  return rotated
    .extract({
      left,
      top,
      width: Math.min(cropWidth, sourceWidth - left),
      height: Math.min(cropHeight, sourceHeight - top),
    })
    .toBuffer();
}

async function enhance(input: Buffer, invert: boolean): Promise<Buffer> {
  let pipeline = sharp(input).grayscale().normalise().sharpen();
  if (invert) {
    pipeline = pipeline.negate({ alpha: false });
  }
  return pipeline
    .resize({
      width: TARGET_WIDTH,
      withoutEnlargement: false,
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer();
}

export async function prepareOcrImages(input: Buffer): Promise<Buffer[]> {
  const cropped = await cropToForeground(input);
  const stats = await sharp(cropped).grayscale().stats();
  const mean = stats.channels[0]?.mean ?? 128;
  const images = [await enhance(cropped, mean < 118)];
  const inverted = await enhance(cropped, mean >= 118);
  images.push(inverted);
  return images;
}

/**
 * Image loading and optional optimization used by the `read` tool.
 *
 * Layer: `tools`. It only turns bytes into a base64 image block; it does not
 * know about the agent loop, sessions or the wire format of any provider.
 *
 * Optimization uses Photon (Rust/WASM) when the optional dependency is
 * installed. When it is missing or fails, the original bytes are returned
 * unchanged so that reading a file never fails because of imaging.
 */

/** Image formats recognised by magic bytes. */
export type ImageMimeType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/gif'
  | 'image/webp'
  | 'image/bmp';

/** Decoded image plus the metadata the `read` tool reports back. */
export interface LoadedImage {
  /** Base64-encoded image bytes. */
  readonly data: string;
  readonly mimeType: ImageMimeType;
  /** Size of `data` once decoded, in bytes. */
  readonly bytes: number;
  /** Whether the bytes were re-encoded (resized or recompressed). */
  readonly resized: boolean;
}

export interface ImageLoadOptions {
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  readonly maxBytes?: number;
  /** Injectable Photon module (tests); defaults to lazy-loading the optional dependency. */
  readonly photon?: PhotonModule | null;
}

const DEFAULT_MAX_WIDTH = 2000;
const DEFAULT_MAX_HEIGHT = 2000;
const DEFAULT_MAX_BYTES = Math.round(4.5 * 1024 * 1024);
const PHOTON_PACKAGE: string = '@silvia-odwyer/photon-node';

/** Detect an image MIME type from magic bytes, not the file extension. */
export function detectImageMimeType(buffer: Buffer): ImageMimeType | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 6 &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return 'image/gif';
  }
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return 'image/bmp';
  }
  return null;
}

/** Minimal structural view of Photon's API, so the dependency stays optional. */
interface PhotonImage {
  get_width(): number;
  get_height(): number;
  get_bytes(): Uint8Array;
  get_bytes_jpeg(quality: number): Uint8Array;
  free(): void;
}

export interface PhotonModule {
  readonly PhotonImage: {
    new_from_byteslice(bytes: Uint8Array): PhotonImage;
  };
  readonly resize: (
    image: PhotonImage,
    width: number,
    height: number,
    sampling?: number,
  ) => PhotonImage;
}

let cachedPhoton: PhotonModule | null | undefined;

/** Load the optional Photon WASM module once; return null when unavailable. */
export async function loadPhoton(): Promise<PhotonModule | null> {
  if (cachedPhoton !== undefined) {
    return cachedPhoton;
  }
  try {
    const mod = (await import(PHOTON_PACKAGE)) as Partial<PhotonModule>;
    cachedPhoton = mod.PhotonImage && mod.resize ? (mod as PhotonModule) : null;
  } catch {
    cachedPhoton = null;
  }
  return cachedPhoton;
}

/**
 * Turn raw file bytes into an image block, resizing through Photon when
 * available. Returns null when the bytes are not a recognised image.
 */
export async function loadImagePart(
  buffer: Buffer,
  options: ImageLoadOptions = {},
): Promise<LoadedImage | null> {
  const mimeType = detectImageMimeType(buffer);
  if (!mimeType) {
    return null;
  }

  const original: LoadedImage = {
    data: buffer.toString('base64'),
    mimeType,
    bytes: buffer.length,
    resized: false,
  };

  const photon = options.photon === undefined ? await loadPhoton() : options.photon;
  if (!photon) {
    return original;
  }

  try {
    return optimizeImage(original.data, photon, options);
  } catch {
    // Never fail a read because optimization failed; fall back to raw bytes.
    return original;
  }
}

/** Resize to a bounding box, then shrink until the byte budget fits. */
function optimizeImage(
  base64: string,
  photon: PhotonModule,
  options: ImageLoadOptions,
): LoadedImage {
  const maxWidth = options.maxWidth ?? DEFAULT_MAX_WIDTH;
  const maxHeight = options.maxHeight ?? DEFAULT_MAX_HEIGHT;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const input = Buffer.from(base64, 'base64');
  const original = photon.PhotonImage.new_from_byteslice(input);
  let working = original;
  try {
    const width = original.get_width();
    const height = original.get_height();
    if (width > maxWidth || height > maxHeight) {
      const scale = Math.min(maxWidth / width, maxHeight / height);
      working = photon.resize(original, Math.round(width * scale), Math.round(height * scale), 1);
    }

    const png = working.get_bytes();
    const jpeg = working.get_bytes_jpeg(80);
    let bytes = png.length <= jpeg.length ? png : jpeg;
    let mimeType: ImageMimeType = png.length <= jpeg.length ? 'image/png' : 'image/jpeg';

    if (bytes.length > maxBytes) {
      for (const quality of [70, 55, 40]) {
        const candidate = working.get_bytes_jpeg(quality);
        bytes = candidate;
        mimeType = 'image/jpeg';
        if (candidate.length <= maxBytes) {
          break;
        }
      }
    }

    return {
      data: Buffer.from(bytes).toString('base64'),
      mimeType,
      bytes: bytes.length,
      resized: true,
    };
  } finally {
    if (working !== original) {
      working.free();
    }
    original.free();
  }
}

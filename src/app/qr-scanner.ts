// Camera and QR decoding boundary. Nothing here knows what a Workstr pairing code is; it
// hands back whatever string a QR contained.
//
// iOS has no native BarcodeDetector and never has - every browser there is WebKit - so a
// decoder has to ship. Two paths, chosen at runtime:
//
//   Android Chrome  native BarcodeDetector, zero bytes downloaded
//   iOS Safari      ZXing compiled to WASM, ~448 KB gzipped, loaded on demand
//
// The fallback is imported dynamically so the WASM never reaches a cold start. Pairing
// needs the relay anyway, so this screen is always online; nothing is gained by putting it
// in the offline precache.

// Presence of the class is not enough. Some Android devices expose BarcodeDetector while
// supporting no formats at all, and the package's own polyfill mode checks only that the
// class exists, so the format list is the real test.
async function nativeDetector(): Promise<QrDetector | null> {
  const Native = (globalThis as { BarcodeDetector?: QrDetectorConstructor }).BarcodeDetector;
  if (!Native) return null;
  try {
    const formats = await Native.getSupportedFormats?.();
    if (!formats?.includes('qr_code')) return null;
    return new Native({ formats: ['qr_code'] });
  } catch {
    return null;
  }
}

interface QrDetector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

interface QrDetectorConstructor {
  new (options: { formats: string[] }): QrDetector;
  getSupportedFormats?(): Promise<string[]>;
}

let detectorPromise: Promise<QrDetector> | null = null;

async function detector(): Promise<QrDetector> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const native = await nativeDetector();
      if (native) return native;
      // Dynamic: this pulls in the WASM decoder, and only devices without a working
      // native implementation should ever pay for it.
      const [{ BarcodeDetector, prepareZXingModule }, wasmUrl] = await Promise.all([
        import('barcode-detector/ponyfill'),
        import('zxing-wasm/reader/zxing_reader.wasm?url').then((m) => m.default)
      ]);
      // The package defaults to fetching its binary from a jsDelivr CDN. That is a
      // third-party request on the screen where a private key is transferred, and it
      // breaks under CSP, so the binary is served from our own origin instead.
      prepareZXingModule({ overrides: { locateFile: () => wasmUrl } });
      return new BarcodeDetector({ formats: ['qr_code'] }) as QrDetector;
    })();
  }
  return detectorPromise;
}

export type ScannerErrorCode = 'no_camera' | 'denied' | 'unsupported';

export class ScannerError extends Error {
  readonly code: ScannerErrorCode;
  constructor(code: ScannerErrorCode, message: string) {
    super(message);
    this.name = 'ScannerError';
    this.code = code;
  }
}

export interface ScannerHandle {
  /** Idempotent. Safe to call from a cancel button, a screen change and an unload. */
  stop(): void;
}

/**
 * Opens the camera, decodes into `onResult`, and stops on the first hit.
 *
 * The stream is stopped from exactly one place, so leaving the screen, cancelling, and a
 * successful scan all release the camera the same way. A camera left running behind a
 * closed modal is the failure people actually notice.
 */
export async function scanQr(video: HTMLVideoElement, onResult: (value: string) => void): Promise<ScannerHandle> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new ScannerError('unsupported', 'This browser cannot use the camera.');
  }

  let stream: MediaStream;
  try {
    // Rear camera where there is one; `ideal` rather than `exact` so a laptop with only a
    // front camera still works instead of failing outright.
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  } catch (error) {
    const name = (error as { name?: string })?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new ScannerError('denied', 'Camera access was refused. Allow it and try again.');
    }
    throw new ScannerError('no_camera', 'No camera is available on this device.');
  }

  let stopped = false;
  let frame = 0;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });

  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  };

  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  video.muted = true;
  try {
    await video.play();
  } catch {
    stop();
    throw new ScannerError('unsupported', 'The camera preview could not start.');
  }

  const detect = await detector().catch(() => null);
  if (!detect || !context) {
    stop();
    throw new ScannerError('unsupported', 'QR scanning is not supported on this device.');
  }

  let busy = false;
  const tick = () => {
    if (stopped) return;
    frame = requestAnimationFrame(tick);
    // One decode at a time: a WASM pass can outlast a frame, and queueing them behind each
    // other turns a slow phone into an unresponsive one.
    if (busy || video.readyState < 2 || !video.videoWidth) return;
    busy = true;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    void detect.detect(canvas)
      .then((codes) => {
        if (stopped || !codes.length) return;
        const value = codes[0]?.rawValue;
        if (!value) return;
        stop();
        onResult(value);
      })
      .catch(() => undefined)
      .finally(() => { busy = false; });
  };
  frame = requestAnimationFrame(tick);

  return { stop };
}

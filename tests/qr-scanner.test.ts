// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScannerError, scanQr } from '../src/app/qr-scanner';

// The decode loop needs a real camera and a real frame, so it is covered by the two-device
// QA rather than here. What is worth pinning is the part that misbehaves quietly: which
// error a caller gets, and whether the camera is released when start fails part-way.

function video(): HTMLVideoElement {
  const element = document.createElement('video');
  element.play = async () => undefined;
  return element;
}

function stubMedia(getUserMedia: () => Promise<MediaStream>): void {
  vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('camera acquisition', () => {
  it('reports an unsupported browser rather than throwing something opaque', async () => {
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: undefined });
    await expect(scanQr(video(), () => {})).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('distinguishes a refused permission from a missing camera', async () => {
    // These need different copy: one is fixed in browser settings, the other cannot be
    // fixed at all, and telling someone to "allow camera access" on a device with no
    // camera sends them looking for a setting that is not there.
    stubMedia(async () => { throw Object.assign(new Error('no'), { name: 'NotAllowedError' }); });
    await expect(scanQr(video(), () => {})).rejects.toMatchObject({ code: 'denied' });

    stubMedia(async () => { throw Object.assign(new Error('no'), { name: 'NotFoundError' }); });
    await expect(scanQr(video(), () => {})).rejects.toMatchObject({ code: 'no_camera' });
  });

  it('releases the camera when start fails after the stream was granted', async () => {
    // The leak that matters: permission granted, then something later throws. Without a
    // stop here the camera light stays on behind a closed modal.
    const stopped: string[] = [];
    const track = { stop: () => stopped.push('stopped') } as unknown as MediaStreamTrack;
    stubMedia(async () => ({ getTracks: () => [track] }) as unknown as MediaStream);

    const element = video();
    element.play = async () => { throw new Error('autoplay blocked'); };
    await expect(scanQr(element, () => {})).rejects.toBeInstanceOf(ScannerError);
    expect(stopped).toHaveLength(1);
  });

  it('asks for the rear camera without demanding one', async () => {
    // `ideal`, not `exact`: a laptop with only a front camera should still scan rather
    // than fail outright.
    let constraints: MediaStreamConstraints | undefined;
    stubMedia(async (c?: MediaStreamConstraints) => {
      constraints = c;
      throw Object.assign(new Error('no'), { name: 'NotFoundError' });
    });
    await expect(scanQr(video(), () => {})).rejects.toMatchObject({ code: 'no_camera' });
    expect(constraints?.video).toMatchObject({ facingMode: { ideal: 'environment' } });
    expect(JSON.stringify(constraints)).not.toContain('exact');
  });
});

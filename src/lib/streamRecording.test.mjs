import assert from 'node:assert/strict';
import test from 'node:test';

const loadStreamRecording = async () => {
  try {
    return await import('./streamRecording.ts');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  }
};

test('builds the exact start payload from a normalized video URL', async () => {
  const { buildStreamRecordingPayload } = await loadStreamRecording();
  assert.equal(typeof buildStreamRecordingPayload, 'function', 'recording payload helper must exist');
  assert.deepEqual(buildStreamRecordingPayload('https://chaturbate.com/alice/'), {
    action: 'start',
    url: 'https://chaturbate.com/alice/',
  });
});

test('rejects non-HTTP, credentialed, and nonstandard-port recording URLs', async () => {
  const { buildStreamRecordingPayload } = await loadStreamRecording();
  assert.equal(typeof buildStreamRecordingPayload, 'function', 'recording payload helper must exist');
  assert.throws(() => buildStreamRecordingPayload('file:///etc/passwd'), /only_http_urls/);
  assert.throws(() => buildStreamRecordingPayload('https://user:secret@example.com/video.m3u8'), /url_credentials_not_allowed/);
  assert.throws(() => buildStreamRecordingPayload('https://example.com:8443/video.m3u8'), /nonstandard_port_not_allowed/);
});

test('allows only the Synced origin and localhost development origins', async () => {
  const { isAllowedStreamRecordingOrigin } = await loadStreamRecording();
  assert.equal(typeof isAllowedStreamRecordingOrigin, 'function', 'recording origin guard must exist');
  assert.equal(isAllowedStreamRecordingOrigin('https://synced.novec.online'), true);
  assert.equal(isAllowedStreamRecordingOrigin('http://localhost:3000'), true);
  assert.equal(isAllowedStreamRecordingOrigin('https://synced.novec.online.attacker.test'), false);
  assert.equal(isAllowedStreamRecordingOrigin(null), false);
});

test('tells users where a started recording will be stored', async () => {
  const { formatStreamRecordingLocationMessage } = await loadStreamRecording();
  assert.equal(typeof formatStreamRecordingLocationMessage, 'function', 'recording location helper must exist');
  assert.equal(
    formatStreamRecordingLocationMessage('job-123'),
    'Soubory se ukládají do ~/n8n-stream-downloads/. Po dokončení ve Finderu vyhledej ID úlohy: job-123.',
  );
});

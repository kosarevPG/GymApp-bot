import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './loadTs.mjs';

const { exerciseThumbnailUrl } = await loadTs('../src/exerciseImage.ts');
const BASE = 'https://storage.yandexcloud.net/gymapp-kpg-photos/exercises';

test('a catalogue GIF is listed by its static frame', () => {
  assert.equal(exerciseThumbnailUrl(`${BASE}/catalogue/20261104/abc.gif`), `${BASE}/catalogue/20261104/abc.thumb.webp`);
});

test('uploaded photos and foreign images keep their own address', () => {
  for (const url of [`${BASE}/1f2e.jpg`, `${BASE}/old.gif`, 'https://example.com/exercises/catalogue/a.gif', '']) {
    assert.equal(exerciseThumbnailUrl(url), url);
  }
});

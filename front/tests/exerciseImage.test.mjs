import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './loadTs.mjs';

const { exerciseThumbnailUrl } = await loadTs('../src/exerciseImage.ts');
const BASE = 'https://storage.yandexcloud.net/gymapp-kpg-photos/exercises';

test('a catalogue GIF is listed by its static frame next to it', () => {
  assert.equal(exerciseThumbnailUrl(`${BASE}/catalogue/20261104/abc.gif`), `${BASE}/catalogue/20261104/abc.thumb.webp`);
});

test('a GIF from another site is listed by its frame in the bucket', () => {
  assert.equal(
    exerciseThumbnailUrl('https://kosarevPG.github.io/GymApp/images/exercises/DB_LUNGE.gif'),
    `${BASE}/thumbs/kosarevpg.github.io/GymApp/images/exercises/DB_LUNGE.thumb.webp`,
  );
  assert.equal(
    exerciseThumbnailUrl('https://example.com/a%20b/Fly_360.GIF'),
    `${BASE}/thumbs/example.com/a%20b/Fly_360.thumb.webp`,
  );
});

test('photos, unsafe and unusual addresses keep their own address', () => {
  for (const url of [`${BASE}/1f2e.jpg`, 'https://example.com/a.png', 'http://example.com/a.gif',
    'https://example.com/a.gif?size=1', 'not a url', '']) {
    assert.equal(exerciseThumbnailUrl(url), url);
  }
});

// Committed test fixtures. PNG = 16x16 magenta; WAV/MP3/GIF via ffmpeg;
// OGG = pygame examples/data/house_lo.ogg (real Vorbis).
export { PNG_B64, WAV_B64, OGG_B64, MP3_B64, GIF_B64 } from './_fixtures.mjs';
export const buf = (b64) => Buffer.from(b64, 'base64');

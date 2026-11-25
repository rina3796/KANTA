import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
);

export type Kind = 'photo' | 'audio' | 'video';

export type MediaRow = {
  id: string; created_at: string; author: string; kind: Kind;
  bucket: 'guest-media' | 'private-wishes'; path: string; secs: number | null; is_private: boolean;
};

export const mediaUrl = (r: Pick<MediaRow, 'bucket' | 'path'>) =>
  supabase.storage.from(r.bucket).getPublicUrl(r.path).data.publicUrl;

// Shrink big phone photos picked from the gallery (max 2048px on the long edge, JPEG)
export async function compressImage(file: File, max = 2048): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('compress'))), 'image/jpeg', 0.88));
}

function extFor(kind: Kind, mime: string) {
  if (kind === 'photo') return 'jpg';
  if (kind === 'video') return mime.includes('mp4') ? 'mp4' : 'webm';
  return mime.includes('mp4') ? 'm4a' : 'webm';
}

export async function uploadMedia(
  blob: Blob,
  o: { author: string; kind: Kind; secs?: number; priv?: boolean },
) {
  const bucket = o.priv ? 'private-wishes' : 'guest-media';
  const path = `${crypto.randomUUID()}.${extFor(o.kind, blob.type)}`;
  const contentType = (blob.type || 'application/octet-stream').split(';')[0]; // drop ";codecs=..."
  const up = await supabase.storage.from(bucket).upload(path, blob, { contentType });
  if (up.error) throw up.error;
  const ins = await supabase.from('media').insert({
    author: o.author, kind: o.kind, bucket, path,
    secs: o.secs != null ? Math.min(30, Math.round(o.secs)) : null, is_private: !!o.priv,
  });
  if (ins.error) throw ins.error;
}

// Guests only ever receive non-private rows (enforced by the database, not the app)
export async function loadRemote() {
  const { data, error } = await supabase
    .from('media').select('*').eq('is_private', false)
    .order('created_at', { ascending: false }).limit(500);
  if (error) throw error;
  return (data as MediaRow[]).map(r => ({
    id: r.id, author: r.author, type: r.kind, url: mediaUrl(r), secs: r.secs ?? undefined,
    isFav: false, at: r.created_at,
  }));
}

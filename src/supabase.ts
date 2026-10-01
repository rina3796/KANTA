import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface MediaRow {
  id: string;
  created_at: string;
  author: string;
  kind: 'photo' | 'audio';
  bucket: 'guest-media' | 'private-wishes';
  path: string;
  is_private: boolean;
  secs?: number;
}

export function mediaUrl(row: MediaRow): string {
  const { data } = supabase.storage.from(row.bucket).getPublicUrl(row.path);
  return data.publicUrl;
}

export async function uploadMedia(
  file: Blob | File,
  meta: { author: string; kind: 'photo' | 'audio'; secs?: number; priv?: boolean }
) {
  const isPrivate = meta.priv ?? false;
  const bucket = isPrivate ? 'private-wishes' : 'guest-media';
  const ext = meta.kind === 'photo' ? 'jpg' : file.type.includes('mp4') ? 'm4a' : 'webm';
  const filename = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${ext}`;

  const { error: uploadErr } = await supabase.storage.from(bucket).upload(filename, file);
  if (uploadErr) throw uploadErr;

  const { error: dbErr } = await supabase.from('media').insert({
    author: meta.author,
    kind: meta.kind,
    bucket,
    path: filename,
    is_private: isPrivate,
    secs: meta.secs || null,
  });

  if (dbErr) throw dbErr;
}

export async function loadRemote() {
  const { data, error } = await supabase
    .from('media')
    .select('*')
    .eq('is_private', false)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data as MediaRow[]).map(row => ({
    id: row.id,
    author: row.author,
    type: row.kind,
    url: mediaUrl(row),
    isFav: false,
    secs: row.secs || undefined,
    priv: row.is_private,
  }));
}

export async function compressImage(file: File, maxWidth = 1280, quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      let { width, height } = img;

      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Failed to get canvas context'));

      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        blob => {
          if (blob) resolve(blob);
          else reject(new Error('Image compression failed'));
        },
        'image/jpeg',
        quality
      );
    };
    img.onerror = reject;
  });
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}
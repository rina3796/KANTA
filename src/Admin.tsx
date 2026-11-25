import React, { useCallback, useEffect, useState } from 'react';
import JSZip from 'jszip';
import { Download, Trash2, LogOut, Lock, Check } from 'lucide-react';
import { supabase, mediaUrl, type MediaRow } from './supabase';

type Tab = 'all' | 'photo' | 'video' | 'audio' | 'private';
const ext = (r: MediaRow) => r.path.split('.').pop() || 'bin';

export default function AdminDashboard() {
  const [session, setSession] = useState<any>(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<Tab>('all');
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('media').select('*').order('created_at', { ascending: false });
    if (error) { setMsg(error.message); return; }
    const list = (data || []) as MediaRow[];
    const map: Record<string, string> = {};
    list.filter(r => !r.is_private).forEach(r => { map[r.id] = mediaUrl(r); });
    const priv = list.filter(r => r.is_private);
    if (priv.length) {
      const { data: signed } = await supabase.storage.from('private-wishes')
        .createSignedUrls(priv.map(r => r.path), 3600);
      signed?.forEach((s, i) => { if (s.signedUrl) map[priv[i].id] = s.signedUrl; });
    }
    setRows(list); setUrls(map);
  }, []);

  useEffect(() => {
    if (!session) return;
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [session, load]);

  const login = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setMsg('Emel atau kata laluan salah.');
  };

  const zip = async (list: MediaRow[], name: string) => {
    if (!list.length || busy) return;
    const z = new JSZip();
    for (let i = 0; i < list.length; i++) {
      setBusy(`Menyediakan ${i + 1}/${list.length}…`);
      const r = list[i];
      try {
        const blob = await (await fetch(urls[r.id])).blob();
        const folder = r.kind === 'photo' ? 'gambar' : r.kind === 'video' ? 'video' : r.is_private ? 'suara-peribadi' : 'suara';
        z.file(`${folder}/${r.author.replace(/[^\w-]+/g, '_')}_${r.created_at.slice(0, 10)}_${r.id.slice(0, 6)}.${ext(r)}`, blob);
      } catch { /* skip a file that fails to download */ }
    }
    const out = await z.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(out); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    setBusy('');
  };

  const remove = async () => {
    if (!sel.length || !confirm(`Padam ${sel.length} item secara kekal?`)) return;
    const list = rows.filter(r => sel.includes(r.id));
    for (const b of ['guest-media', 'private-wishes'] as const) {
      const paths = list.filter(r => r.bucket === b).map(r => r.path);
      if (paths.length) await supabase.storage.from(b).remove(paths);
    }
    await supabase.from('media').delete().in('id', sel);
    setSel([]); load();
  };

  const toggle = (id: string) => setSel(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));

  if (!ready) return null;

  if (!session) {
    return (
      <div className="min-h-screen bg-[#f6efe2] flex items-center justify-center p-6">
        <form onSubmit={login} className="w-full max-w-sm bg-white rounded-2xl shadow-lg border border-[#e7dcc6] p-6 space-y-4">
          <div className="flex items-center gap-2 text-[#2b2622]">
            <Lock className="w-5 h-5" />
            <h1 className="font-serif text-xl font-bold">Papan pemuka pengantin</h1>
          </div>
          <input type="email" required placeholder="Emel" value={email} onChange={e => setEmail(e.target.value)}
            className="w-full border border-[#d9ccb2] rounded-lg px-3 py-2 text-sm text-[#2b2622]" />
          <input type="password" required placeholder="Kata laluan" value={password} onChange={e => setPassword(e.target.value)}
            className="w-full border border-[#d9ccb2] rounded-lg px-3 py-2 text-sm text-[#2b2622]" />
          {msg && <p className="text-xs text-rose-600">{msg}</p>}
          <button className="w-full py-2.5 rounded-full bg-[#2b2622] text-[#f5efe3] text-sm font-bold">Log masuk</button>
        </form>
      </div>
    );
  }

  const photos = rows.filter(r => r.kind === 'photo').length;
  const privates = rows.filter(r => r.is_private).length;
  const audios = rows.filter(r => r.kind === 'audio').length;
  const videos = rows.filter(r => r.kind === 'video').length;
  const shown = rows.filter(r =>
    tab === 'all' ? true : tab === 'photo' ? r.kind === 'photo' : tab === 'video' ? r.kind === 'video' : tab === 'audio' ? r.kind === 'audio' : r.is_private);
  const pill = (a: boolean) =>
    `px-4 py-1.5 rounded-full text-xs font-semibold border ${a ? 'bg-[#2b2622] text-[#f5efe3] border-[#2b2622]' : 'bg-white text-[#4a3f33] border-[#d9ccb2]'}`;

  return (
    <div className="min-h-screen bg-[#faf6ef] text-[#2b2622]">
      <header className="sticky top-0 z-10 bg-white border-b border-[#e7dcc6] px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="font-serif text-lg font-bold">Sarah & Syaiful</h1>
          <p className="text-xs text-[#8a7a62]">{photos} gambar · {videos} video · {audios} suara ({privates} peribadi)</p>
        </div>
        <button onClick={() => zip(rows, 'semua-kenangan.zip')} disabled={!!busy || !rows.length}
          className="px-4 py-2 rounded-full bg-[#2b2622] text-[#f5efe3] text-xs font-bold flex items-center gap-2 disabled:bg-[#b9ad98]">
          <Download className="w-4 h-4" /> Muat turun semua (zip)
        </button>
        <button onClick={() => supabase.auth.signOut()} aria-label="Log keluar"
          className="p-2 rounded-full border border-[#d9ccb2] bg-white"><LogOut className="w-4 h-4" /></button>
      </header>

      <div className="p-4 space-y-4 max-w-6xl mx-auto">
        <div className="flex flex-wrap items-center gap-2">
          {(['all', 'photo', 'video', 'audio', 'private'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} className={pill(tab === t)}>
              {{ all: 'Semua', photo: 'Gambar', video: 'Video', audio: 'Suara', private: 'Peribadi' }[t]}
            </button>
          ))}
          <span className="ml-auto text-xs text-[#6b5d4a]">{busy || `${sel.length} dipilih`}</span>
          <button onClick={() => setSel(sel.length === shown.length ? [] : shown.map(r => r.id))} className={pill(false)}>
            Pilih semua
          </button>
          <button onClick={() => zip(rows.filter(r => sel.includes(r.id)), 'pilihan.zip')} disabled={!sel.length || !!busy}
            className={`${pill(false)} disabled:opacity-40`}>Muat turun pilihan</button>
          <button onClick={remove} disabled={!sel.length}
            className="px-4 py-1.5 rounded-full text-xs font-semibold bg-rose-600 text-white disabled:opacity-40 flex items-center gap-1">
            <Trash2 className="w-3.5 h-3.5" /> Padam
          </button>
        </div>
        {msg && <p className="text-xs text-rose-600">{msg}</p>}
        {shown.length === 0 && <p className="text-center text-sm text-[#8a7a62] pt-16">Belum ada kandungan.</p>}

        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {shown.map(r => (
            <div key={r.id} onClick={() => toggle(r.id)}
              className={`relative rounded-xl overflow-hidden bg-white shadow-sm cursor-pointer ${sel.includes(r.id) ? 'ring-2 ring-[#c48a7c]' : ''}`}>
              <div className="aspect-[3/4] bg-stone-200 relative">
                {r.kind === 'photo' ? (
                  <img src={urls[r.id]} alt={`Gambar oleh ${r.author}`} loading="lazy" className="w-full h-full object-cover" />
                ) : r.kind === 'video' ? (
                  <video src={urls[r.id]} controls playsInline preload="metadata" className="w-full h-full object-cover bg-black" onClick={e => e.stopPropagation()} />
                ) : (
                  <div className="w-full h-full bg-[#2a2622] flex flex-col items-center justify-center gap-2 p-2" onClick={e => e.stopPropagation()}>
                    <audio controls src={urls[r.id]} className="w-full" />
                    <span className="text-[10px] font-mono text-stone-400">{r.secs ?? 0} SAAT</span>
                  </div>
                )}
                {r.is_private && (
                  <span className="absolute top-1.5 left-1.5 bg-rose-500 text-white rounded-full p-1"><Lock className="w-3 h-3" /></span>
                )}
                <span className={`absolute top-1.5 right-1.5 w-6 h-6 rounded-full border-2 flex items-center justify-center ${sel.includes(r.id) ? 'bg-[#c48a7c] border-[#c48a7c] text-white' : 'bg-black/30 border-white text-transparent'}`}>
                  <Check className="w-3.5 h-3.5" />
                </span>
              </div>
              <div className="p-1.5">
                <span className="font-serif italic text-[11px] font-semibold truncate block">{r.author}</span>
                <span className="text-[10px] text-[#8a7a62]">{new Date(r.created_at).toLocaleString('ms-MY', { dateStyle: 'short', timeStyle: 'short' })}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

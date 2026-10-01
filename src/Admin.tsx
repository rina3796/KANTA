import React, { useCallback, useEffect, useState } from 'react';
import JSZip from 'jszip';
import { Download, Trash2, LogOut, Lock, Check } from 'lucide-react';
import { supabase, mediaUrl, type MediaRow } from './supabase';

type Tab = 'all' | 'photo' | 'audio' | 'private';
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
        const folder = r.kind === 'photo' ? 'gambar' : r.is_private ? 'suara-peribadi' : 'suara';
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
      <div style={{ backgroundColor: '#F7F5ED', color: '#3E3832' }} className="min-h-screen flex items-center justify-center p-6">
        <form onSubmit={login} style={{ backgroundColor: '#FFFFFF', borderColor: '#EADCC2' }} className="w-full max-w-sm rounded-3xl shadow-xl border p-8 space-y-5">
          <div className="flex items-center gap-3">
            <div style={{ backgroundColor: '#EADCC2', color: '#3E3832' }} className="w-10 h-10 rounded-full flex items-center justify-center">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-serif text-xl font-bold">Pengantin Dashboard</h1>
              <p style={{ opacity: 0.7 }} className="text-xs">Sarah & Syaiful</p>
            </div>
          </div>
          <input type="email" required placeholder="Emel" value={email} onChange={e => setEmail(e.target.value)}
            style={{ borderColor: '#C8BEAD', backgroundColor: '#F7F5ED', color: '#3E3832' }}
            className="w-full border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#A8B39A]" />
          <input type="password" required placeholder="Kata laluan" value={password} onChange={e => setPassword(e.target.value)}
            style={{ borderColor: '#C8BEAD', backgroundColor: '#F7F5ED', color: '#3E3832' }}
            className="w-full border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#A8B39A]" />
          {msg && <p className="text-xs text-rose-600 font-semibold">{msg}</p>}
          <button style={{ backgroundColor: '#A8B39A', color: '#FFFFFF' }} className="w-full py-3 rounded-full text-sm font-bold shadow-md hover:brightness-105 transition-all">
            Log masuk
          </button>
        </form>
      </div>
    );
  }

  const photos = rows.filter(r => r.kind === 'photo').length;
  const privates = rows.filter(r => r.is_private).length;
  const audios = rows.filter(r => r.kind === 'audio').length;
  const shown = rows.filter(r =>
    tab === 'all' ? true : tab === 'photo' ? r.kind === 'photo' : tab === 'audio' ? r.kind === 'audio' : r.is_private);

  return (
    <div style={{ backgroundColor: '#F7F5ED', color: '#3E3832' }} className="min-h-screen">
      <header style={{ backgroundColor: '#FFFFFF', borderColor: '#EADCC2' }} className="sticky top-0 z-10 border-b px-6 py-4 flex flex-wrap items-center gap-3 shadow-xs">
        <div className="mr-auto">
          <h1 className="font-serif text-xl font-bold">Sarah & Syaiful</h1>
          <p style={{ opacity: 0.8 }} className="text-xs">{photos} gambar · {audios} suara ({privates} peribadi)</p>
        </div>
        <button onClick={() => zip(rows, 'semua-kenangan.zip')} disabled={!!busy || !rows.length}
          style={{ backgroundColor: '#A8B39A', color: '#FFFFFF' }}
          className="px-5 py-2.5 rounded-full text-xs font-bold flex items-center gap-2 shadow-xs hover:brightness-105 disabled:opacity-40">
          <Download className="w-4 h-4" /> Muat turun semua (zip)
        </button>
        <button onClick={() => supabase.auth.signOut()} aria-label="Log keluar"
          style={{ borderColor: '#C8BEAD', backgroundColor: '#FFFFFF', color: '#3E3832' }}
          className="p-2.5 rounded-full border hover:bg-stone-50"><LogOut className="w-4 h-4" /></button>
      </header>

      <div className="p-6 space-y-5 max-w-6xl mx-auto">
        <div className="flex flex-wrap items-center gap-2">
          {(['all', 'photo', 'audio', 'private'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={tab === t ? { backgroundColor: '#A8B39A', color: '#FFFFFF', borderColor: '#A8B39A' } : { backgroundColor: '#FFFFFF', color: '#3E3832', borderColor: '#C8BEAD' }}
              className="px-4 py-1.5 rounded-full text-xs font-semibold transition-all border shadow-xs">
              {{ all: 'Semua', photo: 'Gambar', audio: 'Suara', private: 'Peribadi' }[t]}
            </button>
          ))}
          <span style={{ opacity: 0.8 }} className="ml-auto text-xs font-semibold">{busy || `${sel.length} dipilih`}</span>
          <button onClick={() => setSel(sel.length === shown.length ? [] : shown.map(r => r.id))}
            style={{ backgroundColor: '#FFFFFF', color: '#3E3832', borderColor: '#C8BEAD' }}
            className="px-4 py-1.5 rounded-full text-xs font-semibold border shadow-xs">
            Pilih semua
          </button>
          <button onClick={() => zip(rows.filter(r => sel.includes(r.id)), 'pilihan.zip')} disabled={!sel.length || !!busy}
            style={{ backgroundColor: '#FFFFFF', color: '#3E3832', borderColor: '#C8BEAD' }}
            className="px-4 py-1.5 rounded-full text-xs font-semibold border shadow-xs disabled:opacity-40">Muat turun pilihan</button>
          <button onClick={remove} disabled={!sel.length}
            className="px-4 py-1.5 rounded-full text-xs font-semibold bg-rose-600 text-white disabled:opacity-40 flex items-center gap-1 shadow-xs">
            <Trash2 className="w-3.5 h-3.5" /> Padam
          </button>
        </div>
        {msg && <p className="text-xs text-rose-600 font-semibold">{msg}</p>}
        {shown.length === 0 && <p style={{ opacity: 0.6 }} className="text-center text-sm pt-16">Belum ada kandungan.</p>}

        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3.5">
          {shown.map(r => (
            <div key={r.id} onClick={() => toggle(r.id)}
              style={{ backgroundColor: '#FFFFFF', borderColor: '#EADCC2' }}
              className={`relative rounded-2xl overflow-hidden border shadow-xs cursor-pointer ${sel.includes(r.id) ? 'ring-2 ring-[#A8B39A]' : ''}`}>
              <div style={{ backgroundColor: '#F7F5ED' }} className="aspect-[3/4] relative">
                {r.kind === 'photo' ? (
                  <img src={urls[r.id]} alt={`Gambar oleh ${r.author}`} loading="lazy" className="w-full h-full object-cover" />
                ) : (
                  <div style={{ backgroundColor: '#3E3832' }} className="w-full h-full flex flex-col items-center justify-center gap-2 p-2" onClick={e => e.stopPropagation()}>
                    <audio controls src={urls[r.id]} className="w-full" />
                    <span style={{ color: '#EADCC2' }} className="text-[10px] font-mono">{r.secs ?? 0} SAAT</span>
                  </div>
                )}
                {r.is_private && (
                  <span style={{ backgroundColor: '#D4AF3A', color: '#FFFFFF' }} className="absolute top-1.5 left-1.5 rounded-full p-1 shadow-xs"><Lock className="w-3 h-3" /></span>
                )}
                <span style={sel.includes(r.id) ? { backgroundColor: '#A8B39A', borderColor: '#A8B39A', color: '#FFFFFF' } : { backgroundColor: 'rgba(0,0,0,0.3)', borderColor: '#FFFFFF' }}
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full border-2 flex items-center justify-center">
                  <Check className="w-3.5 h-3.5" />
                </span>
              </div>
              <div className="p-2">
                <span className="font-serif italic text-[11px] font-semibold truncate block">{r.author}</span>
                <span style={{ opacity: 0.7 }} className="text-[10px]">{new Date(r.created_at).toLocaleString('ms-MY', { dateStyle: 'short', timeStyle: 'short' })}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
import React, { useState, useEffect, useRef } from 'react';
import { Heart, Camera, ChevronLeft, Mic, Zap, Trash2, Image as ImageIcon, Play, Pause, Lock, RefreshCw, Check, Download } from 'lucide-react';

const COUPLE = 'Sarah & Syaiful';
const HASHTAG = '#SarahAndSyaiful';

// Watermark text built from the device's current date and time
const buildWatermark = (d: Date = new Date()) => {
  const day = d.getDate();
  const mon = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  const time = d
    .toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/\u202f/g, ' '); // newer browsers put a narrow no-break space before AM/PM
  return `SARAH & SYAIFUL #SARAHANDSYAIFUL 1.20 ${day} ${mon} ${d.getFullYear()} ${time}`;
};
const MAX_SECS = 30;

// css is used for both the live preview and the captured photo
const FILTERS = [
  { id: 'asal', name: 'Asal', css: 'contrast(1.05) brightness(0.95)' },
  { id: 'kodak', name: 'Kodak', css: 'sepia(0.3) contrast(1.15) saturate(1.3) brightness(1.05) hue-rotate(-5deg)' },
  { id: 'fuji', name: 'Fuji', css: 'contrast(1.2) saturate(1.25) hue-rotate(10deg) brightness(1.02)' },
  { id: 'noir', name: 'Noir', css: 'grayscale(1) contrast(1.35) brightness(0.95)' },
  { id: 'hangat', name: 'Hangat', css: 'sepia(0.4) saturate(1.4) contrast(1.1) brightness(1.1)' },
];
const U = (id: string) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&q=80&w=600`;

type Item = {
  id: string; author: string; type: 'photo' | 'audio'; url: string; isFav: boolean;
  secs?: number; priv?: boolean;
};

const INITIAL_GALLERY: Item[] = [
  { id: 'g1', author: 'Diana', type: 'photo', url: U('1519741497674-611481863552'), isFav: false },
  { id: 'g2', author: 'Diana', type: 'photo', url: U('1511285560929-80b456fea0bc'), isFav: false },
  { id: 'g3', author: 'Diana', type: 'photo', url: U('1583939003579-730e3918a45a'), isFav: false },
  { id: 'g4', author: 'Diana', type: 'photo', url: U('1532712938310-34cb3982ef74'), isFav: false },
  { id: 'g5', author: 'Diana', type: 'photo', url: U('1519225421980-715cb0215aed'), isFav: false },
  { id: 'g6', author: 'Kak Chik', type: 'photo', url: U('1520854221256-17451cc331bf'), isFav: false },
  { id: 'g7', author: 'Kak Chik', type: 'photo', url: U('1511795409834-ef04bbd61622'), isFav: false },
  { id: 'g8', author: 'Diana', type: 'photo', url: U('1465495976277-4387d4b0b4c6'), isFav: false },
  { id: 'g9', author: 'Kak Chik', type: 'photo', url: U('1519741497674-611481863552'), isFav: false },
];

// Draw the vertical retro watermark on the left edge of a canvas
function bakeWatermark(ctx: CanvasRenderingContext2D, w: number, h: number, text: string) {
  ctx.save();
  ctx.translate(Math.round(w * 0.1), h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.font = `bold ${Math.round(w * 0.03)}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ff5533';
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 4;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

export default function WeddingPhotoApp() {
  const [screen, setScreen] = useState<'camera' | 'gallery' | 'audio'>('camera');
  const [filter, setFilter] = useState<'ALL' | 'FAVOURITES' | 'WISHES'>('ALL');
  const [items, setItems] = useState<Item[]>(INITIAL_GALLERY);

  // Camera
  const [shots, setShots] = useState(12);
  const [mode, setMode] = useState<'BIASA' | 'LEBAR'>('BIASA');
  const [flash, setFlash] = useState(false);
  const [flashFx, setFlashFx] = useState(false);
  const [now, setNow] = useState(new Date());
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [filterId, setFilterId] = useState('asal');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Voice
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [priv, setPriv] = useState(false);
  const [guestName, setGuestName] = useState('Suraya');
  const [micError, setMicError] = useState('');
  const timerRef = useRef<any>(null);
  const secsRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Playback in gallery
  const [playingId, setPlayingId] = useState<string | null>(null);
  const playerRef = useRef<HTMLAudioElement | null>(null);

  const zoom = mode === 'BIASA' ? 1.25 : 1;
  const flt = FILTERS.find(f => f.id === filterId) || FILTERS[0];
  const watermark = buildWatermark(now);

  useEffect(() => {
    if (screen === 'camera') startCamera(); else stopCamera();
    return stopCamera;
  }, [screen, facing]);

  // keep the live viewfinder watermark in step with the clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => () => {
    clearInterval(timerRef.current);
    playerRef.current?.pause();
  }, []);

  const startCamera = async () => {
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 1920 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (e) {
      console.warn('Camera unavailable', e);
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  const takeSnap = () => {
    if (shots <= 0) return;
    if (flash) { setFlashFx(true); setTimeout(() => setFlashFx(false), 250); }

    const W = 720, H = 1280;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const v = videoRef.current;
    if (v && v.videoWidth) {
      // cover-fit the video into 9:16, then apply lens zoom (BIASA crops in, LEBAR stays wide)
      const target = W / H;
      let sw = v.videoWidth, sh = sw / target;
      if (sh > v.videoHeight) { sh = v.videoHeight; sw = sh * target; }
      sw /= zoom; sh /= zoom;
      ctx.filter = flt.css;
      ctx.save();
      if (facing === 'user') { ctx.translate(W, 0); ctx.scale(-1, 1); } // selfie is mirrored like the preview
      ctx.drawImage(v, (v.videoWidth - sw) / 2, (v.videoHeight - sh) / 2, sw, sh, 0, 0, W, H);
      ctx.restore();
      ctx.filter = 'none';
      ctx.fillStyle = 'rgba(120,53,15,0.10)';
      ctx.fillRect(0, 0, W, H);
    } else {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#44403c'); g.addColorStop(1, '#1c1917');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    bakeWatermark(ctx, W, H, buildWatermark()); // stamped with the moment the photo is taken

    setShots(n => n - 1);
    setItems(prev => [
      { id: `snap_${Date.now()}`, author: 'You', type: 'photo', url: canvas.toDataURL('image/jpeg', 0.92), isFav: false },
      ...prev,
    ]);
  };

  const uploadFromGallery = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        setItems(prev => [
          { id: `up_${Date.now()}_${Math.random()}`, author: 'You', type: 'photo', url: String(reader.result), isFav: false },
          ...prev,
        ]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const toggleFav = (id: string) => setItems(p => p.map(i => (i.id === id ? { ...i, isFav: !i.isFav } : i)));
  const removeItem = (id: string) => setItems(p => p.filter(i => i.id !== id));

  const togglePlay = (item: Item) => {
    if (!item.url) return;
    if (playingId === item.id) { playerRef.current?.pause(); setPlayingId(null); return; }
    playerRef.current?.pause();
    const a = new Audio(item.url);
    a.preload = 'auto';
    a.onended = () => setPlayingId(null);
    a.onerror = () => setPlayingId(null);
    a.play().catch(() => setPlayingId(null));
    playerRef.current = a;
    setPlayingId(item.id);
  };

  const finishRecording = () => {
    clearInterval(timerRef.current);
    setRecording(false);
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
  };

  const toggleRecord = async () => {
    if (recording) { finishRecording(); return; }
    setAudioUrl(null);
    setMicError('');
    secsRef.current = 0;
    setSecs(0);
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // pick a format this browser can both record and play back (webm on Chrome/Android, mp4 on Safari)
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(
        t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t));
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      rec.ondataavailable = e => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        setAudioUrl(URL.createObjectURL(new Blob(chunksRef.current, { type: rec.mimeType || mime || 'audio/webm' })));
      };
      rec.start();
      recorderRef.current = rec;
    } catch {
      recorderRef.current = null;
      setMicError('Mikrofon tidak dapat diakses. Benarkan akses mikrofon dan cuba lagi.');
      return; // no fake recording: nothing would be saved to play back
    }
    setRecording(true);
    timerRef.current = setInterval(() => {
      secsRef.current += 1;
      setSecs(secsRef.current);
      if (secsRef.current >= MAX_SECS) finishRecording();
    }, 1000);
  };

  const canSend = !recording && secs > 0 && !!audioUrl; // wait until the recording is finalised

  const sendVoice = () => {
    if (!canSend) return;
    setItems(p => [
      { id: `voice_${Date.now()}`, author: guestName.trim() || 'Tetamu', type: 'audio', url: audioUrl || '', isFav: false, secs, priv },
      ...p,
    ]);
    setSecs(0); secsRef.current = 0; setAudioUrl(null); setPriv(false);
    setFilter('WISHES');
    setScreen('gallery');
  };

  const exitSelect = () => { setSelectMode(false); setSelected([]); };
  const toggleSelect = (id: string) =>
    setSelected(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));

  const downloadSelected = async () => {
    const chosen = items.filter(i => selected.includes(i.id) && i.url);
    for (const it of chosen) {
      try {
        const blob = await (await fetch(it.url)).blob();
        const ext = it.type === 'photo' ? 'jpg' : blob.type.includes('mp4') ? 'm4a' : 'webm';
        const href = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = href;
        a.download = `sarah-syaiful_${it.author.replace(/\s+/g, '')}_${it.id}.${ext}`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 2000);
      } catch {
        window.open(it.url, '_blank'); // remote image blocked by CORS: open it so it can be saved manually
      }
      await new Promise(r => setTimeout(r, 300)); // browsers throttle rapid multi-downloads
    }
    exitSelect();
  };

  const visible = items.filter(i =>
    filter === 'ALL' ? true : filter === 'FAVOURITES' ? i.isFav : i.type === 'audio');
  const latestPhoto = items.find(i => i.type === 'photo');

  const pill = (active: boolean) =>
    `px-4 py-2 rounded-full transition-all whitespace-nowrap ${active ? 'bg-stone-900 text-white' : 'bg-white text-stone-600 border border-stone-200'}`;

  return (
    <div className="min-h-screen bg-stone-900 text-stone-100 flex justify-center font-sans">
      <div className="w-full max-w-md bg-black min-h-screen relative flex flex-col overflow-hidden shadow-2xl">

        {/* ============ SCREEN 1: CAMERA ============ */}
        {screen === 'camera' && (
          <div className="relative flex-1 flex flex-col justify-between p-4 bg-stone-950">
            <div className="absolute inset-0 z-0 overflow-hidden">
              <video
                ref={videoRef} autoPlay playsInline muted
                className="w-full h-full object-cover transition-transform duration-300"
                style={{ filter: flt.css, transform: `scale(${zoom}) ${facing === 'user' ? 'scaleX(-1)' : ''}` }}
              />
              <div className="absolute inset-0 bg-amber-900/10 mix-blend-color pointer-events-none" />
            </div>
            {flashFx && <div className="absolute inset-0 z-30 bg-white opacity-90 pointer-events-none" />}

            {/* Header */}
            <div className="relative z-10 flex flex-col items-center pt-2 text-center">
              <div className="w-full flex items-center justify-between px-2">
                <button onClick={() => setScreen('gallery')} aria-label="Galeri"
                  className="w-8 h-8 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white border border-white/20">
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="text-center">
                  <h1 className="font-serif text-lg font-bold tracking-wide text-white drop-shadow">
                    {COUPLE} <span className="font-sans text-xs font-normal opacity-80">{HASHTAG}</span>
                  </h1>
                  <p className="text-[10px] tracking-widest text-stone-300 uppercase font-mono">8 SEPTEMBER 2026</p>
                </div>
                <button onClick={() => setFacing(facing === 'user' ? 'environment' : 'user')} aria-label="Tukar kamera depan/belakang"
                  className="w-8 h-8 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white border border-white/20">
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-2 bg-black/40 backdrop-blur-md border border-white/20 px-4 py-0.5 rounded-full text-[10px] font-medium tracking-wider uppercase text-stone-200">
                DEWAN
              </div>
            </div>

            {/* Vertical live watermark */}
            <div className="absolute left-10 top-1/2 -translate-y-1/2 z-10 pointer-events-none origin-bottom-left -rotate-90">
              <p className="font-mono text-[11px] font-bold text-orange-500 tracking-wider drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] whitespace-nowrap opacity-90">
                {watermark}
              </p>
            </div>

            {/* Controls */}
            <div className="relative z-10 space-y-4 pb-4">
              <div className="flex items-center justify-between px-6">
                <button onClick={() => setFlash(!flash)} aria-label="Flash"
                  className={`p-2.5 rounded-full backdrop-blur-md border ${flash ? 'bg-amber-400 text-black border-amber-300' : 'bg-black/40 text-white border-white/20'}`}>
                  <Zap className="w-4 h-4" />
                </button>
                <div className="bg-black/50 backdrop-blur-md p-1 rounded-full border border-white/20 flex gap-1">
                  {(['LEBAR', 'BIASA'] as const).map(m => (
                    <button key={m} onClick={() => setMode(m)}
                      className={`px-4 py-1 rounded-full text-xs font-medium transition-all ${mode === m ? 'bg-white text-black font-bold' : 'text-stone-300'}`}>
                      {m}
                    </button>
                  ))}
                </div>
                <button onClick={() => setScreen('audio')} aria-label="Rakam suara"
                  className="p-2.5 rounded-full bg-black/40 backdrop-blur-md text-white border border-white/20">
                  <Mic className="w-4 h-4" />
                </button>
              </div>

              <div className="flex gap-2 overflow-x-auto px-6 justify-center">
                {FILTERS.map(f => (
                  <button key={f.id} onClick={() => setFilterId(f.id)}
                    className={`px-3 py-1 rounded-full text-[11px] font-medium shrink-0 backdrop-blur-md border transition-all ${filterId === f.id ? 'bg-white text-black font-bold border-white' : 'bg-black/40 text-stone-200 border-white/20'}`}>
                    {f.name}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-around px-4 pt-2">
                <div className="text-center">
                  <span className="text-2xl font-mono font-bold text-white block leading-none">{shots}</span>
                  <span className="text-[9px] font-mono tracking-widest text-stone-400 uppercase">LAGI</span>
                </div>

                <button onClick={takeSnap} disabled={shots <= 0} aria-label="Tangkap gambar"
                  className="w-20 h-20 rounded-full border-4 border-white/80 p-1 bg-black/20 backdrop-blur-sm active:scale-95 transition-transform disabled:opacity-40">
                  <div className="w-full h-full rounded-full bg-white shadow-inner flex items-center justify-center">
                    <div className="w-16 h-16 rounded-full border-2 border-stone-300" />
                  </div>
                </button>

                <button onClick={() => setScreen('gallery')} aria-label="Buka galeri"
                  className="w-12 h-12 rounded-xl border border-white/30 overflow-hidden bg-stone-800 shadow-md flex items-center justify-center">
                  {latestPhoto ? (
                    <img src={latestPhoto.url} alt="Gambar terkini" className="w-full h-full object-cover" />
                  ) : (
                    <ImageIcon className="w-6 h-6 text-stone-400" />
                  )}
                </button>
              </div>

              <div className="text-center pt-2">
                <label className="bg-black/60 backdrop-blur-md border border-white/20 px-6 py-2 rounded-full text-[11px] font-mono tracking-wider uppercase text-stone-200 cursor-pointer hover:bg-black/80 transition-colors inline-block">
                  UPLOAD DARI GALERI
                  <input type="file" accept="image/*" multiple className="hidden" onChange={uploadFromGallery} />
                </label>
              </div>
            </div>
          </div>
        )}

        {/* ============ SCREEN 2: GALLERY ============ */}
        {screen === 'gallery' && (
          <div className="flex-1 bg-[#f0f5f5] text-stone-900 flex flex-col">
            <div className="p-4 bg-[#f0f5f5] sticky top-0 z-20 border-b border-stone-200">
              <div className="flex items-center justify-between gap-2">
                <button onClick={() => setScreen('camera')} aria-label="Kamera"
                  className="w-8 h-8 shrink-0 rounded-full bg-stone-900 text-white flex items-center justify-center">
                  <Camera className="w-4 h-4" />
                </button>
                <div className="flex gap-1.5 text-[11px] font-semibold overflow-x-auto">
                  <button onClick={() => setFilter('ALL')} className={pill(filter === 'ALL')}>ALL</button>
                  <button onClick={() => setFilter('FAVOURITES')} className={`${pill(filter === 'FAVOURITES')} flex items-center gap-1`}>
                    FAVOURITES <span className="text-rose-400">♥</span> {items.filter(i => i.isFav).length}
                  </button>
                  <button onClick={() => setFilter('WISHES')} className={pill(filter === 'WISHES')}>WISHES</button>
                </div>
                <button onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
                  className="shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold border border-stone-300 bg-white text-stone-800">
                  {selectMode ? 'Batal' : 'Pilih'}
                </button>
              </div>
            </div>

            <div className="flex-1 p-3 overflow-y-auto">
              {visible.length === 0 && (
                <p className="text-center text-xs text-stone-500 pt-16">
                  {filter === 'WISHES' ? 'Belum ada ucapan suara.' : 'Belum ada gambar kegemaran.'}
                </p>
              )}
              <div className="grid grid-cols-3 gap-2.5">
                {visible.map(item => (
                  <div key={item.id} onClick={() => selectMode && toggleSelect(item.id)}
                    className={`relative rounded-xl overflow-hidden bg-white shadow-sm flex flex-col ${selectMode ? 'cursor-pointer' : ''} ${selected.includes(item.id) ? 'ring-2 ring-rose-500' : ''}`}>
                    <div className="aspect-[3/4] relative overflow-hidden bg-stone-200">
                      {selectMode && (
                        <div className={`absolute top-1.5 right-1.5 z-10 w-6 h-6 rounded-full border-2 flex items-center justify-center ${selected.includes(item.id) ? 'bg-rose-500 border-rose-500 text-white' : 'bg-black/30 border-white text-transparent'}`}>
                          <Check className="w-3.5 h-3.5" />
                        </div>
                      )}
                      {item.type === 'photo' ? (
                        <img src={item.url} alt={`Gambar oleh ${item.author}`} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-[#1f2022] flex flex-col items-center justify-center gap-2 p-2">
                          <div className="w-full bg-[#f2ebd9] rounded text-[8px] font-mono text-stone-800 px-1 py-0.5 truncate text-center">
                            {item.author}
                          </div>
                          <button onClick={() => togglePlay(item)} aria-label="Main ucapan"
                            className="w-9 h-9 rounded-full bg-gradient-to-r from-orange-500 to-rose-500 text-white flex items-center justify-center">
                            {playingId === item.id ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                          </button>
                          <span className="text-[9px] font-mono text-stone-400">{item.secs ?? 0} SAAT</span>
                          {item.priv && <Lock className="w-3 h-3 text-rose-300" />}
                        </div>
                      )}
                      <div className={`absolute top-1.5 left-1.5 right-1.5 flex justify-between items-center ${selectMode ? 'hidden' : ''}`}>
                        <button onClick={() => removeItem(item.id)} aria-label="Padam"
                          className="w-6 h-6 rounded-full bg-black/40 backdrop-blur-md text-white flex items-center justify-center hover:bg-rose-600 transition-colors">
                          <Trash2 className="w-3 h-3" />
                        </button>
                        <button onClick={() => toggleFav(item.id)} aria-label="Kegemaran"
                          className="w-6 h-6 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center">
                          <Heart className={`w-3.5 h-3.5 ${item.isFav ? 'fill-rose-500 text-rose-500' : 'text-white'}`} />
                        </button>
                      </div>
                    </div>
                    <div className="p-1.5 bg-white text-left">
                      <span className="font-serif italic text-[11px] text-stone-800 font-semibold truncate block">{item.author}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {selectMode && (
              <div className="p-3 bg-white border-t border-stone-200 flex items-center gap-2">
                <button onClick={() => setSelected(selected.length === visible.length ? [] : visible.map(i => i.id))}
                  className="px-4 py-2.5 rounded-full text-xs font-semibold border border-stone-300 text-stone-800">
                  {selected.length === visible.length && visible.length > 0 ? 'Nyahpilih semua' : 'Pilih semua'}
                </button>
                <button onClick={downloadSelected} disabled={selected.length === 0}
                  className={`flex-1 py-2.5 rounded-full text-xs font-bold text-white flex items-center justify-center gap-2 ${selected.length ? 'bg-stone-900' : 'bg-stone-400 cursor-not-allowed'}`}>
                  <Download className="w-4 h-4" /> Muat turun ({selected.length})
                </button>
              </div>
            )}
          </div>
        )}

        {/* ============ SCREEN 3: AUDIO CASSETTE ============ */}
        {screen === 'audio' && (
          <div className="flex-1 bg-[#fbf9f5] text-stone-900 flex flex-col justify-between p-6">
            <div>
              <button onClick={() => { if (recording) finishRecording(); setScreen('camera'); }}
                className="flex items-center gap-1 text-xs font-mono text-stone-500 uppercase tracking-widest hover:text-black">
                &lt; KEMBALI
              </button>
              <div className="mt-6 space-y-2">
                <h2 className="font-serif text-3xl font-bold text-stone-900">Rakam suara</h2>
                <p className="text-xs text-stone-600 leading-relaxed">
                  Untuk {COUPLE} {HASHTAG}. Paling lama 30 saat, jadi cakap yang penting sahaja.
                </p>
              </div>
            </div>

            <div className="my-auto py-6 space-y-8 flex flex-col items-center">
              <div className="w-full max-w-xs bg-[#1f2022] rounded-xl p-3 border-2 border-stone-800 shadow-2xl space-y-2">
                <div className="bg-[#f2ebd9] rounded-lg p-2 border border-stone-300 flex justify-between items-center text-xs font-mono gap-2">
                  <input value={guestName} onChange={e => setGuestName(e.target.value)} maxLength={20}
                    aria-label="Nama tetamu"
                    className="font-bold underline text-stone-800 bg-transparent outline-none w-28" />
                  <span className="text-[10px] text-stone-600 shrink-0">
                    {secs.toString().padStart(2, '0')} / {MAX_SECS} SAAT
                  </span>
                </div>

                <div className="bg-[#111214] rounded-lg p-4 flex items-center justify-around border border-stone-800">
                  {[0, 1].map(k => (
                    <div key={k}
                      className={`w-10 h-10 rounded-full border-4 border-stone-300 bg-stone-900 flex items-center justify-center ${recording ? 'animate-spin' : ''}`}>
                      <div className="w-3 h-3 rounded-full bg-white" />
                    </div>
                  ))}
                </div>
                {/* tape window sits between reels */}
                <div className="h-4 bg-gradient-to-r from-orange-500 via-amber-500 to-rose-500 rounded-b-lg" />
              </div>

              <div className="text-center space-y-2">
                <button onClick={toggleRecord} aria-label={recording ? 'Berhenti' : 'Mula rakam'}
                  className={`w-20 h-20 rounded-full border-4 p-1 transition-transform active:scale-90 ${recording ? 'border-rose-500 bg-rose-500/20' : 'border-orange-500 bg-transparent'}`}>
                  <div className={`w-full h-full rounded-full flex items-center justify-center ${recording ? 'bg-rose-500' : 'bg-black'}`}>
                    <div className={`bg-white ${recording ? 'w-6 h-6 rounded-sm' : 'w-6 h-6 rounded-full'}`} />
                  </div>
                </button>
                <p className="text-[10px] font-mono tracking-widest text-stone-500 uppercase">
                  {recording ? 'TEKAN UNTUK BERHENTI' : 'TEKAN UNTUK MULA'}
                </p>
                {micError && <p className="text-[11px] text-rose-600 max-w-[16rem] mx-auto">{micError}</p>}
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-[#ebd2d0]/40 rounded-2xl p-4 flex items-center justify-between border border-[#e8c0bd]/60">
                <div>
                  <h4 className="text-xs font-bold text-stone-800">Untuk pengantin sahaja</h4>
                  <p className="text-[11px] text-stone-500">Hanya pengantin yang dengar.</p>
                </div>
                <button onClick={() => setPriv(!priv)} role="switch" aria-checked={priv} aria-label="Untuk pengantin sahaja"
                  className={`w-12 h-6 rounded-full transition-colors p-1 flex items-center ${priv ? 'bg-rose-500 justify-end' : 'bg-stone-300 justify-start'}`}>
                  <div className="w-4 h-4 rounded-full bg-white shadow-md" />
                </button>
              </div>

              <button onClick={sendVoice} disabled={!canSend}
                className={`w-full py-4 text-white font-bold rounded-full shadow-lg text-sm transition-all ${canSend ? 'bg-stone-900 hover:bg-stone-700' : 'bg-stone-400 cursor-not-allowed'}`}>
                Hantar suara
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

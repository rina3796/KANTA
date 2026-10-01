import React, { useState, useEffect, useRef } from 'react';
import { uploadMedia, loadRemote, compressImage, dataUrlToBlob } from './supabase';
import { Heart, Camera, ChevronLeft, Mic, Zap, Trash2, Image as ImageIcon, Play, Pause, Lock, RefreshCw, Check, Download, ZoomIn } from 'lucide-react';

const COUPLE = 'Sarah & Syaiful';
const HASHTAG = '#KantaKita';

const buildWatermark = (d: Date = new Date()) => {
  const day = d.getDate();
  const mon = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  const time = d
    .toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/\u202f/g, ' ');
  return `#SARAH&SYAIFUL 17.04 ${day} ${mon} ${d.getFullYear()} ${time}`;
};
const MAX_SECS = 30;

const FILTERS = [
  { id: 'asal', name: 'Asal', css: 'contrast(1.05) brightness(0.95)' },
  { id: 'kodak', name: 'Kodak', css: 'sepia(0.3) contrast(1.15) saturate(1.3) brightness(1.05) hue-rotate(-5deg)' },
  { id: 'fuji', name: 'Fuji', css: 'contrast(1.2) saturate(1.25) hue-rotate(10deg) brightness(1.02)' },
  { id: 'noir', name: 'Noir', css: 'grayscale(1) contrast(1.35) brightness(0.95)' },
  { id: 'hangat', name: 'Hangat', css: 'sepia(0.4) saturate(1.4) contrast(1.1) brightness(1.1)' },
];

type Item = {
  id: string; author: string; type: 'photo' | 'audio'; url: string; isFav: boolean;
  secs?: number; priv?: boolean;
};

const readSet = (k: string) => {
  try { return new Set<string>(JSON.parse(localStorage.getItem(k) || '[]')); } catch { return new Set<string>(); }
};
const writeSet = (k: string, v: Set<string>) => {
  try { localStorage.setItem(k, JSON.stringify([...v])); } catch {}
};

function bakeWatermark(ctx: CanvasRenderingContext2D, w: number, h: number, text: string) {
  ctx.save();
  ctx.translate(Math.round(w * 0.08), h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.font = `bold ${Math.round(w * 0.032)}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#D4AF3A';
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 4;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

export default function WeddingPhotoApp() {
  const [screen, setScreen] = useState<'camera' | 'gallery' | 'audio'>('camera');
  const [filter, setFilter] = useState<'ALL' | 'FAVOURITES' | 'WISHES'>('ALL');
  const [items, setItems] = useState<Item[]>([]);

  // Camera
  const [shots, setShots] = useState(() => {
    const v = localStorage.getItem('shots_left');
    return v === null ? 12 : Math.max(0, Number(v) || 0);
  });
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [flash, setFlash] = useState(false);
  const [flashFx, setFlashFx] = useState(false);
  const [now, setNow] = useState(new Date());
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [filterId, setFilterId] = useState('asal');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isStartingRef = useRef(false);

  // Brightness state (1.0 = normal, 0.4 = dark, 1.6 = bright)
  const [brightness, setBrightness] = useState<number>(1.0);
  const [showBrightnessIndicator, setShowBrightnessIndicator] = useState(false);

  // Gesture tracking refs
  const touchStartRef = useRef<{
    dist: number;
    zoom: number;
    y: number;
    brightness: number;
  }>({ dist: 0, zoom: 1, y: 0, brightness: 1 });
  const brightnessTimerRef = useRef<any>(null);

  // Voice
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [priv, setPriv] = useState(false);
  const [guestName, setGuestName] = useState(() => localStorage.getItem('guest_name') || '');
  const [nameDraft, setNameDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');
  const [micError, setMicError] = useState('');
  const timerRef = useRef<any>(null);
  const secsRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Playback in gallery
  const [playingId, setPlayingId] = useState<string | null>(null);
  const playerRef = useRef<HTMLAudioElement | null>(null);

  const flt = FILTERS.find(f => f.id === filterId) || FILTERS[0];
  const watermark = buildWatermark(now);

  useEffect(() => {
    if (screen === 'camera') startCamera(); else stopCamera();
    return stopCamera;
  }, [screen, facing]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);

  const refresh = async () => {
    try {
      const remote = await loadRemote();
      const favs = readSet('favs'), hidden = readSet('hidden');
      setItems(prev => [
        ...prev.filter(i => i.id.startsWith('local_')),
        ...remote.filter(r => !hidden.has(r.id)).map(r => ({ ...r, isFav: favs.has(r.id) })),
      ]);
    } catch (e) { console.warn('Gagal muat galeri', e); }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 20000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { try { localStorage.setItem('shots_left', String(shots)); } catch {} }, [shots]);
  useEffect(() => { try { localStorage.setItem('guest_name', guestName); } catch {} }, [guestName]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 5000);
    return () => clearInterval(t);
  }, [notice]);

  useEffect(() => () => {
    clearInterval(timerRef.current);
    playerRef.current?.pause();
  }, []);

  const stopCamera = () => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => {
        t.stop();
        t.enabled = false;
      });
      streamRef.current = null;
    }
  };

  const applyHardwareZoom = (stream: MediaStream, level: number) => {
    const track = stream.getVideoTracks()[0];
    if (track && 'applyConstraints' in track) {
      const caps = (track.getCapabilities ? track.getCapabilities() : {}) as any;
      if (caps.zoom) {
        const minZ = caps.zoom.min || 1;
        const maxZ = caps.zoom.max || 5;
        const targetZoom = Math.min(Math.max(level, minZ), maxZ);
        track.applyConstraints({ advanced: [{ zoom: targetZoom }] as any }).catch(() => {});
      }
    }
  };

  const handleZoomChange = (newZoom: number) => {
    const validZoom = isNaN(newZoom) ? 1 : newZoom;
    setZoomLevel(validZoom);
    if (streamRef.current) {
      applyHardwareZoom(streamRef.current, validZoom);
    }
  };

  // Safe gesture distance calculation
  const getTouchDistance = (e: React.TouchEvent) => {
    if (!e.touches || e.touches.length < 2) return 0;
    const t1 = e.touches[0];
    const t2 = e.touches[1];
    return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dist = getTouchDistance(e);
      if (dist > 0) {
        touchStartRef.current.dist = dist;
        touchStartRef.current.zoom = zoomLevel || 1;
      }
    } else if (e.touches.length === 1 && e.touches[0]) {
      touchStartRef.current.y = e.touches[0].clientY;
      touchStartRef.current.brightness = brightness || 1;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Two fingers: Pinch-to-zoom
      const currentDist = getTouchDistance(e);
      const startDist = touchStartRef.current.dist;

      if (startDist > 0 && currentDist > 0) {
        const scale = currentDist / startDist;
        let newZoom = (touchStartRef.current.zoom || 1) * scale;

        if (!isNaN(newZoom)) {
          newZoom = Math.min(Math.max(1, newZoom), 4);
          handleZoomChange(Number(newZoom.toFixed(1)));
        }
      }
    } else if (e.touches.length === 1 && e.touches[0]) {
      // One finger: Vertical slide brightness
      const currentY = e.touches[0].clientY;
      const deltaY = touchStartRef.current.y - currentY;
      let newBrightness = (touchStartRef.current.brightness || 1) + deltaY / 250;

      if (!isNaN(newBrightness)) {
        newBrightness = Math.min(Math.max(0.4, newBrightness), 1.6);
        setBrightness(Number(newBrightness.toFixed(2)));
        setShowBrightnessIndicator(true);

        clearTimeout(brightnessTimerRef.current);
        brightnessTimerRef.current = setTimeout(() => {
          setShowBrightnessIndicator(false);
        }, 1200);
      }
    }
  };

  const startCamera = async () => {
    if (isStartingRef.current) return;
    isStartingRef.current = true;

    try {
      stopCamera();
      await new Promise(r => setTimeout(r, 500));

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setNotice('Akses kamera memerlukan sambungan HTTPS / localhost.');
        return;
      }

      let stream: MediaStream | null = null;

      const videoConstraints: MediaTrackConstraints = {
        facingMode: facing,
        aspectRatio: { ideal: 0.75 },
        width: { ideal: 720 },
        height: { ideal: 960 }
      };

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false
        });
      } catch {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoDevices = devices.filter(d => d.kind === 'videoinput');
          
          let targetDevice = videoDevices.find(d => 
            facing === 'user' 
              ? d.label.toLowerCase().includes('front') || d.label.toLowerCase().includes('user') || d.label.toLowerCase().includes('selfie')
              : d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('environment') || d.label.toLowerCase().includes('rear')
          );

          if (!targetDevice && videoDevices.length > 1) {
            targetDevice = facing === 'user' ? videoDevices[1] : videoDevices[0];
          }

          if (targetDevice && targetDevice.deviceId) {
            stream = await navigator.mediaDevices.getUserMedia({
              video: { deviceId: { exact: targetDevice.deviceId } },
              audio: false
            });
          } else {
            stream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: facing },
              audio: false
            });
          }
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
      }

      if (stream) {
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        applyHardwareZoom(stream, zoomLevel);
      }
    } catch (err: any) {
      console.error("Camera access error:", err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setNotice('Akses kamera ditolak. Sila benarkan akses kamera dalam tetapan pelayar anda.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setNotice('Kamera tidak ditemui pada peranti ini.');
      } else {
        setNotice('Kamera sibuk. Sila tekan butang tukar kamera sekali lagi.');
      }
    } finally {
      isStartingRef.current = false;
    }
  };

  const takeSnap = () => {
    if (shots <= 0) return;
    if (flash) { setFlashFx(true); setTimeout(() => setFlashFx(false), 250); }

    const W = 900, H = 1200;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const v = videoRef.current;
    if (v && v.videoWidth) {
      const target = W / H;
      let sw = v.videoWidth, sh = sw / target;
      if (sh > v.videoHeight) { sh = v.videoHeight; sw = sh * target; }
      sw /= zoomLevel; 
      sh /= zoomLevel;
      ctx.filter = `${flt.css} brightness(${brightness})`;
      ctx.save();
      if (facing === 'user') { ctx.translate(W, 0); ctx.scale(-1, 1); }
      ctx.drawImage(v, (v.videoWidth - sw) / 2, (v.videoHeight - sh) / 2, sw, sh, 0, 0, W, H);
      ctx.restore();
      ctx.filter = 'none';
      ctx.fillStyle = 'rgba(212, 175, 58, 0.08)';
      ctx.fillRect(0, 0, W, H);
    } else {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#F7F5ED'); g.addColorStop(1, '#EADCC2');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    bakeWatermark(ctx, W, H, buildWatermark());

    setShots(n => n - 1);
    const name = guestName.trim() || 'Tetamu';
    const localId = `local_${Date.now()}`;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    setItems(prev => [{ id: localId, author: name, type: 'photo', url: dataUrl, isFav: false }, ...prev]);
    dataUrlToBlob(dataUrl)
      .then(b => uploadMedia(b, { author: name, kind: 'photo' }))
      .then(() => { setItems(p => p.filter(i => i.id !== localId)); refresh(); })
      .catch(() => {
        setItems(p => p.filter(i => i.id !== localId));
        setNotice('Gambar gagal dihantar. Semak sambungan internet.');
      });
  };

  const uploadFromGallery = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    const name = guestName.trim() || 'Tetamu';
    for (const file of files) {
      try { await uploadMedia(await compressImage(file), { author: name, kind: 'photo' }); }
      catch { setNotice('Gambar gagal dihantar. Semak sambungan internet.'); }
    }
    refresh();
  };

  const toggleFav = (id: string) => {
    const f = readSet('favs');
    if (f.has(id)) f.delete(id); else f.add(id);
    writeSet('favs', f);
    setItems(p => p.map(i => (i.id === id ? { ...i, isFav: !i.isFav } : i)));
  };

  const removeItem = (id: string) => {
    const h = readSet('hidden'); h.add(id); writeSet('hidden', h);
    setItems(p => p.filter(i => i.id !== id));
  };

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
      return;
    }
    setRecording(true);
    timerRef.current = setInterval(() => {
      secsRef.current += 1;
      setSecs(secsRef.current);
      if (secsRef.current >= MAX_SECS) finishRecording();
    }, 1000);
  };

  const canSend = !recording && secs > 0 && !!audioUrl;

  const sendVoice = async () => {
    if (!canSend || !audioUrl || sending) return;
    setSending(true);
    try {
      const blob = await (await fetch(audioUrl)).blob();
      await uploadMedia(blob, { author: guestName.trim() || 'Tetamu', kind: 'audio', secs, priv });
      const wasPrivate = priv;
      setSecs(0); secsRef.current = 0; setAudioUrl(null); setPriv(false);
      setNotice(wasPrivate ? 'Ucapan suara dihantar kepada pengantin.' : 'Ucapan suara dihantar.');
      if (wasPrivate) { setScreen('camera'); }
      else { setFilter('WISHES'); await refresh(); setScreen('gallery'); }
    } catch {
      setNotice('Ucapan gagal dihantar. Cuba lagi.');
    }
    setSending(false);
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
        window.open(it.url, '_blank');
      }
      await new Promise(r => setTimeout(r, 300));
    }
    exitSelect();
  };

  const visible = items.filter(i =>
    filter === 'ALL' ? true : filter === 'FAVOURITES' ? i.isFav : i.type === 'audio');
  const latestPhoto = items.find(i => i.type === 'photo');

  return (
    <div style={{ backgroundColor: '#F7F5ED', color: '#3E3832' }} className="h-dvh w-full flex justify-center font-sans overflow-hidden">
      <div style={{ backgroundColor: '#FFFFFF', borderColor: '#C8BEAD' }} className="w-full max-w-md h-full relative flex flex-col justify-between overflow-hidden border-x">
        {notice && (
          <div role="status" onClick={() => setNotice('')}
            style={{ backgroundColor: '#3E3832', color: '#F7F5ED', borderColor: '#D4AF3A' }}
            className="absolute top-3 left-4 right-4 z-50 text-xs rounded-2xl px-4 py-3 border shadow-xl backdrop-blur-md">
            {notice}
          </div>
        )}

        {/* ============ SCREEN 1: CAMERA ============ */}
        {screen === 'camera' && (
          <div style={{ backgroundColor: '#F7F5ED' }} className="relative h-full flex flex-col justify-between p-3 overflow-hidden">
            
            {/* Header */}
            <div className="relative z-10 flex flex-col items-center pt-1 text-center">
              <div className="w-full flex items-center justify-between px-2">
                <button onClick={() => setScreen('gallery')} aria-label="Galeri"
                  style={{ backgroundColor: 'rgba(62, 56, 50, 0.1)', borderColor: '#C8BEAD', color: '#3E3832' }}
                  className="w-9 h-9 rounded-full backdrop-blur-md flex items-center justify-center border">
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="text-center">
                  <h1 className="font-serif text-base font-bold tracking-wide text-[#3E3832] leading-tight">
                    {COUPLE}
                    <span className="block font-sans text-[11px] font-normal opacity-80 mt-0.5">
                      {HASHTAG}
                    </span>
                  </h1>
                  <p style={{ color: '#D4AF3A' }} className="text-[9px] tracking-widest uppercase font-mono mt-0.5 font-bold">17 APR 2027</p>
                </div>
                <button onClick={() => setFacing(facing === 'user' ? 'environment' : 'user')} aria-label="Tukar kamera"
                  style={{ backgroundColor: 'rgba(62, 56, 50, 0.1)', borderColor: '#C8BEAD', color: '#3E3832' }}
                  className="w-9 h-9 rounded-full backdrop-blur-md flex items-center justify-center border">
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
              <div style={{ backgroundColor: '#FFFFFF', borderColor: '#C8BEAD', color: '#3E3832' }}
                className="mt-1 backdrop-blur-md border px-3 py-0.5 rounded-full text-[9px] font-semibold tracking-wider uppercase shadow-xs">
                Glass Hall by Lugar De La Boda
              </div>
            </div>

            {/* 3:4 CAMERA VIEWFINDER FRAME WITH INSTAGRAM-STYLE GESTURES */}
            <div className="relative my-auto w-full flex items-center justify-center">
              <div 
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                style={{ borderColor: '#C8BEAD' }} 
                className="relative w-full aspect-[3/4] max-h-[58vh] rounded-3xl overflow-hidden bg-stone-900 shadow-xl border-2 flex items-center justify-center touch-none select-none"
              >
                <video
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  muted
                  className={`w-full h-full transition-transform duration-300 ${
                    facing === 'user' ? 'object-cover scale-105' : 'object-cover'
                  }`}
                  style={{ 
                    filter: `${flt.css} brightness(${isNaN(brightness) ? 1 : brightness})`, 
                    transform: `scale(${isNaN(zoomLevel) ? 1 : zoomLevel}) ${facing === 'user' ? 'scaleX(-1)' : ''}` 
                  }}
                />
                <div style={{ backgroundColor: '#A8B39A', opacity: 0.08 }} className="absolute inset-0 mix-blend-color pointer-events-none" />
                
                {flashFx && <div style={{ backgroundColor: '#F7F5ED' }} className="absolute inset-0 z-30 opacity-90 pointer-events-none" />}

                {/* Instagram-style Brightness Indicator Popup */}
                {showBrightnessIndicator && (
                  <div className="absolute top-4 right-4 z-20 bg-black/60 backdrop-blur-md text-amber-300 px-3 py-1.5 rounded-full flex items-center gap-2 border border-amber-400/30 shadow-lg text-xs font-mono font-bold transition-opacity">
                    <span>☀️</span>
                    <span>{Math.round((isNaN(brightness) ? 1 : brightness) * 100)}%</span>
                  </div>
                )}

                {/* Vertical watermark overlay inside 3:4 viewfinder */}
                <div className="absolute left-4 bottom-4 z-10 pointer-events-none origin-bottom-left -rotate-90">
                  <p style={{ color: '#D4AF3A' }} className="font-mono text-[9px] font-bold tracking-wider drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] whitespace-nowrap opacity-90">
                    {watermark}
                  </p>
                </div>
              </div>
            </div>

            {!guestName.trim() && (
              <div style={{ backgroundColor: 'rgba(247, 245, 237, 0.95)' }} className="absolute inset-0 z-40 backdrop-blur-md flex items-center justify-center p-6">
                <div className="w-full max-w-xs space-y-4 text-center">
                  <span className="text-2xl">✨</span>
                  <h2 style={{ color: '#3E3832' }} className="font-serif text-2xl font-bold">Siapa nama anda?</h2>
                  <p style={{ color: '#3E3832', opacity: 0.8 }} className="text-xs">Nama ini akan tertera pada gambar & ucapan anda.</p>
                  <input value={nameDraft} onChange={e => setNameDraft(e.target.value)} maxLength={30} placeholder="cth. Kak Chik"
                    style={{ borderColor: '#C8BEAD', backgroundColor: '#FFFFFF', color: '#3E3832' }}
                    className="w-full rounded-xl border px-4 py-3 text-sm outline-none shadow-xs focus:ring-2" />
                  <button onClick={() => nameDraft.trim() && setGuestName(nameDraft.trim())} disabled={!nameDraft.trim()}
                    style={{ backgroundColor: '#A8B39A', color: '#FFFFFF' }}
                    className="w-full py-3.5 rounded-full text-sm font-bold shadow-md transition-all disabled:opacity-40 hover:brightness-105">
                    Mula Tangkap Kenangan
                  </button>
                </div>
              </div>
            )}

            {/* Controls */}
            <div className="relative z-10 space-y-2 pb-1">
              <div className="flex items-center justify-between px-2">
                <button onClick={() => setFlash(!flash)} aria-label="Flash"
                  style={flash ? { backgroundColor: '#D4AF3A', color: '#FFFFFF', borderColor: '#D4AF3A' } : { backgroundColor: '#FFFFFF', color: '#3E3832', borderColor: '#C8BEAD' }}
                  className="p-2 rounded-full border shadow-xs">
                  <Zap className="w-4 h-4" />
                </button>

                {/* Zoom buttons */}
                <div style={{ backgroundColor: '#FFFFFF', borderColor: '#C8BEAD' }} className="p-1 rounded-full border flex gap-1 items-center shadow-xs">
                  <ZoomIn className="w-3.5 h-3.5 ml-1 text-amber-700/70" />
                  {[1, 1.5, 2, 3].map(z => (
                    <button key={z} onClick={() => handleZoomChange(z)}
                      style={zoomLevel === z ? { backgroundColor: '#A8B39A', color: '#FFFFFF' } : { color: '#3E3832' }}
                      className="px-2.5 py-0.5 rounded-full text-xs font-bold transition-all">
                      {z}x
                    </button>
                  ))}
                </div>

                <button onClick={() => setScreen('audio')} aria-label="Rakam suara"
                  style={{ backgroundColor: '#FFFFFF', borderColor: '#C8BEAD', color: '#3E3832' }}
                  className="p-2 rounded-full border shadow-xs">
                  <Mic className="w-4 h-4" />
                </button>
              </div>

              <div className="flex gap-2 overflow-x-auto px-2 justify-center">
                {FILTERS.map(f => (
                  <button key={f.id} onClick={() => setFilterId(f.id)}
                    style={filterId === f.id ? { backgroundColor: '#A8B39A', color: '#FFFFFF', borderColor: '#A8B39A' } : { backgroundColor: '#FFFFFF', color: '#3E3832', borderColor: '#C8BEAD' }}
                    className="px-3 py-1 rounded-full text-[10px] font-semibold shrink-0 border transition-all shadow-xs">
                    {f.name}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-around px-4 pt-1">
                <div className="text-center">
                  <span style={{ color: '#D4AF3A' }} className="text-xl font-mono font-bold block leading-none">{shots}</span>
                  <span style={{ color: '#3E3832' }} className="text-[8px] font-mono tracking-widest uppercase opacity-70">LAGI</span>
                </div>

                <button onClick={takeSnap} disabled={shots <= 0} aria-label="Tangkap gambar"
                  style={{ borderColor: '#C8BEAD' }}
                  className="w-16 h-16 rounded-full border-4 p-1 bg-black/5 active:scale-95 transition-transform disabled:opacity-40 shadow-lg">
                  <div style={{ background: 'linear-gradient(to top right, #EADCC2, #A8B39A)' }} className="w-full h-full rounded-full shadow-inner flex items-center justify-center">
                    <div style={{ borderColor: 'rgba(212, 175, 58, 0.6)' }} className="w-12 h-12 rounded-full border-2" />
                  </div>
                </button>

                <button onClick={() => setScreen('gallery')} aria-label="Buka galeri"
                  style={{ borderColor: '#C8BEAD', backgroundColor: '#FFFFFF' }}
                  className="w-11 h-11 rounded-xl border overflow-hidden shadow-md flex items-center justify-center">
                  {latestPhoto ? (
                    <img src={latestPhoto.url} alt="Gambar terkini" className="w-full h-full object-cover" />
                  ) : (
                    <ImageIcon style={{ color: '#A8B39A' }} className="w-5 h-5" />
                  )}
                </button>
              </div>

              <div className="text-center pt-0.5">
                <label style={{ backgroundColor: '#FFFFFF', borderColor: '#C8BEAD', color: '#3E3832' }}
                  className="border px-5 py-1.5 rounded-full text-[10px] font-semibold tracking-wider uppercase cursor-pointer hover:bg-stone-50 transition-colors inline-block shadow-xs">
                  NAIK GAMBAR DARI GALERI
                  <input type="file" accept="image/*" multiple className="hidden" onChange={uploadFromGallery} />
                </label>
              </div>
            </div>
          </div>
        )}

        {/* ============ SCREEN 2: GALLERY ============ */}
        {screen === 'gallery' && (
          <div style={{ backgroundColor: '#F7F5ED', color: '#3E3832' }} className="h-full flex flex-col overflow-hidden">
            <div style={{ backgroundColor: '#FFFFFF', borderColor: '#EADCC2' }} className="p-3 border-b shadow-xs shrink-0">
              <div className="flex items-center justify-between gap-2">
                <button onClick={() => setScreen('camera')} aria-label="Kamera"
                  style={{ backgroundColor: '#A8B39A', color: '#FFFFFF' }}
                  className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center shadow-xs">
                  <Camera className="w-4 h-4" />
                </button>
                <div className="flex gap-1.5 text-[11px] font-semibold overflow-x-auto">
                  <button onClick={() => setFilter('ALL')}
                    style={filter === 'ALL' ? { backgroundColor: '#A8B39A', color: '#FFFFFF' } : { backgroundColor: '#FFFFFF', color: '#3E3832', borderColor: '#C8BEAD' }}
                    className="px-3.5 py-1.5 rounded-full border transition-all whitespace-nowrap">ALL</button>
                  <button onClick={() => setFilter('FAVOURITES')}
                    style={filter === 'FAVOURITES' ? { backgroundColor: '#A8B39A', color: '#FFFFFF' } : { backgroundColor: '#FFFFFF', color: '#3E3832', borderColor: '#C8BEAD' }}
                    className="px-3 py-1.5 rounded-full border transition-all whitespace-nowrap flex items-center gap-1">
                    FAVOURITES <span style={{ color: '#D4AF3A' }}>♥</span> {items.filter(i => i.isFav).length}
                  </button>
                  <button onClick={() => setFilter('WISHES')}
                    style={filter === 'WISHES' ? { backgroundColor: '#A8B39A', color: '#FFFFFF' } : { backgroundColor: '#FFFFFF', color: '#3E3832', borderColor: '#C8BEAD' }}
                    className="px-3.5 py-1.5 rounded-full border transition-all whitespace-nowrap">WISHES</button>
                </div>
                <button onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
                  style={{ borderColor: '#C8BEAD', backgroundColor: '#FFFFFF', color: '#3E3832' }}
                  className="shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold border shadow-xs">
                  {selectMode ? 'Batal' : 'Pilih'}
                </button>
              </div>
            </div>

            <div className="flex-1 p-3 overflow-y-auto min-h-0">
              {visible.length === 0 && (
                <p style={{ color: '#3E3832', opacity: 0.7 }} className="text-center text-xs pt-16">
                  {filter === 'WISHES' ? 'Belum ada ucapan suara.' : 'Belum ada gambar kegemaran.'}
                </p>
              )}
              <div className="grid grid-cols-3 gap-2">
                {visible.map(item => (
                  <div key={item.id} onClick={() => selectMode && toggleSelect(item.id)}
                    style={{ backgroundColor: '#FFFFFF', borderColor: '#EADCC2' }}
                    className={`relative rounded-2xl overflow-hidden border shadow-xs flex flex-col ${selectMode ? 'cursor-pointer' : ''} ${selected.includes(item.id) ? 'ring-2 ring-[#A8B39A]' : ''}`}>
                    <div style={{ backgroundColor: '#F7F5ED' }} className="aspect-[3/4] relative overflow-hidden">
                      {selectMode && (
                        <div style={selected.includes(item.id) ? { backgroundColor: '#A8B39A', borderColor: '#A8B39A', color: '#FFFFFF' } : { backgroundColor: 'rgba(0,0,0,0.3)', borderColor: '#FFFFFF' }}
                          className="absolute top-1.5 right-1.5 z-10 w-5 h-5 rounded-full border-2 flex items-center justify-center">
                          <Check className="w-3 h-3" />
                        </div>
                      )}
                      {item.type === 'photo' ? (
                        <img src={item.url} alt={`Gambar oleh ${item.author}`} className="w-full h-full object-cover" />
                      ) : (
                        <div style={{ backgroundColor: '#3E3832' }} className="w-full h-full flex flex-col items-center justify-center gap-1.5 p-2">
                          <div style={{ backgroundColor: '#F7F5ED', color: '#3E3832' }} className="w-full rounded text-[8px] font-mono px-1 py-0.5 truncate text-center font-bold">
                            {item.author}
                          </div>
                          <button onClick={() => togglePlay(item)} aria-label="Main ucapan"
                            style={{ backgroundColor: '#D4AF3A', color: '#FFFFFF' }}
                            className="w-8 h-8 rounded-full flex items-center justify-center shadow-md">
                            {playingId === item.id ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
                          </button>
                          <span style={{ color: '#EADCC2' }} className="text-[8px] font-mono">{item.secs ?? 0} SAAT</span>
                          {item.priv && <Lock style={{ color: '#D4AF3A' }} className="w-3 h-3" />}
                        </div>
                      )}
                      <div className={`absolute top-1.5 left-1.5 right-1.5 flex justify-between items-center ${selectMode ? 'hidden' : ''}`}>
                        <button onClick={() => removeItem(item.id)} aria-label="Padam"
                          className="w-5 h-5 rounded-full bg-black/40 backdrop-blur-md text-white flex items-center justify-center hover:bg-rose-600 transition-colors">
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                        <button onClick={() => toggleFav(item.id)} aria-label="Kegemaran"
                          className="w-5 h-5 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center">
                          <Heart className={`w-3 h-3 ${item.isFav ? 'fill-[#D4AF3A] text-[#D4AF3A]' : 'text-white'}`} />
                        </button>
                      </div>
                    </div>
                    <div className="p-1.5 bg-white text-left">
                      <span style={{ color: '#3E3832' }} className="font-serif italic text-[10px] font-semibold truncate block">{item.author}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {selectMode && (
              <div style={{ backgroundColor: '#FFFFFF', borderColor: '#EADCC2' }} className="p-3 border-t flex items-center gap-2 shadow-lg shrink-0">
                <button onClick={() => setSelected(selected.length === visible.length ? [] : visible.map(i => i.id))}
                  style={{ borderColor: '#C8BEAD', color: '#3E3832' }}
                  className="px-3.5 py-2 rounded-full text-xs font-semibold border">
                  {selected.length === visible.length && visible.length > 0 ? 'Nyahpilih semua' : 'Pilih semua'}
                </button>
                <button onClick={downloadSelected} disabled={selected.length === 0}
                  style={selected.length ? { backgroundColor: '#A8B39A', color: '#FFFFFF' } : { backgroundColor: '#C8BEAD', color: '#3E3832', opacity: 0.5 }}
                  className="flex-1 py-2 rounded-full text-xs font-bold flex items-center justify-center gap-2 shadow-md">
                  <Download className="w-4 h-4" /> Muat turun ({selected.length})
                </button>
              </div>
            )}
          </div>
        )}

        {/* ============ SCREEN 3: AUDIO CASSETTE ============ */}
        {screen === 'audio' && (
          <div style={{ backgroundColor: '#F7F5ED', color: '#3E3832' }} className="h-full flex flex-col justify-between p-5 overflow-y-auto">
            <div>
              <button onClick={() => { if (recording) finishRecording(); setScreen('camera'); }}
                style={{ color: '#3E3832' }} className="flex items-center gap-1 text-xs font-mono font-semibold uppercase tracking-widest opacity-80 hover:opacity-100">
                &lt; KEMBALI
              </button>
              <div className="mt-4 space-y-1">
                <h2 style={{ color: '#3E3832' }} className="font-serif text-2xl font-bold">Rakam suara</h2>
                <p style={{ color: '#3E3832', opacity: 0.8 }} className="text-xs leading-relaxed">
                  Untuk {COUPLE} {HASHTAG}. Paling lama 30 saat, jadi cakap yang penting sahaja.
                </p>
              </div>
            </div>

            <div className="my-auto py-4 space-y-6 flex flex-col items-center">
              <div style={{ backgroundColor: '#3E3832', borderColor: '#D4AF3A' }} className="w-full max-w-xs rounded-2xl p-3 border-2 shadow-xl space-y-2">
                <div style={{ backgroundColor: '#F7F5ED', borderColor: '#EADCC2' }} className="rounded-xl p-2 border flex justify-between items-center text-xs font-mono gap-2">
                  <input value={guestName} onChange={e => setGuestName(e.target.value)} maxLength={20}
                    aria-label="Nama tetamu"
                    style={{ color: '#3E3832' }}
                    className="font-bold underline bg-transparent outline-none w-28" />
                  <span style={{ color: '#3E3832', opacity: 0.8 }} className="text-[10px] shrink-0 font-bold">
                    {secs.toString().padStart(2, '0')} / {MAX_SECS} SAAT
                  </span>
                </div>

                <div style={{ backgroundColor: '#2B2622' }} className="rounded-xl p-3.5 flex items-center justify-around border border-amber-900/30">
                  {[0, 1].map(k => (
                    <div key={k}
                      style={{ borderColor: '#D4AF3A', backgroundColor: '#3E3832' }}
                      className={`w-9 h-9 rounded-full border-4 flex items-center justify-center ${recording ? 'animate-spin' : ''}`}>
                      <div style={{ backgroundColor: '#F7F5ED' }} className="w-2.5 h-2.5 rounded-full" />
                    </div>
                  ))}
                </div>
                <div style={{ background: 'linear-gradient(to right, #EADCC2, #D4AF3A, #A8B39A)' }} className="h-2.5 rounded-b-lg" />
              </div>

              <div className="text-center space-y-2">
                <button onClick={toggleRecord} aria-label={recording ? 'Berhenti' : 'Mula rakam'}
                  style={recording ? { borderColor: '#E11D48', backgroundColor: 'rgba(225, 29, 72, 0.2)' } : { borderColor: '#A8B39A', backgroundColor: '#EADCC2' }}
                  className="w-16 h-16 rounded-full border-4 p-1 transition-transform active:scale-90 shadow-md">
                  <div style={{ backgroundColor: recording ? '#E11D48' : '#A8B39A' }} className="w-full h-full rounded-full flex items-center justify-center">
                    <div style={{ backgroundColor: '#FFFFFF' }} className={recording ? 'w-5 h-5 rounded-sm' : 'w-5 h-5 rounded-full'} />
                  </div>
                </button>
                <p style={{ color: '#3E3832' }} className="text-[9px] font-mono tracking-widest uppercase font-semibold">
                  {recording ? 'TEKAN UNTUK BERHENTI' : 'TEKAN UNTUK MULA'}
                </p>
                {micError && <p className="text-[11px] text-rose-600 max-w-[16rem] mx-auto">{micError}</p>}
              </div>
            </div>

            <div className="space-y-3">
              <div style={{ backgroundColor: '#FFFFFF', borderColor: '#EADCC2' }} className="rounded-2xl p-3 flex items-center justify-between border shadow-xs">
                <div>
                  <h4 style={{ color: '#3E3832' }} className="text-xs font-bold">Untuk pengantin sahaja</h4>
                  <p style={{ color: '#3E3832', opacity: 0.7 }} className="text-[10px]">Hanya pengantin yang dengar.</p>
                </div>
                <button onClick={() => setPriv(!priv)} role="switch" aria-checked={priv} aria-label="Untuk pengantin sahaja"
                  style={{ backgroundColor: priv ? '#A8B39A' : '#C8BEAD' }}
                  className="w-11 h-5.5 rounded-full transition-colors p-0.5 flex items-center justify-start">
                  <div style={{ transform: priv ? 'translateX(22px)' : 'translateX(0)' }} className="w-4 h-4 rounded-full bg-white shadow-md transition-transform" />
                </button>
              </div>

              <button onClick={sendVoice} disabled={!canSend || sending}
                style={canSend ? { backgroundColor: '#A8B39A', color: '#FFFFFF' } : { backgroundColor: '#C8BEAD', color: '#3E3832', opacity: 0.5 }}
                className="w-full py-3 font-bold rounded-full shadow-md text-xs transition-all">
                {sending ? 'Menghantar…' : 'Hantar suara'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
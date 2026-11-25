import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import type { ChangeEvent, PointerEvent as RPointerEvent, TouchEvent as RTouchEvent, ReactNode } from 'react';
import {
  Heart, Camera, Mic, Zap, ZapOff, Trash2, Play, Pause, Lock, Check, Download, Upload, SwitchCamera,
  Images, Sun, Film, X, ChevronLeft, ChevronRight, RotateCcw, Loader2, CircleAlert, Square,
} from 'lucide-react';
import { uploadMedia, loadRemote, compressImage } from './supabase';
import { putJob, deleteJob, allJobs } from './queue';
import type { Job } from './queue';
import { STR, fmt } from './i18n';
import type { Lang } from './i18n';

/* ------------------------------------------------------------------ */
/*  Settings you may want to change                                    */
/* ------------------------------------------------------------------ */
const COUPLE = 'Sarah & Syaiful';
const HASHTAG = '#KantaKita';
const EVENT_DATE = '17 April 2027';
const EVENT_DATE_SHORT = '17 Apr 2027';
const VENUE = 'Glass Hall by Lugar De La Boda';
const VENUE_SHORT = 'Glass Hall';

const MAX_SHOTS = 12;          // film roll size
const MAX_SECS = 30;           // voice note length
const VIDEO_MAX = 15;          // video clip length (seconds)
const VIDEO_COST = 1;          // how many shots one video uses
const PHOTO_W = 1080;          // saved photos/videos are 3:4 Full HD class (1080 x 1440)
const PHOTO_H = 1440;
const VIDEO_BITRATE = 5_000_000;
const PORTRAIT = { r: 0.36, solid: 0.55 }; // size of the sharp area in Portrait mode
const RATIO = 3 / 4;
const MAX_DIGITAL_ZOOM = 4;

const buildWatermark = (d: Date = new Date()) => {
  const day = d.getDate();
  const mon = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  const time = d
    .toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/ /g, ' ');
  return `#SARAH&SYAIFUL 17.04 ${day} ${mon} ${d.getFullYear()} ${time}`;
};

const FILTERS = [
  { id: 'asal', name: { ms: 'Asal', en: 'Natural' }, css: 'contrast(1.05) brightness(0.95)' },
  { id: 'kodak', name: { ms: 'Kodak', en: 'Kodak' }, css: 'sepia(0.3) contrast(1.15) saturate(1.3) brightness(1.05) hue-rotate(-5deg)' },
  { id: 'fuji', name: { ms: 'Fuji', en: 'Fuji' }, css: 'contrast(1.2) saturate(1.25) hue-rotate(10deg) brightness(1.02)' },
  { id: 'noir', name: { ms: 'Noir', en: 'Noir' }, css: 'grayscale(1) contrast(1.35) brightness(0.95)' },
  { id: 'hangat', name: { ms: 'Hangat', en: 'Warm' }, css: 'sepia(0.4) saturate(1.4) contrast(1.1) brightness(1.1)' },
];

// Prefer MP4/AAC: it also plays on iPhones, unlike WebM on older iOS versions
const VIDEO_MIMES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'];
const AUDIO_MIMES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];

/* ------------------------------------------------------------------ */
/*  Types and small helpers                                            */
/* ------------------------------------------------------------------ */
type Item = {
  id: string; author: string; type: 'photo' | 'video' | 'audio'; url: string; isFav: boolean;
  secs?: number; priv?: boolean; at?: string; status?: 'uploading' | 'failed';
};
type Mode = 'photo' | 'portrait' | 'video';
type Live = { zoom: number; mirror: boolean; filter: string; portrait: boolean; fx: number; fy: number };
type Buffers = { blur: HTMLCanvasElement; sharp: HTMLCanvasElement };

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const pad = (n: number) => n.toString().padStart(2, '0');
const readSet = (k: string) => {
  try { return new Set<string>(JSON.parse(localStorage.getItem(k) || '[]')); } catch { return new Set<string>(); }
};
const writeSet = (k: string, v: Set<string>) => {
  try { localStorage.setItem(k, JSON.stringify([...v])); } catch { /* storage unavailable */ }
};
const pickMime = (list: string[]) =>
  typeof MediaRecorder === 'undefined' ? undefined : list.find(m => MediaRecorder.isTypeSupported(m));

function bakeWatermark(ctx: CanvasRenderingContext2D, w: number, h: number, text: string) {
  ctx.save();
  ctx.translate(Math.round(w * 0.08), h / 2); // same spot as the live preview
  ctx.rotate(-Math.PI / 2);
  ctx.font = `bold ${Math.round(w * 0.032)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#E8C766';
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 4;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

// One drawing routine for photos AND video frames, so the saved result matches the preview
function drawFrame(
  ctx: CanvasRenderingContext2D, v: HTMLVideoElement, W: number, H: number,
  o: Live, buf: Buffers, stamp: string,
) {
  const vw = v.videoWidth, vh = v.videoHeight;
  const target = W / H;
  let sw = vw, sh = sw / target;
  if (sh > vh) { sh = vh; sw = sh * target; }
  sw /= o.zoom; sh /= o.zoom;
  const sx = (vw - sw) / 2, sy = (vh - sh) / 2;

  const paint = (c: CanvasRenderingContext2D, w: number, h: number) => {
    c.save();
    c.filter = o.filter;
    if (o.mirror) { c.translate(w, 0); c.scale(-1, 1); }
    c.drawImage(v, sx, sy, sw, sh, 0, 0, w, h);
    c.restore();
  };

  if (o.portrait) {
    // soft background: draw small, scale up (cheap blur that works in every browser)
    const bw = Math.round(W / 8), bh = Math.round(H / 8);
    if (buf.blur.width !== bw) { buf.blur.width = bw; buf.blur.height = bh; }
    if (buf.sharp.width !== W) { buf.sharp.width = W; buf.sharp.height = H; }
    const bctx = buf.blur.getContext('2d')!;
    bctx.imageSmoothingQuality = 'high';
    paint(bctx, bw, bh);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(buf.blur, 0, 0, bw, bh, 0, 0, W, H);

    // sharp subject: full-res frame faded out around the tapped point
    const sctx = buf.sharp.getContext('2d')!;
    sctx.globalCompositeOperation = 'source-over';
    sctx.clearRect(0, 0, W, H);
    paint(sctx, W, H);
    sctx.globalCompositeOperation = 'destination-in';
    const cx = o.fx * W, cy = o.fy * H, r1 = PORTRAIT.r * W;
    const g = sctx.createRadialGradient(cx, cy, r1 * PORTRAIT.solid, cx, cy, r1);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    sctx.fillStyle = g;
    sctx.fillRect(0, 0, W, H);
    sctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(buf.sharp, 0, 0);
  } else {
    paint(ctx, W, H);
  }
  bakeWatermark(ctx, W, H, stamp);
}

const resFor = (long: number, short: number): MediaTrackConstraints => {
  const portrait = window.innerHeight >= window.innerWidth;
  return portrait ? { width: { ideal: short }, height: { ideal: long } } : { width: { ideal: long }, height: { ideal: short } };
};

// Ask for Full HD; the browser gives the best the phone supports
async function acquireStream(facing: 'environment' | 'user'): Promise<MediaStream> {
  const attempts: MediaStreamConstraints[] = [
    { video: { facingMode: { ideal: facing }, ...resFor(1920, 1080), frameRate: { ideal: 30 } }, audio: false },
    { video: { facingMode: { ideal: facing } }, audio: false },
    { video: true, audio: false },
  ];
  let last: unknown;
  for (const c of attempts) {
    try { return await navigator.mediaDevices.getUserMedia(c); }
    catch (e) {
      last = e;
      const n = (e as DOMException)?.name;
      if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError') throw e;
    }
  }
  throw last;
}

async function upgradeResolution(track: MediaStreamTrack) {
  const short = () => { const s = track.getSettings(); return Math.min(s.width || 0, s.height || 0); };
  if (short() >= 1080) return;
  for (const c of [{ width: { ideal: 1920 }, height: { ideal: 1080 } }, { width: { ideal: 1080 }, height: { ideal: 1920 } }]) {
    try { await track.applyConstraints(c); } catch { /* keep what we have */ }
    if (short() >= 1080) return;
  }
}

/* ------------------------------------------------------------------ */
/*  Small components                                                   */
/* ------------------------------------------------------------------ */
// Sizes a child to the largest 3:4 box that fits the space available
function Fit({ ratio, children }: { ratio: number; children: (w: number, h: number) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const w = Math.max(0, Math.floor(Math.min(r.width, r.height * ratio)));
      setBox({ w, h: Math.floor(w / ratio) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ratio]);
  return (
    <div ref={ref} className="relative flex-1 min-h-0 w-full">
      <div className="absolute inset-0 flex items-center justify-center">{children(box.w, box.h)}</div>
    </div>
  );
}

function LangToggle({ lang, setLang, dark }: { lang: Lang; setLang: (l: Lang) => void; dark?: boolean }) {
  return (
    <div role="group" aria-label="Language / Bahasa" className="inline-flex rounded-full p-0.5 border"
      style={{ borderColor: dark ? 'rgba(247,245,237,.35)' : 'var(--line)' }}>
      {(['ms', 'en'] as Lang[]).map(l => (
        <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l}
          className="h-8 min-w-10 px-2.5 rounded-full text-[12px] font-semibold"
          style={lang === l
            ? { background: dark ? 'var(--ivory)' : 'var(--ink)', color: dark ? 'var(--night)' : 'var(--ivory)' }
            : { color: dark ? 'var(--ivory)' : 'var(--ink)' }}>
          {l === 'ms' ? 'BM' : 'EN'}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */
export default function WeddingPhotoApp() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('lang') === 'en' ? 'en' : 'ms'));
  const t = STR[lang];

  const [screen, setScreen] = useState<'camera' | 'gallery' | 'audio'>('camera');
  const [filter, setFilter] = useState<'ALL' | 'FAVOURITES' | 'WISHES'>('ALL');
  const [items, setItems] = useState<Item[]>([]);
  const [notice, setNotice] = useState('');

  const [guestName, setGuestName] = useState(() => localStorage.getItem('guest_name') || '');
  const [nameDraft, setNameDraft] = useState('');
  const nameReady = !!guestName.trim();

  // camera
  const [shots, setShots] = useState(() => {
    const v = localStorage.getItem('shots_left');
    return v === null ? MAX_SHOTS : Math.max(0, Number(v) || 0);
  });
  const [mode, setMode] = useState<Mode>('photo');
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [filterId, setFilterId] = useState('asal');
  const [brightness, setBrightness] = useState(1);
  const [showBrightness, setShowBrightness] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [hwZoom, setHwZoom] = useState(false);
  const [flash, setFlash] = useState(false);
  const [torchOk, setTorchOk] = useState(false);
  const [screenFlash, setScreenFlash] = useState(false);
  const [shutterFx, setShutterFx] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [camError, setCamError] = useState('');
  const [camRes, setCamRes] = useState('');
  const [focus, setFocus] = useState({ x: 0.5, y: 0.5 });
  const [ring, setRing] = useState<{ x: number; y: number; k: number } | null>(null);
  const [coach, setCoach] = useState(() => !localStorage.getItem('coach_seen'));
  const [vidRecording, setVidRecording] = useState(false);
  const [vidSecs, setVidSecs] = useState(0);

  // gallery
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  // voice
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [priv, setPriv] = useState(false);
  const [sending, setSending] = useState(false);
  const [micError, setMicError] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  // refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const bgVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startIdRef = useRef(0);
  const zoomCapsRef = useRef<{ min: number; max: number } | null>(null);
  const liveRef = useRef<Live>({ zoom: 1, mirror: false, filter: '', portrait: false, fx: 0.5, fy: 0.5 });
  const bufRef = useRef<Buffers | null>(null);
  const authorRef = useRef('');
  const tapRef = useRef({ x: 0, y: 0, t: 0, moved: false, ignore: false, multi: false });
  const touchRef = useRef({ dist: 0, zoom: 1, y: 0, brightness: 1 });
  const brightTimer = useRef<number | undefined>(undefined);
  const ringTimer = useRef<number | undefined>(undefined);
  const vidRecRef = useRef<MediaRecorder | null>(null);
  const vidRafRef = useRef(0);
  const vidTimerRef = useRef<number | undefined>(undefined);
  const jobsRef = useRef(new Map<string, Job>());
  const urlsRef = useRef(new Map<string, string>());
  const busyRef = useRef(new Set<string>());
  const recTimerRef = useRef<number | undefined>(undefined);
  const secsRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const swipeRef = useRef(0);

  const flt = FILTERS.find(f => f.id === filterId) || FILTERS[0];
  const effZoom = hwZoom ? 1 : zoomLevel; // hardware zoom already changes the stream itself
  const maxZoom = hwZoom ? (zoomCapsRef.current?.max ?? 1) : MAX_DIGITAL_ZOOM;
  const mirror = facing === 'user';
  const filterCss = `${flt.css} brightness(${brightness})`;
  const [now, setNow] = useState(new Date());
  const watermark = buildWatermark(now);

  useEffect(() => {
    liveRef.current = { zoom: effZoom, mirror, filter: filterCss, portrait: mode === 'portrait', fx: focus.x, fy: focus.y };
    authorRef.current = guestName.trim() || t.guest;
  });

  useEffect(() => {
    try { localStorage.setItem('lang', lang); } catch { /* ignore */ }
    document.documentElement.lang = lang === 'ms' ? 'ms' : 'en';
  }, [lang]);
  useEffect(() => { try { localStorage.setItem('shots_left', String(shots)); } catch { /* ignore */ } }, [shots]);
  useEffect(() => { try { localStorage.setItem('guest_name', guestName); } catch { /* ignore */ } }, [guestName]);
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(id);
  }, [notice]);

  const getBuf = (): Buffers => {
    if (!bufRef.current) bufRef.current = { blur: document.createElement('canvas'), sharp: document.createElement('canvas') };
    return bufRef.current;
  };

  /* ---------------------------- camera ---------------------------- */
  const attach = (el: HTMLVideoElement | null, stream: MediaStream | null) => {
    if (!el) return;
    el.srcObject = stream;
    if (stream) el.play().catch(() => { /* autoplay blocked: user tap will start it */ });
  };
  const bgRef = useCallback((el: HTMLVideoElement | null) => {
    bgVideoRef.current = el;
    if (el && streamRef.current) { el.srcObject = streamRef.current; el.play().catch(() => {}); }
  }, []);

  const stopCamera = () => {
    startIdRef.current++;
    for (const el of [videoRef.current, bgVideoRef.current]) {
      if (el) { el.pause(); el.srcObject = null; }
    }
    streamRef.current?.getTracks().forEach(tr => tr.stop());
    streamRef.current = null;
  };

  const startCamera = async () => {
    stopCamera();
    const myId = ++startIdRef.current;
    setCamError('');
    setCamRes('');
    if (!navigator.mediaDevices?.getUserMedia) { setCamError('https'); return; }
    try {
      await sleep(150); // some phones need a moment to release the previous camera
      if (myId !== startIdRef.current) return;
      const stream = await acquireStream(facing);
      if (myId !== startIdRef.current) { stream.getTracks().forEach(tr => tr.stop()); return; }
      const track = stream.getVideoTracks()[0];
      await upgradeResolution(track);
      if (myId !== startIdRef.current) { stream.getTracks().forEach(tr => tr.stop()); return; }
      streamRef.current = stream;

      const caps = (track.getCapabilities ? track.getCapabilities() : {}) as any;
      setTorchOk(!!caps.torch);
      if (caps.zoom && (caps.zoom.max ?? 1) > 1) {
        zoomCapsRef.current = { min: caps.zoom.min ?? 1, max: caps.zoom.max };
        setHwZoom(true);
      } else {
        zoomCapsRef.current = null;
        setHwZoom(false);
      }
      setZoomLevel(1);

      const s = track.getSettings();
      const short = Math.min(s.width || 0, s.height || 0);
      setCamRes(short ? `${short}p` : '');
      attach(videoRef.current, stream);
      attach(bgVideoRef.current, stream);
    } catch (e) {
      const n = (e as DOMException)?.name;
      if (n === 'NotAllowedError' || n === 'PermissionDeniedError' || n === 'SecurityError') setCamError('denied');
      else if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError') setCamError('notfound');
      else setCamError('busy');
    }
  };

  useEffect(() => {
    if (screen === 'camera' && nameReady) void startCamera(); else stopCamera();
    return stopCamera;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, facing, nameReady]);

  useEffect(() => {
    const onVis = () => {
      if (document.hidden) { stopVideo(); stopCamera(); }
      else if (screen === 'camera' && nameReady) void startCamera();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, facing, nameReady]);

  useEffect(() => {
    if (!(coach && nameReady && screen === 'camera')) return;
    const id = setTimeout(() => dismissCoach(), 7000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coach, nameReady, screen]);
  const dismissCoach = () => {
    setCoach(false);
    try { localStorage.setItem('coach_seen', '1'); } catch { /* ignore */ }
  };

  const setTorch = async (on: boolean) => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return false;
    try { await track.applyConstraints({ advanced: [{ torch: on } as any] }); return true; } catch { return false; }
  };

  const toggleFlash = () => {
    if (facing === 'environment' && !torchOk) { setNotice(t.flashUnsupported); return; }
    setFlash(f => !f);
  };

  // Rear camera: real torch. Front camera: the screen lights up white for a moment.
  const withFlash = async (fn: () => Promise<void>) => {
    if (!flash) { await fn(); return; }
    if (facing === 'environment' && torchOk) {
      await setTorch(true);
      await sleep(450);
      try { await fn(); } finally { await sleep(150); await setTorch(false); }
    } else {
      setScreenFlash(true);
      await sleep(450);
      try { await fn(); } finally { await sleep(150); setScreenFlash(false); }
    }
  };

  const switchCamera = () => {
    setFlash(false);
    setFacing(f => (f === 'user' ? 'environment' : 'user'));
  };

  const handleZoomChange = (z: number) => {
    const v = Math.min(Math.max(1, Number.isFinite(z) ? z : 1), maxZoom);
    setZoomLevel(Number(v.toFixed(1)));
    if (hwZoom) {
      const track = streamRef.current?.getVideoTracks()[0];
      track?.applyConstraints({ advanced: [{ zoom: v } as any] }).catch(() => {});
    }
  };

  // Tap to focus: move the focus ring, ask the camera to focus there, and (in Portrait) move the sharp area
  const focusHardware = (nx: number, ny: number) => {
    const track = streamRef.current?.getVideoTracks()[0];
    const v = videoRef.current;
    if (!track || !v || !v.videoWidth) return;
    let u = (nx - 0.5) / effZoom + 0.5;
    const w = (ny - 0.5) / effZoom + 0.5;
    if (mirror) u = 1 - u;
    const a = RATIO, b = v.videoWidth / v.videoHeight;
    let x = u, y = w;
    if (b > a) x = 0.5 + (u - 0.5) * (a / b); else y = 0.5 + (w - 0.5) * (b / a);
    const caps = (track.getCapabilities ? track.getCapabilities() : {}) as any;
    const modes: string[] = caps.focusMode ?? [];
    const adv: any = { pointsOfInterest: [{ x, y }] };
    if (modes.includes('single-shot')) adv.focusMode = 'single-shot';
    track.applyConstraints({ advanced: [adv] })
      .then(() => {
        if (modes.includes('continuous')) {
          setTimeout(() => track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] }).catch(() => {}), 1800);
        }
      })
      .catch(() => { /* this phone/browser does not allow manual focus */ });
  };

  const handleTap = (nx: number, ny: number, px: number, py: number) => {
    if (coach) dismissCoach();
    setFocus({ x: nx, y: ny });
    setRing({ x: px, y: py, k: Date.now() });
    clearTimeout(ringTimer.current);
    ringTimer.current = window.setTimeout(() => setRing(null), 900);
    focusHardware(nx, ny);
  };

  const onPD = (e: RPointerEvent<HTMLDivElement>) => {
    const tr = tapRef.current;
    if (!e.isPrimary) { tr.multi = true; return; }
    tr.x = e.clientX; tr.y = e.clientY; tr.t = Date.now(); tr.moved = false; tr.multi = false;
    tr.ignore = !!(e.target as HTMLElement).closest('button');
  };
  const onPM = (e: RPointerEvent<HTMLDivElement>) => {
    const tr = tapRef.current;
    if (Math.hypot(e.clientX - tr.x, e.clientY - tr.y) > 10) tr.moved = true;
  };
  const onPU = (e: RPointerEvent<HTMLDivElement>) => {
    const tr = tapRef.current;
    if (!e.isPrimary || tr.ignore || tr.moved || tr.multi || Date.now() - tr.t > 600) return;
    const r = e.currentTarget.getBoundingClientRect();
    handleTap((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e.clientX - r.left, e.clientY - r.top);
  };

  const touchDist = (e: RTouchEvent) =>
    e.touches.length < 2 ? 0 : Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
  const onTS = (e: RTouchEvent) => {
    if (e.touches.length === 2) {
      tapRef.current.multi = true;
      touchRef.current.dist = touchDist(e);
      touchRef.current.zoom = zoomLevel;
    } else if (e.touches.length === 1) {
      touchRef.current.y = e.touches[0].clientY;
      touchRef.current.brightness = brightness;
    }
  };
  const onTM = (e: RTouchEvent) => {
    if (e.touches.length === 2) {
      const d = touchDist(e), s = touchRef.current.dist;
      if (s > 0 && d > 0) handleZoomChange(touchRef.current.zoom * (d / s));
    } else if (e.touches.length === 1) {
      const dy = touchRef.current.y - e.touches[0].clientY;
      if (Math.abs(dy) < 8) return;
      const b = Math.min(Math.max(0.4, touchRef.current.brightness + dy / 250), 1.6);
      setBrightness(Number(b.toFixed(2)));
      setShowBrightness(true);
      clearTimeout(brightTimer.current);
      brightTimer.current = window.setTimeout(() => setShowBrightness(false), 1200);
    }
  };

  /* ------------------- uploads (with retry queue) ------------------- */
  const setStatus = (id: string, status: Item['status']) =>
    setItems(p => p.map(i => (i.id === id ? { ...i, status } : i)));

  const runJob = async (id: string) => {
    const job = jobsRef.current.get(id);
    if (!job || busyRef.current.has(id)) return;
    busyRef.current.add(id);
    setStatus(id, 'uploading');
    try {
      await uploadMedia(job.blob, { author: job.author, kind: job.kind, secs: job.secs });
      jobsRef.current.delete(id);
      void deleteJob(id);
      setItems(p => p.filter(i => i.id !== id));
      const url = urlsRef.current.get(id);
      if (url) setTimeout(() => URL.revokeObjectURL(url), 3000);
      urlsRef.current.delete(id);
      void refresh();
    } catch {
      setStatus(id, 'failed');
      setNotice(STR[lang].uploadFail);
    } finally {
      busyRef.current.delete(id);
    }
  };

  const addLocalItem = (j: Job, status: Item['status']) => {
    const url = URL.createObjectURL(j.blob);
    urlsRef.current.set(j.id, url);
    setItems(p => [{
      id: j.id, author: j.author, type: j.kind, url, isFav: false, secs: j.secs, status, at: new Date(j.at).toISOString(),
    }, ...p]);
  };

  const enqueue = async (job: Job) => {
    jobsRef.current.set(job.id, job);
    void putJob(job);
    addLocalItem(job, 'uploading');
    void runJob(job.id);
  };

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
    let alive = true;
    void refresh();
    allJobs().then(list => {
      if (!alive) return;
      list.forEach(j => {
        if (jobsRef.current.has(j.id)) return;
        jobsRef.current.set(j.id, j);
        addLocalItem(j, 'failed');
        void runJob(j.id);
      });
    });
    const retry = () => jobsRef.current.forEach((_, id) => { void runJob(id); });
    window.addEventListener('online', retry);
    const a = setInterval(retry, 30000);
    const b = setInterval(() => { void refresh(); }, 20000);
    return () => { alive = false; window.removeEventListener('online', retry); clearInterval(a); clearInterval(b); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------- taking pictures ------------------------ */
  const takePhoto = async () => {
    if (shots <= 0 || capturing) return;
    const v = videoRef.current;
    if (!v || !v.videoWidth) { setNotice(t.camNotReady); return; }
    setCapturing(true);
    try {
      await withFlash(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = PHOTO_W; canvas.height = PHOTO_H;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        drawFrame(ctx, v, PHOTO_W, PHOTO_H, liveRef.current, getBuf(), buildWatermark());
        setShutterFx(true);
        setTimeout(() => setShutterFx(false), 140);
        navigator.vibrate?.(12);
        const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.9));
        if (!blob) return;
        setShots(n => Math.max(0, n - 1));
        await enqueue({ id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, blob, kind: 'photo', author: authorRef.current, at: Date.now() });
      });
    } finally { setCapturing(false); }
  };

  const stopVideo = () => {
    const r = vidRecRef.current;
    vidRecRef.current = null;
    if (r && r.state !== 'inactive') r.stop();
  };

  const startVideo = async () => {
    if (vidRecording || shots < VIDEO_COST) return;
    const v = videoRef.current;
    if (!v || !v.videoWidth) { setNotice(t.camNotReady); return; }
    if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) { setNotice(t.videoUnsupported); return; }
    const W = PHOTO_W, H = PHOTO_H;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let mic: MediaStream | null = null;
    try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { setNotice(t.videoNoMic); }

    drawFrame(ctx, v, W, H, liveRef.current, getBuf(), buildWatermark());
    const out = canvas.captureStream(30);
    mic?.getAudioTracks().forEach(tr => out.addTrack(tr));
    const mime = pickMime(VIDEO_MIMES);
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(out, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: VIDEO_BITRATE, audioBitsPerSecond: 128_000 });
    } catch { mic?.getTracks().forEach(tr => tr.stop()); setNotice(t.videoUnsupported); return; }

    const chunks: Blob[] = [];
    const startedAt = Date.now();
    const torchOn = flash && facing === 'environment' && torchOk;
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      cancelAnimationFrame(vidRafRef.current);
      clearInterval(vidTimerRef.current);
      mic?.getTracks().forEach(tr => tr.stop());
      if (torchOn) void setTorch(false);
      setVidRecording(false);
      setVidSecs(0);
      const dur = (Date.now() - startedAt) / 1000;
      if (dur < 0.7 || !chunks.length) { setNotice(t.videoTooShort); return; }
      const blob = new Blob(chunks, { type: rec.mimeType || mime || 'video/webm' });
      setShots(n => Math.max(0, n - VIDEO_COST));
      await enqueue({ id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, blob, kind: 'video', author: authorRef.current, secs: Math.round(dur), at: Date.now() });
    };

    if (torchOn) await setTorch(true);
    rec.start(1000);
    vidRecRef.current = rec;
    setVidRecording(true);
    setVidSecs(0);
    navigator.vibrate?.(20);

    let last = 0, stamp = buildWatermark(), stampAt = Date.now();
    const loop = (ts: number) => {
      if (ts - last >= 32) {
        last = ts;
        if (Date.now() - stampAt > 1000) { stamp = buildWatermark(); stampAt = Date.now(); }
        const vv = videoRef.current;
        if (vv && vv.videoWidth) drawFrame(ctx, vv, W, H, liveRef.current, getBuf(), stamp);
      }
      vidRafRef.current = requestAnimationFrame(loop);
    };
    vidRafRef.current = requestAnimationFrame(loop);
    vidTimerRef.current = window.setInterval(() => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      setVidSecs(s);
      if (s >= VIDEO_MAX) stopVideo();
    }, 250);
  };

  const onShutter = () => {
    if (mode === 'video') { if (vidRecording) stopVideo(); else void startVideo(); }
    else void takePhoto();
  };

  const uploadFromGallery = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    for (const file of files) {
      try { await uploadMedia(await compressImage(file), { author: authorRef.current, kind: 'photo' }); }
      catch { setNotice(t.uploadFail); }
    }
    void refresh();
  };

  /* ---------------------------- gallery ----------------------------- */
  const toggleFav = (id: string) => {
    const f = readSet('favs');
    if (f.has(id)) f.delete(id); else f.add(id);
    writeSet('favs', f);
    setItems(p => p.map(i => (i.id === id ? { ...i, isFav: !i.isFav } : i)));
  };
  const hideItem = (id: string) => {
    const h = readSet('hidden'); h.add(id); writeSet('hidden', h);
    setItems(p => p.filter(i => i.id !== id));
    setConfirmId(null);
    setViewerId(null);
  };
  const exitSelect = () => { setSelectMode(false); setSelected([]); };
  const toggleSelect = (id: string) => setSelected(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));

  const togglePlay = (item: Item) => {
    if (!item.url) return;
    if (playingId === item.id) { playerRef.current?.pause(); setPlayingId(null); return; }
    playerRef.current?.pause();
    const a = new Audio(item.url);
    a.onended = () => setPlayingId(null);
    a.onerror = () => setPlayingId(null);
    a.play().catch(() => setPlayingId(null));
    playerRef.current = a;
    setPlayingId(item.id);
  };

  const saveItem = async (it: Item) => {
    try {
      const blob = await (await fetch(it.url)).blob();
      const mp4 = blob.type.includes('mp4');
      const ext = it.type === 'photo' ? 'jpg' : it.type === 'video' ? (mp4 ? 'mp4' : 'webm') : (mp4 ? 'm4a' : 'webm');
      const name = `kanta-kita_${it.author.replace(/\s+/g, '')}_${it.id.slice(0, 8)}.${ext}`;
      const file = new File([blob], name, { type: blob.type });
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
      if (ios && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; }
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 2000);
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return;
      window.open(it.url, '_blank');
    }
  };
  const downloadSelected = async () => {
    for (const it of items.filter(i => selected.includes(i.id) && i.url)) {
      await saveItem(it);
      await sleep(300);
    }
    exitSelect();
  };

  const visible = items.filter(i =>
    filter === 'ALL' ? true : filter === 'FAVOURITES' ? i.isFav : i.type === 'audio');
  const viewerList = visible.filter(i => i.type !== 'audio');
  const viewerIndex = viewerId ? viewerList.findIndex(i => i.id === viewerId) : -1;
  const viewerItem = viewerIndex >= 0 ? viewerList[viewerIndex] : null;
  const stepViewer = (d: number) => {
    if (!viewerList.length) return;
    setViewerId(viewerList[(viewerIndex + d + viewerList.length) % viewerList.length].id);
  };
  const latestMedia = items.find(i => i.type !== 'audio');
  const dateLabel = (at?: string) =>
    at ? new Date(at).toLocaleString(lang === 'ms' ? 'ms-MY' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '';

  useEffect(() => {
    if (!viewerItem) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewerId(null);
      if (e.key === 'ArrowRight') stepViewer(1);
      if (e.key === 'ArrowLeft') stepViewer(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerId, viewerList.length]);

  /* ------------------------------ voice ----------------------------- */
  const finishRecording = () => {
    clearInterval(recTimerRef.current);
    setRecording(false);
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
  };

  const toggleRecord = async () => {
    if (recording) { finishRecording(); return; }
    previewRef.current?.pause();
    setPreviewing(false);
    setAudioUrl(null);
    setMicError(false);
    secsRef.current = 0;
    setSecs(0);
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime(AUDIO_MIMES);
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      rec.ondataavailable = e => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(tr => tr.stop());
        setAudioUrl(URL.createObjectURL(new Blob(chunksRef.current, { type: rec.mimeType || mime || 'audio/webm' })));
      };
      rec.start();
      recorderRef.current = rec;
    } catch {
      recorderRef.current = null;
      setMicError(true);
      return;
    }
    setRecording(true);
    recTimerRef.current = window.setInterval(() => {
      secsRef.current += 1;
      setSecs(secsRef.current);
      if (secsRef.current >= MAX_SECS) finishRecording();
    }, 1000);
  };

  const togglePreview = () => {
    if (!audioUrl) return;
    if (previewing) { previewRef.current?.pause(); setPreviewing(false); return; }
    const a = new Audio(audioUrl);
    a.onended = () => setPreviewing(false);
    a.onerror = () => setPreviewing(false);
    a.play().then(() => setPreviewing(true)).catch(() => setPreviewing(false));
    previewRef.current = a;
  };

  const discardRecording = () => {
    previewRef.current?.pause();
    setPreviewing(false);
    setAudioUrl(null);
    setSecs(0);
    secsRef.current = 0;
  };

  const canSend = !recording && secs > 0 && !!audioUrl;
  const sendVoice = async () => {
    if (!canSend || !audioUrl || sending) return;
    setSending(true);
    try {
      const blob = await (await fetch(audioUrl)).blob();
      await uploadMedia(blob, { author: authorRef.current, kind: 'audio', secs, priv });
      const wasPrivate = priv;
      previewRef.current?.pause();
      setPreviewing(false);
      setSecs(0); secsRef.current = 0; setAudioUrl(null); setPriv(false);
      setNotice(wasPrivate ? t.sentPriv : t.sentOk);
      if (wasPrivate) setScreen('camera');
      else { setFilter('WISHES'); await refresh(); setScreen('gallery'); }
    } catch {
      setNotice(t.sendFail);
    }
    setSending(false);
  };

  useEffect(() => () => {
    clearInterval(recTimerRef.current);
    clearInterval(vidTimerRef.current);
    cancelAnimationFrame(vidRafRef.current);
    playerRef.current?.pause();
    previewRef.current?.pause();
  }, []);

  /* ------------------------------ render ---------------------------- */
  const camErrorText =
    camError === 'denied' ? t.camDenied : camError === 'https' ? t.camHttps : camError === 'notfound' ? t.camNotFound : t.camBusy;
  const zoomPresets = [1, 2, 3].filter(z => z <= maxZoom);
  const filmDone = mode === 'video' ? shots < VIDEO_COST : shots <= 0;
  const maskGrad = `radial-gradient(ellipse ${PORTRAIT.r * 100}% ${PORTRAIT.r * 75}% at ${focus.x * 100}% ${focus.y * 100}%, #000 ${PORTRAIT.solid * 100}%, transparent 100%)`;
  const flipT = `${mirror ? 'scaleX(-1)' : ''}`;
  const emptyText = filter === 'WISHES' ? t.emptyWishes : filter === 'FAVOURITES' ? t.emptyFav : t.emptyAll;

  const iconBtn = 'w-11 h-11 rounded-full flex items-center justify-center border shrink-0';
  const darkBtn = { background: 'rgba(28,23,19,.55)', borderColor: 'rgba(247,245,237,.35)', color: 'var(--ivory)' } as const;
  const pillStyle = (on: boolean) =>
    on ? { background: 'var(--sage)', color: '#fff', borderColor: 'var(--sage)' }
       : { background: 'var(--paper)', color: 'var(--ink)', borderColor: 'var(--line)' };

  return (
    <div className="h-dvh w-full flex justify-center font-sans overflow-hidden"
      style={{ background: screen === 'camera' ? 'var(--night)' : 'var(--ivory)', color: 'var(--ink)' }}>
      <div className="relative w-full max-w-md h-full flex flex-col overflow-hidden">

        {notice && (
          <div role="status" onClick={() => setNotice('')}
            className="absolute top-3 left-4 right-4 z-[80] text-[13px] rounded-2xl px-4 py-3 border shadow-xl"
            style={{ background: 'var(--night)', color: 'var(--ivory)', borderColor: 'var(--gold)' }}>
            {notice}
          </div>
        )}
        {screenFlash && <div className="fixed inset-0 z-[70] bg-white pointer-events-none" />}

        {/* ================= NAME + LANGUAGE GATE ================= */}
        {!nameReady && (
          <form onSubmit={e => { e.preventDefault(); if (nameDraft.trim()) setGuestName(nameDraft.trim()); }}
            className="absolute inset-0 z-[90] flex flex-col items-center justify-center gap-5 p-7 text-center"
            style={{ background: 'var(--ivory)' }}>
            <LangToggle lang={lang} setLang={setLang} />
            <div>
              <h1 className="font-serif text-[34px] italic font-semibold leading-none">{COUPLE}</h1>
              <p className="mt-2 text-[13px]" style={{ color: 'var(--ink-soft)' }}>{EVENT_DATE} · {VENUE}</p>
              <p className="mt-1 text-[13px] font-semibold" style={{ color: 'var(--gold-deep)' }}>{HASHTAG}</p>
            </div>
            <div className="w-12 h-px" style={{ background: 'var(--gold)' }} />
            <div className="w-full max-w-xs space-y-3">
              <h2 className="font-serif text-2xl font-semibold">{t.gateTitle}</h2>
              <p className="text-[13px]" style={{ color: 'var(--ink-soft)' }}>{t.gateHint}</p>
              <input value={nameDraft} onChange={e => setNameDraft(e.target.value)} maxLength={30}
                placeholder={t.gatePlaceholder} aria-label={t.gateTitle}
                className="w-full rounded-xl border px-4 py-3 text-[15px] outline-none"
                style={{ background: 'var(--paper)', borderColor: 'var(--line)', color: 'var(--ink)' }} />
              <p className="text-[12px]" style={{ color: 'var(--ink-soft)' }}>{fmt(t.gateFilm, { n: MAX_SHOTS })}</p>
              <button type="submit" disabled={!nameDraft.trim()}
                className="w-full py-3.5 rounded-full text-[14px] font-semibold disabled:opacity-40"
                style={{ background: 'var(--sage)', color: '#fff' }}>
                {t.gateStart}
              </button>
            </div>
          </form>
        )}

        {/* ======================= CAMERA ======================= */}
        {screen === 'camera' && (
          <div className="h-full flex flex-col gap-2 px-3"
            style={{ background: 'var(--night)', color: 'var(--ivory)', paddingTop: 'max(8px, env(safe-area-inset-top))', paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}>

            {/* header: language left, voice at the top right */}
            <header className="shrink-0 grid grid-cols-[auto_1fr_auto] items-center gap-2">
              <div className="justify-self-start"><LangToggle lang={lang} setLang={setLang} dark /></div>
              <div className="text-center min-w-0">
                <h1 className="font-serif text-[22px] leading-none font-semibold italic">{COUPLE}</h1>
                <p className="mt-1 text-[12px] whitespace-nowrap" style={{ color: 'var(--gold-lite)' }}>{EVENT_DATE_SHORT} · {VENUE_SHORT}</p>
              </div>
              <button onClick={() => setScreen('audio')} disabled={vidRecording} aria-label={t.voiceTitle}
                className="justify-self-end h-11 pl-3 pr-3.5 rounded-full flex items-center gap-1.5 border text-[13px] font-medium disabled:opacity-40"
                style={darkBtn}>
                <Mic className="w-4 h-4" /> {t.voice}
              </button>
            </header>

            {/* viewfinder (always exactly 3:4, like the saved photo) */}
            <Fit ratio={RATIO}>
              {(w, h) => (
                <div
                  onPointerDown={onPD} onPointerMove={onPM} onPointerUp={onPU}
                  onTouchStart={onTS} onTouchMove={onTM}
                  className="relative overflow-hidden touch-none select-none bg-black"
                  style={{ width: w, height: h, borderRadius: 20, border: '1px solid rgba(232,199,102,.4)' }}>

                  {mode === 'portrait' && (
                    <video ref={bgRef} autoPlay playsInline muted aria-hidden
                      className="absolute inset-0 w-full h-full object-cover"
                      style={{ filter: `${filterCss} blur(9px)`, transform: `scale(${effZoom * 1.06}) ${flipT}` }} />
                  )}
                  <div className="absolute inset-0"
                    style={mode === 'portrait' ? { WebkitMaskImage: maskGrad, maskImage: maskGrad } : undefined}>
                    <video ref={videoRef} autoPlay playsInline muted
                      className="w-full h-full object-cover"
                      style={{ filter: filterCss, transform: `scale(${effZoom}) ${flipT}` }} />
                  </div>

                  <div className="absolute inset-0 bg-black pointer-events-none"
                    style={{ opacity: shutterFx ? 0.55 : 0, transition: 'opacity 140ms' }} />

                  {/* retro watermark: same position and size as in the saved photo */}
                  <div className="absolute pointer-events-none whitespace-nowrap font-mono font-bold"
                    style={{ left: '8%', top: '50%', transform: 'translate(-50%,-50%) rotate(-90deg)', fontSize: w * 0.032, color: '#E8C766', textShadow: '0 1px 3px rgba(0,0,0,.85)' }}>
                    {watermark}
                  </div>

                  {ring && (
                    <div key={ring.k} className="absolute pointer-events-none rounded-full focus-ring"
                      style={{ left: ring.x - 32, top: ring.y - 32, width: 64, height: 64, border: '2px solid var(--gold-lite)' }} />
                  )}

                  {/* top overlays */}
                  <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 rounded-full px-3 h-8 text-[12px] font-semibold"
                    style={{ background: 'rgba(28,23,19,.6)', border: '1px solid rgba(247,245,237,.25)' }}>
                    <Film className="w-3.5 h-3.5" style={{ color: 'var(--gold-lite)' }} />
                    <span className="font-mono">{shots}</span><span className="opacity-80">{t.shotsLeft}</span>
                  </div>
                  <button onClick={toggleFlash} aria-label={flash ? t.flashOn : t.flashOff} aria-pressed={flash}
                    className="absolute top-2 right-2 w-11 h-11 rounded-full flex items-center justify-center border"
                    style={flash ? { background: 'var(--gold)', color: 'var(--night)', borderColor: 'var(--gold-lite)' } : darkBtn}>
                    {flash ? <Zap className="w-5 h-5" /> : <ZapOff className="w-5 h-5" />}
                  </button>

                  {vidRecording && (
                    <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full px-3 h-8 text-[12px] font-mono font-semibold"
                      style={{ background: 'rgba(28,23,19,.7)' }}>
                      <span className="w-2.5 h-2.5 rounded-full rec-dot" style={{ background: '#E5566D' }} />
                      {Math.floor(vidSecs / 60)}:{pad(vidSecs % 60)} / 0:{pad(VIDEO_MAX)}
                    </div>
                  )}
                  {showBrightness && !vidRecording && (
                    <div className="absolute top-14 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full px-3 h-8 text-[12px] font-mono font-semibold"
                      style={{ background: 'rgba(28,23,19,.7)', color: 'var(--gold-lite)' }}>
                      <Sun className="w-4 h-4" /> {Math.round(brightness * 100)}%
                    </div>
                  )}

                  {/* bottom overlays */}
                  {coach && (
                    <button onClick={dismissCoach}
                      className="absolute left-3 right-3 bottom-16 rounded-xl px-3 py-2 text-[12px] text-center"
                      style={{ background: 'rgba(28,23,19,.78)', border: '1px solid rgba(232,199,102,.4)' }}>
                      {t.coach}
                    </button>
                  )}
                  {zoomPresets.length > 1 && (
                    <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full p-1"
                      style={{ background: 'rgba(28,23,19,.6)', border: '1px solid rgba(247,245,237,.25)' }}
                      role="group" aria-label={t.zoom}>
                      {zoomPresets.map(z => (
                        <button key={z} onClick={() => handleZoomChange(z)} aria-pressed={zoomLevel === z}
                          className="h-9 min-w-10 px-2 rounded-full text-[13px] font-semibold"
                          style={zoomLevel === z ? { background: 'var(--ivory)', color: 'var(--night)' } : { color: 'var(--ivory)' }}>
                          {z}x
                        </button>
                      ))}
                      {!zoomPresets.includes(zoomLevel) && (
                        <span className="h-9 min-w-10 px-2 rounded-full text-[13px] font-semibold flex items-center justify-center"
                          style={{ background: 'var(--ivory)', color: 'var(--night)' }}>{zoomLevel}x</span>
                      )}
                    </div>
                  )}
                  {camRes && (
                    <span className="absolute bottom-3 right-3 text-[11px] font-mono px-1.5 rounded"
                      style={{ background: 'rgba(28,23,19,.6)', color: 'var(--ivory)' }}>{camRes}</span>
                  )}

                  {camError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center"
                      style={{ background: 'var(--night-2)' }}>
                      <CircleAlert className="w-8 h-8" style={{ color: 'var(--gold-lite)' }} />
                      <h2 className="font-serif text-xl font-semibold">{t.camDeniedTitle}</h2>
                      <p className="text-[13px] opacity-90">{camErrorText}</p>
                      <button onClick={() => void startCamera()} className="h-11 px-5 rounded-full text-[14px] font-semibold"
                        style={{ background: 'var(--ivory)', color: 'var(--night)' }}>{t.camRetry}</button>
                    </div>
                  )}
                  {filmDone && !camError && (
                    <div className="absolute inset-x-3 bottom-16 rounded-2xl p-4 text-center space-y-3"
                      style={{ background: 'rgba(28,23,19,.88)', border: '1px solid rgba(232,199,102,.45)' }}>
                      <h2 className="font-serif text-xl font-semibold">{t.filmDoneTitle}</h2>
                      <p className="text-[13px] opacity-90">{t.filmDoneBody}</p>
                      <div className="flex gap-2 justify-center">
                        <button onClick={() => setScreen('audio')} className="h-11 px-4 rounded-full text-[13px] font-semibold flex items-center gap-1.5"
                          style={{ background: 'var(--ivory)', color: 'var(--night)' }}><Mic className="w-4 h-4" />{t.voice}</button>
                        <button onClick={() => setScreen('gallery')} className="h-11 px-4 rounded-full text-[13px] font-semibold flex items-center gap-1.5 border"
                          style={darkBtn}><Images className="w-4 h-4" />{t.gallery}</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Fit>

            {/* controls */}
            <div className="shrink-0 space-y-2">
              <div className="flex gap-2 overflow-x-auto px-1 justify-center" role="group">
                {FILTERS.map(f => (
                  <button key={f.id} onClick={() => setFilterId(f.id)} aria-pressed={filterId === f.id}
                    className="h-8 px-3.5 rounded-full text-[12px] font-medium shrink-0 border"
                    style={filterId === f.id
                      ? { background: 'var(--ivory)', color: 'var(--night)', borderColor: 'var(--ivory)' }
                      : { color: 'var(--ivory)', borderColor: 'rgba(247,245,237,.35)' }}>
                    {f.name[lang]}
                  </button>
                ))}
              </div>

              <div className="flex justify-center gap-6" role="tablist">
                {(['photo', 'portrait', 'video'] as Mode[]).map(m => (
                  <button key={m} role="tab" aria-selected={mode === m} disabled={vidRecording}
                    onClick={() => setMode(m)}
                    className="h-9 px-1 text-[14px] font-medium border-b-2 disabled:opacity-60"
                    style={mode === m
                      ? { color: 'var(--gold-lite)', borderColor: 'var(--gold-lite)' }
                      : { color: 'rgba(247,245,237,.8)', borderColor: 'transparent' }}>
                    {m === 'photo' ? t.modePhoto : m === 'portrait' ? t.modePortrait : t.modeVideo}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-3 items-center px-3">
                <button onClick={() => setScreen('gallery')} disabled={vidRecording} aria-label={t.gallery}
                  className="justify-self-start w-14 h-14 rounded-xl overflow-hidden border flex items-center justify-center disabled:opacity-40"
                  style={{ borderColor: 'rgba(247,245,237,.45)', background: 'var(--night-2)' }}>
                  {latestMedia?.type === 'photo' ? (
                    <img src={latestMedia.url} alt="" className="w-full h-full object-cover" />
                  ) : latestMedia?.type === 'video' ? (
                    <video src={`${latestMedia.url}#t=0.1`} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                  ) : (
                    <Images className="w-6 h-6" style={{ color: 'var(--gold-lite)' }} />
                  )}
                </button>

                <button onClick={onShutter} disabled={filmDone || capturing || !!camError}
                  aria-label={mode === 'video' ? (vidRecording ? t.stopVideo : t.startVideo) : t.shutter}
                  className="justify-self-center w-[78px] h-[78px] rounded-full p-1 active:scale-95 transition-transform disabled:opacity-40"
                  style={{ border: '4px solid var(--ivory)' }}>
                  <span className="w-full h-full rounded-full flex items-center justify-center"
                    style={{ background: mode === 'video' ? '#D2455C' : 'var(--ivory)' }}>
                    {mode === 'video' && vidRecording
                      ? <Square className="w-7 h-7 text-white fill-white" />
                      : mode === 'video'
                        ? <span className="w-5 h-5 rounded-full bg-white" />
                        : <span className="w-[54px] h-[54px] rounded-full" style={{ border: '2px solid var(--gold)' }} />}
                  </span>
                </button>

                <button onClick={switchCamera} disabled={vidRecording} aria-label={t.flipCamera}
                  className={`${iconBtn} justify-self-end w-14 h-14 disabled:opacity-40`} style={darkBtn}>
                  <SwitchCamera className="w-6 h-6" />
                </button>
              </div>

              <div className="text-center">
                <label className="inline-flex items-center gap-2 h-10 px-4 rounded-full text-[12px] font-medium cursor-pointer"
                  style={{ color: 'var(--ivory)', opacity: vidRecording ? 0.4 : 1 }}>
                  <Upload className="w-4 h-4" /> {t.upload}
                  <input type="file" accept="image/*" multiple className="hidden" disabled={vidRecording} onChange={uploadFromGallery} />
                </label>
              </div>
            </div>
          </div>
        )}

        {/* ======================= GALLERY ======================= */}
        {screen === 'gallery' && (
          <div className="h-full flex flex-col overflow-hidden" style={{ background: 'var(--ivory)' }}>
            <div className="shrink-0 px-3 pt-3 pb-2 border-b space-y-2.5"
              style={{ background: 'var(--paper)', borderColor: 'var(--line)', paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
              <div className="flex items-center gap-2">
                <button onClick={() => { exitSelect(); setScreen('camera'); }} aria-label="Camera"
                  className={iconBtn} style={{ background: 'var(--sage)', color: '#fff', borderColor: 'var(--sage)' }}>
                  <Camera className="w-5 h-5" />
                </button>
                <div className="mr-auto min-w-0">
                  <h1 className="font-serif text-2xl italic font-semibold leading-none">{t.gallery}</h1>
                  <p className="text-[12px] font-semibold mt-0.5" style={{ color: 'var(--gold-deep)' }}>{HASHTAG}</p>
                </div>
                <LangToggle lang={lang} setLang={setLang} />
                <button onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
                  className="h-11 px-4 rounded-full text-[13px] font-semibold border" style={pillStyle(selectMode)}>
                  {selectMode ? t.cancel : t.select}
                </button>
              </div>
              <div className="flex gap-2 overflow-x-auto" role="tablist">
                {([['ALL', t.all], ['FAVOURITES', t.favourites], ['WISHES', t.wishes]] as const).map(([k, label]) => (
                  <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
                    className="h-9 px-4 rounded-full border text-[13px] font-semibold whitespace-nowrap flex items-center gap-1.5"
                    style={pillStyle(filter === k)}>
                    {label}
                    {k === 'FAVOURITES' && <><Heart className="w-3.5 h-3.5 fill-current" /> {items.filter(i => i.isFav).length}</>}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              {visible.length === 0 && (
                <p className="text-center text-[14px] pt-16 px-6" style={{ color: 'var(--ink-soft)' }}>{emptyText}</p>
              )}
              <div className="grid grid-cols-3 gap-2.5">
                {visible.map(item => {
                  const isSel = selected.includes(item.id);
                  const open = () => {
                    if (selectMode) toggleSelect(item.id);
                    else if (item.status === 'failed') void runJob(item.id);
                    else if (item.type !== 'audio') setViewerId(item.id);
                  };
                  return (
                    <div key={item.id} className="relative rounded-md p-1.5 pb-1 border"
                      style={{ background: 'var(--paper)', borderColor: isSel ? 'var(--sage)' : '#EFE5D0', boxShadow: isSel ? '0 0 0 2px var(--sage)' : '0 3px 10px rgba(60,45,25,.12)' }}>
                      <div className="relative aspect-[3/4] overflow-hidden cursor-pointer" style={{ background: 'var(--ivory-2)' }} onClick={open}>
                        {item.type === 'photo' && <img src={item.url} alt={item.author} loading="lazy" className="w-full h-full object-cover" />}
                        {item.type === 'video' && (
                          <>
                            <video src={`${item.url}#t=0.1`} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                            <span className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between text-[11px] text-white font-mono">
                              <span className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: 'rgba(28,23,19,.65)' }}><Play className="w-3 h-3 fill-white" /></span>
                              <span className="px-1.5 rounded" style={{ background: 'rgba(28,23,19,.65)' }}>0:{pad(item.secs ?? 0)}</span>
                            </span>
                          </>
                        )}
                        {item.type === 'audio' && (
                          <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-2 pt-10" style={{ background: 'var(--night-2)' }}>
                            <div className="w-full rounded text-[11px] font-mono px-1 py-0.5 truncate text-center font-semibold"
                              style={{ background: 'var(--ivory)', color: 'var(--ink)' }}>{item.author}</div>
                            <button onClick={e => { e.stopPropagation(); togglePlay(item); }}
                              aria-label={playingId === item.id ? t.pauseWish : t.playWish}
                              className="w-11 h-11 rounded-full flex items-center justify-center"
                              style={{ background: 'var(--gold)', color: 'var(--night)' }}>
                              {playingId === item.id ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
                            </button>
                            <span className="text-[11px] font-mono" style={{ color: '#EADCC2' }}>{item.secs ?? 0} {t.seconds}</span>
                            {item.priv && <Lock className="w-3.5 h-3.5" style={{ color: 'var(--gold-lite)' }} />}
                          </div>
                        )}

                        {item.status && (
                          <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 text-[11px] font-medium flex items-center gap-1 text-white"
                            style={{ background: item.status === 'failed' ? 'var(--rose)' : 'rgba(28,23,19,.75)' }}>
                            {item.status === 'failed' ? <RotateCcw className="w-3.5 h-3.5 shrink-0" /> : <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />}
                            <span className="truncate">{item.status === 'failed' ? t.failedRetry : t.sending}</span>
                          </div>
                        )}

                        {selectMode ? (
                          <span className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full border-2 flex items-center justify-center"
                            style={isSel ? { background: 'var(--sage)', borderColor: 'var(--sage)', color: '#fff' } : { background: 'rgba(0,0,0,.35)', borderColor: '#fff', color: 'transparent' }}>
                            <Check className="w-4 h-4" />
                          </span>
                        ) : (
                          <>
                            {!item.id.startsWith('local_') && (
                              <button onClick={e => { e.stopPropagation(); setConfirmId(item.id); }} aria-label={t.remove}
                                className="absolute top-1 left-1 w-8 h-8 rounded-full flex items-center justify-center text-white"
                                style={{ background: 'rgba(28,23,19,.55)' }}>
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                            {!item.id.startsWith('local_') && (
                              <button onClick={e => { e.stopPropagation(); toggleFav(item.id); }} aria-label={t.favourite} aria-pressed={item.isFav}
                                className="absolute top-1 right-1 w-8 h-8 rounded-full flex items-center justify-center"
                                style={{ background: 'rgba(28,23,19,.55)' }}>
                                <Heart className="w-4 h-4" style={item.isFav ? { fill: 'var(--rose)', color: 'var(--rose)' } : { color: '#fff' }} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                      <p className="pt-1.5 pb-0.5 text-center font-serif italic text-[14px] font-medium truncate">{item.author}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {selectMode && (
              <div className="shrink-0 p-3 border-t flex items-center gap-2"
                style={{ background: 'var(--paper)', borderColor: 'var(--line)', paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
                <button onClick={() => setSelected(selected.length === visible.length ? [] : visible.map(i => i.id))}
                  className="h-11 px-4 rounded-full text-[13px] font-semibold border" style={{ borderColor: 'var(--line)' }}>
                  {selected.length === visible.length && visible.length > 0 ? t.deselectAll : t.selectAll}
                </button>
                <button onClick={() => void downloadSelected()} disabled={!selected.length}
                  className="flex-1 h-11 rounded-full text-[14px] font-semibold flex items-center justify-center gap-2 disabled:opacity-45"
                  style={{ background: 'var(--sage)', color: '#fff' }}>
                  <Download className="w-4 h-4" /> {t.download} ({selected.length})
                </button>
              </div>
            )}
          </div>
        )}

        {/* ======================= VOICE ======================= */}
        {screen === 'audio' && (
          <div className="h-full flex flex-col gap-5 overflow-y-auto px-5 pb-5"
            style={{ background: 'var(--ivory)', paddingTop: 'max(16px, env(safe-area-inset-top))' }}>
            <div className="flex items-center justify-between">
              <button onClick={() => { if (recording) finishRecording(); previewRef.current?.pause(); setPreviewing(false); setScreen('camera'); }}
                className="h-11 pr-3 flex items-center gap-1 text-[14px] font-medium">
                <ChevronLeft className="w-5 h-5" /> {t.back}
              </button>
              <LangToggle lang={lang} setLang={setLang} />
            </div>

            <div className="space-y-2">
              <h1 className="font-serif text-[40px] leading-none italic font-medium">{t.voiceTitle}</h1>
              <div className="w-14 h-px" style={{ background: 'var(--gold)' }} />
              <p className="text-[14px] leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
                {fmt(t.voiceDesc, { couple: COUPLE, tag: HASHTAG, n: MAX_SECS })}
              </p>
            </div>

            <div className="my-auto flex flex-col items-center gap-6">
              <div className="w-full max-w-xs rounded-2xl p-3 border-2 space-y-2 shadow-xl"
                style={{ background: 'var(--night-2)', borderColor: 'var(--gold)' }}>
                <div className="rounded-xl p-2.5 border flex justify-between items-center gap-2 font-mono"
                  style={{ background: 'var(--ivory)', borderColor: '#EADCC2' }}>
                  <input value={guestName} onChange={e => setGuestName(e.target.value)} maxLength={20}
                    aria-label={t.guestNameLabel}
                    className="font-bold underline bg-transparent outline-none w-28 text-[13px]" style={{ color: 'var(--ink)' }} />
                  <span className="text-[12px] font-bold shrink-0" style={{ color: 'var(--ink)' }}>
                    {pad(secs)} / {MAX_SECS} {t.seconds}
                  </span>
                </div>
                <div className="rounded-xl p-4 flex items-center justify-around border"
                  style={{ background: '#1B1612', borderColor: 'rgba(212,175,58,.3)' }}>
                  {[0, 1].map(k => (
                    <div key={k} className={`w-11 h-11 rounded-full border-4 flex items-center justify-center ${recording ? 'animate-spin' : ''}`}
                      style={{ borderColor: 'var(--gold)', background: 'var(--night-2)' }}>
                      <div className="w-3 h-3 rounded-full" style={{ background: 'var(--ivory)' }} />
                    </div>
                  ))}
                </div>
                <div className="h-2.5 rounded-b-lg" style={{ background: 'linear-gradient(to right, #EADCC2, #D4AF3A, #A8B39A)' }} />
              </div>

              <div className="text-center space-y-2">
                <button onClick={() => void toggleRecord()} aria-label={recording ? t.stopBtn : t.recordBtn}
                  className={`w-[84px] h-[84px] rounded-full p-1 border-4 active:scale-95 transition-transform ${recording ? 'rec-pulse' : ''}`}
                  style={{ borderColor: 'var(--rose)' }}>
                  <span className="w-full h-full rounded-full flex items-center justify-center" style={{ background: 'var(--rose)' }}>
                    {recording ? <Square className="w-7 h-7 text-white fill-white" /> : <Mic className="w-8 h-8 text-white" />}
                  </span>
                </button>
                <p className="text-[12px] font-mono tracking-widest font-semibold">{recording ? t.tapStop : t.tapStart}</p>
                {micError && <p role="alert" className="text-[13px] max-w-[18rem] mx-auto" style={{ color: 'var(--rose)' }}>{t.micError}</p>}
              </div>

              {canSend && (
                <div className="flex gap-2">
                  <button onClick={togglePreview}
                    className="h-11 px-4 rounded-full text-[13px] font-semibold border flex items-center gap-2"
                    style={{ background: 'var(--paper)', borderColor: 'var(--line)' }}>
                    {previewing ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                    {previewing ? t.pausePlayback : t.playback}
                  </button>
                  <button onClick={discardRecording}
                    className="h-11 px-4 rounded-full text-[13px] font-semibold border flex items-center gap-2"
                    style={{ background: 'var(--paper)', borderColor: 'var(--line)' }}>
                    <RotateCcw className="w-4 h-4" /> {t.rerecord}
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl p-3.5 flex items-center justify-between gap-3 border"
                style={{ background: 'var(--paper)', borderColor: '#EADCC2' }}>
                <div className="flex items-start gap-2.5">
                  <Lock className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--gold-deep)' }} />
                  <div>
                    <h2 className="text-[14px] font-semibold">{t.privTitle}</h2>
                    <p className="text-[12px]" style={{ color: 'var(--ink-soft)' }}>{t.privBody}</p>
                  </div>
                </div>
                <button onClick={() => setPriv(!priv)} role="switch" aria-checked={priv} aria-label={t.privTitle}
                  className="w-12 h-7 rounded-full p-1 flex items-center shrink-0 transition-colors"
                  style={{ background: priv ? 'var(--sage)' : '#B9AF9C' }}>
                  <span className="w-5 h-5 rounded-full bg-white shadow transition-transform" style={{ transform: priv ? 'translateX(20px)' : 'translateX(0)' }} />
                </button>
              </div>
              <button onClick={() => void sendVoice()} disabled={!canSend || sending}
                className="w-full h-12 rounded-full text-[15px] font-semibold disabled:opacity-45"
                style={{ background: 'var(--sage)', color: '#fff' }}>
                {sending ? t.sendingVoice : t.send}
              </button>
            </div>
          </div>
        )}

        {/* ======================= PHOTO / VIDEO VIEWER ======================= */}
        {viewerItem && (
          <div className="absolute inset-0 z-[60] flex flex-col" style={{ background: 'rgba(20,15,10,.96)', color: 'var(--ivory)' }}
            onTouchStart={e => { swipeRef.current = e.touches[0].clientX; }}
            onTouchEnd={e => {
              const dx = e.changedTouches[0].clientX - swipeRef.current;
              if (Math.abs(dx) > 60) stepViewer(dx < 0 ? 1 : -1);
            }}>
            <div className="flex items-center gap-2 px-3 pt-3 pb-2" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
              <button onClick={() => setViewerId(null)} aria-label={t.close} className={iconBtn} style={darkBtn}><X className="w-5 h-5" /></button>
              <div className="mr-auto min-w-0">
                <p className="font-serif italic text-lg leading-tight truncate">{viewerItem.author}</p>
                <p className="text-[12px] opacity-80">{dateLabel(viewerItem.at)}</p>
              </div>
              {!viewerItem.id.startsWith('local_') && (
                <button onClick={() => toggleFav(viewerItem.id)} aria-label={t.favourite} aria-pressed={viewerItem.isFav} className={iconBtn} style={darkBtn}>
                  <Heart className="w-5 h-5" style={viewerItem.isFav ? { fill: '#E5566D', color: '#E5566D' } : undefined} />
                </button>
              )}
              <button onClick={() => void saveItem(viewerItem)} aria-label={t.download} className={iconBtn} style={darkBtn}><Download className="w-5 h-5" /></button>
              {!viewerItem.id.startsWith('local_') && (
                <button onClick={() => setConfirmId(viewerItem.id)} aria-label={t.remove} className={iconBtn} style={darkBtn}><Trash2 className="w-5 h-5" /></button>
              )}
            </div>
            <div className="relative flex-1 min-h-0 flex items-center justify-center p-3">
              {viewerItem.type === 'photo'
                ? <img src={viewerItem.url} alt={viewerItem.author} className="max-w-full max-h-full object-contain rounded-lg" />
                : <video key={viewerItem.id} src={viewerItem.url} controls autoPlay playsInline className="max-w-full max-h-full rounded-lg" />}
              {viewerList.length > 1 && (
                <>
                  <button onClick={() => stepViewer(-1)} aria-label={t.prev} className={`${iconBtn} absolute left-2`} style={darkBtn}><ChevronLeft className="w-5 h-5" /></button>
                  <button onClick={() => stepViewer(1)} aria-label={t.next} className={`${iconBtn} absolute right-2`} style={darkBtn}><ChevronRight className="w-5 h-5" /></button>
                </>
              )}
            </div>
          </div>
        )}

        {/* ======================= CONFIRM HIDE ======================= */}
        {confirmId && (
          <div className="absolute inset-0 z-[75] flex items-center justify-center p-6" style={{ background: 'rgba(20,15,10,.6)' }}
            onClick={() => setConfirmId(null)}>
            <div role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}
              className="w-full max-w-xs rounded-2xl p-5 space-y-3 text-center" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
              <h2 className="font-serif text-xl font-semibold">{t.removeTitle}</h2>
              <p className="text-[13px]" style={{ color: 'var(--ink-soft)' }}>{t.removeBody}</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmId(null)} className="flex-1 h-11 rounded-full text-[14px] font-semibold border" style={{ borderColor: 'var(--line)' }}>{t.cancel}</button>
                <button onClick={() => hideItem(confirmId)} className="flex-1 h-11 rounded-full text-[14px] font-semibold text-white" style={{ background: 'var(--rose)' }}>{t.remove}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

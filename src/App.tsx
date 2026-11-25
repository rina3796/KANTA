import { useEffect, useState } from 'react';
import WeddingPhotoApp from './WeddingPhotoApp';
import AdminDashboard from './Admin';

// Guests open the normal address. The couple open  https://your-site/#/admin
export default function App() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const f = () => setHash(window.location.hash);
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500;1,600&family=Jost:wght@300;400;500;600&display=swap');

        /* Colour tokens: change a colour here and it changes everywhere */
        :root {
          --night:#1C1713;  --night-2:#2A231D;
          --ivory:#F7F5ED;  --ivory-2:#EFE8D8;  --paper:#FFFDF8;
          --ink:#3E3832;    --ink-soft:#6B6055; --line:#D9CFBD;
          --sage:#66765B;   --sage-soft:#A8B39A;
          --gold:#D4AF3A;   --gold-lite:#E8C766; --gold-deep:#8A6D1F;
          --rose:#B5485D;
        }
        body { margin:0; font-family:'Jost', system-ui, sans-serif; background:var(--ivory); }
        .font-sans { font-family:'Jost', system-ui, sans-serif; }
        .font-serif { font-family:'Cormorant Garamond', Georgia, serif !important; }
        button { cursor:pointer; }
        button:focus-visible, input:focus-visible, label:focus-within {
          outline:2px solid var(--gold-lite); outline-offset:2px;
        }
        @keyframes focusRing { from { transform:scale(1.5); opacity:0; } 25% { opacity:1; } to { transform:scale(1); opacity:.9; } }
        @keyframes recDot { 50% { opacity:.25; } }
        @keyframes recPulse { 0%,100% { box-shadow:0 0 0 0 rgba(181,72,93,.45); } 50% { box-shadow:0 0 0 12px rgba(181,72,93,0); } }
        .focus-ring { animation:focusRing .35s ease-out both; }
        .rec-dot { animation:recDot 1s steps(2) infinite; }
        .rec-pulse { animation:recPulse 1.4s ease-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .focus-ring, .rec-dot, .rec-pulse, .animate-spin { animation:none !important; }
        }
      `}</style>
      {hash === '#/admin' ? <AdminDashboard /> : <WeddingPhotoApp />}
    </>
  );
}

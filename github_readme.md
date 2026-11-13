# 📸 Wedding Disposable Camera & Audio Guestbook (`#KantaKita`)

A nostalgic, disposable-camera-inspired web application built for **Sarah & Syaiful's Wedding** (17 April 2027 at Glass Hall by Lugar De La Boda). 

Guests can capture candid moments with vintage film filters, leave 30-second cassette-style voice wishes, and browse a live shared gallery—no app installation required.

---

## ✨ Features

* **🎞️ Disposable Camera Experience**
  * **3:4 Aspect Ratio Viewfinder** with live vintage film filters (*Asal, Kodak, Fuji, Noir, Hangat*).
  * **Instagram-Style Touch Gestures:** Two-finger pinch-to-zoom (`1x` – `4x`) and one-finger vertical slide to adjust brightness in real time.
  * **Shot Limit:** Simulates a real disposable camera roll (12 shots per guest) with a baked-in vintage timestamp & wedding hashtag watermark (`#SARAH&SYAIFUL`).
  * **Camera Upload:** Guests can also upload existing photos directly from their phone's gallery.
* **🎙️ Retro Cassette Audio Guestbook**
  * Record up to **30 seconds** of audio wishes with an animated cassette tape interface.
  * **Privacy Toggle:** Guests can choose to share wishes publicly in the gallery or send them privately for the bride & groom only.
* **🖼️ Live Shared Gallery & Admin Controls**
  * Real-time photo and audio feed powered by **Supabase**.
  * Filter by `ALL`, `FAVOURITES`, or `WISHES`.
  * Multi-select batch downloading for guests and couples.
  * Dedicated `Admin` dashboard for moderation and management.

---

## 🛠️ Tech Stack

* **Frontend:** React, TypeScript, Vite, Tailwind CSS, Lucide Icons
* **Backend & Storage:** Supabase (PostgreSQL Database & Storage Buckets)
* **Deployment / Local Tunneling:** Cloudflare Tunnels (`cloudflared`)

---

## 🚀 Getting Started

### 1. Clone the repository
```bash
git clone <your-repository-url>
cd wedding-dispo-app
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure Supabase
1. Create a new project on [Supabase](https://supabase.com/).
2. Run the SQL script included in `supabase-setup.sql` inside your Supabase SQL Editor to set up the required tables and storage bucket policies.
3. Create a `.env` file in the root directory and add your Supabase credentials:
```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 4. Run locally
```bash
npm run dev
```

---

## 📱 Testing on Mobile Devices (HTTPS)

Mobile browsers require a secure **HTTPS** connection to access the camera and microphone. To test on your phone during development:

1. Start the Vite dev server (`npm run dev`).
2. In a separate terminal, start a temporary Cloudflare Tunnel:
   ```bash
   npx cloudflared tunnel --url http://localhost:5173
   ```
3. Open the generated `*.trycloudflare.com` link on your smartphone browser.

---

## 📂 Project Structure

```text
├── src/
│   ├── WeddingPhotoApp.tsx   # Main camera, audio recorder, and guest gallery UI
│   ├── Admin.tsx             # Moderation & admin management view
│   ├── supabase.ts           # Supabase client, image compression, and media upload helpers
│   ├── App.tsx               # Root routing and layout
│   └── index.css             # Tailwind CSS configuration
├── supabase-setup.sql        # Database schema and storage policies
├── vite.config.ts            # Vite bundler configuration
└── package.json
```
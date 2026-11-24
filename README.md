# 🎨 RenderX Image Studio (v1.0.0)

**RenderX Image Studio** is a high-speed, professional Bulk AI Image Generator tailored for AI video creators, YouTubers, Shorts/Reels makers, and storytelling channels.

It generates 100–150+ high-quality images in minutes with **Character Consistency**, **Style Consistency**, and **Smart Video Timeline File Naming** (`01. 0-0.5.png`, `02. 0.5-2.7.png`), complete with a `timeline_sync.csv` sheet for instant drag-and-drop video editing in **CapCut, Premiere Pro, and DaVinci Resolve**.

---

## ⚡ Key Features

1. **Full-Tab Dashboard Extension:**
   - Doesn't clutter your browser. Clicking the extension icon opens a dedicated, full-screen software studio.
2. **Multi-Engine Core with Auto-Fallback (Never Stops):**
   - **Gemini Canvas (Default):** Free Google web session engine.
   - **Pollinations FLUX.1:** Free unlimited, no API key required, state-of-the-art photorealism.
   - **Google AI Studio (Imagen 3):** Official Google developer API.
   - *Auto-Fallback Guarantee:* If any engine encounters a rate-limit or error, it seamlessly shifts to FLUX.1 to finish the batch without halting.
3. **Character & Style Lock:**
   - Lock character features (face, age, clothing) with reference image upload and optional descriptions.
   - Lock visual style (medium, lighting, aesthetics) with reference image upload.
4. **1-Click Negative Prompts:**
   - Quick chips for `Bad Anatomy`, `Extra Fingers`, `Blurry`, `Distorted Face`, `Watermark`, etc.
5. **Timeline Sync for Video Creators:**
   - Paste prompts with timestamps (e.g. `0.0-0.5 | Prompt...`).
   - One-click "Auto Sync Timeline" formats raw text with clean 1-line gaps.
   - Downloads a `.zip` file with images named strictly by timeline order + `timeline_sync.csv` and `README_VIDEO_EDITORS.txt`.
6. **Card Management & Regeneration:**
   - Full-screen lightbox preview.
   - Inline prompt editing & single-card regeneration.
   - "Reset All" clears all residual memory for fresh batches.

---

## 🚀 How to Install as a Chrome Extension

1. Open Google Chrome (or Microsoft Edge / Brave).
2. Go to `chrome://extensions/` in your URL bar.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** (button in the top-left).
5. Select this folder:
   `C:\Users\Raselur Rahman\Desktop\SaaS Tools\Render X. Image Studio`
6. Pin **RenderX Image Studio** to your extension bar.
7. Click the icon anytime to open the full-screen studio!

---

## 💻 How to Run as a Standalone Web App

- Simply double-click **`start.bat`** (or open `studio.html` directly in your browser).
- You can also click **"Install App"** in Chrome's address bar to install it as a desktop shortcut on your Windows taskbar.

---

## 📦 Version History

- **v1.0.0** — Initial production release with multi-engine auto-fallback, timeline parsing, character/style lock, and zero-dependency ZIP exporter.

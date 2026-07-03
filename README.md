# App Store Screenshot Generator

A free, open-source tool for creating beautiful App Store screenshots with customizable backgrounds, text overlays, and 3D device mockups.


**[Start using it now. Hosted on GitHub Pages](https://yuzu-hub.github.io/appscreen/)**

![App Store Screenshot Generator](img/screenshot-generator.png)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> 🍋 **Built by [YuzuHub](https://yuzuhub.com)** — We build smart AI products in Düsseldorf, Germany. Check out [yuzu.chat](https://yuzu.chat), [Eno](https://eno.yuzuhub.com), [VoltPlan](https://voltplan.app) and more.

## Features

### Output & Export
- **Multiple Output Sizes**: iPhone 6.9", 6.7", 6.5", 5.5" and iPad 12.9", 11" App Store requirements, plus custom sizes
- **Batch Export**: Export all screenshots at once as a ZIP file
- **Per-Screenshot Settings**: Each screenshot can have its own background, device settings, and text

### Backgrounds
- **Gradient Backgrounds**: Multi-stop gradients with draggable color stops and angle control
- **Preset Gradients**: Quick-access gradient presets for common styles
- **Solid Color**: Simple single-color backgrounds
- **Image Backgrounds**: Upload custom images with blur, overlay, and fit options
- **Noise Overlay**: Add subtle noise texture to any background

### Device Mockups
- **2D Mode**: Position, scale, rotate, and adjust corner radius of screenshots
- **3D Mode**: Interactive iPhone 15 Pro Max 3D mockup with drag-to-rotate
- **Position Presets**: Centered, bleed, tilt left/right, perspective, and more
- **Shadow Effects**: Customizable drop shadows with color, blur, opacity, and offset
- **Border Effects**: Add borders around screenshots with adjustable width and opacity

### Text Overlays
- **Headlines & Subheadlines**: Separate controls with enable/disable toggles
- **Font Picker**: Access to 1500+ Google Fonts with search and preview
- **Text Styling**: Font weight, italic, underline, strikethrough options
- **Positioning**: Top, center, or bottom placement with offset control
- **Line Height**: Adjustable spacing for multi-line text

### Multi-Language Support
- **Multiple Languages**: Add translations for any language
- **Language Flags**: Visual language switcher with flag icons
- **AI-Powered Translation**: Auto-translate using Claude, OpenAI, or Google AI
- **Per-Screenshot Languages**: Different text per screenshot if needed
- **Localized Screenshots**: Upload language-specific screenshot images with auto-detection from filename
- **Smart Duplicate Detection**: Dialog to replace, create new, or skip when uploading matching screenshots
- **Multi-Language Export**: Export current language only or all languages in separate folders

### Project Management
- **Multiple Projects**: Create, rename, and delete projects
- **Auto-Save**: All changes saved automatically to browser storage
- **Screenshot Count**: See screenshot counts in project selector

### User Interface
- **Dark Theme**: Easy on the eyes for extended editing sessions
- **Side Preview Carousel**: See adjacent screenshots while editing
- **Drag & Drop**: Reorder screenshots by dragging
- **Collapsible Sections**: Clean UI with expandable settings panels
- **Tab Persistence**: Remembers your active tab between sessions

## Getting Started

### Just Want to Use It?

Visit **[yuzu-hub.github.io/appscreen](https://yuzu-hub.github.io/appscreen/)** to use the tool directly in your browser. No installation needed!

---

### Want to Develop & Customize?

#### Option 1: With Claude Desktop (Easiest - No Technical Knowledge Required)

Perfect for non-technical users who want to run and modify the tool locally with AI assistance:

1. **Install GitHub Desktop**
   - Download from [desktop.github.com](https://desktop.github.com)
   - Install and sign in with your GitHub account

2. **Clone this repository**
   - Click the green "Code" button above → "Open with GitHub Desktop"
   - Choose where to save it (e.g., Documents folder)

3. **Install Claude Desktop**
   - Download from [claude.ai/download](https://claude.ai/download)
   - Sign in with your Anthropic account

4. **Open in Claude Desktop**
   - Open Claude Desktop app
   - Click the "Code" tab at the top
   - Click "Open Folder" and select the cloned repository folder

5. **Start the app**
   - Simply type: **"start the app"**
   - Claude will automatically start the server and tell you which URL to open in your browser
   - Claude monitors the server and reports any issues

6. **Make changes**
   - Ask Claude to modify features, fix bugs, or add functionality
   - Claude will show you the proposed commit message before committing
   - All changes are automatically saved to Git

No command line, no technical setup - just chat with Claude!

#### Option 2: Run Locally (Command Line)

Since this app uses IndexedDB for persistence, you need to serve it through a local web server:

```bash
# Using Python
cd appscreen
python3 -m http.server 8000

# Using Node.js
npx serve .
```

Then open `http://localhost:8000` in your browser.

#### Option 3: VS Code Live Server

If you have the "Live Server" extension installed in VS Code, right-click `index.html` and select "Open with Live Server".

#### Option 4: Docker

Run the pre-built Docker image from GitHub Container Registry:

```bash
# Using Docker directly
docker run -d -p 8080:80 ghcr.io/yuzu-hub/appscreen:latest

# Using Docker Compose
docker compose up -d
```

Then open `http://localhost:8080` in your browser.

#### Building locally

If you want to build the image yourself:

```bash
docker compose -f docker-compose.build.yml up -d
```

> The container now runs a small Node server (instead of nginx-only) so it can
> both serve the frontend and perform the App Store Connect upload. It listens on
> port `3000` inside the container.

## NAS Deployment + App Store Connect Upload

You can run the app on a NAS via a **self-hosted GitHub Actions runner** and push
your rendered screenshots straight to App Store Connect with one click.

### Why a backend is needed

The App Store Connect API cannot be called from the browser (no CORS) and the
private `.p8` signing key must never be exposed to the client. The container
therefore includes a Node backend (`server/`) that signs the ES256 JWT and runs
Apple's upload flow (reserve → upload parts → MD5 checksum → commit). The
**Upload to App Store Connect** button is always visible; when the backend is
missing (static hosting) or has no credentials, clicking it shows setup
instructions instead of the upload dialog.

### 1. Create an App Store Connect API key

1. In App Store Connect go to **Users and Access → Integrations → App Store Connect API**.
2. Create a key with the **App Manager** role (or higher) and download the
   `AuthKey_XXXXXXXXXX.p8` file (you can only download it once).
3. Note the **Issuer ID** (top of the page) and the **Key ID**.

### 2. Provide the credentials — web UI or GitHub secrets

**Easiest: in the web UI.** Open the app, click **Upload to App Store Connect**
and enter Issuer ID, Key ID and the `.p8` key (or load the file). They are stored
server-side in the Docker volume `appscreen-data` and survive container rebuilds.

**Alternatively via GitHub secrets** (used as fallback when nothing is saved in
the UI). In the repo, under **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
|--------|-------|
| `ASC_ISSUER_ID` | the Issuer ID |
| `ASC_KEY_ID` | the Key ID |
| `ASC_PRIVATE_KEY` | the full contents of the `AuthKey_XXXX.p8` file (including the `-----BEGIN/END PRIVATE KEY-----` lines) |

### 3. Set up the self-hosted runner on the NAS

1. Install Docker + the Docker Compose plugin on the NAS.
2. Add a **self-hosted runner** (repo **Settings → Actions → Runners**) on the NAS
   and give it the label **`nas`** (the workflow targets `runs-on: [self-hosted, nas]`).

### 4. Deploy

Push to the deploy branch or run the **Deploy to NAS** workflow manually
(**Actions → Deploy to NAS → Run workflow**). It runs on the NAS runner and does:

```bash
docker compose -f docker-compose.nas.yml up -d --build
```

The app is then available at `http://<nas-host>:11112`. Credentials are passed to
the container as environment variables from the GitHub Secrets — nothing sensitive
is written to disk or committed.

You can also run it manually on the NAS without the workflow:

```bash
export ASC_ISSUER_ID=... ASC_KEY_ID=... ASC_PRIVATE_KEY="$(cat AuthKey_XXXX.p8)"
docker compose -f docker-compose.nas.yml up -d --build
```

### 5. Upload screenshots

1. Open the app on the NAS, create/style your screenshots.
2. Click **Upload to App Store Connect** (only visible when the backend has
   credentials).
3. Pick the **app**, an **editable version** (e.g. *Prepare for Submission*), the
   **language**, and the **device / screenshot display type** (defaults to match
   your current output size), then choose current or all screenshots and upload.

> **Note:** App Store Connect only accepts screenshots for a version in an editable
> state and only at the exact pixel dimensions Apple requires for each display
> type. Make sure your output size matches the selected device.

## Usage

1. **Upload Screenshots**: Drag and drop your app screenshots or click to browse
2. **Choose Output Size**: Select the target device size from the sidebar
3. **Customize Background**: Choose gradient, solid color, or image background
4. **Position Screenshot**: Use presets or manually adjust scale, position, and rotation
5. **Switch to 3D** (optional): Enable 3D mode for interactive iPhone mockup
6. **Add Text**: Enter your headline and optional subheadline
7. **Export**: Download the current screenshot or export all at once as ZIP

## AI Translation

To use the AI-powered translation feature:

1. Click the Settings icon (gear) in the sidebar
2. Choose your AI provider (Claude, OpenAI, or Google)
3. Enter your API key from the respective provider's console
4. Add multiple languages to your headline/subheadline
5. Click the translate icon and use "Auto-translate with AI"

Your API key is stored locally in your browser and only sent to the respective AI provider's API.

## Tech Stack

- Vanilla JavaScript (no frameworks)
- HTML5 Canvas for 2D rendering
- Three.js for 3D device mockups
- IndexedDB for local storage
- JSZip for batch export
- Google Fonts API for font picker
- Claude/OpenAI/Google APIs for translations
- Node + Express backend (static hosting + App Store Connect upload)
- Docker for containerized deployment

## Apps Using This Project

Built something with this tool? Add your app to the list by submitting a pull request!

| App | Description | Link |
|-----|-------------|------|
| Cable | Manage your 12V systems like Boats and RVs | [cable.yuzuhub.com](https://cable.yuzuhub.com) |
| Eno | Wine pairings and food pairings made easy | [eno.yuzuhub.com](https://eno.yuzuhub.com) |
| TravelRates Currency Converter* | Exchange Rates for Travelers | [apple.com](https://apps.apple.com/sg/app/travelrates-currency-converter/id6756080378) |
| Trakz Sales Tracker | Manage sales for restaurants and small businesses | [apple.com](https://apps.apple.com/us/app/trakz-sales-tracker/id6748954468) |
| AI Soccer Insights Football IQ | AI-powered football predictions and insights | [apple.com](https://apps.apple.com/us/app/ai-soccer-insights-football-iq/id6592649804) |
| Navegatime | time tracking for workers and business functions | [play.google.com](https://play.google.com/store/apps/details?id=com.companyname.NavegaTime) |
| Sommo | Your personal wine journey — scan labels, learn wine, and build your tasting journal | [sommo.app](https://sommo.app) |
| Dandelion: Write and Let Go | An ephemeral journal for writing to let go, not save. | [apple.com](https://apps.apple.com/us/app/dandelion-write-and-let-go/id6757363901) |
| *Your app here* | *Submit a PR to add your app* | *Your app link* |

## License

MIT License - feel free to use, modify, and distribute.

## Credits
- **Samsung Galaxy S25 Ultra 3D Model** by [mistJS](https://sketchfab.com/mistjs) - Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

- **iPhone 15 Pro Max 3D Model** by [MajdyModels](https://sketchfab.com/majdymodels) - Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

## Author

Proudly vibe coded by [Stefan](https://github.com/BlackMac) at [YuzuHub](https://yuzuhub.com/en) — building smart AI products from Düsseldorf, Germany.

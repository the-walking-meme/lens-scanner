# 🔬 LensScan — IOL Tracker

> AI-powered intraocular lens label scanner built for a real retina clinic.

**[Live Demo →](https://lens-scanner.vercel.app)**

LensScan lets clinic staff photograph intraocular lens (IOL) labels and automatically extracts the lens data using AI vision — no manual entry required. Inventory is logged in real time to Google Sheets, giving the clinic an always-up-to-date record of lens stock.

---

## 📸 Screenshots

![LensScan Demo](screenshots/demo.png)

---

## ✨ Features

- 📷 **AI Label Scanning** — photograph any IOL label and Claude Vision extracts the data automatically
- 📊 **Live Inventory Tracking** — every scan is logged instantly to Google Sheets
- 📱 **Mobile-First** — designed for use on a phone in a clinic environment
- 🔐 **Secure Auth** — Google OAuth 2.0 for staff login
- ☁️ **Production Deployed** — live on Vercel with secure environment variable management

---

## 🛠 Tech Stack

![React](https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat&logo=vite&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=flat&logo=vercel&logoColor=white)

| Layer | Technology |
|---|---|
| Frontend | React.js, JavaScript (ES6+), Tailwind CSS |
| AI Vision | Anthropic Claude Vision API |
| Inventory | Google Sheets API |
| Auth | Google OAuth 2.0 |
| Build Tool | Vite |
| Deployment | Vercel |

---

## 🚀 Running Locally

**1. Clone the repo**
```bash
git clone https://github.com/the-walking-meme/lens-scanner.git
cd lens-scanner
```

**2. Install dependencies**
```bash
npm install
```

**3. Set up environment variables**

Create a `.env` file in the root directory:
```
VITE_ANTHROPIC_API_KEY=your_claude_api_key
VITE_GOOGLE_CLIENT_ID=your_google_oauth_client_id
VITE_GOOGLE_SHEETS_ID=your_google_sheet_id
```

**4. Start the dev server**
```bash
npm run dev
```

---

## 📁 Project Structure

```
lens-scanner/
├── src/
│   ├── components/     # React components
│   ├── utils/          # API helpers (Claude, Google Sheets)
│   └── App.jsx         # Root component
├── public/
├── screenshots/        # Demo screenshots
└── .env.example        # Environment variable template
```

---

## 🔑 API Setup

**Anthropic Claude API**
- Get a key at [console.anthropic.com](https://console.anthropic.com)

**Google Sheets + OAuth**
- Enable the Sheets API in [Google Cloud Console](https://console.cloud.google.com)
- Create OAuth 2.0 credentials
- Share your target Google Sheet with the service account

---

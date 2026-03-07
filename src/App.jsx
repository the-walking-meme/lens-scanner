import { useState, useRef, useCallback } from "react";

const GOOGLE_SHEETS_CONFIG = {
  SPREADSHEET_ID: import.meta.env.VITE_SPREADSHEET_ID,
  API_KEY: import.meta.env.VITE_API_KEY,
  CLIENT_ID: import.meta.env.VITE_CLIENT_ID,
  SHEET_NAME: new Date().toLocaleString('default', { month: 'long', year: 'numeric' }),
};

const FIELDS = ["brand", "lensType", "serialNumber", "power"];
const FIELD_LABELS = {
  brand: "Brand / Manufacturer",
  lensType: "Lens Type",
  serialNumber: "Serial Number (SN)",
  power: "Power",
};
const STATUSES = ["Recieved", "Used", "Returned"];

// ── Utility ──────────────────────────────────────────────────────────────────

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Google Sheets helpers ─────────────────────────────────────────────────────

let gapiLoaded = false;
let gisLoaded = false;
let tokenClient = null;

async function loadGapi() {
  if (gapiLoaded) return;
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://apis.google.com/js/api.js";
    s.onload = () => {
      window.gapi.load("client", async () => {
        await window.gapi.client.init({
          apiKey: GOOGLE_SHEETS_CONFIG.API_KEY,
          discoveryDocs: ["https://sheets.googleapis.com/$discovery/rest?version=v4"],
        });
        gapiLoaded = true;
        resolve();
      });
    };
    document.head.appendChild(s);
  });
}

async function loadGis() {
  if (gisLoaded) return;
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.onload = () => {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_SHEETS_CONFIG.CLIENT_ID,
        scope: "https://www.googleapis.com/auth/spreadsheets",
        callback: () => {},
      });
      gisLoaded = true;
      resolve();
    };
    document.head.appendChild(s);
  });
}

async function ensureSheetExists(spreadsheetId, sheetName) {
  const response = await window.gapi.client.sheets.spreadsheets.get({ spreadsheetId });
  const sheets = response.result.sheets.map(s => s.properties.title);
  if (!sheets.includes(sheetName)) {
    await window.gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [{
          addSheet: {
            properties: {
              title: sheetName
            }
          }
        }]
      }
    });
    // Add headers to new sheet
    await window.gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [["Brand", "Lens Type", "Serial Number", "Power", "Received", "Used", "Returned"]] }
    });
  }
}

async function findExistingRow(spreadsheetId, sheetName, serialNumber) {
  const response = await window.gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:G`,
  });
  const rows = response.result.values || [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][2] === serialNumber) return i + 1;
  }
  return null;
}

async function authorizeAndAppend(rowData, lensStatus) {
  await loadGapi();
  await loadGis();
  return new Promise((resolve, reject) => {
    tokenClient.callback = async (resp) => {
      if (resp.error) { reject(new Error(resp.error)); return; }
      try {
        await ensureSheetExists(GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID, GOOGLE_SHEETS_CONFIG.SHEET_NAME);
        const timestamp = new Date().toLocaleString();
        const spreadsheetId = GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID;
        const sheetName = GOOGLE_SHEETS_CONFIG.SHEET_NAME;
        const existingRow = await findExistingRow(spreadsheetId, sheetName, rowData.serialNumber);
        const statusColMap = { Received: "E", Used: "F", Returned: "G" };
        const statusCol = statusColMap[lensStatus];

        if (existingRow) {
          const rowResponse = await window.gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!${statusCol}${existingRow}`,
          });
          const existing = rowResponse.result.values?.[0]?.[0];
          if (existing) {
            reject(new Error(`This lens was already marked as ${lensStatus} on ${existing}`));
            return;
          }
          await window.gapi.client.sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheetName}!${statusCol}${existingRow}`,
            valueInputOption: "USER_ENTERED",
            resource: { values: [[timestamp]] },
          });
        } else {
          const receivedTs = lensStatus === "Received" ? timestamp : "";
          const usedTs = lensStatus === "Used" ? timestamp : "";
          const returnedTs = lensStatus === "Returned" ? timestamp : "";
          await window.gapi.client.sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `${sheetName}!A1`,
            valueInputOption: "USER_ENTERED",
            resource: {
              values: [[rowData.brand, rowData.lensType, rowData.serialNumber, rowData.power, receivedTs, usedTs, returnedTs]],
            },
          });
        }
        resolve();
      } catch (e) { reject(e); }
    };
    if (window.gapi.client.getToken() === null) {
      tokenClient.requestAccessToken({ prompt: "consent" });
    } else {
      tokenClient.requestAccessToken({ prompt: "" });
    }
  });
}

// ── Claude Vision parse ───────────────────────────────────────────────────────

async function parseLabelWithClaude(base64Image, mediaType) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      "x-api-key": import.meta.env.VITE_ANTH_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64Image },
          },
          {
            type: "text",
            text: `You are a medical device label parser for a retina clinic. Analyze this intraocular lens (IOL) or ophthalmic lens label image.

Extract the following fields and respond ONLY with valid JSON (no markdown, no extra text):
{
  "brand": "manufacturer/brand name or empty string",
  "lensType": "lens model/type name or empty string",
  "serialNumber": "serial number or lot number or empty string",
  "power": "optical power in diopters (e.g. +21.0 D) or empty string"
}

If a field cannot be determined, use an empty string. Be precise with the power value including sign and unit.`,
          },
        ],
      }],
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || "Claude API error");
  }

  const data = await response.json();
  const text = data.content.map((b) => b.text || "").join("");
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ── Components ────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{
      width: 40, height: 40, borderRadius: "50%",
      border: "3px solid #1a3a4a", borderTopColor: "#00c9a7",
      animation: "spin 0.8s linear infinite",
      margin: "0 auto",
    }} />
  );
}

function StatusBadge({ status }) {
  const styles = {
    idle: { bg: "#1a3a4a", color: "#7ab8c8" },
    scanning: { bg: "#0d2d3a", color: "#00c9a7" },
    success: { bg: "#0d3a2a", color: "#00e676" },
    error: { bg: "#3a1a1a", color: "#ff5252" },
    saving: { bg: "#1a2a3a", color: "#ffd740" },
  };
  const s = styles[status] || styles.idle;
  return (
    <span style={{
      background: s.bg, color: s.color,
      padding: "4px 12px", borderRadius: 20,
      fontSize: 12, fontFamily: "'DM Mono', monospace",
      letterSpacing: "0.05em", textTransform: "uppercase",
      border: `1px solid ${s.color}40`,
    }}>
      {status}
    </span>
  );
}

export default function LensScanner() {
  const [status, setStatus] = useState("idle");
  const [preview, setPreview] = useState(null);
  const [fields, setFields] = useState({ brand: "", lensType: "", serialNumber: "", power: "" });
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [imageData, setImageData] = useState(null);
  const [lensStatus, setLensStatus] = useState("Received");
  const fileRef = useRef();
  const cameraRef = useRef();

  const handleImage = useCallback(async (file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    setStatus("scanning");
    setMessage("Scanning label with AI…");
    try {
      const b64 = await fileToBase64(file);
      const mime = file.type || "image/jpeg";
      setImageData({ b64, mime });
      const parsed = await parseLabelWithClaude(b64, mime);
      setFields(parsed);
      setStatus("success");
      setMessage("Label parsed successfully. Review and save.");
    } catch (e) {
      setStatus("error");
      setMessage("Could not parse label: " + e.message);
    }
  }, []);

  const handleSave = async () => {
    if (!fields.serialNumber && !fields.lensType) {
      setMessage("Please fill in at least Lens Type or Serial Number.");
      return;
    }
    setStatus("saving");
    setMessage("Saving to Google Sheets…");
    try {
      await authorizeAndAppend(fields, lensStatus);
      setHistory((h) => [{ ...fields, lensStatus, time: new Date().toLocaleTimeString() }, ...h.slice(0, 19)]);
      setStatus("idle");
      setMessage("✓ Saved to Google Sheets!");
      setFields({ brand: "", lensType: "", serialNumber: "", power: "" });
      setPreview(null);
      setImageData(null);
    } catch (e) {
      setStatus("error");
      setMessage("Save failed: " + e.message);
    }
  };

  const handleReset = () => {
    setStatus("idle");
    setPreview(null);
    setFields({ brand: "", lensType: "", serialNumber: "", power: "" });
    setMessage("");
    setImageData(null);
    setLensStatus("Received");
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(160deg, #071520 0%, #0b2030 50%, #071a28 100%)",
      fontFamily: "'DM Sans', sans-serif",
      color: "#cce8f0",
      padding: "0 0 80px 0",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@300;400;500;600&family=Syne:wght@700;800&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
        input:focus { outline: none; border-color: #00c9a7 !important; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #071520; }
        ::-webkit-scrollbar-thumb { background: #1a4a5a; border-radius: 2px; }
      `}</style>

      {/* Header */}
      <div style={{
        background: "linear-gradient(90deg, #071520 0%, #0d2535 100%)",
        borderBottom: "1px solid #1a4a5a",
        padding: "20px 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 100,
        backdropFilter: "blur(10px)",
      }}>
        <div>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", color: "#fff" }}>
            <span style={{ color: "#00c9a7" }}>LENS</span>SCAN
          </div>
          <div style={{ fontSize: 11, color: "#4a8a9a", fontFamily: "'DM Mono', monospace", letterSpacing: "0.1em" }}>
            RETINA CLINIC · IOL TRACKER
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <StatusBadge status={status} />
          <button onClick={() => setShowHistory(!showHistory)} style={{
            background: showHistory ? "#1a4a5a" : "transparent",
            border: "1px solid #1a4a5a", borderRadius: 8, padding: "6px 12px",
            color: "#7ab8c8", fontSize: 12, cursor: "pointer",
            fontFamily: "'DM Mono', monospace",
          }}>
            LOG ({history.length})
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 480, margin: "0 auto", padding: "24px 20px" }}>

        {/* Camera / Upload Area */}
        {!preview ? (
          <div style={{ animation: "fadeIn 0.4s ease" }}>
            <div
              onClick={() => cameraRef.current?.click()}
              style={{
                background: "linear-gradient(135deg, #0d2535 0%, #0a1e2e 100%)",
                border: "2px dashed #1a4a5a",
                borderRadius: 20,
                padding: "48px 24px",
                textAlign: "center",
                cursor: "pointer",
                transition: "all 0.2s",
                marginBottom: 16,
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#00c9a7"; e.currentTarget.style.background = "linear-gradient(135deg, #0d3040 0%, #0a2535 100%)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#1a4a5a"; e.currentTarget.style.background = "linear-gradient(135deg, #0d2535 0%, #0a1e2e 100%)"; }}
            >
              <div style={{ fontSize: 56, marginBottom: 12 }}>📷</div>
              <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 6 }}>
                Capture Lens Label
              </div>
              <div style={{ color: "#4a8a9a", fontSize: 14 }}>Tap to open camera</div>
            </div>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment"
              style={{ display: "none" }} onChange={e => handleImage(e.target.files[0])} />

            <div style={{ textAlign: "center", color: "#2a5a6a", fontSize: 13, marginBottom: 16 }}>— or —</div>

            <button onClick={() => fileRef.current?.click()} style={{
              width: "100%", background: "transparent",
              border: "1px solid #1a4a5a", borderRadius: 12,
              padding: "14px", color: "#7ab8c8", fontSize: 14,
              cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
              transition: "all 0.2s",
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#00c9a7"; e.currentTarget.style.color = "#00c9a7"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#1a4a5a"; e.currentTarget.style.color = "#7ab8c8"; }}
            >
              Upload Image File
            </button>
            <input ref={fileRef} type="file" accept="image/*"
              style={{ display: "none" }} onChange={e => handleImage(e.target.files[0])} />
          </div>
        ) : (
          <div style={{ animation: "fadeIn 0.4s ease" }}>
            {/* Preview */}
            <div style={{ position: "relative", marginBottom: 20 }}>
              <img src={preview} alt="Lens label" style={{
                width: "100%", borderRadius: 16,
                border: "1px solid #1a4a5a",
                maxHeight: 240, objectFit: "contain",
                background: "#071520",
              }} />
              <button onClick={handleReset} style={{
                position: "absolute", top: 10, right: 10,
                background: "#071520cc", border: "1px solid #1a4a5a",
                borderRadius: 8, padding: "4px 10px", color: "#7ab8c8",
                fontSize: 12, cursor: "pointer",
              }}>✕ Reset</button>
            </div>

            {/* Scanning indicator */}
            {status === "scanning" && (
              <div style={{ textAlign: "center", padding: "24px 0", animation: "fadeIn 0.3s ease" }}>
                <Spinner />
                <div style={{ marginTop: 12, color: "#00c9a7", fontFamily: "'DM Mono', monospace", fontSize: 13, animation: "pulse 1.5s ease infinite" }}>
                  Analyzing label…
                </div>
              </div>
            )}
          </div>
        )}

        {/* Message */}
        {message && (
          <div style={{
            margin: "16px 0",
            padding: "12px 16px",
            borderRadius: 10,
            background: status === "error" ? "#3a1a1a" : status === "success" ? "#0d3a2a" : "#1a2a3a",
            border: `1px solid ${status === "error" ? "#ff525240" : status === "success" ? "#00e67640" : "#00c9a740"}`,
            color: status === "error" ? "#ff5252" : status === "success" ? "#00e676" : "#ffd740",
            fontSize: 13, fontFamily: "'DM Mono', monospace",
            animation: "fadeIn 0.3s ease",
          }}>
            {message}
          </div>
        )}

        {/* Fields form */}
        {(status === "success" || status === "saving" || (status === "idle" && preview)) && (
          <div style={{ animation: "fadeIn 0.4s ease" }}>
            <div style={{
              background: "linear-gradient(135deg, #0d2535 0%, #0a1e2e 100%)",
              border: "1px solid #1a4a5a",
              borderRadius: 20,
              padding: 20,
              marginBottom: 16,
            }}>
              <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 14, fontWeight: 700, color: "#7ab8c8", marginBottom: 16, letterSpacing: "0.05em" }}>
                EXTRACTED DATA — REVIEW &amp; EDIT
              </div>
              {FIELDS.map(key => (
                <div key={key} style={{ marginBottom: 16 }}>
                  <label style={{ display: "block", fontSize: 11, fontFamily: "'DM Mono', monospace", color: "#4a8a9a", letterSpacing: "0.1em", marginBottom: 6, textTransform: "uppercase" }}>
                    {FIELD_LABELS[key]}
                  </label>
                  <input
                    value={fields[key]}
                    onChange={e => setFields(f => ({ ...f, [key]: e.target.value }))}
                    placeholder={`Enter ${FIELD_LABELS[key]}…`}
                    style={{
                      width: "100%", boxSizing: "border-box",
                      background: "#071a28",
                      border: "1px solid #1a4a5a",
                      borderRadius: 10,
                      padding: "12px 14px",
                      color: fields[key] ? "#fff" : "#2a5a6a",
                      fontSize: 15,
                      fontFamily: fields[key] ? "'DM Mono', monospace" : "'DM Sans', sans-serif",
                      transition: "border-color 0.2s",
                    }}
                  />
                </div>
              ))}
            </div>
            {/* Lens Status Selector */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: "#4a8a9a", letterSpacing: "0.1em", marginBottom: 10, textTransform: "uppercase" }}>
                Mark As
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {STATUSES.map(s => (
                  <button
                    key={s}
                    onClick={() => setLensStatus(s)}
                    style={{
                      flex: 1, padding: "12px 6px", borderRadius: 10,
                      border: `1px solid ${lensStatus === s ? s === "Received" ? "#00c9a7" : s === "Used" ? "#ffd740" : "#ff5252" : "#1a4a5a"}`,
                      background: lensStatus === s ? s === "Received" ? "#003d33" : s === "Used" ? "#3a3000" : "#3a0000" : "transparent",
                      color: lensStatus === s ? s === "Received" ? "#00c9a7" : s === "Used" ? "#ffd740" : "#ff5252" : "#4a8a9a",
                      fontSize: 13, fontFamily: "'DM Mono', monospace",
                      cursor: "pointer", transition: "all 0.2s",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={handleSave}
              disabled={status === "saving"}
              style={{
                width: "100%",
                background: status === "saving" ? "#1a3a4a" : "linear-gradient(135deg, #00c9a7 0%, #00a88a 100%)",
                border: "none",
                borderRadius: 14,
                padding: "18px",
                color: status === "saving" ? "#4a8a9a" : "#071520",
                fontSize: 16,
                fontWeight: 600,
                fontFamily: "'Syne', sans-serif",
                cursor: status === "saving" ? "not-allowed" : "pointer",
                letterSpacing: "0.02em",
                transition: "all 0.2s",
                boxShadow: status === "saving" ? "none" : "0 4px 24px #00c9a730",
              }}
            >
              {status === "saving" ? "Saving…" : "Save to Google Sheets →"}
            </button>
          </div>
        )}

        {/* History panel */}
        {showHistory && (
          <div style={{ marginTop: 24, animation: "fadeIn 0.3s ease" }}>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 14, fontWeight: 700, color: "#7ab8c8", marginBottom: 12, letterSpacing: "0.05em" }}>
              RECENT ENTRIES
            </div>
            {history.length === 0 ? (
              <div style={{ color: "#2a5a6a", fontSize: 13, textAlign: "center", padding: "24px 0" }}>No entries yet this session.</div>
            ) : history.map((entry, i) => (
              <div key={i} style={{
                background: "#0d2535",
                border: "1px solid #1a4a5a",
                borderRadius: 12,
                padding: "12px 14px",
                marginBottom: 10,
                animation: "fadeIn 0.3s ease",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ color: "#00c9a7", fontFamily: "'DM Mono', monospace", fontSize: 12 }}>{entry.serialNumber || "—"}</span>
                  <span style={{ color: "#2a5a6a", fontSize: 11, fontFamily: "'DM Mono', monospace" }}>{entry.time}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13, color: "#7ab8c8" }}>
                    {[entry.brand, entry.lensType, entry.power].filter(Boolean).join(" · ") || "No data"}
                  </span>
                  <span style={{
                    fontSize: 11, fontFamily: "'DM Mono', monospace",
                    color: entry.lensStatus === "Received" ? "#00c9a7" : entry.lensStatus === "Used" ? "#ffd740" : "#ff5252",
                    border: `1px solid ${entry.lensStatus === "Received" ? "#00c9a740" : entry.lensStatus === "Used" ? "#ffd74040" : "#ff525240"}`,
                    padding: "2px 8px", borderRadius: 10,
                  }}>
                    {entry.lensStatus}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
# Tsidu Inventory Management System

A multi-store inventory, dispatch, return, and sales tracking application with an ultra-modern glassmorphic UI, smart field automations, and Google Sheets cloud storage.

![Tsidu Inventory Preview](https://img.shields.io/badge/Interface-Glassmorphism-6366f1?style=for-the-badge)
![Storage-Google%20Sheets-10b981](https://img.shields.io/badge/Storage-Google%20Sheets-10b981?style=for-the-badge)
![Status-Active-38bdf8](https://img.shields.io/badge/Status-Active-38bdf8?style=for-the-badge)

---

## ✨ Features

### 🪟 Ultra-Modern Glassmorphic & Minimal UI
- **Frosted Glass Aesthetic**: Multi-layered backdrop blurs (`backdrop-filter: blur(20px)`), luminous border highlights, ambient mesh gradients, and sleek typography (`Plus Jakarta Sans`).
- **Dark & Light Modes**: Seamless theme switching with high-contrast obsidian glass and airy frosty glass.
- **Consistent Currency**: Standardized Ethiopian Birr (`ETB`) formatting across all modules.

### ⚡ Smart Field Automations
- **Auto-Generated SKU**: Product names dynamically produce clean, standardized codes (e.g. `Special White Bread` $\rightarrow$ `SWB-412`) with an instant `⚡ Auto SKU` action button.
- **Automatic Today's Date**: Dispatch and payment forms auto-fill the current local date.
- **Dispatch Quick Fill & Real-time Value**: One-click `⚡ Fill Max Stock` and `✕ Clear All` with live calculating counters for total units and estimated total value in ETB.
- **Smart Returns & Sales**: One-click `⚡ Mark All Sold` and `↩ Mark All Returned` presets, plus bidirectional synchronization between Sold and Returned quantities.
- **Driver Phone Auto-Formatting**: Automatic hyphenation and formatting for Ethiopian and international phone numbers.
- **Payment Autocomplete**: Dynamic `<datalist>` suggesting registered drivers and stores.
- **Instant Search & Filtering**: Fast client-side search across Stock, Drivers, Payments, and Trip Logs.

### 📊 Google Sheets Cloud Storage
- **Direct Code Integration**: Point `GOOGLE_SHEETS_WEBAPP_URL` in `app.js` to your Google Apps Script Web App URL.
- **Automated Tab Generation**: Synchronizes data across structured human-readable Google Sheets tabs (`Products`, `Drivers`, `Trips`, `Payments`, `RAW_STATE`).
- **Offline-Resilient**: Saves immediately to `localStorage` and synchronizes debounced updates to Google Sheets in the background.

### 🏪 Multi-Store & Role-Based Access
- **Multi-Store Management**: Supports multiple branches (e.g., *Burrayu*, *Jimma*).
- **Owner & Storekeeper Roles**:
  - **Owner**: Full oversight, store management, and account assignments.
  - **Storekeeper**: Assigned to their respective store branch for daily stock and trip entries.

---

## 🚀 Quick Start

1. Clone or download the repository:
   ```bash
   git clone https://github.com/Yonatan996/tsidu.git
   cd tsidu
   ```

2. Open `index.html` in any web browser (no build steps or servers required!).

---

## 📈 Setting Up Google Sheets Cloud Sync

1. Open [Google Sheets](https://sheets.new) and create a new spreadsheet.
2. Go to **Extensions > Apps Script**.
3. Replace the default code with the contents of [`GoogleAppsScript.gs`](./GoogleAppsScript.gs).
4. Click **Deploy > New deployment**:
   - **Type**: Web app
   - **Execute as**: `Me`
   - **Who has access**: `Anyone`
5. Copy the generated Web App URL (`https://script.google.com/macros/s/.../exec`).
6. Paste the URL into line 16 of `app.js`:
   ```javascript
   const GOOGLE_SHEETS_WEBAPP_URL = 'YOUR_WEB_APP_URL_HERE';
   ```

---

## 📁 Project Structure

```
Tsidu/
├── index.html            # Main HTML application markup
├── style.css             # Glassmorphic and responsive stylesheet
├── app.js                # Core state management, field automation & sync logic
├── GoogleAppsScript.gs   # Backend script for Google Sheets sync
├── .gitignore            # Git ignore file
└── README.md             # Project documentation
```

---

## 📝 License

MIT License. Designed & Developed for Tsidu Store Inventory.

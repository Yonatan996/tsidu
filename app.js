// app.js - Tsidu Store Inventory Management (Glass Minimal UI, Field Automation & Google Sheets Storage)

// ==================== STATE MANAGEMENT ====================
let state = {
  users: [],       // { username, password, role, storeId }
  stores: [],      // { id, name }
  storeData: {}    // keyed by storeId -> { products, drivers, trips, payments }
};

let currentUser = null;
let currentStoreId = null;

// ==================== GOOGLE SHEETS STORAGE CONFIG ====================
// Integrated directly in code: Paste your Google Apps Script Web App URL below.
// The app will automatically and silently synchronize all products, drivers, trips, and payments.
const GOOGLE_SHEETS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbz6NLepRvjuFGyQbhsSuDqgJurXUpZR7iCNmAH7-ZR_K5Ec-S9iNm_LL9B1wNuTQSOHzQ/exec'; // e.g. 'https://script.google.com/macros/s/AKfycb.../exec'

const SheetsStorage = {
  getUrl() {
    return GOOGLE_SHEETS_WEBAPP_URL || localStorage.getItem('tsidu_sheets_url') || '';
  },
  setUrl(url) {
    if (url) localStorage.setItem('tsidu_sheets_url', url.trim());
    else localStorage.removeItem('tsidu_sheets_url');
    this.updateStatusBadge();
  },
  updateStatusBadge(status, text) {
    const dot = document.getElementById('sheets-status-dot');
    const label = document.getElementById('sheets-status-text');
    const syncBtn = document.getElementById('btn-sync-now');
    const url = this.getUrl();

    if (!dot || !label) return;

    if (!url) {
      dot.className = 'status-dot';
      label.textContent = 'Sheets: Local';
      if (syncBtn) syncBtn.classList.add('d-none');
      return;
    }

    if (syncBtn) syncBtn.classList.remove('d-none');

    if (status === 'syncing') {
      dot.className = 'status-dot syncing';
      label.textContent = 'Syncing...';
    } else if (status === 'synced') {
      dot.className = 'status-dot synced';
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      label.textContent = text || `Synced (${time})`;
    } else if (status === 'error') {
      dot.className = 'status-dot error';
      label.textContent = text || 'Sync Error';
    } else {
      dot.className = 'status-dot synced';
      label.textContent = 'Sheets: Connected';
    }
  },

  syncDebounceTimer: null,

  debounceSync() {
    const url = this.getUrl();
    if (!url) return;
    clearTimeout(this.syncDebounceTimer);
    this.syncDebounceTimer = setTimeout(() => {
      this.pushToSheets();
    }, 800);
  },

  async pushToSheets(showToast = false) {
    const url = this.getUrl();
    if (!url) return false;

    this.updateStatusBadge('syncing');
    try {
      // Use text/plain to avoid CORS preflight options rejection in Google Apps Script
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ state })
      });

      if (!response.ok) throw new Error('HTTP ' + response.status);
      const res = await response.json();
      if (res.status === 'success') {
        this.updateStatusBadge('synced');
        if (showToast) alert('Successfully synchronized state with Google Sheets!');
        return true;
      } else {
        throw new Error(res.message || 'Unknown error');
      }
    } catch (err) {
      console.warn('Google Sheets sync error:', err);
      this.updateStatusBadge('error', 'Offline / Sync Error');
      if (showToast) alert('Google Sheets sync failed: ' + err.message);
      return false;
    }
  },

  async pullFromSheets(showToast = false) {
    const url = this.getUrl();
    if (!url) return false;

    this.updateStatusBadge('syncing');
    try {
      const response = await fetch(url, { method: 'GET' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const res = await response.json();
      if (res.status === 'success' && res.data) {
        if (res.data.stores && res.data.stores.length > 0) {
          state = res.data;
          localStorage.setItem('tsidu_v2_state', JSON.stringify(state));
          this.updateStatusBadge('synced');
          renderAll();
          if (showToast) alert('Successfully pulled latest inventory from Google Sheets!');
          return true;
        }
      }
      this.updateStatusBadge('synced');
      return true;
    } catch (err) {
      console.warn('Google Sheets pull error:', err);
      this.updateStatusBadge('error', 'Pull Error');
      if (showToast) alert('Failed to pull from Google Sheets: ' + err.message);
      return false;
    }
  }
};

// ==================== THEME MANAGEMENT ====================
function initTheme() {
  const theme = localStorage.getItem('tsidu_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('btn-theme-toggle');
  if (btn) btn.innerHTML = theme === 'light' ? '🌙' : '☀️';
}
initTheme();

const btnThemeToggle = document.getElementById('btn-theme-toggle');
if (btnThemeToggle) {
  btnThemeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('tsidu_theme', next);
    btnThemeToggle.innerHTML = next === 'light' ? '🌙' : '☀️';
  });
}

// ==================== STATE LOADING & PERSISTENCE ====================
function loadState() {
  const stored = localStorage.getItem('tsidu_v2_state');
  if (stored) {
    state = JSON.parse(stored);
    
    // Auto-update default stores if needed
    let changed = false;
    const mainStore = state.stores.find(s => s.name === 'Main Store');
    if (mainStore) { mainStore.name = 'Burrayu'; changed = true; }
    if (!state.stores.some(s => s.name === 'Burrayu')) {
      const bId = 'store_b_' + Date.now();
      state.stores.push({ id: bId, name: 'Burrayu' });
      state.storeData[bId] = { products: [], drivers: [], trips: [], payments: [] };
      changed = true;
    }
    if (!state.stores.some(s => s.name === 'Jimma')) {
      const jId = 'store_j_' + Date.now();
      state.stores.push({ id: jId, name: 'Jimma' });
      state.storeData[jId] = { products: [], drivers: [], trips: [], payments: [] };
      changed = true;
    }
    if (changed) saveState();

  } else {
    // Migration from single-store (v1)
    const oldStateStr = localStorage.getItem('tsidu_state');
    if (oldStateStr) {
      const oldState = JSON.parse(oldStateStr);
      const defaultStoreId = 'store_' + Date.now();
      const jimmaId = 'store_j_' + Date.now();
      state = {
        users: [],
        stores: [
          { id: defaultStoreId, name: 'Burrayu' },
          { id: jimmaId, name: 'Jimma' }
        ],
        storeData: {
          [defaultStoreId]: {
            products: oldState.products || [],
            drivers: oldState.drivers || [],
            trips: oldState.trips || [],
            payments: oldState.payments || []
          },
          [jimmaId]: { products: [], drivers: [], trips: [], payments: [] }
        }
      };
      const oldAdminStr = localStorage.getItem('tsidu_admin_user');
      if (oldAdminStr) {
        const oldAdmin = JSON.parse(oldAdminStr);
        state.users.push({ username: oldAdmin.username, password: oldAdmin.password, role: 'owner', storeId: null });
      }
      saveState();
    } else {
      state = { users: [], stores: [], storeData: {} };
      saveState();
    }
  }

  // Attempt Google Sheets background sync if connected
  if (SheetsStorage.getUrl()) {
    SheetsStorage.pullFromSheets();
  } else {
    SheetsStorage.updateStatusBadge();
  }
}

function saveState() {
  localStorage.setItem('tsidu_v2_state', JSON.stringify(state));
  SheetsStorage.debounceSync();
}

function getStoreData() {
  if (!currentStoreId || !state.storeData[currentStoreId]) return null;
  return state.storeData[currentStoreId];
}

// ==================== DOM SELECTORS ====================
const authSection = document.getElementById('auth-section');
const setupCard = document.getElementById('setup-card');
const loginCard = document.getElementById('login-card');
const dashboardSection = document.getElementById('dashboard-section');

const setupForm = document.getElementById('setup-form');
const loginForm = document.getElementById('login-form');
const setupAlert = document.getElementById('setup-alert');
const loginAlert = document.getElementById('login-alert');

const displayUser = document.getElementById('display-user');
const btnLogout = document.getElementById('btn-logout');
const headerStoreSelect = document.getElementById('header-store-select');
const tabAdminBtn = document.getElementById('tab-admin-btn');

const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

// Admin Tabs
const storeForm = document.getElementById('store-form');
const newStoreName = document.getElementById('new-store-name');
const storesTableBody = document.getElementById('stores-table-body');
const userForm = document.getElementById('user-form');
const newUserName = document.getElementById('new-user-name');
const newUserPass = document.getElementById('new-user-pass');
const newUserStore = document.getElementById('new-user-store');
const usersTableBody = document.getElementById('users-table-body');

// Inventory
const productForm = document.getElementById('product-form');
const productFormTitle = document.getElementById('product-form-title');
const productIdInput = document.getElementById('product-id');
const productNameInput = document.getElementById('product-name');
const productSkuInput = document.getElementById('product-sku');
const productStockInput = document.getElementById('product-stock');
const productPriceInput = document.getElementById('product-price');
const btnCancelEdit = document.getElementById('btn-cancel-edit');
const btnAutoSku = document.getElementById('btn-auto-sku');
const inventoryTableBody = document.getElementById('inventory-table-body');
const inventoryAlertContainer = document.getElementById('inventory-alert-container');
const inventorySearchInput = document.getElementById('inventory-search');

// Drivers
const driverForm = document.getElementById('driver-form');
const driverNameInput = document.getElementById('driver-name');
const driverPhoneInput = document.getElementById('driver-phone');
const driversTableBody = document.getElementById('drivers-table-body');
const driverSearchInput = document.getElementById('driver-search');

// Dispatch
const dispatchForm = document.getElementById('dispatch-form');
const dispatchDriverSelect = document.getElementById('dispatch-driver');
const dispatchDateInput = document.getElementById('dispatch-date');
const dispatchProductsList = document.getElementById('dispatch-products-list');
const dispatchTotalItems = document.getElementById('dispatch-total-items');
const dispatchTotalValue = document.getElementById('dispatch-total-value');
const dispatchAlert = document.getElementById('dispatch-alert');
const btnDispatchFillMax = document.getElementById('btn-dispatch-fill-max');
const btnDispatchClear = document.getElementById('btn-dispatch-clear');

// Returns
const activeTripsList = document.getElementById('active-trips-list');
const returnsForm = document.getElementById('returns-form');
const returnsFallback = document.getElementById('returns-fallback');
const returnTripIdInput = document.getElementById('return-trip-id');
const returnDriverName = document.getElementById('return-driver-name');
const returnTripDate = document.getElementById('return-trip-date');
const returnsItemsList = document.getElementById('returns-items-list');
const returnsAlert = document.getElementById('returns-alert');
const returnTotalRevenue = document.getElementById('return-total-revenue');
const btnReturnAllSold = document.getElementById('btn-return-all-sold');
const btnReturnAllReturned = document.getElementById('btn-return-all-returned');

// Payments
const paymentForm = document.getElementById('payment-form');
const payDateInput = document.getElementById('pay-date');
const payPartyInput = document.getElementById('pay-party');
const payPartyList = document.getElementById('pay-party-list');
const payTypeSelect = document.getElementById('pay-type');
const payAmountInput = document.getElementById('pay-amount');
const payNoteInput = document.getElementById('pay-note');
const paymentsTableBody = document.getElementById('payments-table-body');
const payTotalIn = document.getElementById('pay-total-in');
const payTotalCredit = document.getElementById('pay-total-credit');
const paymentSearchInput = document.getElementById('payment-search');

// Reports
const reportTotalRevenue = document.getElementById('report-total-revenue');
const reportCompletedTrips = document.getElementById('report-completed-trips');
const reportActiveTrips = document.getElementById('report-active-trips');
const reportTotalProducts = document.getElementById('report-total-products');
const historyTableBody = document.getElementById('history-table-body');
const historySearchInput = document.getElementById('history-search');

// Overview
const ovRevenue = document.getElementById('ov-revenue');
const ovCompleted = document.getElementById('ov-completed');
const ovActive = document.getElementById('ov-active');
const ovProducts = document.getElementById('ov-products');
const ovLowstock = document.getElementById('ov-lowstock');
const overviewRecentBody = document.getElementById('overview-recent-body');

// Google Sheets DOM
const headerSheetsBadge = document.getElementById('header-sheets-badge');
const btnSyncNow = document.getElementById('btn-sync-now');

// Change Password DOM
const btnOpenChangePass = document.getElementById('btn-open-change-pass');
const changePassPanel = document.getElementById('change-pass-panel');
const btnCloseChangePass = document.getElementById('btn-close-change-pass');
const btnCancelChangePass = document.getElementById('btn-cancel-change-pass');
const changePassForm = document.getElementById('change-pass-form');
const changeCurrentPass = document.getElementById('change-current-pass');
const changeNewPass = document.getElementById('change-new-pass');
const changeConfirmPass = document.getElementById('change-confirm-pass');
const changePassAlert = document.getElementById('change-pass-alert');

// Reset Password Modal DOM
const resetPassModal = document.getElementById('reset-pass-modal');
const btnCloseResetModal = document.getElementById('btn-close-reset-modal');
const btnCancelResetModal = document.getElementById('btn-cancel-reset-modal');
const resetPassForm = document.getElementById('reset-pass-form');
const resetPassUsername = document.getElementById('reset-pass-username');
const resetPassTargetUser = document.getElementById('reset-pass-target-user');
const resetNewPass = document.getElementById('reset-new-pass');
const resetConfirmPass = document.getElementById('reset-confirm-pass');
const resetPassAlert = document.getElementById('reset-pass-alert');

// ==================== AUTH ====================
function initAuth() {
  loadState();
  const hasOwner = state.users.some(u => u.role === 'owner');
  const sessionUser = sessionStorage.getItem('tsidu_session_user');

  if (!hasOwner) {
    setupCard.classList.remove('d-none');
    loginCard.classList.add('d-none');
  } else {
    setupCard.classList.add('d-none');
    loginCard.classList.remove('d-none');
  }

  if (sessionUser) {
    const u = state.users.find(x => x.username === sessionUser);
    if (u) {
      currentUser = u;
      showDashboard();
    } else {
      showAuth();
    }
  } else {
    showAuth();
  }
}

function showAuth() {
  authSection.classList.remove('d-none');
  dashboardSection.classList.add('d-none');
}

function showDashboard() {
  authSection.classList.add('d-none');
  dashboardSection.classList.remove('d-none');
  displayUser.textContent = `${currentUser.role === 'owner' ? 'Owner' : 'Keeper'}: ${currentUser.username}`;

  if (currentUser.role === 'owner') {
    document.body.classList.add('role-owner');
    tabAdminBtn.classList.remove('d-none');
    headerStoreSelect.classList.remove('d-none');
    renderStoreSelector();
    currentStoreId = headerStoreSelect.value;
  } else {
    document.body.classList.remove('role-owner');
    tabAdminBtn.classList.add('d-none');
    headerStoreSelect.classList.add('d-none');
    currentStoreId = currentUser.storeId;
    if (document.querySelector('.tab-btn.active').getAttribute('data-tab') === 'admin') {
      document.querySelector('.tab-btn[data-tab="overview"]').click();
    }
  }

  if (!currentStoreId && state.stores.length > 0) {
    currentStoreId = state.stores[0].id;
    if (currentUser.role === 'owner') headerStoreSelect.value = currentStoreId;
  }
  
  // Set automatic dates on forms
  const today = new Date().toISOString().split('T')[0];
  if (dispatchDateInput) dispatchDateInput.value = today;
  if (payDateInput) payDateInput.value = today;

  renderAll();
}

function showMsg(el, msg, success = false) {
  el.textContent = msg;
  el.className = `alert ${success ? 'alert-success' : 'alert-danger'}`;
  el.classList.remove('d-none');
  setTimeout(() => el.classList.add('d-none'), 5000);
}

if (setupForm) {
  setupForm.addEventListener('submit', e => {
    e.preventDefault();
    const username = document.getElementById('setup-username').value.trim();
    const password = document.getElementById('setup-password').value;
    const confirm  = document.getElementById('setup-confirm-password').value;
    if (!username) { showMsg(setupAlert, 'Username required.'); return; }
    if (password.length < 4) { showMsg(setupAlert, 'Password must be >= 4 chars.'); return; }
    if (password !== confirm) { showMsg(setupAlert, 'Passwords mismatch.'); return; }
    
    const burrayuId = 'store_b_' + Date.now();
    const jimmaId = 'store_j_' + Date.now();
    state.stores.push({ id: burrayuId, name: 'Burrayu' });
    state.stores.push({ id: jimmaId, name: 'Jimma' });
    state.storeData[burrayuId] = { products: [], drivers: [], trips: [], payments: [] };
    state.storeData[jimmaId] = { products: [], drivers: [], trips: [], payments: [] };
    
    const owner = { username, password, role: 'owner', storeId: null };
    state.users.push(owner);
    saveState();
    
    sessionStorage.setItem('tsidu_session_user', username);
    currentUser = owner;
    currentStoreId = burrayuId;
    showDashboard();
  });
}

if (loginForm) {
  loginForm.addEventListener('submit', e => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    
    const u = state.users.find(x => x.username === username && x.password === password);
    if (!u) { showMsg(loginAlert, 'Invalid credentials.'); return; }
    sessionStorage.setItem('tsidu_session_user', username);
    currentUser = u;
    currentStoreId = u.role === 'owner' ? (state.stores[0]?.id || null) : u.storeId;
    showDashboard();
  });
}

if (btnLogout) {
  btnLogout.addEventListener('click', () => {
    sessionStorage.removeItem('tsidu_session_user');
    currentUser = null;
    currentStoreId = null;
    document.querySelector('.tab-btn[data-tab="overview"]').click();
    initAuth();
  });
}

// ==================== TABS & NAVIGATION ====================
tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.getAttribute('data-tab');
    tabButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    tabPanes.forEach(p => {
      if (p.id === `tab-${target}`) p.classList.remove('d-none');
      else p.classList.add('d-none');
    });
    renderAll();
  });
});

function renderAll() { 
  const active = document.querySelector('.tab-btn.active')?.getAttribute('data-tab') || 'overview'; 
  switch (active) { 
    case 'overview': renderOverview(); break; 
    case 'inventory': renderInventory(); break; 
    case 'drivers': renderDrivers(); break; 
    case 'dispatch': renderDispatchForm(); break; 
    case 'returns': renderReturnsPane(); break; 
    case 'payments': renderPayments(); break; 
    case 'history': renderHistory(); break; 
    case 'admin': renderAdmin(); break; 
  }
  updatePartyDatalist();
}

function renderStoreSelector() {
  headerStoreSelect.innerHTML = '';
  state.stores.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    headerStoreSelect.appendChild(opt);
  });
  if (currentStoreId) headerStoreSelect.value = currentStoreId;
}

if (headerStoreSelect) {
  headerStoreSelect.addEventListener('change', (e) => {
    currentStoreId = e.target.value;
    renderAll();
  });
}

// ==================== FIELD AUTOMATION HELPERS ====================

// 1. Auto-generate SKU from Product Name
function generateSku(name) {
  if (!name || !name.trim()) return '';
  const words = name.trim().replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/);
  let prefix = '';
  if (words.length === 1) {
    prefix = words[0].substring(0, 3).toUpperCase();
  } else {
    prefix = words.map(w => w[0]).join('').substring(0, 4).toUpperCase();
  }
  const randomSuffix = Math.floor(100 + Math.random() * 900);
  return `${prefix}-${randomSuffix}`;
}

if (productNameInput && productSkuInput) {
  productNameInput.addEventListener('input', () => {
    // Only auto-fill if SKU is currently empty or user is creating a new product
    if (!productIdInput.value && (!productSkuInput.value || productSkuInput.dataset.autoGenerated === 'true')) {
      productSkuInput.value = generateSku(productNameInput.value);
      productSkuInput.dataset.autoGenerated = 'true';
    }
  });

  productSkuInput.addEventListener('input', () => {
    productSkuInput.dataset.autoGenerated = 'false';
  });
}

if (btnAutoSku && productNameInput && productSkuInput) {
  btnAutoSku.addEventListener('click', () => {
    const name = productNameInput.value.trim() || 'PROD';
    productSkuInput.value = generateSku(name);
    productSkuInput.dataset.autoGenerated = 'true';
  });
}

// 2. Auto-format Driver Phone
if (driverPhoneInput) {
  driverPhoneInput.addEventListener('input', (e) => {
    let val = e.target.value.replace(/\D/g, ''); // strip non-digits
    if (val.length > 10) val = val.substring(0, 10);
    // Format 0911-234-567 or similar
    if (val.length > 6) {
      val = `${val.substring(0, 4)}-${val.substring(4, 7)}-${val.substring(7)}`;
    } else if (val.length > 4) {
      val = `${val.substring(0, 4)}-${val.substring(4)}`;
    }
    e.target.value = val;
  });
}

// 3. Payment Party Datalist Autocomplete
function updatePartyDatalist() {
  if (!payPartyList) return;
  payPartyList.innerHTML = '';
  const sd = getStoreData();
  const parties = new Set();

  if (sd) {
    sd.drivers.forEach(d => parties.add(d.name));
    sd.payments.forEach(p => parties.add(p.party));
  }
  state.stores.forEach(s => parties.add(s.name));

  parties.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    payPartyList.appendChild(opt);
  });
}

// ==================== SEARCH & FILTER FILTERS ====================
if (inventorySearchInput) {
  inventorySearchInput.addEventListener('input', () => renderInventory());
}
if (driverSearchInput) {
  driverSearchInput.addEventListener('input', () => renderDrivers());
}
if (paymentSearchInput) {
  paymentSearchInput.addEventListener('input', () => renderPayments());
}
if (historySearchInput) {
  historySearchInput.addEventListener('input', () => renderHistory());
}

// ==================== ADMIN (OWNER ONLY) ====================
function renderAdmin() {
  if (currentUser?.role !== 'owner') return;
  storesTableBody.innerHTML = '';
  state.stores.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><code>${s.id}</code></td><td><strong>${s.name}</strong></td>`;
    storesTableBody.appendChild(tr);
  });
  
  usersTableBody.innerHTML = '';
  state.users.forEach(u => {
    if (u.role === 'owner') return;
    const store = state.stores.find(s => s.id === u.storeId);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><strong>${u.username}</strong></td><td><span class="badge badge-info">Keeper</span></td><td>${store ? store.name : 'Unknown'}</td><td class="text-center"><button class="btn btn-secondary btn-xs" style="margin-right:4px;" onclick="resetUserPassword('${u.username}')">Reset Pass</button><button class="btn btn-danger btn-xs" onclick="deleteUser('${u.username}')">Remove</button></td>`;
    usersTableBody.appendChild(tr);
  });
  
  newUserStore.innerHTML = '';
  state.stores.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    newUserStore.appendChild(opt);
  });
}

if (storeForm) {
  storeForm.addEventListener('submit', e => {
    e.preventDefault();
    const name = newStoreName.value.trim();
    if (!name) return;
    const id = 'store_' + Date.now();
    state.stores.push({ id, name });
    state.storeData[id] = { products: [], drivers: [], trips: [], payments: [] };
    saveState();
    storeForm.reset();
    renderStoreSelector();
    renderAdmin();
  });
}

if (userForm) {
  userForm.addEventListener('submit', e => {
    e.preventDefault();
    const username = newUserName.value.trim();
    const password = newUserPass.value;
    const storeId = newUserStore.value;
    if (!username || !password || !storeId) return;
    if (state.users.some(u => u.username === username)) { alert('Username exists'); return; }
    state.users.push({ username, password, role: 'storekeeper', storeId });
    saveState();
    userForm.reset();
    renderAdmin();
  });
}

window.deleteUser = function(username) {
  if (confirm(`Remove storekeeper ${username}?`)) {
    state.users = state.users.filter(u => u.username !== username);
    saveState();
    renderAdmin();
  }
};

window.resetUserPassword = function(username) {
  openResetPassModal(username);
};

// ==================== INVENTORY ====================
function renderInventory() { 
  const sd = getStoreData();
  if (!sd) return;
  inventoryTableBody.innerHTML = '';
  inventoryAlertContainer.innerHTML = '';
  const low = [];
  const query = (inventorySearchInput ? inventorySearchInput.value : '').toLowerCase().trim();

  const filtered = sd.products.filter(p => {
    if (!query) return true;
    return p.name.toLowerCase().includes(query) || p.sku.toLowerCase().includes(query);
  });

  filtered.forEach(p => { 
    const isLow = p.stock <= 10;
    if (p.stock <= 10) low.push(p.name); 
    const tr = document.createElement('tr'); 
    tr.innerHTML = `
      <td><code>${p.sku}</code></td>
      <td><strong>${p.name}</strong></td>
      <td class="text-right">ETB ${p.price.toFixed(2)}</td>
      <td class="text-right"><strong>${p.stock}</strong></td>
      <td><span class="badge ${isLow ? 'badge-danger' : 'badge-success'}">${isLow ? 'Low Stock (' + p.stock + ')' : 'In Stock'}</span></td>
      <td class="text-center keeper-only">
        <button class="btn btn-secondary btn-xs" onclick="editProduct('${p.id}')">Edit</button>
        <button class="btn btn-danger btn-xs" onclick="deleteProduct('${p.id}')">Delete</button>
      </td>
    `; 
    inventoryTableBody.appendChild(tr); 
  }); 

  if (low.length && !query) {
    const alertDiv = document.createElement('div');
    alertDiv.className = 'alert alert-danger';
    alertDiv.innerHTML = `<strong>⚠️ Low stock alert:</strong> ${low.join(', ')} (10 or fewer remaining).`;
    inventoryAlertContainer.appendChild(alertDiv);
  } 
}

function resetProductForm() {
  productForm.reset();
  productIdInput.value = '';
  productSkuInput.dataset.autoGenerated = 'false';
  productFormTitle.textContent = 'Add New Product';
  btnCancelEdit.classList.add('d-none');
}

if (productForm) {
  productForm.addEventListener('submit', e => {
    e.preventDefault();
    const sd = getStoreData();
    if (!sd) return;
    const id = productIdInput.value;
    const name = productNameInput.value.trim();
    const sku = productSkuInput.value.trim().toUpperCase();
    const stock = parseInt(productStockInput.value) || 0;
    const price = parseFloat(productPriceInput.value) || 0;
    if (!name || !sku) return;

    if (id) {
      const idx = sd.products.findIndex(p => p.id === id);
      if (idx !== -1) sd.products[idx] = { id, name, sku, stock, price };
    } else {
      if (sd.products.some(p => p.sku === sku)) {
        alert('Product SKU already exists. Please choose a unique SKU.');
        return;
      }
      sd.products.push({ id: 'p_' + Date.now(), name, sku, stock, price });
    }
    saveState();
    resetProductForm();
    renderInventory();
  });
}

window.editProduct = function(id) {
  const sd = getStoreData();
  if (!sd) return;
  const p = sd.products.find(x => x.id === id);
  if (!p) return;
  productIdInput.value = p.id;
  productNameInput.value = p.name;
  productSkuInput.value = p.sku;
  productSkuInput.dataset.autoGenerated = 'false';
  productStockInput.value = p.stock;
  productPriceInput.value = p.price;
  productFormTitle.textContent = 'Edit Product';
  btnCancelEdit.classList.remove('d-none');
};

if (btnCancelEdit) btnCancelEdit.addEventListener('click', resetProductForm);

window.deleteProduct = function(id) {
  const sd = getStoreData();
  if (!sd) return;
  const used = sd.trips.some(t => t.status === 'active' && t.dispatchData.some(d => d.productId === id));
  if (used) {
    alert('Cannot delete this product because it is currently part of an active dispatch trip.');
    return;
  }
  if (confirm('Are you sure you want to delete this product?')) {
    sd.products = sd.products.filter(p => p.id !== id);
    saveState();
    renderInventory();
  }
};

// ==================== DRIVERS ====================
if (driverForm) {
  driverForm.addEventListener('submit', e => {
    e.preventDefault();
    const sd = getStoreData();
    if (!sd) return;
    const name = driverNameInput.value.trim();
    const phone = driverPhoneInput.value.trim();
    if (!name) return;
    sd.drivers.push({ id: 'd_' + Date.now(), name, phone });
    saveState();
    driverForm.reset();
    renderDrivers();
    updatePartyDatalist();
  });
}

function renderDrivers() {
  const sd = getStoreData();
  if (!sd) return;
  driversTableBody.innerHTML = '';
  const query = (driverSearchInput ? driverSearchInput.value : '').toLowerCase().trim();

  const filtered = sd.drivers.filter(d => {
    if (!query) return true;
    return d.name.toLowerCase().includes(query) || (d.phone || '').includes(query);
  });

  filtered.forEach(d => {
    const active = sd.trips.filter(t => t.driverId === d.id && t.status === 'active').length;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><code>${d.id}</code></td>
      <td><strong>${d.name}</strong></td>
      <td>${d.phone || '<span class="text-secondary">—</span>'}</td>
      <td><span class="badge ${active ? 'badge-warning' : 'badge-success'}">${active ? active + ' Active Trip' : 'Available'}</span></td>
      <td class="text-center keeper-only">
        <button class="btn btn-danger btn-xs" onclick="deleteDriver('${d.id}')" ${active ? 'disabled' : ''}>Delete</button>
      </td>
    `;
    driversTableBody.appendChild(tr);
  });
}

window.deleteDriver = function(id) {
  const sd = getStoreData();
  if (!sd) return;
  const active = sd.trips.filter(t => t.driverId === id && t.status === 'active').length;
  if (active) {
    alert('This driver currently has active dispatches.');
    return;
  }
  if (confirm('Delete driver?')) {
    sd.drivers = sd.drivers.filter(d => d.id !== id);
    saveState();
    renderDrivers();
    updatePartyDatalist();
  }
};

// ==================== DISPATCH ====================
function renderDispatchForm() {
  const sd = getStoreData();
  if (!sd) return;
  
  // Auto-set today's date if empty
  if (dispatchDateInput && !dispatchDateInput.value) {
    dispatchDateInput.value = new Date().toISOString().split('T')[0];
  }

  dispatchDriverSelect.innerHTML = '<option value="">-- Select a Driver --</option>';
  sd.drivers.forEach(d => {
    const hasActive = sd.trips.some(t => t.driverId === d.id && t.status === 'active');
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.name + (hasActive ? ' (Active Trip Ongoing)' : '');
    dispatchDriverSelect.appendChild(opt);
  });

  dispatchProductsList.innerHTML = '';
  if (!sd.products.length) {
    dispatchProductsList.innerHTML = '<p class="text-center text-secondary" style="padding:16px 0;">No products in inventory.</p>';
    updateDispatchCalculations();
    return;
  }

  sd.products.forEach(p => {
    const div = document.createElement('div');
    div.className = 'dispatch-list-item';
    div.innerHTML = `
      <div>
        <strong>${p.name}</strong>
        <span class="text-secondary" style="font-size:0.8rem"> (${p.sku} | In stock: ${p.stock})</span>
      </div>
      <div>ETB ${p.price.toFixed(2)}</div>
      <div class="text-right">
        <input type="number" class="input-control text-right dispatch-qty-input" style="width:90px;" min="0" max="${p.stock}" data-id="${p.id}" data-price="${p.price}" data-max="${p.stock}" placeholder="0" oninput="updateDispatchCalculations()">
      </div>
    `;
    dispatchProductsList.appendChild(div);
  });

  updateDispatchCalculations();
}

function updateDispatchCalculations() {
  const inputs = document.querySelectorAll('.dispatch-qty-input');
  let totalCount = 0;
  let totalVal = 0;

  inputs.forEach(i => {
    const qty = parseInt(i.value) || 0;
    const price = parseFloat(i.dataset.price) || 0;
    if (qty > 0) {
      totalCount += qty;
      totalVal += qty * price;
    }
  });

  if (dispatchTotalItems) dispatchTotalItems.textContent = `Total: ${totalCount} items`;
  if (dispatchTotalValue) dispatchTotalValue.textContent = `Value: ETB ${totalVal.toFixed(2)}`;
}

// Quick dispatch action buttons
if (btnDispatchFillMax) {
  btnDispatchFillMax.addEventListener('click', () => {
    const inputs = document.querySelectorAll('.dispatch-qty-input');
    inputs.forEach(i => {
      const max = parseInt(i.dataset.max) || 0;
      i.value = max;
    });
    updateDispatchCalculations();
  });
}

if (btnDispatchClear) {
  btnDispatchClear.addEventListener('click', () => {
    const inputs = document.querySelectorAll('.dispatch-qty-input');
    inputs.forEach(i => i.value = '');
    updateDispatchCalculations();
  });
}

if (dispatchForm) {
  dispatchForm.addEventListener('submit', e => {
    e.preventDefault();
    const sd = getStoreData();
    if (!sd) return;
    const driverId = dispatchDriverSelect.value;
    const date = dispatchDateInput.value;
    if (!driverId) { showMsg(dispatchAlert, 'Please select a driver.'); return; }
    const driver = sd.drivers.find(d => d.id === driverId);
    if (!driver) return;

    const qtyInputs = document.querySelectorAll('.dispatch-qty-input');
    const dispatchData = [];
    let exceed = false;

    qtyInputs.forEach(inp => {
      const qty = parseInt(inp.value) || 0;
      if (qty > 0) {
        const prod = sd.products.find(p => p.id === inp.dataset.id);
        if (prod) {
          if (qty > prod.stock) exceed = true;
          dispatchData.push({ productId: prod.id, productName: prod.name, quantity: qty, price: prod.price });
        }
      }
    });

    if (!dispatchData.length) {
      showMsg(dispatchAlert, 'Please specify quantity for at least one product.');
      return;
    }
    if (exceed) {
      showMsg(dispatchAlert, 'Entered quantity exceeds current available stock.');
      return;
    }

    // Deduct stock
    dispatchData.forEach(d => {
      const prod = sd.products.find(p => p.id === d.productId);
      if (prod) prod.stock -= d.quantity;
    });

    const newTrip = {
      id: 't_' + Date.now(),
      driverId: driver.id,
      driverName: driver.name,
      date,
      status: 'active',
      dispatchData,
      returnData: []
    };

    sd.trips.push(newTrip);
    saveState();
    dispatchForm.reset();
    dispatchDateInput.value = new Date().toISOString().split('T')[0];
    alert(`Morning dispatch for ${driver.name} confirmed! Switched to Returns pane.`);
    document.querySelector('.tab-btn[data-tab="returns"]').click();
  });
}

// ==================== RETURNS ====================
function renderReturnsPane() {
  const sd = getStoreData();
  if (!sd) return;
  activeTripsList.innerHTML = '';
  const activeTrips = sd.trips.filter(t => t.status === 'active');

  if (!activeTrips.length) {
    activeTripsList.innerHTML = '<p class="text-center text-secondary" style="padding:24px 0;">No active dispatches currently on the road.</p>';
    returnsForm.classList.add('d-none');
    returnsFallback.classList.remove('d-none');
    return;
  }

  activeTrips.forEach(trip => {
    const card = document.createElement('div');
    card.className = 'trip-select-card';
    const totalItems = trip.dispatchData.reduce((a, c) => a + c.quantity, 0);
    const estVal = trip.dispatchData.reduce((a, c) => a + (c.quantity * c.price), 0);

    card.innerHTML = `
      <div class="flex justify-between align-center" style="margin-bottom:6px;">
        <strong>Driver: ${trip.driverName}</strong>
        <span class="badge badge-info">${totalItems} units</span>
      </div>
      <div class="flex justify-between align-center text-secondary" style="font-size:0.82rem;">
        <span>Date: ${trip.date}</span>
        <span>ETB ${estVal.toFixed(2)}</span>
      </div>
      <button class="btn btn-secondary btn-sm btn-block" style="margin-top:10px;" onclick="selectTripForReturn('${trip.id}')">Process Evening Return</button>
    `;
    activeTripsList.appendChild(card);
  });
}

window.selectTripForReturn = function(tripId) {
  const sd = getStoreData();
  if (!sd) return;
  const trip = sd.trips.find(t => t.id === tripId);
  if (!trip) return;

  returnsFallback.classList.add('d-none');
  returnsForm.classList.remove('d-none');
  returnTripIdInput.value = trip.id;
  returnDriverName.textContent = `Driver: ${trip.driverName}`;
  returnTripDate.textContent = `Dispatch Date: ${trip.date}`;
  returnsItemsList.innerHTML = '';

  trip.dispatchData.forEach(item => {
    const div = document.createElement('div');
    div.className = 'returns-list-item';
    div.innerHTML = `
      <div>
        <strong>${item.productName}</strong>
        <div class="item-total-info">ETB ${item.price.toFixed(2)} each</div>
      </div>
      <div class="text-center font-bold" id="disp-qty-${item.productId}">${item.quantity}</div>
      <div>
        <input type="number" id="sold-qty-${item.productId}" class="input-control text-center return-sold-input" min="0" max="${item.quantity}" data-id="${item.productId}" data-price="${item.price}" data-disp="${item.quantity}" placeholder="0" oninput="handleReturnCalculation('${item.productId}','sold')">
      </div>
      <div>
        <input type="number" id="ret-qty-${item.productId}" class="input-control text-center return-ret-input" min="0" max="${item.quantity}" data-id="${item.productId}" data-disp="${item.quantity}" placeholder="0" oninput="handleReturnCalculation('${item.productId}','returned')">
      </div>
    `;
    returnsItemsList.appendChild(div);
  });

  calculateReturnsSummary();
};

// Automated Returns presets
if (btnReturnAllSold) {
  btnReturnAllSold.addEventListener('click', () => {
    const soldInputs = document.querySelectorAll('.return-sold-input');
    soldInputs.forEach(inp => {
      const disp = parseInt(inp.dataset.disp) || 0;
      inp.value = disp;
      const pid = inp.dataset.id;
      const retInput = document.getElementById(`ret-qty-${pid}`);
      if (retInput) retInput.value = 0;
    });
    calculateReturnsSummary();
  });
}

if (btnReturnAllReturned) {
  btnReturnAllReturned.addEventListener('click', () => {
    const retInputs = document.querySelectorAll('.return-ret-input');
    retInputs.forEach(inp => {
      const disp = parseInt(inp.dataset.disp) || 0;
      inp.value = disp;
      const pid = inp.dataset.id;
      const soldInput = document.getElementById(`sold-qty-${pid}`);
      if (soldInput) soldInput.value = 0;
    });
    calculateReturnsSummary();
  });
}

// Bidirectional Smart Calculation for Returns
window.handleReturnCalculation = function(productId, field) {
  const dispEl = document.getElementById(`disp-qty-${productId}`);
  if (!dispEl) return;
  const disp = parseInt(dispEl.textContent) || 0;
  const soldInput = document.getElementById(`sold-qty-${productId}`);
  const retInput = document.getElementById(`ret-qty-${productId}`);
  if (!soldInput || !retInput) return;

  let sold = parseInt(soldInput.value) || 0;
  let ret = parseInt(retInput.value) || 0;

  if (field === 'sold') {
    if (sold > disp) { sold = disp; soldInput.value = disp; }
    if (sold < 0) { sold = 0; soldInput.value = 0; }
    ret = disp - sold;
    retInput.value = ret;
  } else {
    if (ret > disp) { ret = disp; retInput.value = disp; }
    if (ret < 0) { ret = 0; retInput.value = 0; }
    sold = disp - ret;
    soldInput.value = sold;
  }
  calculateReturnsSummary();
};

window.calculateReturnsSummary = function() {
  let revenue = 0;
  let hasError = false;
  const soldInputs = document.querySelectorAll('.return-sold-input');

  soldInputs.forEach(inp => {
    const pid = inp.dataset.id;
    const price = parseFloat(inp.dataset.price) || 0;
    const disp = parseInt(inp.dataset.disp) || 0;
    const sold = parseInt(inp.value) || 0;
    const retInput = document.getElementById(`ret-qty-${pid}`);
    const ret = parseInt(retInput ? retInput.value : 0) || 0;

    if (sold + ret !== disp) {
      hasError = true;
    }
    revenue += sold * price;
  });

  returnTotalRevenue.textContent = `ETB ${revenue.toFixed(2)}`;
  const btn = document.getElementById('btn-complete-trip');

  if (hasError) {
    returnsAlert.textContent = 'Notice: Sold Qty + Returned Qty must equal total dispatched quantity.';
    returnsAlert.classList.remove('d-none');
    if (btn) btn.disabled = true;
  } else {
    returnsAlert.classList.add('d-none');
    if (btn) btn.disabled = false;
  }
};

if (returnsForm) {
  returnsForm.addEventListener('submit', e => {
    e.preventDefault();
    const sd = getStoreData();
    if (!sd) return;
    const tripId = returnTripIdInput.value;
    const idx = sd.trips.findIndex(t => t.id === tripId);
    if (idx === -1) return;

    const trip = sd.trips[idx];
    const returnData = [];
    let mismatch = false;

    trip.dispatchData.forEach(item => {
      const sold = parseInt(document.getElementById(`sold-qty-${item.productId}`)?.value) || 0;
      const returned = parseInt(document.getElementById(`ret-qty-${item.productId}`)?.value) || 0;
      if (sold + returned !== item.quantity) mismatch = true;
      returnData.push({ productId: item.productId, sold, returned });
    });

    if (mismatch) {
      showMsg(returnsAlert, 'Sold + Returned quantities must equal dispatched quantity for every item.');
      return;
    }

    // Restock returned items back to store inventory
    returnData.forEach(r => {
      const prod = sd.products.find(p => p.id === r.productId);
      if (prod) prod.stock += r.returned;
    });

    sd.trips[idx].returnData = returnData;
    sd.trips[idx].status = 'completed';
    saveState();

    returnsForm.reset();
    returnsForm.classList.add('d-none');
    returnsFallback.classList.remove('d-none');
    alert(`Trip for ${trip.driverName} completed and restocked successfully!`);
    document.querySelector('.tab-btn[data-tab="history"]').click();
  });
}

// ==================== PAYMENTS ====================
function renderPayments() {
  const sd = getStoreData();
  if (!sd) return;
  const totalIn = sd.payments.reduce((s, p) => s + (p.type === 'credit' ? 0 : p.amount), 0);
  const totalCredit = sd.payments.reduce((s, p) => s + (p.type === 'credit' ? p.amount : 0), 0);

  payTotalIn.textContent = `ETB ${totalIn.toFixed(2)}`;
  payTotalCredit.textContent = `ETB ${totalCredit.toFixed(2)}`;
  paymentsTableBody.innerHTML = '';

  const query = (paymentSearchInput ? paymentSearchInput.value : '').toLowerCase().trim();

  const filtered = sd.payments.filter(p => {
    if (!query) return true;
    return p.party.toLowerCase().includes(query) ||
           p.type.toLowerCase().includes(query) ||
           (p.note || '').toLowerCase().includes(query) ||
           p.date.includes(query);
  });

  filtered.forEach(p => {
    const isCredit = p.type === 'credit';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.date}</td>
      <td><strong>${p.party}</strong></td>
      <td><span class="badge ${isCredit ? 'badge-danger' : 'badge-success'}">${p.type.toUpperCase()}</span></td>
      <td class="text-right"><strong>ETB ${p.amount.toFixed(2)}</strong></td>
      <td>${p.note || '<span class="text-secondary">—</span>'}</td>
      <td class="text-center keeper-only">
        <button class="btn btn-danger btn-xs" onclick="deletePayment('${p.id}')">✕</button>
      </td>
    `;
    paymentsTableBody.appendChild(tr);
  });
}

if (paymentForm) {
  paymentForm.addEventListener('submit', e => {
    e.preventDefault();
    const sd = getStoreData();
    if (!sd) return;
    const date = payDateInput.value;
    const party = payPartyInput.value.trim();
    const type = payTypeSelect.value;
    const amount = parseFloat(payAmountInput.value) || 0;
    const note = payNoteInput.value.trim();

    if (!date || !party || amount <= 0) {
      alert('Please fill out all required fields.');
      return;
    }

    sd.payments.push({ id: 'pay_' + Date.now(), date, party, type, amount, note });
    saveState();
    paymentForm.reset();
    payDateInput.value = new Date().toISOString().split('T')[0];
    renderPayments();
    updatePartyDatalist();
  });
}

window.deletePayment = function(id) {
  const sd = getStoreData();
  if (!sd) return;
  if (confirm('Delete this payment record?')) {
    sd.payments = sd.payments.filter(p => p.id !== id);
    saveState();
    renderPayments();
  }
};

window.exportPaymentsCSV = function() {
  const sd = getStoreData();
  if (!sd) return;
  const header = ['Date', 'Party', 'Type', 'Amount (ETB)', 'Note'];
  const rows = sd.payments.map(p => [p.date, p.party, p.type, p.amount.toFixed(2), p.note || '']);
  const csv = [header, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `payments_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

// ==================== HISTORY & REPORTS ====================
function renderHistory() {
  const sd = getStoreData();
  if (!sd) return;
  historyTableBody.innerHTML = '';
  let revenue = 0, completed = 0, active = 0;
  const query = (historySearchInput ? historySearchInput.value : '').toLowerCase().trim();

  sd.trips.forEach(t => {
    if (t.status === 'active') {
      active++;
    } else {
      completed++;
      t.dispatchData.forEach(d => {
        const r = t.returnData.find(r => r.productId === d.productId) || { sold: 0 };
        revenue += r.sold * d.price;
      });
    }
  });

  const filtered = sd.trips.filter(t => {
    if (!query) return true;
    return t.driverName.toLowerCase().includes(query) ||
           t.date.includes(query) ||
           t.status.toLowerCase().includes(query);
  });

  filtered.forEach(t => {
    let tripRev = 0;
    t.dispatchData.forEach(d => {
      const r = t.returnData.find(r => r.productId === d.productId) || { sold: 0, returned: d.quantity };
      tripRev += r.sold * d.price;
    });

    const dispatchedStr = t.dispatchData.map(d => `${d.quantity}x ${d.productName}`).join(', ');
    const soldStr = t.returnData.map(r => `${r.sold}x ${(sd.products.find(p => p.id === r.productId) || {}).name || ''}`).join(', ');
    const retStr = t.returnData.map(r => `${r.returned}x ${(sd.products.find(p => p.id === r.productId) || {}).name || ''}`).join(', ');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${t.date}</td>
      <td><strong>${t.driverName}</strong></td>
      <td>${dispatchedStr}</td>
      <td>${t.status === 'completed' ? soldStr : '<span class="text-secondary">—</span>'}</td>
      <td>${t.status === 'completed' ? retStr : '<span class="text-secondary">—</span>'}</td>
      <td class="text-right"><strong>ETB ${tripRev.toFixed(2)}</strong></td>
      <td><span class="badge ${t.status === 'active' ? 'badge-warning' : 'badge-success'}">${t.status === 'active' ? 'Active' : 'Completed'}</span></td>
    `;
    historyTableBody.appendChild(tr);
  });

  reportTotalRevenue.textContent = `ETB ${revenue.toFixed(2)}`;
  reportCompletedTrips.textContent = completed;
  reportActiveTrips.textContent = active;
  reportTotalProducts.textContent = sd.products.length;
}

window.exportTripsCSV = function() {
  const sd = getStoreData();
  if (!sd) return;
  const header = ['Date', 'Driver', 'Dispatched', 'Sold', 'Returned', 'Revenue (ETB)', 'Status'];
  const rows = sd.trips.map(t => {
    const dispatched = t.dispatchData.map(d => `${d.quantity}x ${d.productName}`).join(' | ');
    const sold = t.returnData.map(r => `${r.sold}x ${(sd.products.find(p => p.id === r.productId) || {}).name || ''}`).join(' | ');
    const returned = t.returnData.map(r => `${r.returned}x ${(sd.products.find(p => p.id === r.productId) || {}).name || ''}`).join(' | ');
    const rev = t.dispatchData.reduce((sum, d) => {
      const r = t.returnData.find(r => r.productId === d.productId) || { sold: 0 };
      return sum + (r.sold * d.price);
    }, 0);
    return [t.date, t.driverName, dispatched, sold, returned, rev.toFixed(2), t.status];
  });
  const csv = [header, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `trips_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

// ==================== OVERVIEW ====================
function renderOverview() {
  const sd = getStoreData();
  if (!sd) return;
  let totalRev = 0, completed = 0, active = 0, lowStock = 0;

  sd.trips.forEach(t => {
    if (t.status === 'active') {
      active++;
    } else {
      completed++;
      const rev = t.dispatchData.reduce((sum, d) => {
        const r = t.returnData.find(r => r.productId === d.productId) || { sold: 0 };
        return sum + (r.sold * d.price);
      }, 0);
      totalRev += rev;
    }
  });

  lowStock = sd.products.filter(p => p.stock <= 10).length;
  ovRevenue.textContent = `ETB ${totalRev.toFixed(2)}`;
  ovCompleted.textContent = completed;
  ovActive.textContent = active;
  ovProducts.textContent = sd.products.length;
  ovLowstock.textContent = lowStock;

  // Recent 5 trips
  overviewRecentBody.innerHTML = '';
  const recent = sd.trips.slice(-5).reverse();
  if (!recent.length) {
    overviewRecentBody.innerHTML = '<tr><td colspan="5" class="text-center text-secondary" style="padding:20px;">No trips recorded yet.</td></tr>';
    return;
  }

  recent.forEach(t => {
    const tr = document.createElement('tr');
    const rev = t.dispatchData.reduce((sum, d) => {
      const r = t.returnData.find(r => r.productId === d.productId) || { sold: 0 };
      return sum + (r.sold * d.price);
    }, 0);
    tr.innerHTML = `
      <td>${t.date}</td>
      <td><strong>${t.driverName}</strong></td>
      <td>${t.dispatchData.map(d => `${d.quantity}x ${d.productName}`).join(', ')}</td>
      <td class="text-right"><strong>ETB ${rev.toFixed(2)}</strong></td>
      <td>${t.status === 'active' ? '<span class="badge badge-warning">Active</span>' : '<span class="badge badge-success">Completed</span>'}</td>
    `;
    overviewRecentBody.appendChild(tr);
  });
}

// ==================== GOOGLE SHEETS STORAGE INTERACTIONS ====================
if (headerSheetsBadge) {
  headerSheetsBadge.addEventListener('click', async () => {
    // Clicking badge triggers manual sync if URL configured
    if (SheetsStorage.getUrl()) {
      btnSyncNow?.classList.add('syncing');
      await SheetsStorage.pushToSheets(true);
      btnSyncNow?.classList.remove('syncing');
    } else {
      alert('Google Sheets cloud storage is configured directly in code.\nSet GOOGLE_SHEETS_WEBAPP_URL at the top of app.js to enable auto-sync.');
    }
  });
}

if (btnSyncNow) {
  btnSyncNow.addEventListener('click', async () => {
    btnSyncNow.classList.add('syncing');
    await SheetsStorage.pushToSheets(true);
    btnSyncNow.classList.remove('syncing');
  });
}

// ==================== PASSWORD SHOW / HIDE TOGGLE ====================
document.addEventListener('click', (e) => {
  const toggleBtn = e.target.closest('.btn-toggle-password');
  if (!toggleBtn) return;
  const wrapper = toggleBtn.closest('.password-wrapper');
  if (!wrapper) return;
  const input = wrapper.querySelector('input');
  if (!input) return;

  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';

  const eyeOpen = toggleBtn.querySelector('.eye-open');
  const eyeClosed = toggleBtn.querySelector('.eye-closed');
  if (eyeOpen && eyeClosed) {
    if (isPassword) {
      eyeOpen.classList.add('d-none');
      eyeClosed.classList.remove('d-none');
    } else {
      eyeOpen.classList.remove('d-none');
      eyeClosed.classList.add('d-none');
    }
  }
});

// ==================== CHANGE PASSWORD FEATURE ====================
if (btnOpenChangePass && changePassPanel) {
  btnOpenChangePass.addEventListener('click', () => {
    const isHidden = changePassPanel.classList.contains('d-none');
    if (isHidden) {
      changePassPanel.classList.remove('d-none');
      if (changePassForm) changePassForm.reset();
      if (changePassAlert) changePassAlert.classList.add('d-none');
      changeCurrentPass?.focus();
      changePassPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      changePassPanel.classList.add('d-none');
    }
  });
}

function closeChangePassPanel() {
  if (changePassPanel) {
    changePassPanel.classList.add('d-none');
    if (changePassForm) changePassForm.reset();
  }
}

if (btnCloseChangePass) btnCloseChangePass.addEventListener('click', closeChangePassPanel);
if (btnCancelChangePass) btnCancelChangePass.addEventListener('click', closeChangePassPanel);

if (changePassForm) {
  changePassForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!currentUser) return;

    const currentP = changeCurrentPass.value;
    const newP = changeNewPass.value;
    const confirmP = changeConfirmPass.value;

    if (currentUser.password !== currentP) {
      showMsg(changePassAlert, 'Current password is incorrect.');
      return;
    }
    if (newP.length < 4) {
      showMsg(changePassAlert, 'New password must be at least 4 characters.');
      return;
    }
    if (newP !== confirmP) {
      showMsg(changePassAlert, 'New passwords do not match.');
      return;
    }

    // Update in state
    const user = state.users.find(u => u.username === currentUser.username);
    if (user) user.password = newP;
    currentUser.password = newP;
    saveState();

    showMsg(changePassAlert, 'Password updated successfully!', true);
    setTimeout(() => {
      closeChangePassPanel();
    }, 1200);
  });
}

// ==================== RESET PASSWORD MODAL (ADMIN) ====================
function openResetPassModal(username) {
  if (!resetPassModal) return;
  resetPassUsername.value = username;
  resetPassTargetUser.textContent = username;
  if (resetPassForm) resetPassForm.reset();
  if (resetPassAlert) resetPassAlert.classList.add('d-none');
  resetPassModal.classList.remove('d-none');
  setTimeout(() => resetNewPass?.focus(), 50);
}

function closeResetPassModal() {
  if (resetPassModal) {
    resetPassModal.classList.add('d-none');
    if (resetPassForm) resetPassForm.reset();
  }
}

if (btnCloseResetModal) btnCloseResetModal.addEventListener('click', closeResetPassModal);
if (btnCancelResetModal) btnCancelResetModal.addEventListener('click', closeResetPassModal);

if (resetPassModal) {
  resetPassModal.addEventListener('click', (e) => {
    if (e.target === resetPassModal) {
      closeResetPassModal();
    }
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (resetPassModal && !resetPassModal.classList.contains('d-none')) {
      closeResetPassModal();
    }
  }
});

if (resetPassForm) {
  resetPassForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = resetPassUsername.value;
    const newP = resetNewPass.value;
    const confirmP = resetConfirmPass.value;

    if (!newP || newP.length < 4) {
      showMsg(resetPassAlert, 'New password must be at least 4 characters.');
      return;
    }
    if (newP !== confirmP) {
      showMsg(resetPassAlert, 'Passwords do not match.');
      return;
    }

    const u = state.users.find(user => user.username === username);
    if (!u) {
      showMsg(resetPassAlert, 'Storekeeper account not found.');
      return;
    }

    u.password = newP;
    saveState();

    showMsg(resetPassAlert, `Password for "${username}" updated successfully!`, true);
    setTimeout(() => {
      closeResetPassModal();
    }, 1200);
  });
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', initAuth);

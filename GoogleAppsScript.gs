function doGet(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var state = readStateFromSheets(ss);
    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      data: state,
      updatedAt: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(15000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var contents = e.postData ? e.postData.contents : '';
    if (!contents) {
      throw new Error('No payload received');
    }
    
    var payload = JSON.parse(contents);
    var state = payload.state || payload; // Supports wrapped or direct state
    
    // Save state into dedicated tabs, setting sheet, and sanitized backup
    saveStateToSheets(ss, state);
    
    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      message: 'State synchronized successfully',
      updatedAt: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// ==================== SETTING SHEET HELPERS ====================
function getSettingSheet(ss) {
  return ss.getSheetByName('setting') || ss.getSheetByName('Settings');
}

function readUsersFromSettingSheet(ss) {
  var sheet = getSettingSheet(ss);
  if (!sheet) return [];
  
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 2) return [];

  var data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  if (!data || data.length < 2) return [];

  // Parse header row dynamically to find column indexes
  var headers = data[0].map(function(h) { return String(h || '').trim().toLowerCase(); });
  
  var roleIdx = headers.indexOf('role');
  var userIdx = headers.indexOf('username');
  if (userIdx === -1) userIdx = headers.indexOf('user');
  var passIdx = headers.indexOf('password');
  if (passIdx === -1) passIdx = headers.indexOf('pass');
  var storeNameIdx = headers.indexOf('assigned store');
  if (storeNameIdx === -1) storeNameIdx = headers.indexOf('store name');
  var storeIdIdx = headers.indexOf('store id');
  if (storeIdIdx === -1) storeIdIdx = headers.indexOf('storeid');

  // Standard positional fallbacks if custom headers aren't detected
  if (roleIdx === -1) roleIdx = 0;
  if (userIdx === -1) userIdx = 1;
  if (passIdx === -1) passIdx = 2;
  if (storeNameIdx === -1) storeNameIdx = 3;
  if (storeIdIdx === -1) storeIdIdx = 4;

  var users = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var username = String(row[userIdx] !== undefined ? row[userIdx] : '').trim();
    if (!username) continue; // Skip empty row

    // Stop if we hit a section divider or config table
    if (username.indexOf('---') !== -1 || username.toLowerCase().indexOf('setting') !== -1 || username.toLowerCase().indexOf('credential') !== -1) {
      break;
    }

    var role = String(row[roleIdx] !== undefined ? row[roleIdx] : '').trim().toLowerCase();
    if (!role) role = 'storekeeper';
    if (role === 'admin') role = 'owner';

    var password = String(row[passIdx] !== undefined ? row[passIdx] : '').trim();
    var rawStoreId = row[storeIdIdx] !== undefined ? String(row[storeIdIdx]).trim() : '';
    var storeId = (rawStoreId && rawStoreId !== 'null' && rawStoreId !== 'undefined') ? rawStoreId : null;

    users.push({
      role: role,
      username: username,
      password: password,
      storeId: storeId
    });
  }

  return users;
}

function writeUsersToSettingSheet(ss, users, stores) {
  var sheet = getOrCreateSheet(ss, 'setting');
  sheet.clear();

  // 1. User & Role Credentials Table
  var rows = [
    ['Role', 'Username', 'Password', 'Assigned Store', 'Store ID', 'Status', 'Updated At']
  ];

  var storesList = stores || [];
  (users || []).forEach(function(u) {
    var storeName = 'All Stores (Owner)';
    if (u.role !== 'owner' && u.storeId) {
      var foundStore = storesList.find(function(s) { return s.id === u.storeId; });
      storeName = foundStore ? foundStore.name : (u.storeId || 'Unassigned');
    }
    rows.push([
      u.role || 'storekeeper',
      u.username,
      u.password,
      storeName,
      u.storeId || 'null',
      'Active',
      new Date().toISOString()
    ]);
  });

  // 2. Empty spacing row
  rows.push(['', '', '', '', '', '', '']);

  // 3. Other Credentials & System Configuration Table
  rows.push(['--- SYSTEM CREDENTIALS & CONFIGURATION ---', '', '', '', '', '', '']);
  rows.push(['Setting / Credential Key', 'Value', 'Description', '', '', '', '']);
  rows.push(['DEFAULT_OWNER_ROLE', 'owner', 'Top-level administrative privileges across all stores', '', '', '', '']);
  rows.push(['DEFAULT_ADMIN_USER', 'admin', 'Root owner account identifier', '', '', '', '']);
  rows.push(['APP_NAME', 'Tsidu Inventory', 'Application identifier', '', '', '', '']);
  rows.push(['DEFAULT_CURRENCY', 'ETB', 'Primary operating transactional currency', '', '', '', '']);
  rows.push(['CREDENTIAL_STORAGE', 'setting', 'User roles, usernames, passwords stored in this sheet', '', '', '', '']);
  rows.push(['RAW_STATE_SECURITY', 'Sanitized', 'User credentials excluded from RAW_STATE backup', '', '', '', '']);

  // Write all rows
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);

  // Style Header Row
  var header = sheet.getRange(1, 1, 1, rows[0].length);
  header.setFontWeight('bold');
  header.setBackground('#4338ca'); // Indigo
  header.setFontColor('#ffffff');
  sheet.setFrozenRows(1);

  // Style Section Divider & Subheaders
  var sectionRow = users.length + 3;
  var sectionHeader = sheet.getRange(sectionRow, 1, 1, rows[0].length);
  sectionHeader.setFontWeight('bold');
  sectionHeader.setBackground('#1e1b4b'); // Dark indigo
  sectionHeader.setFontColor('#a5b4fc');

  var subHeader = sheet.getRange(sectionRow + 1, 1, 1, 3);
  subHeader.setFontWeight('bold');
  subHeader.setBackground('#312e81');
  subHeader.setFontColor('#ffffff');

  // Auto-resize columns for readability
  for (var c = 1; c <= rows[0].length; c++) {
    sheet.autoResizeColumn(c);
  }
}

// ==================== READ FROM SHEETS ====================
function readStateFromSheets(ss) {
  // 1. Read operational inventory from RAW_STATE
  var rawSheet = ss.getSheetByName('RAW_STATE');
  var state = { users: [], stores: [], storeData: {} };
  if (rawSheet) {
    var lastRow = rawSheet.getLastRow();
    if (lastRow > 0) {
      var values = rawSheet.getRange(1, 1, lastRow, 1).getValues();
      var fullStr = values.map(function(r) { return r[0]; }).join('');
      if (fullStr && fullStr.trim().startsWith('{')) {
        try {
          state = JSON.parse(fullStr);
        } catch (e) {}
      }
    }
  }

  // Ensure state structure
  if (!state.stores) state.stores = [];
  if (!state.storeData) state.storeData = {};

  // 2. Read users & credentials from 'setting' sheet (NOT from RAW_STATE)
  var usersFromSetting = readUsersFromSettingSheet(ss);

  // Migration: If setting sheet had no users yet, check if legacy RAW_STATE had them
  if (usersFromSetting.length === 0 && state.users && Array.isArray(state.users) && state.users.length > 0) {
    writeUsersToSettingSheet(ss, state.users, state.stores);
    usersFromSetting = state.users;
  }

  // Multi-device guarantee: Ensure default owner admin exists in cloud state
  if (usersFromSetting.length === 0 || !usersFromSetting.some(function(u) { return u.role === 'owner'; })) {
    var defaultOwner = { username: 'admin', password: 'admin', role: 'owner', storeId: null };
    usersFromSetting.unshift(defaultOwner);
    writeUsersToSettingSheet(ss, usersFromSetting, state.stores);
  }

  // Set users in returned state
  state.users = usersFromSetting;

  return state;
}

// ==================== SAVE TO SHEETS ====================
function saveStateToSheets(ss, state) {
  // 1. Store User Roles, Usernames, Passwords and Credentials in the 'setting' sheet
  var currentSheetUsers = readUsersFromSettingSheet(ss);
  var mergedUsers = (state.users || []).slice();

  // If setting sheet has users created/edited directly in Google Sheets, preserve them
  currentSheetUsers.forEach(function(su) {
    var exists = mergedUsers.some(function(u) {
      return u.username.toLowerCase() === su.username.toLowerCase();
    });
    if (!exists) {
      mergedUsers.push(su);
    }
  });

  if (mergedUsers.length === 0) {
    mergedUsers.push({ username: 'admin', password: 'admin', role: 'owner', storeId: null });
  }

  writeUsersToSettingSheet(ss, mergedUsers, state.stores);

  // 2. Save Raw JSON State WITHOUT users/passwords/credentials (Sanitized state)
  var rawState = JSON.parse(JSON.stringify(state));
  rawState.users = []; // Exclude users and credentials from RAW_STATE backup
  delete rawState.credentials;

  var rawSheet = getOrCreateSheet(ss, 'RAW_STATE');
  rawSheet.clear();
  var jsonStr = JSON.stringify(rawState);
  var chunkSize = 45000;
  var chunks = [];
  for (var i = 0; i < jsonStr.length; i += chunkSize) {
    chunks.push([jsonStr.substring(i, i + chunkSize)]);
  }
  rawSheet.getRange(1, 1, chunks.length, 1).setValues(chunks);
  rawSheet.hideSheet();

  // 3. Human-friendly Tables: Products (includes Min Stock Alert Level)
  var prodSheet = getOrCreateSheet(ss, 'Products');
  prodSheet.clear();
  var prodRows = [['Store Name', 'Product ID', 'SKU', 'Product Name', 'Stock Qty', 'Min Alert Qty', 'Unit Price (ETB)']];
  
  // 4. Human-friendly Tables: Drivers
  var driverSheet = getOrCreateSheet(ss, 'Drivers');
  driverSheet.clear();
  var driverRows = [['Store Name', 'Driver ID', 'Driver Name', 'Phone']];

  // 5. Human-friendly Tables: Trips (includes Damaged Goods & Settlement Tracking)
  var tripSheet = getOrCreateSheet(ss, 'Trips');
  tripSheet.clear();
  var tripRows = [['Store Name', 'Trip ID', 'Date', 'Driver Name', 'Status', 'Dispatched Summary', 'Sold Summary', 'Returned Summary', 'Damaged Summary', 'Gross Revenue (ETB)', 'Amount Paid (ETB)', 'Balance Due (ETB)', 'Settlement Status']];

  // 6. Human-friendly Tables: Payments (includes Linked Trip ID)
  var paySheet = getOrCreateSheet(ss, 'Payments');
  paySheet.clear();
  var payRows = [['Store Name', 'Payment ID', 'Date', 'Party', 'Type', 'Amount (ETB)', 'Linked Trip ID', 'Note']];

  // 7. Human-friendly Tables: Credit & Receivables Ledger
  var ledgerSheet = getOrCreateSheet(ss, 'Credit_Ledger');
  ledgerSheet.clear();
  var ledgerRows = [['Store Name', 'Party / Driver', 'Role', 'Total Incurred (ETB)', 'Total Paid (ETB)', 'Balance Due (ETB)', 'Status']];

  // Populate data per store
  (state.stores || []).forEach(function(store) {
    var sData = (state.storeData && state.storeData[store.id]) || { products: [], drivers: [], trips: [], payments: [] };
    
    // Products
    (sData.products || []).forEach(function(p) {
      prodRows.push([store.name, p.id, p.sku, p.name, p.stock, p.minStock || 10, p.price]);
    });

    // Drivers
    (sData.drivers || []).forEach(function(d) {
      driverRows.push([store.name, d.id, d.name, d.phone || '']);
    });

    // Trips
    (sData.trips || []).forEach(function(t) {
      var dispatched = (t.dispatchData || []).map(function(d) { return d.quantity + 'x ' + d.productName; }).join(', ');
      var sold = (t.returnData || []).map(function(r) { return r.sold + 'x ' + (getProdName(sData.products, r.productId)); }).join(', ');
      var returned = (t.returnData || []).map(function(r) { return r.returned + 'x ' + (getProdName(sData.products, r.productId)); }).join(', ');
      var damaged = (t.returnData || []).map(function(r) { return (r.damaged || 0) + 'x ' + (getProdName(sData.products, r.productId)); }).join(', ');
      
      var rev = (t.dispatchData || []).reduce(function(sum, d) {
        var r = (t.returnData || []).find(function(ret) { return ret.productId === d.productId; }) || { sold: 0 };
        return sum + (r.sold * (d.price || 0));
      }, 0);

      var paid = (sData.payments || [])
        .filter(function(p) { return p.tripId === t.id || (p.note && p.note.indexOf(t.id) !== -1); })
        .reduce(function(sum, p) { return sum + (p.type === 'credit' ? 0 : (p.amount || 0)); }, 0);
      
      var balanceDue = Math.max(0, rev - paid);
      var settlementStatus = (t.status === 'active') ? 'On Road' : (balanceDue === 0 ? 'Settled' : (paid > 0 ? 'Partial' : 'Unpaid'));

      tripRows.push([store.name, t.id, t.date, t.driverName, t.status, dispatched, sold, returned, damaged, rev, paid, balanceDue, settlementStatus]);
    });

    // Payments
    (sData.payments || []).forEach(function(p) {
      payRows.push([store.name, p.id, p.date, p.party, p.type, p.amount, p.tripId || '', p.note || '']);
    });

    // Credit Ledger calculation per store
    var ledgerMap = {};
    (sData.trips || []).forEach(function(t) {
      if (t.status === 'completed') {
        var party = (t.driverName || '').trim();
        if (!ledgerMap[party]) ledgerMap[party] = { party: party, role: 'Driver', incurred: 0, paid: 0 };
        var tripRev = (t.dispatchData || []).reduce(function(sum, d) {
          var r = (t.returnData || []).find(function(ret) { return ret.productId === d.productId; }) || { sold: 0 };
          return sum + (r.sold * (d.price || 0));
        }, 0);
        ledgerMap[party].incurred += tripRev;
      }
    });

    (sData.payments || []).forEach(function(p) {
      var party = (p.party || '').trim();
      if (!ledgerMap[party]) {
        var isDriver = (sData.drivers || []).some(function(d) { return d.name.toLowerCase() === party.toLowerCase(); });
        ledgerMap[party] = { party: party, role: isDriver ? 'Driver' : 'Customer', incurred: 0, paid: 0 };
      }
      if (p.type === 'credit') {
        ledgerMap[party].incurred += p.amount;
      } else {
        ledgerMap[party].paid += p.amount;
      }
    });

    Object.keys(ledgerMap).forEach(function(k) {
      var entry = ledgerMap[k];
      var bal = Math.max(0, entry.incurred - entry.paid);
      var status = bal > 0 ? 'Due' : 'Clear';
      ledgerRows.push([store.name, entry.party, entry.role, entry.incurred, entry.paid, bal, status]);
    });
  });

  writeSheetData(prodSheet, prodRows);
  writeSheetData(driverSheet, driverRows);
  writeSheetData(tripSheet, tripRows);
  writeSheetData(paySheet, payRows);
  writeSheetData(ledgerSheet, ledgerRows);

  // Sync Log sheet
  var logSheet = getOrCreateSheet(ss, 'Sync_Log');
  logSheet.appendRow([new Date(), 'Synced from Tsidu Web App', Object.keys(state.storeData || {}).length + ' stores synced, ' + mergedUsers.length + ' users in setting sheet']);
}

function getProdName(products, id) {
  var p = (products || []).find(function(item) { return item.id === id; });
  return p ? p.name : id;
}

function getOrCreateSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

function writeSheetData(sheet, rows) {
  if (rows.length === 0) return;
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  
  // Style header row
  var header = sheet.getRange(1, 1, 1, rows[0].length);
  header.setFontWeight('bold');
  header.setBackground('#4338ca');
  header.setFontColor('#ffffff');
  sheet.setFrozenRows(1);
}

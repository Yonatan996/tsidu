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

// ==================== USER VALIDATION & FILTERING ====================
function isGenuineUser(u) {
  if (!u || !u.username) return false;
  var un = String(u.username).trim().toLowerCase();
  var role = String(u.role || '').trim().toLowerCase();
  
  // Reject any bogus config rows or header echoes
  if (role.indexOf('default_admin') !== -1 ||
      role.indexOf('app_name') !== -1 ||
      role.indexOf('default_currency') !== -1 ||
      role.indexOf('credential') !== -1 ||
      role.indexOf('setting') !== -1 ||
      role.indexOf('raw_state') !== -1 ||
      role.indexOf('---') !== -1 ||
      un.indexOf('---') !== -1 ||
      un === 'value' ||
      un === 'description' ||
      un === 'tsidu inventory' ||
      un === 'etb' ||
      un === 'username') {
    return false;
  }
  return true;
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

    var role = String(row[roleIdx] !== undefined ? row[roleIdx] : '').trim().toLowerCase();
    if (!role) role = 'storekeeper';
    if (role === 'admin') role = 'owner';

    var password = String(row[passIdx] !== undefined ? row[passIdx] : '').trim();
    var rawStoreId = row[storeIdIdx] !== undefined ? String(row[storeIdIdx]).trim() : '';
    var storeId = (rawStoreId && rawStoreId !== 'null' && rawStoreId !== 'undefined') ? rawStoreId : null;

    var candidate = {
      role: role,
      username: username,
      password: password,
      storeId: storeId
    };

    if (isGenuineUser(candidate)) {
      users.push(candidate);
    }
  }

  return users;
}

function writeUsersToSettingSheet(ss, users, stores) {
  var sheet = getOrCreateSheet(ss, 'setting');
  sheet.clear();

  // Pure, clean User & Role Credentials Table ONLY
  var rows = [
    ['Role', 'Username', 'Password', 'Assigned Store', 'Store ID', 'Status', 'Updated At']
  ];

  var validUsers = (users || []).filter(isGenuineUser);
  if (!validUsers.some(function(u) { return u.role === 'owner'; })) {
    validUsers.unshift({ username: 'admin', password: 'admin', role: 'owner', storeId: null });
  }

  var storesList = stores || [];
  validUsers.forEach(function(u) {
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

  // Write all rows (ONLY the clean user accounts table)
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);

  // Style Header Row
  var header = sheet.getRange(1, 1, 1, rows[0].length);
  header.setFontWeight('bold');
  header.setBackground('#4338ca'); // Indigo
  header.setFontColor('#ffffff');
  sheet.setFrozenRows(1);

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

  // Products Tab Fallback: Restore products from the human-editable 'Products' tab if RAW_STATE has empty products
  var prodSheet = ss.getSheetByName('Products');
  if (prodSheet && prodSheet.getLastRow() > 1) {
    try {
      var prodData = prodSheet.getRange(1, 1, prodSheet.getLastRow(), prodSheet.getLastColumn()).getValues();
      var pHeaders = prodData[0].map(function(h) { return String(h || '').trim().toLowerCase(); });
      var sNameIdx = pHeaders.indexOf('store name');
      var pIdIdx = pHeaders.indexOf('product id');
      var skuIdx = pHeaders.indexOf('sku');
      var nameIdx = pHeaders.indexOf('product name');
      var stockIdx = pHeaders.indexOf('stock qty');
      var minIdx = pHeaders.indexOf('min alert qty');
      var priceIdx = pHeaders.indexOf('unit price (etb)');

      if (sNameIdx === -1) sNameIdx = 0;
      if (pIdIdx === -1) pIdIdx = 1;
      if (skuIdx === -1) skuIdx = 2;
      if (nameIdx === -1) nameIdx = 3;
      if (stockIdx === -1) stockIdx = 4;
      if (minIdx === -1) minIdx = 5;
      if (priceIdx === -1) priceIdx = 6;

      var storeProductsMap = {};
      for (var pi = 1; pi < prodData.length; pi++) {
        var pRow = prodData[pi];
        var sName = String(pRow[sNameIdx] || '').trim().toLowerCase();
        var pName = String(pRow[nameIdx] || '').trim();
        if (!sName || !pName) continue;
        if (!storeProductsMap[sName]) storeProductsMap[sName] = [];
        storeProductsMap[sName].push({
          id: String(pRow[pIdIdx] || ('p_' + pi)).trim(),
          sku: String(pRow[skuIdx] || '').trim(),
          name: pName,
          stock: Number(pRow[stockIdx]) || 0,
          minStock: Number(pRow[minIdx]) || 10,
          price: Number(pRow[priceIdx]) || 0
        });
      }

      state.stores.forEach(function(s) {
        if (!state.storeData[s.id]) {
          state.storeData[s.id] = { products: [], drivers: [], trips: [], payments: [] };
        }
        var curProds = state.storeData[s.id].products || [];
        var foundProds = storeProductsMap[s.name.toLowerCase()];
        if (curProds.length === 0 && foundProds && foundProds.length > 0) {
          state.storeData[s.id].products = foundProds;
        }
      });
    } catch (pe) {}
  }

  // 2. Read users & credentials from 'setting' sheet (NOT from RAW_STATE)
  var usersFromSetting = readUsersFromSettingSheet(ss).filter(isGenuineUser);

  // Migration: If setting sheet had no users yet, check if legacy RAW_STATE had them
  if (usersFromSetting.length === 0 && state.users && Array.isArray(state.users)) {
    var legacyUsers = state.users.filter(isGenuineUser);
    if (legacyUsers.length > 0) {
      writeUsersToSettingSheet(ss, legacyUsers, state.stores);
      usersFromSetting = legacyUsers;
    }
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
  var currentSheetUsers = readUsersFromSettingSheet(ss).filter(isGenuineUser);
  var mergedUsers = (state.users || []).filter(isGenuineUser);

  // If setting sheet has users created/edited directly in Google Sheets, preserve them
  currentSheetUsers.forEach(function(su) {
    var exists = mergedUsers.some(function(u) {
      return u.username.toLowerCase() === su.username.toLowerCase();
    });
    if (!exists) {
      mergedUsers.push(su);
    }
  });

  if (mergedUsers.length === 0 || !mergedUsers.some(function(u) { return u.role === 'owner'; })) {
    mergedUsers.unshift({ username: 'admin', password: 'admin', role: 'owner', storeId: null });
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

  // Safety: Only overwrite Products tab if valid product rows exist! Never clear into empty sheet
  if (prodRows.length > 1) {
    prodSheet.clear();
    writeSheetData(prodSheet, prodRows);
  }
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

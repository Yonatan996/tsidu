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
    
    // Save state into dedicated tabs and raw backup
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

// ==================== READ FROM SHEETS ====================
function readStateFromSheets(ss) {
  // Check if raw JSON state sheet exists
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

  // Multi-device guarantee: Ensure default owner admin exists in cloud state
  if (!state.users || !Array.isArray(state.users) || state.users.length === 0) {
    state.users = [{ username: 'admin', password: 'admin', role: 'owner', storeId: null }];
  } else if (!state.users.some(function(u) { return u.role === 'owner'; })) {
    state.users.unshift({ username: 'admin', password: 'admin', role: 'owner', storeId: null });
  }

  return state;
}

// ==================== SAVE TO SHEETS ====================
function saveStateToSheets(ss, state) {
  // 1. Save Raw JSON State with safe chunking (Google Sheets 50k char cell limit protection)
  var rawSheet = getOrCreateSheet(ss, 'RAW_STATE');
  rawSheet.clear();
  var jsonStr = JSON.stringify(state);
  var chunkSize = 45000;
  var chunks = [];
  for (var i = 0; i < jsonStr.length; i += chunkSize) {
    chunks.push([jsonStr.substring(i, i + chunkSize)]);
  }
  rawSheet.getRange(1, 1, chunks.length, 1).setValues(chunks);
  rawSheet.hideSheet();

  // 2. Human-friendly Tables: Products (includes Min Stock Alert Level)
  var prodSheet = getOrCreateSheet(ss, 'Products');
  prodSheet.clear();
  var prodRows = [['Store Name', 'Product ID', 'SKU', 'Product Name', 'Stock Qty', 'Min Alert Qty', 'Unit Price (ETB)']];
  
  // 3. Human-friendly Tables: Drivers
  var driverSheet = getOrCreateSheet(ss, 'Drivers');
  driverSheet.clear();
  var driverRows = [['Store Name', 'Driver ID', 'Driver Name', 'Phone']];

  // 4. Human-friendly Tables: Trips (includes Damaged Goods & Settlement Tracking)
  var tripSheet = getOrCreateSheet(ss, 'Trips');
  tripSheet.clear();
  var tripRows = [['Store Name', 'Trip ID', 'Date', 'Driver Name', 'Status', 'Dispatched Summary', 'Sold Summary', 'Returned Summary', 'Damaged Summary', 'Gross Revenue (ETB)', 'Amount Paid (ETB)', 'Balance Due (ETB)', 'Settlement Status']];

  // 5. Human-friendly Tables: Payments (includes Linked Trip ID)
  var paySheet = getOrCreateSheet(ss, 'Payments');
  paySheet.clear();
  var payRows = [['Store Name', 'Payment ID', 'Date', 'Party', 'Type', 'Amount (ETB)', 'Linked Trip ID', 'Note']];

  // 6. Human-friendly Tables: Credit & Receivables Ledger
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
  logSheet.appendRow([new Date(), 'Synced from Tsidu Web App', Object.keys(state.storeData || {}).length + ' stores synced']);
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

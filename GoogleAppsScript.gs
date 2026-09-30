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
  if (rawSheet) {
    var val = rawSheet.getRange('A1').getValue();
    if (val && typeof val === 'string' && val.trim().startsWith('{')) {
      return JSON.parse(val);
    }
  }
  
  // Otherwise construct from tabular sheets if available
  return {
    users: [],
    stores: [],
    storeData: {}
  };
}

// ==================== SAVE TO SHEETS ====================
function saveStateToSheets(ss, state) {
  // 1. Save Raw JSON State for 100% lossless fidelity
  var rawSheet = getOrCreateSheet(ss, 'RAW_STATE');
  rawSheet.getRange('A1').setValue(JSON.stringify(state));
  rawSheet.hideSheet();

  // 2. Human-friendly Tables: Products
  var prodSheet = getOrCreateSheet(ss, 'Products');
  prodSheet.clear();
  var prodRows = [['Store Name', 'Product ID', 'SKU', 'Product Name', 'Stock Qty', 'Unit Price (ETB)']];
  
  // 3. Human-friendly Tables: Drivers
  var driverSheet = getOrCreateSheet(ss, 'Drivers');
  driverSheet.clear();
  var driverRows = [['Store Name', 'Driver ID', 'Driver Name', 'Phone']];

  // 4. Human-friendly Tables: Trips
  var tripSheet = getOrCreateSheet(ss, 'Trips');
  tripSheet.clear();
  var tripRows = [['Store Name', 'Trip ID', 'Date', 'Driver Name', 'Status', 'Dispatched Summary', 'Sold Summary', 'Returned Summary', 'Total Revenue (ETB)']];

  // 5. Human-friendly Tables: Payments
  var paySheet = getOrCreateSheet(ss, 'Payments');
  paySheet.clear();
  var payRows = [['Store Name', 'Payment ID', 'Date', 'Party', 'Type', 'Amount (ETB)', 'Note']];

  // Populate data per store
  (state.stores || []).forEach(function(store) {
    var sData = (state.storeData && state.storeData[store.id]) || { products: [], drivers: [], trips: [], payments: [] };
    
    // Products
    (sData.products || []).forEach(function(p) {
      prodRows.push([store.name, p.id, p.sku, p.name, p.stock, p.price]);
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
      var rev = (t.dispatchData || []).reduce(function(sum, d) {
        var r = (t.returnData || []).find(function(ret) { return ret.productId === d.productId; }) || { sold: 0 };
        return sum + (r.sold * (d.price || 0));
      }, 0);
      tripRows.push([store.name, t.id, t.date, t.driverName, t.status, dispatched, sold, returned, rev]);
    });

    // Payments
    (sData.payments || []).forEach(function(p) {
      payRows.push([store.name, p.id, p.date, p.party, p.type, p.amount, p.note || '']);
    });
  });

  writeSheetData(prodSheet, prodRows);
  writeSheetData(driverSheet, driverRows);
  writeSheetData(tripSheet, tripRows);
  writeSheetData(paySheet, payRows);

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

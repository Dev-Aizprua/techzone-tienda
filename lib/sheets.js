// lib/sheets.js - Conexión con Google Sheets

const { google } = require('googleapis');

// ID de tu Google Sheet
const SHEET_ID = '1JbcsekjdeU1o91ByS9OaT0xdiBsH1A-c-C6tNmO4Rk8';

// Configurar autenticación
function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  
  return new google.auth.GoogleAuth({
    credentials: credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

// Obtener cliente de Sheets
function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

// Leer productos
async function getProductos() {
  try {
    const sheets = getSheetsClient();
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Productos!A2:K100', // ← AUMENTADO HASTA K
    });
    
    const rows = response.data.values || [];
    
    console.log('📊 Total rows:', rows.length);
    console.log('📋 Primera fila:', rows[0]);
    
    // Mapear a objetos
    const productos = rows.map((row, index) => {
      // Limpiar valores numéricos (quitar comas, símbolos $)
      const precioBaseStr = row[3] ? row[3].toString().replace(/[,$\s]/g, '') : '0';
      const itbmsPorcStr = row[8] ? row[8].toString().replace(/[%\s]/g, '') : '7';
      const costoStr = row[9] ? row[9].toString().replace(/[,$\s]/g, '') : '0';
      
      const precioBase = parseFloat(precioBaseStr) || 0;
      const itbmsPorc = parseFloat(itbmsPorcStr) || 7;
      const costo = parseFloat(costoStr) || 0;
      
      if (index === 0) {
        console.log('🔍 Debug primer producto:');
        console.log('  row[3] (precioBase):', row[3], '→', precioBase);
        console.log('  row[8] (itbmsPorc):', row[8], '→', itbmsPorc);
      }
      
      return {
        id: row[0] || '',
        nombre: row[1] || '',
        descripcion: row[2] || '',
        precioBase: precioBase,
        categoria: row[4] || '',
        imagen: row[5] || '',
        stock: parseInt(row[6]) || 0,
        destacado: row[7] === 'Sí' || row[7] === 'Si' || row[7] === 'YES',
        itbmsPorc: itbmsPorc,
        costo: costo,
      };
    });
    
    // Calcular precio final con ITBMS
    const productosConPrecio = productos.map(p => ({
      ...p,
      itbmsMonto: p.precioBase * (p.itbmsPorc / 100),
      precioFinal: p.precioBase * (1 + p.itbmsPorc / 100),
    }));
    
    console.log('✅ Primer producto con precio:', productosConPrecio[0]);
    
    return productosConPrecio;
    
  } catch (error) {
    console.error('❌ Error al obtener productos:', error);
    throw error;
  }
}

// Obtener un producto por ID
async function getProductoPorId(id) {
  const productos = await getProductos();
  return productos.find(p => p.id === id);
}

module.exports = {
  getProductos,
  getProductoPorId,
  SHEET_ID,
};
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
      range: 'Productos!A2:K100',
    });
    
    const rows = response.data.values || [];
    
    console.log('📊 Total rows:', rows.length);
    if (rows.length > 0) {
      console.log('📋 Primera fila:', rows[0]);
    }
    
    // Mapear a objetos
    const productos = rows.map((row, index) => {
      // Limpieza ROBUSTA de valores numéricos - quita TODO excepto números y punto decimal
      const precioLimpio = row[3] ? row[3].toString().replace(/[^0-9.]/g, '') : '0';
      const itbmsLimpio = row[8] ? row[8].toString().replace(/[^0-9.]/g, '') : '7';
      const costoLimpio = row[9] ? row[9].toString().replace(/[^0-9.]/g, '') : '0';
      
      const precioBase = parseFloat(precioLimpio) || 0;
      const itbmsPorc = parseFloat(itbmsLimpio) || 7;
      const costo = parseFloat(costoLimpio) || 0;
      
      // Debug solo del primer producto
      if (index === 0) {
        console.log('🔍 Debug primer producto:');
        console.log('  row[3] original:', row[3]);
        console.log('  precioLimpio:', precioLimpio);
        console.log('  precioBase final:', precioBase);
        console.log('  row[8] original:', row[8]);
        console.log('  itbmsPorc final:', itbmsPorc);
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
    
    console.log('✅ Primer producto procesado:');
    console.log('   ID:', productosConPrecio[0].id);
    console.log('   Nombre:', productosConPrecio[0].nombre);
    console.log('   Precio Base:', productosConPrecio[0].precioBase);
    console.log('   ITBMS %:', productosConPrecio[0].itbmsPorc);
    console.log('   Precio Final:', productosConPrecio[0].precioFinal);
    
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
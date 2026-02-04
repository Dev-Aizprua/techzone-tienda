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

// Función para limpiar valores numéricos de CUALQUIER formato
function limpiarNumero(valor, porDefecto = 0) {
  if (!valor) return porDefecto;
  
  // Convertir a string
  let str = valor.toString().trim();
  
  // Quitar espacios
  str = str.replace(/\s+/g, '');
  
  // Quitar símbolos de moneda y otros
  str = str.replace(/[$€£¥₡]/g, '');
  
  // Quitar porcentajes
  str = str.replace(/%/g, '');
  
  // Quitar comas de miles (formato USA: 1,299.00)
  str = str.replace(/,/g, '');
  
  // Ahora solo deben quedar números y punto decimal
  str = str.replace(/[^0-9.]/g, '');
  
  // Convertir a número
  const numero = parseFloat(str);
  
  // Retornar el número o el valor por defecto
  return isNaN(numero) ? porDefecto : numero;
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
      // Usar la función de limpieza robusta
      const precioBase = limpiarNumero(row[3], 0);
      const itbmsPorc = limpiarNumero(row[8], 7);
      const costo = limpiarNumero(row[9], 0);
      
      // Debug solo del primer producto
      if (index === 0) {
        console.log('🔍 Debug primer producto:');
        console.log('  row[3] original:', row[3]);
        console.log('  precioBase limpio:', precioBase);
        console.log('  row[8] original:', row[8]);
        console.log('  itbmsPorc limpio:', itbmsPorc);
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
    console.log('   ITBMS Monto:', productosConPrecio[0].itbmsMonto);
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
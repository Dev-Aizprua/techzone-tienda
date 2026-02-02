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
      range: 'Productos!A2:J100',
    });
    
    const rows = response.data.values || [];
    
    // Mapear a objetos
    const productos = rows.map(row => ({
      id: row[0],
      nombre: row[1],
      descripcion: row[2],
      precioBase: parseFloat(row[3]) || 0,
      categoria: row[4],
      imagen: row[5],
      stock: parseInt(row[6]) || 0,
      destacado: row[7] === 'Sí' || row[7] === 'Si',
      itbmsPorc: parseFloat(row[8]) || 7,
      costo: parseFloat(row[9]) || 0,
    }));
    
    // Calcular precio final con ITBMS
    return productos.map(p => ({
      ...p,
      itbmsMonto: p.precioBase * (p.itbmsPorc / 100),
      precioFinal: p.precioBase * (1 + p.itbmsPorc / 100),
    }));
    
  } catch (error) {
    console.error('Error al obtener productos:', error);
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
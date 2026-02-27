// lib/sheets.js - VERSIÓN SEGURA
const { google } = require('googleapis');

// ✅ SHEET_ID desde variable de entorno
const SHEET_ID = process.env.SHEET_ID;

function getAuth() {
  // ✅ Validar que existan las credenciales
  if (!process.env.GOOGLE_CREDENTIALS) {
    throw new Error('Credenciales de Google no configuradas');
  }
  if (!SHEET_ID) {
    throw new Error('SHEET_ID no configurado');
  }

  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

function limpiarNumero(valor, porDefecto = 0) {
  if (!valor) return porDefecto;
  let str = valor.toString().trim()
    .replace(/\s+/g, '')
    .replace(/[$€£¥₡]/g, '')
    .replace(/%/g, '')
    .replace(/,/g, '')
    .replace(/[^0-9.]/g, '');
  const numero = parseFloat(str);
  return isNaN(numero) ? porDefecto : numero;
}

async function getProductos() {
  try {
    const sheets = getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Productos!A2:K100',
    });

    const rows = response.data.values || [];

    const productos = rows
      .filter(row => row[0]) // ✅ Ignorar filas vacías
      .map(row => {
        const precioBase = limpiarNumero(row[3], 0);
        const itbmsPorc  = limpiarNumero(row[8], 7);
        const costo      = limpiarNumero(row[9], 0);

        return {
          id:          row[0] || '',
          nombre:      row[1] || '',
          descripcion: row[2] || '',
          precioBase,
          categoria:   row[4] || '',
          imagen:      row[5] || '',
          stock:       parseInt(row[6]) || 0,
          destacado:   ['Sí','Si','YES'].includes(row[7]),
          itbmsPorc,
          costo,
          // ✅ Calcular directamente aquí
          itbmsMonto: precioBase * (itbmsPorc / 100),
          precioFinal: precioBase * (1 + itbmsPorc / 100),
        };
      });

    return productos;

  } catch (error) {
    // ✅ Log interno sin exponer al cliente
    console.error('Error al obtener productos:', error.message);
    throw new Error('No se pudieron cargar los productos');
  }
}

async function getProductoPorId(id) {
  if (!id) return null;
  const productos = await getProductos();
  return productos.find(p => p.id === id) || null;
}

module.exports = { getProductos, getProductoPorId, SHEET_ID };
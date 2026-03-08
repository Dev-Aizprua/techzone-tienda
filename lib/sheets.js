// lib/sheets.js — Compatible con Vercel Y Cloudflare Pages
// - Vercel llama: getProductos()         (sin parámetro, usa process.env)
// - Cloudflare llama: getProductos(env)  (con parámetro env del Worker)

import { google } from 'googleapis';

function limpiarNumero(valor, porDefecto = 0) {
  if (!valor) return porDefecto;
  const str = valor.toString().trim()
    .replace(/\s+/g, '')
    .replace(/[$€£¥₡]/g, '')
    .replace(/%/g, '')
    .replace(/,/g, '')
    .replace(/[^0-9.]/g, '');
  const numero = parseFloat(str);
  return isNaN(numero) ? porDefecto : numero;
}

// ✅ Resuelve las variables sin importar la plataforma
function getEnvVars(env) {
  return {
    GOOGLE_CREDENTIALS: (env && env.GOOGLE_CREDENTIALS) || process.env.GOOGLE_CREDENTIALS,
    SHEET_ID:           (env && env.SHEET_ID)           || process.env.SHEET_ID,
  };
}

function getAuth(env) {
  const vars = getEnvVars(env);
  if (!vars.GOOGLE_CREDENTIALS) throw new Error('Credenciales de Google no configuradas');
  if (!vars.SHEET_ID)           throw new Error('SHEET_ID no configurado');

  const credentials = JSON.parse(vars.GOOGLE_CREDENTIALS);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function getSheetsClient(env) {
  return google.sheets({ version: 'v4', auth: getAuth(env) });
}

export async function getProductos(env = null) {
  try {
    const { SHEET_ID } = getEnvVars(env);
    const sheets = getSheetsClient(env);

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Productos!A2:K100',
    });

    const rows = response.data.values || [];

    return rows
      .filter(row => row[0])
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
          destacado:   ['Sí', 'Si', 'YES'].includes(row[7]),
          itbmsPorc,
          costo,
          itbmsMonto:  precioBase * (itbmsPorc / 100),
          precioFinal: precioBase * (1 + itbmsPorc / 100),
        };
      });

  } catch (error) {
    console.error('Error al obtener productos:', error.message);
    throw new Error('No se pudieron cargar los productos');
  }
}

export async function getProductoPorId(id, env = null) {
  if (!id) return null;
  const productos = await getProductos(env);
  return productos.find(p => p.id === id) || null;
}